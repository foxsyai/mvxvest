//! Fifth audit (KEYS-1): up to version 3 the stamp's search for the `metadata:`
//! part of a key's attributes looked only at the first 256 bytes
//! (`keys::minted_metadata`), on the assumption that the prefix before it is
//! "at most about 180 bytes". The prefix carries `claimed:<units>`, a BigUint
//! with no bound but the protocol's 100 byte limit on an amount (241 digits),
//! so a key of a token with a huge supply pushed `;metadata:` past byte 256 and
//! the stamp dropped the metadata the key was minted with, on every later
//! claim. Version 4 searches 512 bytes, with the arithmetic in the function's
//! comment. The `safe_*` tests pin what holds: nothing a creator controls
//! reaches the attributes.

mod common;

use common::*;
use multiversx_sc::types::ManagedBuffer;
use multiversx_sc_scenario::imports::*;
use mvxvest::keys::minted_metadata;

const WHALE: TestAddress = TestAddress::new("whale");

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

fn set_display(f: &mut Fixture, metadata: &str) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(
            KeyKind::Claim,
            metadata,
            MultiValueEncoded::<StaticApi, ManagedBuffer<StaticApi>>::new(),
        )
        .run();
}

fn pow10(digits: u32) -> BigUint<StaticApi> {
    let mut value = BigUint::from(1u32);
    for _ in 0..digits {
        value *= 10u32;
    }
    value
}

/// FINDING KEYS-1 (unit): the first `;metadata:` after byte 246 is not found,
/// so the metadata is dropped although the prefix is the contract's own.
#[test]
fn finding_metadata_past_byte_256_is_dropped() {
    let prefix = format!(
        "tags:mvxvest,vesting;vesting:1;token:{}-123456;cancelable:0;claimed:{}",
        "A".repeat(20),
        "9".repeat(161)
    );
    assert!(prefix.len() > 246, "the mark starts past byte 246");
    let attributes =
        ManagedBuffer::<StaticApi>::from(format!("{prefix};metadata:ipfs://cid").as_bytes());
    let found = minted_metadata(&attributes);
    assert_eq!(
        String::from_utf8(found.to_boxed_bytes().into_vec()).unwrap(),
        "ipfs://cid"
    );
}

/// FINDING KEYS-1 (through the contract): a vesting of a token with a huge
/// supply (anyone can issue one: the protocol allows 100 bytes of supply)
/// minted under a display with metadata loses that metadata at the first
/// claim whose `claimed:` has about 160 digits or more.
#[test]
fn finding_a_huge_claimed_amount_makes_the_stamp_drop_the_minted_metadata() {
    let mut f = Fixture::new();
    set_display(&mut f, "ipfs://cid");
    // 190 digits of `claimed:` after a 69 byte prefix (a 10 byte ticker): the
    // mark would start at byte 259. The protocol allows about 240 digits.
    let total = pow10(190);
    f.world
        .account(WHALE)
        .nonce(1)
        .balance(big(100 * EGLD))
        .esdt_balance(PTS, total.clone());

    let mut payment = ManagedVec::new();
    payment.push(Payment::new(
        token(PTS),
        0,
        NonZeroBigUint::new_or_panic(total.clone()),
    ));
    let id: u64 = f
        .world
        .tx()
        .from(WHALE)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            WHALE,
            total.clone(),
            linear(T0, T0, 0, T0 + 1_000),
            false,
            "team",
        )
        .payment(payment)
        .returns(ReturnsResult)
        .run();
    let minted = claim_key_of(&mut f, WHALE, 1);
    assert!(
        minted
            .attributes
            .ends_with(";cancelable:0;metadata:ipfs://cid"),
        "{}",
        minted.attributes
    );

    // The first stamp reads the minted attributes, whose prefix is short: it
    // keeps the metadata and writes 190 digits of `claimed:` before it.
    f.set_time(T0 + 500);
    f.claim(WHALE, &[1]);
    let stamped = claim_key_of(&mut f, WHALE, 1);
    assert_eq!(stamped.amount, 1);
    let claimed = total.clone() * 500u32 / 1_000u32;
    assert_eq!(
        stamped.attributes,
        format!(
            "{};claimed:{};metadata:ipfs://cid",
            key_attributes(id, PTS.as_str(), false),
            claimed.to_display()
        )
    );

    // The second stamp reads those: `;metadata:` now starts past byte 256
    // and is not found, so the key loses it for good.
    f.set_time(T0 + 750);
    f.claim(WHALE, &[1]);
    let stamped = claim_key_of(&mut f, WHALE, 1);
    assert_eq!(stamped.amount, 1);
    let claimed = total.clone() * 750u32 / 1_000u32;
    assert_eq!(
        stamped.attributes,
        format!(
            "{};claimed:{};metadata:ipfs://cid",
            key_attributes(id, PTS.as_str(), false),
            claimed.to_display()
        )
    );
}

/// SAFE: the protocol's whole range fits the search, with the longest prefix
/// the contract can write: a u64 id, a 17 byte identifier and 241 digits (100
/// bytes, the most one transfer can carry): `;metadata:` ends at byte 346.
#[test]
fn safe_the_longest_prefix_the_chain_allows_is_searched() {
    let prefix = format!(
        "tags:mvxvest,vesting;vesting:{};token:ABCDEFGHIJ-123456;cancelable:1;claimed:{}",
        u64::MAX,
        "9".repeat(241)
    );
    assert_eq!(prefix.len(), 336);
    let attributes =
        ManagedBuffer::<StaticApi>::from(format!("{prefix};metadata:ipfs://cid").as_bytes());
    assert_eq!(
        minted_metadata(&attributes).to_boxed_bytes().as_slice(),
        b"ipfs://cid"
    );
}

/// SAFE: no `;metadata:` means no metadata, however long the attributes.
#[test]
fn safe_attributes_with_no_mark_have_no_metadata() {
    let attributes = ManagedBuffer::<StaticApi>::from(
        format!(
            "tags:mvxvest,vesting;vesting:1;token:FOX-a1b2c3;cancelable:0;claimed:{}",
            "9".repeat(2_000)
        )
        .as_bytes(),
    );
    assert!(minted_metadata(&attributes).is_empty());
}

/// SAFE: a `;metadata:` or a `;claimed:` the owner wrote in the display does
/// not confuse the search: the first mark is the contract's, so all of what
/// the owner wrote is kept, stamp after stamp, also past the searched bytes.
#[test]
fn safe_owner_metadata_that_looks_like_the_mark_survives_every_stamp() {
    let tail = "x".repeat(600);
    let metadata = format!(";metadata:evil;claimed:999;metadata:{tail}");
    let mut f = Fixture::new();
    set_display(&mut f, &metadata);
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    for (moment, claimed) in [(250, 250), (500, 500), (750, 750)] {
        f.set_time(T0 + moment);
        f.claim(ALICE, &[1]);
        assert_eq!(
            claim_key_of(&mut f, ALICE, 1).attributes,
            format!(
                "{};claimed:{claimed};metadata:{metadata}",
                key_attributes(id, FOX.as_str(), false)
            )
        );
    }
}

/// SAFE, on the chain's largest amount: a total of 241 digits keeps its
/// metadata through two stamps.
#[test]
fn safe_the_largest_amount_keeps_its_metadata() {
    let mut f = Fixture::new();
    set_display(&mut f, "ipfs://cid");
    let total = pow10(240);
    f.world
        .account(WHALE)
        .nonce(1)
        .balance(big(100 * EGLD))
        .esdt_balance(PTS, total.clone());
    let mut payment = ManagedVec::new();
    payment.push(Payment::new(
        token(PTS),
        0,
        NonZeroBigUint::new_or_panic(total.clone()),
    ));
    let id: u64 = f
        .world
        .tx()
        .from(WHALE)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            WHALE,
            total.clone(),
            linear(T0, T0, 0, T0 + 1_000),
            false,
            "team",
        )
        .payment(payment)
        .returns(ReturnsResult)
        .run();
    for moment in [500u32, 750] {
        f.set_time(T0 + moment as u64);
        f.claim(WHALE, &[1]);
        let claimed = total.clone() * moment / 1_000u32;
        assert_eq!(
            claim_key_of(&mut f, WHALE, 1).attributes,
            format!(
                "{};claimed:{};metadata:ipfs://cid",
                key_attributes(id, PTS.as_str(), false),
                claimed.to_display()
            )
        );
    }
}

/// SAFE: the label is not part of a key's name or attributes, so a label
/// written like an attribute list cannot add a `claimed:` or a `metadata:`
/// part, before or after the stamp.
#[test]
fn safe_a_label_written_like_attributes_reaches_neither_name_nor_attributes() {
    let mut f = Fixture::new();
    set_display(&mut f, "ipfs://cid");
    let label = ";claimed:0;metadata:evil;cancelable:0";
    let id: u64 = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(1_000),
            linear(T0, T0, 0, T0 + 1_000),
            true,
            label,
        )
        .payment(payments(&[(Some(FOX), 1_000)]))
        .returns(ReturnsResult)
        .run();
    let minted = claim_key_of(&mut f, ALICE, 1);
    assert_eq!(minted.name, format!("Vesting #{id} claim key, cancelable"));
    assert_eq!(
        minted.attributes,
        format!(
            "{};metadata:ipfs://cid",
            key_attributes(id, FOX.as_str(), true)
        )
    );
    assert_eq!(
        f.view(id).vesting.label.to_boxed_bytes().as_slice(),
        label.as_bytes()
    );

    f.set_time(T0 + 250);
    f.claim(ALICE, &[1]);
    let stamped = claim_key_of(&mut f, ALICE, 1);
    assert_eq!(
        stamped.name,
        format!("Vesting #{id} claim key, cancelable, 25% claimed")
    );
    assert_eq!(
        stamped.attributes,
        format!(
            "{};claimed:250;metadata:ipfs://cid",
            key_attributes(id, FOX.as_str(), true)
        )
    );
}

/// SAFE: a returned key never says 100%: a claim that reaches the final
/// amount burns the key, and the percentage of a returned key rounds down
/// against the total, so 999,999 of 1,000,000 is "99% claimed".
#[test]
fn safe_a_returned_key_never_reads_100_percent() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000_000, linear(T0, T0, 0, T0 + 1_000_000), false);
    f.set_time(T0 + 999_999);
    f.claim(ALICE, &[1]);
    let key = claim_key_of(&mut f, ALICE, 1);
    assert_eq!(key.amount, 1);
    assert_eq!(key.name, format!("Vesting #{id} claim key, 99% claimed"));
    f.set_time(T0 + 1_000_000);
    f.claim(ALICE, &[1]);
    assert_eq!(
        claim_key_of(&mut f, ALICE, 1).amount,
        0,
        "burned, not stamped"
    );
}
