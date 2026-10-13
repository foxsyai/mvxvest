//! Audit of 2026-10-13 (Claude Fable 5.1): exact boundaries of the schedule
//! maths as seen through `claim` and `cancel`: a cancel on the very second a
//! tranche unlocks, on the cliff of a catch-up schedule, on the last (short)
//! step of a stepped curve, and a 30-year horizon with a start in the far
//! past. All `safe_*` tests pass on the audited code and pin the split
//! "vested stays claimable, the rest is refunded, both sum to the total".

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

/// In a fresh world, creates a cancelable FOX vesting, cancels it at
/// `cancel_at`, then claims at the end; returns (claimed by Alice, refunded
/// to the creator).
fn split(total: u128, schedule: Schedule<StaticApi>, cancel_at: u64) -> (u128, u128) {
    let f = &mut Fixture::new();
    let id = f.create_fox(ALICE, total, schedule, true);
    let creator_before = 10u128.pow(36) - total;
    f.set_time(cancel_at);
    f.cancel(CREATOR, &[id]);
    f.set_time(T0 + 100 * DAY);
    let view = f.view(id);
    if view.claimable > 0u32 {
        f.claim(ALICE, &[id]);
    }
    let alice: BigUint<StaticApi> = view.final_amount.clone();
    let refunded = view.refunded.clone();
    let alice = alice.to_u64().unwrap() as u128;
    let refunded = refunded.to_u64().unwrap() as u128;
    f.check_fox(CREATOR, creator_before + refunded);
    f.check_invariant(Some(FOX));
    assert_eq!(
        alice + refunded,
        total,
        "vested and refunded sum to the total"
    );
    (alice, refunded)
}

/// SAFE: a cancel on the exact second of a tranche includes that tranche in
/// the vested part; one second earlier it does not.
#[test]
fn safe_cancel_on_a_tranche_second_counts_that_tranche() {
    let schedule = tranches(T0, &[(T0 + 100, 10), (T0 + 200, 20), (T0 + 300, 70)]);
    assert_eq!(split(100, schedule.clone(), T0 + 200), (30, 70));
    assert_eq!(split(100, schedule.clone(), T0 + 199), (10, 90));
    assert_eq!(split(100, schedule, T0 + 300), (100, 0));
}

/// SAFE: a catch-up cliff (tranches before the cliff) unlocks them all at
/// the cliff second; a cancel one second before the cliff refunds everything,
/// on the cliff it keeps the caught-up tranches plus the cliff amount.
#[test]
fn safe_cancel_on_a_catch_up_cliff() {
    let mut list = ManagedVec::new();
    for (time, amount) in [
        (T0 + 100, 10u128),
        (T0 + 200, 20),
        (T0 + 300, 30),
        (T0 + 400, 35),
    ] {
        list.push(Tranche {
            time,
            amount: big(amount),
        });
    }
    let schedule = Schedule {
        start: T0,
        cliff: T0 + 250,
        cliff_amount: big(5),
        end: T0 + 400,
        curve: Curve::Tranches(list),
    };
    assert_eq!(split(100, schedule.clone(), T0 + 249), (0, 100));
    assert_eq!(split(100, schedule, T0 + 250), (35, 65));
}

/// SAFE: a stepped curve whose interval does not divide the duration has a
/// short last step; a cancel inside it keeps `floor(rest * (n-1) / n)` and a
/// cancel at the end keeps everything.
#[test]
fn safe_cancel_inside_the_short_last_step() {
    // 1000 over 250 s in steps of 100 s: steps at +100, +200, end at +250.
    let schedule = stepped(T0, T0 + 250, 100);
    assert_eq!(split(1_000, schedule.clone(), T0 + 99), (0, 1_000));
    assert_eq!(split(1_000, schedule.clone(), T0 + 200), (666, 334));
    assert_eq!(split(1_000, schedule.clone(), T0 + 249), (666, 334));
    assert_eq!(split(1_000, schedule, T0 + 250), (1_000, 0));
}

/// SAFE: a linear schedule with a cliff amount and a start in the far past
/// (the Unix epoch) ending 30 years after creation: the vested part at
/// creation is what the curve says, the horizon check accepts exactly
/// `now + 30 years` and refuses one second more, and the split is exact.
#[test]
fn safe_far_past_start_and_the_exact_horizon() {
    let mut f = Fixture::new();
    let horizon = 30 * 365 * DAY;
    let schedule = linear(0, T0, 1_000, T0 + horizon);
    let too_far = linear(0, T0, 1_000, T0 + horizon + 1);
    f.create_fails(
        ALICE.to_managed_address(),
        too_far,
        true,
        payments(&[(Some(FOX), 1_000_000)]),
        "schedule ends too far in the future",
    );
    // Vested at creation: cliff amount plus the linear share since the epoch.
    let id = f.create_fox(ALICE, 1_000_000, schedule, true);
    let view = f.view(id);
    let expected = 1_000 + (999_000u128 * (T0 as u128)) / ((T0 + horizon) as u128);
    assert_eq!(view.vested, big(expected));
    assert_eq!(view.claimable, big(expected));
    f.cancel(CREATOR, &[id]);
    let view = f.view(id);
    assert_eq!(view.final_amount, big(expected));
    assert_eq!(view.refunded, big(1_000_000 - expected));
    f.claim(ALICE, &[id]);
    f.check_fox(ALICE, expected);
    f.check_invariant(Some(FOX));
}
