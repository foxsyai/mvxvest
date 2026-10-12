//! Cancelling: the split between vested and refunded at any moment, and who
//! can cancel.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

/// Creates a cancelable 1000 FOX linear vesting over 1000 seconds with a cliff
/// at 100, cancels at `cancel_at` after claiming at `claim_at` (if any), then
/// claims what is left. Checks the split and returns (beneficiary, refund).
fn cancel_case(cancel_at: u64, claim_at: Option<u64>) -> (u128, u128) {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0 + 100, 0, T0 + 1_000), true);
    let creator_before = 10u128.pow(36) - 1_000;
    if let Some(t) = claim_at {
        f.set_time(T0 + t);
        f.claim(ALICE, &[1]);
    }
    f.set_time(T0 + cancel_at);
    f.cancel(CREATOR, &[1]);
    f.check_invariant(Some(FOX));

    let view = f.view(id);
    assert_eq!(view.cancelled_at, T0 + cancel_at);
    let vested = view.final_amount.to_u64().unwrap() as u128;
    let refund = 1_000 - vested;
    assert_eq!(view.refunded, big(refund));
    f.check_fox(CREATOR, creator_before + refund);

    // Later, the claim key collects exactly what had vested, then burns (with
    // nothing to pay if everything vested was claimed before the cancel).
    f.set_time(T0 + 5_000);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, vested);
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Claim, 1))
        .returns(ExpectStatus(10))
        .run();
    f.check_invariant(Some(FOX));
    assert_eq!(vested + refund, 1_000);
    (vested, refund)
}

#[test]
fn cancel_before_the_cliff_refunds_everything() {
    assert_eq!(cancel_case(50, None), (0, 1_000));
}

#[test]
fn cancel_before_the_start_refunds_everything() {
    let mut f = Fixture::new();
    f.create_fox(
        ALICE,
        1_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        true,
    );
    f.cancel(CREATOR, &[1]);
    f.check_fox(CREATOR, 10u128.pow(36));
    // The claim key holder gets nothing, and the dead key is burned.
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 0);
    f.check_invariant(Some(FOX));
}

#[test]
fn cancel_midway_splits_exactly() {
    assert_eq!(cancel_case(400, None), (400, 600));
}

#[test]
fn cancel_after_a_claim() {
    assert_eq!(cancel_case(700, Some(300)), (700, 300));
}

#[test]
fn cancel_right_after_claiming_everything_vested() {
    assert_eq!(cancel_case(300, Some(300)), (300, 700));
}

#[test]
fn cancel_after_the_end_refunds_nothing() {
    assert_eq!(cancel_case(2_000, None), (1_000, 0));
}

#[test]
fn claim_and_cancel_in_the_same_block() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 600);
    f.claim(ALICE, &[1]);
    f.cancel(CREATOR, &[1]);
    // Everything vested was claimed in that block: the key now burns empty.
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 600);
    f.check_fox(CREATOR, 10u128.pow(36) - 600);
    f.check_invariant(Some(FOX));
}

#[test]
fn cancel_key_moved_to_another_wallet_cancels_and_takes_the_refund() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.send_key(KeyKind::Cancel, 1, CREATOR, BOB);
    f.set_time(T0 + 250);
    f.cancel(BOB, &[1]);
    f.check_fox(BOB, 750);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 250);
    f.check_invariant(Some(FOX));
}

#[test]
fn non_cancelable_vesting_cannot_be_stopped() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // There is no cancel key; the claim key is not one.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .payment(key(KeyKind::Claim, 1))
        .returns(ExpectError(4, ERR_NOT_CANCEL_KEY))
        .run();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .returns(ExpectError(4, ERR_NOT_CANCEL_KEY))
        .run();
}

#[test]
fn cancel_several_at_once_refunds_per_token() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.create_fox(BOB, 2_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        true,
        payments(&[(None, 10 * EGLD)]),
    );
    let creator_egld = 1_000_000 * EGLD - 10 * EGLD;
    f.set_time(T0 + 100);
    f.cancel(CREATOR, &[1, 2, 3]);
    f.check_fox(CREATOR, 10u128.pow(36) - 300);
    f.world
        .check_account(CREATOR)
        .balance(big(creator_egld + 9 * EGLD));
    f.check_invariant(Some(FOX));
    f.check_invariant(None);
}

#[test]
fn pause_never_blocks_claims_or_cancels() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .pause_creation()
        .run();
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1]);
    f.cancel(CREATOR, &[1]);
    f.check_fox(ALICE, 500);
    f.check_invariant(Some(FOX));
}
