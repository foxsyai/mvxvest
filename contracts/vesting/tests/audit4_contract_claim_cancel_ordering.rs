//! Fourth audit (contract money paths, 20 Oct 2026): claim and cancel in
//! every state, in both orders, within one block.
//!
//! For every kind of schedule (linear with a cliff amount, stepped with a
//! short last step, tranches with one before the cliff, a time lock,
//! everything at the cliff), at every moment (before the cliff, at it,
//! midway, at the end, after it), with or without an earlier partial claim,
//! and in both orders (claim then cancel, cancel then claim, same block
//! timestamp): the claim key holder ends with exactly `vested(moment)`, the
//! cancel key's sender (not the creator: the key was passed on) with exactly
//! `total - vested(moment)`, the contract with nothing, and the views agree.
//! `vested` is computed here by an independent model of the spec's maths.
//!
//! The last test adds the bounced state: after a cancel the claim key comes
//! back to the contract, the owner returns it, and the frozen part is still
//! paid in full. Only the owner can move the parked key.
//!
//! Every test passes on 322cb43: the order of a claim and a cancel in one
//! block never changes who gets what. (A single transaction cannot mix the
//! two: `claim` accepts only claim keys and `cancel` only cancel keys; a
//! contract holding both keys calls them one after the other and meets the
//! same two timestamps.)

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

const TOTAL: u128 = 1_000;

#[derive(Clone, Copy, Debug)]
enum Kind {
    /// 100 at the cliff (T0+100), the other 900 linearly from T0 to T0+1000.
    LinearWithCliffAmount,
    /// 4 steps of 300 s from T0; the last one (100 s) ends at T0+1000.
    SteppedShortLastStep,
    /// 10 at T0+50 (before the cliff at T0+100, so it unlocks at the cliff),
    /// 390 at T0+400, 600 at T0+1000.
    TranchesOneBeforeCliff,
    /// start = cliff = end = T0+500.
    TimeLock,
    /// Everything at the cliff (T0+300), end at T0+1000.
    AllAtCliff,
}
const KINDS: [Kind; 5] = [
    Kind::LinearWithCliffAmount,
    Kind::SteppedShortLastStep,
    Kind::TranchesOneBeforeCliff,
    Kind::TimeLock,
    Kind::AllAtCliff,
];

fn schedule(kind: Kind) -> Schedule<StaticApi> {
    match kind {
        Kind::LinearWithCliffAmount => linear(T0, T0 + 100, 100, T0 + 1_000),
        Kind::SteppedShortLastStep => stepped(T0, T0 + 1_000, 300),
        Kind::TranchesOneBeforeCliff => {
            let mut s = tranches(T0, &[(T0 + 50, 10), (T0 + 400, 390), (T0 + 1_000, 600)]);
            s.cliff = T0 + 100;
            s
        }
        Kind::TimeLock => linear(T0 + 500, T0 + 500, 0, T0 + 500),
        Kind::AllAtCliff => linear(T0, T0 + 300, TOTAL, T0 + 1_000),
    }
}

/// The spec's maths, written independently of the contract.
fn vested(kind: Kind, t: u64) -> u128 {
    match kind {
        Kind::LinearWithCliffAmount => {
            if t < T0 + 100 {
                0
            } else if t >= T0 + 1_000 {
                TOTAL
            } else {
                100 + 900 * (t - T0) as u128 / 1_000
            }
        }
        Kind::SteppedShortLastStep => {
            if t >= T0 + 1_000 {
                TOTAL
            } else if t < T0 {
                0
            } else {
                // 4 steps; k whole steps of 300 s done.
                TOTAL * ((t - T0) / 300) as u128 / 4
            }
        }
        Kind::TranchesOneBeforeCliff => {
            if t < T0 + 100 {
                0
            } else if t >= T0 + 1_000 {
                TOTAL
            } else if t >= T0 + 400 {
                400
            } else {
                10
            }
        }
        Kind::TimeLock => {
            if t >= T0 + 500 {
                TOTAL
            } else {
                0
            }
        }
        Kind::AllAtCliff => {
            if t >= T0 + 300 {
                TOTAL
            } else {
                0
            }
        }
    }
}

fn cliff_of(kind: Kind) -> u64 {
    match kind {
        Kind::LinearWithCliffAmount | Kind::TranchesOneBeforeCliff => T0 + 100,
        Kind::SteppedShortLastStep => T0,
        Kind::TimeLock => T0 + 500,
        Kind::AllAtCliff => T0 + 300,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Order {
    ClaimThenCancel,
    CancelThenClaim,
}

fn claim_result(f: &mut Fixture, from: TestAddress, nonce: u64) -> Result<(), String> {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Claim, nonce))
        .returns(ReturnsHandledOrError::new())
        .run()
        .map(|_| ())
        .map_err(|e| e.message)
}

/// Alice's claim when `vested_now` has vested (frozen at the cancel, if
/// there was one) and `claimed` was paid so far: pays what is new, or fails
/// with "nothing to claim yet" when nothing is new and the key is not done
/// (`final_amount` is the most the key can ever collect). Returns what Alice
/// has claimed afterwards.
fn claim_step(
    f: &mut Fixture,
    nonce: u64,
    label: &str,
    vested_now: u128,
    claimed: u128,
    final_amount: u128,
) -> u128 {
    let amount = vested_now - claimed;
    let finished = claimed + amount == final_amount;
    let result = claim_result(f, ALICE, nonce);
    if amount > 0 || finished {
        result.unwrap_or_else(|e| panic!("{label}: claim failed: {e}"));
        claimed + amount
    } else {
        assert_eq!(result, Err(ERR_NOTHING_TO_CLAIM.to_string()), "{label}");
        claimed
    }
}

fn case(kind: Kind, moment: u64, order: Order, partial: bool) {
    if partial && moment <= T0 + 200 {
        // The partial claim happens at +200; time never runs backwards.
        return;
    }
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, TOTAL, schedule(kind), true);
    let view = f.view(id);
    let (claim_nonce, cancel_nonce) = (view.vesting.claim_nonce, view.vesting.cancel_nonce);
    // The cancel key was passed on: the refund goes to its sender, Mallory.
    f.send_key(KeyKind::Cancel, cancel_nonce, CREATOR, MALLORY);

    let label = format!("{kind:?} +{} {order:?} partial={partial}", moment - T0);
    let mut claimed = 0u128;
    if partial {
        let t = T0 + 200;
        f.set_time(t);
        claimed = claim_step(&mut f, claim_nonce, &label, vested(kind, t), claimed, TOTAL);
        f.check_invariant(Some(FOX));
    }

    f.set_time(moment);
    let frozen = vested(kind, moment);
    let refund = TOTAL - frozen;
    // After the cancel, the claim key can collect `frozen` and no more; it is
    // burned by the claim that reaches it. Before the cancel, a claim burns
    // the key only when it reaches the total.
    let key_alive;
    match order {
        Order::ClaimThenCancel => {
            claimed = claim_step(&mut f, claim_nonce, &label, frozen, claimed, TOTAL);
            key_alive = claimed < TOTAL;
            f.cancel(MALLORY, &[cancel_nonce]);
        }
        Order::CancelThenClaim => {
            f.cancel(MALLORY, &[cancel_nonce]);
            claimed = claim_step(&mut f, claim_nonce, &label, frozen, claimed, frozen);
            key_alive = false;
        }
    }
    f.check_invariant(Some(FOX));
    f.check_fox(MALLORY, refund);

    // Much later the vested amount stays frozen: a live key pays what is
    // left of the frozen part (possibly nothing), and is burned.
    f.set_time(moment + 10_000);
    if key_alive {
        claimed = claim_step(&mut f, claim_nonce, &label, frozen, claimed, frozen);
    }
    assert_eq!(claimed, frozen, "{label}");
    f.check_fox(ALICE, frozen);
    f.check_fox(MALLORY, refund);
    f.check_fox(CREATOR, 10u128.pow(36) - TOTAL);
    f.world.check_account(SC).esdt_balance(FOX, big(0));
    f.check_invariant(Some(FOX));

    let view = f.view(id);
    assert_eq!(view.cancelled_at, moment);
    assert_eq!(view.claimed, big(frozen));
    assert_eq!(view.final_amount, big(frozen));
    assert_eq!(view.refunded, big(refund));
    assert_eq!(view.claimable, big(0));
    let totals = f.totals(token(FOX));
    assert_eq!(totals.deposited, big(TOTAL));
    assert_eq!(totals.claimed, big(frozen));
    assert_eq!(totals.refunded, big(refund));
    // Both keys are gone: nothing is parked in the contract either.
    for kind_of_key in [KeyKind::Claim, KeyKind::Cancel] {
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, kind_of_key, OWNER)
            .returns(ExpectError(4, ERR_NO_HELD_KEY))
            .run();
    }
}

#[test]
fn safe_claim_and_cancel_in_either_order_split_the_total_exactly_in_every_state() {
    for kind in KINDS {
        let cliff = cliff_of(kind);
        let moments = [T0 + 50, cliff, T0 + 450, T0 + 1_000, T0 + 1_500];
        for moment in moments {
            for order in [Order::ClaimThenCancel, Order::CancelThenClaim] {
                for partial in [false, true] {
                    case(kind, moment, order, partial);
                }
            }
        }
    }
}

/// The key bounced after the cancel (its holder was a smart contract that
/// could not take it back): the contract holds it, only the owner moves it,
/// and the frozen part is paid to whoever the owner returns it to.
#[test]
fn safe_a_claim_key_parked_after_a_cancel_still_pays_the_frozen_part_once_returned() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, TOTAL, schedule(Kind::LinearWithCliffAmount), true);
    let view = f.view(id);
    let (claim_nonce, cancel_nonce) = (view.vesting.claim_nonce, view.vesting.cancel_nonce);
    f.set_time(T0 + 200);
    // Alice claims 100 + 180 = 280, then the creator cancels at +450.
    f.claim(ALICE, &[claim_nonce]);
    f.check_fox(ALICE, 280);
    f.set_time(T0 + 450);
    f.cancel(CREATOR, &[cancel_nonce]);
    let frozen = vested(Kind::LinearWithCliffAmount, T0 + 450);
    assert_eq!(frozen, 505);
    f.check_fox(CREATOR, 10u128.pow(36) - TOTAL + (TOTAL - 505));
    // The key bounces back to the contract.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, claim_nonce))
        .whitebox(mvxvest::contract_obj, |_| {});
    f.check_invariant(Some(FOX));
    for stranger in [ALICE, CREATOR, MALLORY] {
        f.world
            .tx()
            .from(stranger)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, KeyKind::Claim, stranger)
            .returns(ExpectError(4, ERR_ONLY_OWNER))
            .run();
    }
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(id, KeyKind::Claim, BOB)
        .run();
    f.set_time(T0 + 5_000);
    f.claim(BOB, &[claim_nonce]);
    f.check_fox(BOB, 505 - 280);
    f.check_fox(ALICE, 280);
    f.world.check_account(SC).esdt_balance(FOX, big(0));
    f.check_invariant(Some(FOX));
    let view = f.view(id);
    assert_eq!(view.claimed, big(505));
    assert_eq!(view.final_amount, big(505));
    assert_eq!(view.refunded, big(495));
}
