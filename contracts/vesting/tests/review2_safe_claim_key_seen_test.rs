//! Review 2, verified safe (F1): how `claimKeyUsed` is written by `claim` and
//! read by `recoverBouncedKeys`, with batches, multi-key claims, burned keys,
//! cancelled vestings and refused claims.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::{errors::*, storage::StorageModule};

fn seen(f: &mut Fixture, id: u64) -> bool {
    let mut result = false;
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .whitebox(mvxvest::contract_obj, |sc| {
            result = sc.claim_key_used(id).get();
        });
    result
}

fn bounce(f: &mut Fixture, from: TestAddress, list: ManagedVec<StaticApi, Payment<StaticApi>>) {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .payment(list)
        .whitebox(mvxvest::contract_obj, |_| {});
}

fn recover(f: &mut Fixture, caller: TestAddress, id: u64, to: TestAddress) -> Result<(), String> {
    f.world
        .tx()
        .from(caller)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(id, to)
        .returns(ReturnsHandledOrError::new())
        .run()
        .map_err(|e| e.message)
}

/// A claim key that bounced inside a batch stays the creator's to recover,
/// also after the creator cancelled that vesting, while the keys of the
/// batch that reached their holders are marked as seen once claimed.
#[test]
fn a_key_bounced_in_a_batch_is_the_creators_even_after_a_cancel() {
    let mut f = Fixture::new();
    let mut entries = MultiValueEncoded::new();
    entries.push(
        (
            ALICE.to_managed_address(),
            big(1_000),
            linear(T0, T0, 0, T0 + 1_000),
        )
            .into(),
    );
    entries.push(
        (
            BOB.to_managed_address(),
            big(1_000),
            linear(T0, T0, 0, T0 + 1_000),
        )
            .into(),
    );
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(true, "batch", entries)
        .payment(payments(&[(Some(FOX), 2_000)]))
        .run();
    // Bob's key bounced at creation.
    bounce(&mut f, BOB, key(KeyKind::Claim, 2));
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1]);
    assert!(seen(&mut f, 1));
    assert!(!seen(&mut f, 2));
    // The creator cancels #2: 500 refunded, 500 vested stay claimable.
    f.cancel(CREATOR, &[2]);
    // Bob may not redirect it; the creator may.
    assert_eq!(
        recover(&mut f, BOB, 2, BOB),
        Err(ERR_NOT_ALLOWED.to_string())
    );
    assert_eq!(
        recover(&mut f, CREATOR, 1, CREATOR),
        Err(ERR_NO_HELD_KEY.to_string())
    );
    recover(&mut f, CREATOR, 2, BOB).unwrap();
    f.check_holds_key(BOB, KeyKind::Claim, 2, 2, FOX.as_str());
    f.claim(BOB, &[2]);
    f.check_fox(BOB, 500);
    f.check_invariant(Some(FOX));
}

/// One multi-key claim with a paying key, a key that is burned (cancelled
/// before it vested anything) and a key that pays nothing: every one of them
/// is marked as seen, so after the return bounces only the owner may move
/// the two keys that came back.
#[test]
fn every_key_of_a_multi_claim_is_seen() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.create_fox(
        ALICE,
        1_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        true,
    );
    f.create_fox(
        ALICE,
        1_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    f.cancel(CREATOR, &[1]); // cancel key nonce 1 belongs to vesting #2
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1, 2, 3]);
    for id in 1..=3 {
        assert!(seen(&mut f, id), "vesting #{id} not marked as seen");
    }
    // #2 was burned (its final amount, 0, is claimed).
    let mut back = ManagedVec::new();
    back.push(Payment::new(
        token(FOX),
        0,
        NonZeroBigUint::new_or_panic(big(500)),
    ));
    back.extend(keys(KeyKind::Claim, &[1, 3]).iter().map(|p| p.clone()));
    bounce(&mut f, ALICE, back);
    for id in [1, 3] {
        assert_eq!(
            recover(&mut f, CREATOR, id, CREATOR),
            Err(ERR_NOT_ALLOWED.to_string())
        );
    }
    assert_eq!(
        recover(&mut f, CREATOR, 2, CREATOR),
        Err(ERR_NO_HELD_KEY.to_string())
    );
    recover(&mut f, OWNER, 1, ALICE).unwrap();
    recover(&mut f, OWNER, 3, ALICE).unwrap();
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 3, 3, FOX.as_str());
}

/// A claim that is refused (nothing vested yet) rolls back the mark: it
/// changes nothing, and the key never left its holder.
#[test]
fn a_refused_claim_marks_nothing() {
    let mut f = Fixture::new();
    f.create_fox(
        ALICE,
        1_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    f.claim_fails(ALICE, &[1], ERR_NOTHING_TO_CLAIM);
    assert!(!seen(&mut f, 1));
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
}
