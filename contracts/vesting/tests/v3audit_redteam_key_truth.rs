//! Audit of version 3 (Claude Fable 5.1, 21 Oct 2026), red team (V3R): what
//! a buyer can and cannot learn from a claim key alone, now that `claim`
//! stamps the key it returns. Every test here passes on 7361158: they pin the
//! limits of the stamp, which the site and the docs must state (the Jest test
//! v3audit_redteam_site_key_truth.test.tsx fails until they do).
//!
//! What the key says, at best: its vesting's number, that the vesting can be
//! cancelled (keys minted or stamped by version 3), and what had been claimed
//! at its last claim that paid while stamping was on. What it never says:
//! - a cancel (the contract does not hold the key then; the stamp before the
//!   cancel stays, "cancelable, 25% claimed" on a vesting that will pay 25%
//!   more at most);
//! - claims made while the owner had stamping off (the old stamp stays);
//! - claims made before version 3 (no stamp at all: a key without a stamp is
//!   not a key that paid nothing).
//!
//! And a look-alike collection can copy the name, the attributes and the
//! pictures: only the collection identifier tells, and the contract refuses a
//! look-alike key at `claim`.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

/// A minter of look-alike keys.
const FAKER: TestAddress = TestAddress::new("faker");
/// A collection issued by anyone, with mvxvest's ticker: only the random
/// suffix differs.
const FAKE_KEY: TestTokenId = TestTokenId::new("VESTKEY-abcdef");

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Nft {
    amount: u64,
    name: String,
    attributes: String,
}

fn claim_key_of(f: &mut Fixture, holder: TestAddress, nonce: u64) -> Nft {
    let mut found = Nft::default();
    f.world
        .query()
        .to(SC)
        .whitebox(mvxvest::contract_obj, |sc| {
            let data = sc.blockchain().get_esdt_token_data(
                &ManagedAddress::from(holder.to_address()),
                &EsdtTokenIdentifier::from(CLAIM_KEY.as_str()),
                nonce,
            );
            let text = |b: &ManagedBuffer<DebugApi>| {
                String::from_utf8(b.to_boxed_bytes().into_vec()).unwrap()
            };
            found = Nft {
                amount: data.amount.to_u64().unwrap_or(u64::MAX),
                name: text(&data.name),
                attributes: text(&data.attributes),
            };
        });
    found
}

fn set_stamping(f: &mut Fixture, on: bool) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_stamping(on)
        .run();
}

fn status(f: &mut Fixture, nonce: u64) -> VestingView<StaticApi> {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claim_key_status(nonce)
        .returns(ReturnsResult)
        .run()
}

/// SAFE, pinned: after a cancel the key keeps its last stamp. Bob buys a
/// key that reads "cancelable, 25% claimed" and infers 75% to come; the
/// vesting was cancelled at 50%, so 25% is all it will ever pay. Only
/// `getClaimKeyStatus` (and the site) says so: a marketplace that shows the
/// name alone cannot.
#[test]
fn safe_after_a_cancel_the_key_keeps_the_stamp_of_before() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 250);
    f.claim(CREATOR, &[1]);
    f.set_time(T0 + 500);
    f.cancel(CREATOR, &[1]);
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);

    let bought = claim_key_of(&mut f, BOB, 1);
    assert_eq!(
        bought.name,
        format!("Vesting #{id} claim key, cancelable, 25% claimed")
    );
    assert!(bought.attributes.ends_with(";cancelable:1;claimed:250"));
    let view = status(&mut f, 1);
    assert_eq!(view.cancelled_at, T0 + 500);
    assert_eq!(view.final_amount, big(500));
    assert_eq!(view.claimable, big(250), "250 more, not 750");

    // The next claim pays those 250 and burns the key: nothing to sell on.
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 250);
    assert_eq!(claim_key_of(&mut f, BOB, 1).amount, 0);
    f.check_invariant(Some(FOX));
}

/// SAFE, pinned: with stamping off (the owner's switch, meant for a protocol
/// change), claims leave the stamp as it was. A key stamped "1% claimed" is
/// drained to 99% and sold as "1% claimed"; `isKeyStamping` is the only
/// on-chain sign, so the site must show it to buyers.
#[test]
fn safe_with_stamping_off_a_drained_key_keeps_an_old_stamp() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 10);
    f.claim(CREATOR, &[1]);
    assert_eq!(
        claim_key_of(&mut f, CREATOR, 1).name,
        format!("Vesting #{id} claim key, 1% claimed")
    );

    set_stamping(&mut f, false);
    f.set_time(T0 + 999);
    f.claim(CREATOR, &[1]);
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    let bought = claim_key_of(&mut f, BOB, 1);
    assert_eq!(bought.name, format!("Vesting #{id} claim key, 1% claimed"));
    assert!(bought.attributes.ends_with(";claimed:10"));
    assert_eq!(status(&mut f, 1).claimed, big(999));
    let stamping: bool = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .is_key_stamping()
        .returns(ReturnsResult)
        .run();
    assert!(!stamping, "the only sign on chain");
    f.check_invariant(Some(FOX));
}

/// SAFE, pinned: a key whose claims all happened before version 3 (here:
/// while stamping was off, which leaves the key exactly as version 2 did)
/// carries no stamp at all, and no claim that pays nothing adds one. So "no
/// stamp" never means "nothing claimed": mainnet's keys minted by versions
/// 1 and 2 look untouched whatever they paid, until a claim that pays.
#[test]
fn safe_a_key_without_a_stamp_says_nothing_about_its_claims() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    set_stamping(&mut f, false);
    f.set_time(T0 + 990);
    f.claim(CREATOR, &[1]);
    set_stamping(&mut f, true);

    // A pass through `claim` that pays nothing (same second) does not stamp
    // either: it is refused as nothing to claim when it is the only key.
    f.claim_fails(CREATOR, &[1], "nothing to claim yet");
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    let bought = claim_key_of(&mut f, BOB, 1);
    assert_eq!(bought, minted, "byte for byte the key as minted");
    assert_eq!(bought.name, format!("Vesting #{id} claim key, cancelable"));
    assert_eq!(status(&mut f, 1).claimed, big(990));
    f.check_invariant(Some(FOX));
}

/// SAFE, pinned: anyone can issue a collection with mvxvest's ticker and
/// mint a key with the same attributes (and name and pictures: the mint
/// chooses them). The contract refuses it at `claim`; a buyer is protected
/// only by the collection identifier, which the site states.
#[test]
fn safe_a_look_alike_key_copies_everything_but_the_collection() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 250);
    f.claim(CREATOR, &[1]);
    let real = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(
        real.attributes,
        format!("{};claimed:250", key_attributes(id, FOX.as_str(), true))
    );

    f.world
        .account(FAKER)
        .nonce(1)
        .balance(big(EGLD))
        .esdt_nft_balance(
            FAKE_KEY,
            1,
            1,
            ManagedBuffer::<StaticApi>::from(real.attributes.as_bytes()),
        );
    let mut fake = ManagedVec::new();
    fake.push(Payment::new(token(FAKE_KEY), 1u64, NonZeroBigUint::one()));
    f.world
        .tx()
        .from(FAKER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(fake)
        .returns(ExpectError(4, "only claim keys can be sent"))
        .run();
}
