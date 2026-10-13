//! Audit of 2026-10-13 (Claude Fable 5.1): the keys. Who can move what with
//! a claim key or a cancel key, mixed and wrong payments, and what a holder
//! can do with a cancel key it was given.
//!
//! All `safe_*` tests pass on the audited code (fd32f4e1, mainnet) and pin
//! the behaviour the audit relied on.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

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

/// SAFE (by design, worth knowing): the cancel key is a bearer right. Given
/// or sold to the beneficiary, it lets the beneficiary end its own vesting and
/// take the unvested rest at once, on top of the vested part. A creator must
/// treat the cancel key like the money it controls.
#[test]
fn safe_a_beneficiary_holding_the_cancel_key_unlocks_everything_at_once() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.send_key(KeyKind::Cancel, 1, CREATOR, ALICE);
    f.set_time(T0 + 250);
    f.cancel(ALICE, &[1]);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    f.check_invariant(Some(FOX));
}

/// SAFE: a mixed call is refused as a whole and every key goes back: a cancel
/// key among claim keys, a claim key among cancel keys, a fungible token or
/// EGLD next to a key, a key of another collection.
#[test]
fn safe_mixed_and_wrong_payments_move_nothing() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), true);
    f.send_key(KeyKind::Cancel, 1, CREATOR, ALICE);
    f.world.transfer_step(
        TransferStep::new()
            .from("address:creator")
            .to("address:alice")
            .esdt_transfer("str:FOX-a1b2c3", 0, "5"),
    );
    f.set_time(T0 + 50);
    let claim_key = key(KeyKind::Claim, 1);
    let cancel_key = key(KeyKind::Cancel, 1);
    let mut both = claim_key.clone();
    both.extend(cancel_key.iter().map(|p| p.clone()));
    assert_eq!(
        claim_with(&mut f, ALICE, both.clone()),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    assert_eq!(
        cancel_with(&mut f, ALICE, both),
        Err(ERR_NOT_CANCEL_KEY.to_string())
    );
    let mut key_and_fox = claim_key.clone();
    key_and_fox.extend(payments(&[(Some(FOX), 5)]).iter().map(|p| p.clone()));
    assert_eq!(
        claim_with(&mut f, ALICE, key_and_fox),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    let mut key_and_egld = claim_key.clone();
    key_and_egld.extend(payments(&[(None, 7)]).iter().map(|p| p.clone()));
    assert_eq!(
        claim_with(&mut f, ALICE, key_and_egld),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    let mut other = ManagedVec::new();
    other.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    assert_eq!(
        claim_with(&mut f, CREATOR, other.clone()),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    assert_eq!(
        cancel_with(&mut f, CREATOR, other),
        Err(ERR_NOT_CANCEL_KEY.to_string())
    );
    // Nothing moved: Alice still holds both keys and her 5 FOX, no claim, no
    // cancel, the contract holds exactly the deposit.
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Cancel, 1, 1, FOX.as_str());
    f.check_fox(ALICE, 5);
    assert_eq!(f.view(1).claimed, big(0));
    assert_eq!(f.view(1).cancelled_at, 0);
    f.world
        .check_account(CREATOR)
        .esdt_nft_balance_and_attributes(OTHER_NFT, 1, 1, &b""[..]);
    f.check_invariant(Some(FOX));
}

/// SAFE: a claim key that reaches `claim` after its vesting was cancelled
/// with nothing vested is burned and pays nothing, and a cancel key for a
/// vesting cancelled in the same call cannot cancel twice (it is burned).
#[test]
fn safe_dead_keys_burn_and_cannot_act_twice() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0 + 100, T0 + 100, 0, T0 + 200), true);
    f.cancel(CREATOR, &[1]);
    f.check_fox(CREATOR, 10u128.pow(36));
    // The cancel key is gone: the creator cannot send it again, and the
    // contract does not hold it either.
    assert!(cancel_with(&mut f, CREATOR, key(KeyKind::Cancel, 1)).is_err());
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Cancel, OWNER)
        .returns(ExpectError(4, ERR_NO_HELD_KEY))
        .run();
    f.set_time(T0 + 150);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 0);
    // The claim key is burned: Alice cannot send it again, the contract does
    // not hold it.
    assert!(claim_with(&mut f, ALICE, key(KeyKind::Claim, 1)).is_err());
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, OWNER)
        .returns(ExpectError(4, ERR_NO_HELD_KEY))
        .run();
    let view = f.view(1);
    assert_eq!(view.final_amount, big(0));
    assert_eq!(view.refunded, big(1_000));
    f.check_invariant(Some(FOX));
}

/// SAFE: the owner's key recovery only ever moves a key the contract holds,
/// never one a holder has, and the owner cannot mint, burn or move a key by
/// any other endpoint. After recovery the new holder's claim is exact.
#[test]
fn safe_owner_cannot_touch_a_delivered_key() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), true);
    for kind in [KeyKind::Claim, KeyKind::Cancel] {
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(1u64, kind, OWNER)
            .returns(ExpectError(4, ERR_NO_HELD_KEY))
            .run();
    }
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
}
