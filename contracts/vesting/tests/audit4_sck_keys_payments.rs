//! Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK: every kind of
//! key payment `claim` and `cancel` can meet, and the owner's key recovery.
//! All pass on 322cb43 (`safe_*`): nothing here moves funds or keys it should
//! not. (A cancel key sent to `claim`, a claim key sent to `cancel`, another
//! NFT, a fungible token and EGLD next to a key are already pinned by
//! `audit_fable_keys::safe_mixed_and_wrong_payments_move_nothing`.)
//!
//! A key sent straight to the contract with no function cannot be tested on
//! the Rust VM, which does not model the contract's payable flags; on mainnet
//! the contract is `isPayable: false`, `isPayableBySmartContract: false`
//! (API, 20 Oct 2026), so such a transfer is refused by the protocol and the
//! key never leaves its sender. The Go VM scenario
//! `audit4_sck_stray_key_to_nonpayable.scen.json` pins it.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

/// Someone else's collection with the same ticker: the random suffix differs.
const FAKE_CLAIM: TestTokenId = TestTokenId::new("VESTKEY-999999");
const FAKE_CANCEL: TestTokenId = TestTokenId::new("VESTCANCEL-999999");
const FAKER: TestAddress = TestAddress::new("faker");

fn claim_with(
    f: &mut Fixture,
    from: TestAddress,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Result<(), String> {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(payment)
        .returns(ReturnsHandledOrError::new())
        .run()
        .map(|_| ())
        .map_err(|e| e.message)
}

fn cancel_with(
    f: &mut Fixture,
    from: TestAddress,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Result<(), String> {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .payment(payment)
        .returns(ReturnsHandledOrError::new())
        .run()
        .map(|_| ())
        .map_err(|e| e.message)
}

fn one(
    token_id: TestTokenId,
    nonce: u64,
    amount: u128,
) -> ManagedVec<StaticApi, Payment<StaticApi>> {
    let mut vec = ManagedVec::new();
    vec.push(Payment::new(
        token(token_id),
        nonce,
        NonZeroBigUint::new_or_panic(big(amount)),
    ));
    vec
}

/// SAFE: a look-alike collection issued by someone else with the same ticker
/// (`VESTKEY-999999`, nonce 1, the real key's name and attributes copied)
/// opens nothing: the contract compares the whole identifier with the
/// collection it issued, then its own nonce map.
#[test]
fn safe_a_look_alike_collection_with_the_same_ticker_opens_nothing() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let attributes = key_attributes(id, FOX.as_str(), true);
    f.world
        .account(FAKER)
        .nonce(1)
        .esdt_nft_balance(
            FAKE_CLAIM,
            1,
            1,
            ManagedBuffer::<StaticApi>::from(attributes.as_bytes()),
        )
        .esdt_nft_balance(
            FAKE_CANCEL,
            1,
            1,
            ManagedBuffer::<StaticApi>::from(attributes.as_bytes()),
        );
    f.set_time(T0 + 500);
    assert_eq!(
        claim_with(&mut f, FAKER, one(FAKE_CLAIM, 1, 1)),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    assert_eq!(
        cancel_with(&mut f, FAKER, one(FAKE_CANCEL, 1, 1)),
        Err(ERR_NOT_CANCEL_KEY.to_string())
    );
    // The reverse, for completeness.
    assert_eq!(
        claim_with(&mut f, FAKER, one(FAKE_CANCEL, 1, 1)),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    assert_eq!(
        cancel_with(&mut f, FAKER, one(FAKE_CLAIM, 1, 1)),
        Err(ERR_NOT_CANCEL_KEY.to_string())
    );
    let view = f.view(id);
    assert_eq!((view.claimed, view.cancelled_at), (big(0), 0));
    f.world
        .check_account(FAKER)
        .esdt_nft_balance_and_attributes(FAKE_CLAIM, 1, 1, attributes.as_bytes())
        .esdt_nft_balance_and_attributes(FAKE_CANCEL, 1, 1, attributes.as_bytes());
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, id, FOX.as_str());
    f.check_invariant(Some(FOX));
}

/// SAFE: the same key twice in one call, or a quantity of 2 of it, is
/// refused as a whole (an NFT has one unit: the transfer itself cannot carry
/// two), before and after the key is finished. Then one copy claims normally.
#[test]
fn safe_the_same_key_twice_or_two_of_it_in_one_call_is_refused_whole() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    let twice = claim_with(&mut f, ALICE, keys(KeyKind::Claim, &[1, 1]));
    println!("two copies of key 1 in one claim: {twice:?}");
    assert!(
        twice.is_err(),
        "two copies of key 1 in one claim: {twice:?}"
    );
    let two_units = claim_with(&mut f, ALICE, one(CLAIM_KEY, 1, 2));
    println!("a quantity of 2 of key 1: {two_units:?}");
    assert!(
        two_units.is_err(),
        "a quantity of 2 of key 1: {two_units:?}"
    );
    assert_eq!(f.view(id).claimed, big(0));
    f.check_fox(ALICE, 0);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());

    // At the end the first copy would finish and burn the key; the second
    // cannot exist either.
    f.set_time(T0 + 1_000);
    let twice = claim_with(&mut f, ALICE, keys(KeyKind::Claim, &[1, 1]));
    assert!(twice.is_err(), "two copies of a finishing key: {twice:?}");
    assert_eq!(f.view(id).claimed, big(0));
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    f.check_invariant(Some(FOX));
}

/// SAFE: a claim key sent to any endpoint but `claim` goes back: `create`
/// refuses a non-fungible payment, a view and the owner endpoints refuse any
/// payment at all (and `recoverBouncedKey` the caller too).
#[test]
fn safe_a_key_sent_to_any_other_endpoint_goes_back() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    let as_deposit = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .create(BOB, big(1), linear(T0, T0, 0, T0 + DAY), false, "x")
        .payment(key(KeyKind::Claim, 1))
        .returns(ReturnsHandledOrError::new())
        .run();
    assert_eq!(
        as_deposit.map(|_| ()).map_err(|e| e.message),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    // The typed proxy refuses a payment on these at compile time; a wallet
    // can still send one, so the raw calls below do.
    let to_a_view = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .raw_call("getVesting")
        .argument(&id)
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(to_a_view.is_err(), "a view took a key: {to_a_view:?}");
    let to_recovery = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .raw_call("recoverBouncedKey")
        .argument(&id)
        .argument(&KeyKind::Claim)
        .argument(&ALICE.to_managed_address::<StaticApi>())
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(to_recovery.is_err(), "recovery took a key: {to_recovery:?}");
    let to_claim_fees = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .raw_call("claimFees")
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(
        to_claim_fees.is_err(),
        "claimFees took a key: {to_claim_fees:?}"
    );
    let no_function = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .raw_call("sendMeTheKey")
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(
        no_function.is_err(),
        "an unknown function took a key: {no_function:?}"
    );
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    assert_eq!(f.view(id).claimed, big(0));
    f.check_invariant(Some(FOX));
}

/// SAFE, and one accepted design point pinned: the owner moves only a key
/// the contract holds, of the vesting it names, to a wallet or contract that
/// is not this one; but its choice of recipient is unconstrained. A key
/// anyone parks in the contract (here Alice's own, "bounced") can be sent by
/// the owner to a third party, who then claims. The board must read the
/// transaction that brought the key before voting.
#[test]
fn safe_the_owner_moves_only_the_held_key_of_the_named_vesting_to_whom_it_decides() {
    let mut f = Fixture::new();
    let plain = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let cancelable = f.create_fox(BOB, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    // Alice's claim key bounces back to the contract.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, plain))
        .whitebox(mvxvest::contract_obj, |_| {});

    let recover = |f: &mut Fixture,
                   from: TestAddress,
                   id: u64,
                   kind: KeyKind,
                   to: ManagedAddress<StaticApi>| {
        f.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, kind, to)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    };
    let alice = ALICE.to_managed_address();
    assert_eq!(
        recover(&mut f, CREATOR, plain, KeyKind::Claim, alice.clone()),
        Err(ERR_ONLY_OWNER.to_string())
    );
    assert_eq!(
        recover(&mut f, OWNER, cancelable, KeyKind::Claim, alice.clone()),
        Err(ERR_NO_HELD_KEY.to_string()),
        "the other vesting's key is with Bob"
    );
    assert_eq!(
        recover(&mut f, OWNER, plain, KeyKind::Cancel, alice.clone()),
        Err(ERR_NO_HELD_KEY.to_string()),
        "a non-cancelable vesting has no cancel key (nonce 0)"
    );
    assert_eq!(
        recover(&mut f, OWNER, cancelable, KeyKind::Cancel, alice.clone()),
        Err(ERR_NO_HELD_KEY.to_string()),
        "the cancel key is with the creator"
    );
    assert_eq!(
        recover(&mut f, OWNER, 3, KeyKind::Claim, alice.clone()),
        Err(ERR_UNKNOWN_VESTING.to_string())
    );
    assert_eq!(
        recover(
            &mut f,
            OWNER,
            plain,
            KeyKind::Claim,
            SC.to_managed_address()
        ),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    assert_eq!(
        recover(&mut f, OWNER, plain, KeyKind::Claim, ManagedAddress::zero()),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    // The owner may send it anywhere: here to Mallory, not to Alice.
    assert_eq!(
        recover(
            &mut f,
            OWNER,
            plain,
            KeyKind::Claim,
            MALLORY.to_managed_address()
        ),
        Ok(())
    );
    assert_eq!(
        recover(&mut f, OWNER, plain, KeyKind::Claim, alice),
        Err(ERR_NO_HELD_KEY.to_string()),
        "moved once"
    );
    f.check_holds_key(MALLORY, KeyKind::Claim, plain, plain, FOX.as_str());
    f.set_time(T0 + 500);
    f.claim(MALLORY, &[plain]);
    f.check_fox(MALLORY, 500);
    f.check_fox(ALICE, 0);
    f.check_invariant(Some(FOX));
}
