//! The vesting maths, tested directly: every validation rule, worked
//! examples, and property tests against an independent reference model.

use multiversx_sc::types::{BigUint, ManagedVec};
use multiversx_sc_scenario::api::StaticApi;
use mvxvest::{
    errors::*,
    schedule::{Curve, MAX_TRANCHES, Schedule, Tranche},
};
use num_bigint::BigUint as Big;
use proptest::prelude::*;

type Api = StaticApi;

fn big(value: u128) -> BigUint<Api> {
    BigUint::from(value)
}

fn to_big(value: &BigUint<Api>) -> Big {
    Big::from_bytes_be(value.to_bytes_be().as_slice())
}

fn linear(start: u64, cliff: u64, cliff_amount: u128, end: u64) -> Schedule<Api> {
    Schedule {
        start,
        cliff,
        cliff_amount: big(cliff_amount),
        end,
        curve: Curve::Linear,
    }
}

fn stepped(start: u64, cliff: u64, cliff_amount: u128, end: u64, interval: u64) -> Schedule<Api> {
    Schedule {
        start,
        cliff,
        cliff_amount: big(cliff_amount),
        end,
        curve: Curve::Stepped { interval },
    }
}

fn tranches(start: u64, cliff: u64, cliff_amount: u128, list: &[(u64, u128)]) -> Schedule<Api> {
    let mut vec = ManagedVec::new();
    for (time, amount) in list {
        vec.push(Tranche {
            time: *time,
            amount: big(*amount),
        });
    }
    Schedule {
        start,
        cliff,
        cliff_amount: big(cliff_amount),
        end: list.last().map(|(t, _)| *t).unwrap_or(start),
        curve: Curve::Tranches(vec),
    }
}

fn vested(schedule: &Schedule<Api>, total: u128, t: u64) -> u128 {
    schedule
        .vested_at(&big(total), t)
        .to_u64()
        .map(u128::from)
        .unwrap_or_else(|| {
            let bytes = schedule.vested_at(&big(total), t).to_bytes_be();
            let mut value = 0u128;
            for byte in bytes.as_slice() {
                value = (value << 8) | u128::from(*byte);
            }
            value
        })
}

// ---------------------------------------------------------------- validation

#[test]
fn validate_accepts_well_formed_schedules() {
    assert_eq!(linear(100, 100, 0, 200).validate(&big(1)), Ok(()));
    assert_eq!(linear(100, 150, 10, 200).validate(&big(100)), Ok(()));
    assert_eq!(stepped(100, 100, 0, 200, 10).validate(&big(100)), Ok(()));
    assert_eq!(stepped(100, 100, 0, 200, 100).validate(&big(100)), Ok(()));
    assert_eq!(
        tranches(100, 100, 0, &[(150, 40), (200, 60)]).validate(&big(100)),
        Ok(())
    );
    // A pure time lock: everything at one moment.
    assert_eq!(linear(500, 500, 0, 500).validate(&big(7)), Ok(()));
    // A cliff equal to the total.
    assert_eq!(linear(100, 150, 100, 200).validate(&big(100)), Ok(()));
}

#[test]
fn validate_rejects_zero_total() {
    assert_eq!(
        linear(100, 100, 0, 200).validate(&big(0)),
        Err(ERR_ZERO_TOTAL)
    );
}

#[test]
fn validate_rejects_times_out_of_order() {
    assert_eq!(
        linear(200, 100, 0, 300).validate(&big(1)),
        Err(ERR_TIME_ORDER)
    );
    assert_eq!(
        linear(100, 300, 0, 200).validate(&big(1)),
        Err(ERR_TIME_ORDER)
    );
    assert_eq!(
        linear(300, 300, 0, 200).validate(&big(1)),
        Err(ERR_TIME_ORDER)
    );
}

#[test]
fn validate_rejects_cliff_above_total() {
    assert_eq!(
        linear(100, 100, 11, 200).validate(&big(10)),
        Err(ERR_CLIFF_ABOVE_TOTAL)
    );
}

#[test]
fn validate_rejects_bad_intervals() {
    assert_eq!(
        stepped(100, 100, 0, 200, 0).validate(&big(1)),
        Err(ERR_ZERO_INTERVAL)
    );
    assert_eq!(
        stepped(100, 100, 0, 200, 101).validate(&big(1)),
        Err(ERR_INTERVAL_TOO_LONG)
    );
}

#[test]
fn validate_rejects_bad_tranches() {
    let total = big(100);
    assert_eq!(
        tranches(100, 100, 0, &[]).validate(&total),
        Err(ERR_TRANCHE_COUNT)
    );
    let too_many: Vec<(u64, u128)> = (1..=(MAX_TRANCHES as u64 + 1))
        .map(|i| (100 + i, 1))
        .collect();
    assert_eq!(
        tranches(100, 100, 0, &too_many).validate(&big(too_many.len() as u128)),
        Err(ERR_TRANCHE_COUNT)
    );
    let max: Vec<(u64, u128)> = (1..=MAX_TRANCHES as u64).map(|i| (100 + i, 1)).collect();
    assert_eq!(
        tranches(100, 100, 0, &max).validate(&big(max.len() as u128)),
        Ok(())
    );
    assert_eq!(
        tranches(100, 100, 0, &[(150, 0), (200, 100)]).validate(&total),
        Err(ERR_ZERO_TRANCHE)
    );
    assert_eq!(
        tranches(100, 100, 0, &[(99, 50), (200, 50)]).validate(&total),
        Err(ERR_TRANCHE_BEFORE_START)
    );
    // Out of order, and a repeated time.
    assert_eq!(
        tranches(100, 100, 0, &[(200, 50), (150, 50)]).validate(&total),
        Err(ERR_TRANCHE_ORDER)
    );
    assert_eq!(
        tranches(100, 100, 0, &[(150, 50), (150, 50)]).validate(&total),
        Err(ERR_TRANCHE_ORDER)
    );
    let mut not_at_end = tranches(100, 100, 0, &[(150, 50), (200, 50)]);
    not_at_end.end = 250;
    assert_eq!(not_at_end.validate(&total), Err(ERR_LAST_TRANCHE_NOT_END));
    assert_eq!(
        tranches(100, 100, 0, &[(150, 50), (200, 49)]).validate(&total),
        Err(ERR_TRANCHE_SUM)
    );
    assert_eq!(
        tranches(100, 100, 10, &[(150, 50), (200, 50)]).validate(&total),
        Err(ERR_TRANCHE_SUM)
    );
    assert_eq!(
        tranches(100, 100, 10, &[(150, 40), (200, 50)]).validate(&total),
        Ok(())
    );
}

// ------------------------------------------------------------ worked examples

#[test]
fn linear_vests_per_second_and_rounds_down() {
    let s = linear(1_000, 1_000, 0, 1_003);
    assert_eq!(vested(&s, 10, 999), 0);
    assert_eq!(vested(&s, 10, 1_000), 0);
    assert_eq!(vested(&s, 10, 1_001), 3); // 10 * 1 / 3 = 3.33
    assert_eq!(vested(&s, 10, 1_002), 6); // 10 * 2 / 3 = 6.67
    assert_eq!(vested(&s, 10, 1_003), 10); // the remainder lands at the end
    assert_eq!(vested(&s, 10, u64::MAX), 10);
}

#[test]
fn cliff_gates_and_catches_up() {
    // Startup style: linear from start, nothing before a cliff at 25%.
    let s = linear(0, 250, 0, 1_000);
    assert_eq!(vested(&s, 1_000, 249), 0);
    assert_eq!(vested(&s, 1_000, 250), 250);
    assert_eq!(vested(&s, 1_000, 500), 500);
    // Crypto style: 10% at the cliff, then the rest linear until the end.
    let s = linear(500, 500, 100, 1_500);
    assert_eq!(vested(&s, 1_000, 499), 0);
    assert_eq!(vested(&s, 1_000, 500), 100);
    assert_eq!(vested(&s, 1_000, 1_000), 550);
    assert_eq!(vested(&s, 1_000, 1_500), 1_000);
}

#[test]
fn cliff_equal_to_total_releases_everything_at_the_cliff() {
    let s = linear(0, 100, 1_000, 1_000);
    assert_eq!(vested(&s, 1_000, 99), 0);
    assert_eq!(vested(&s, 1_000, 100), 1_000);
    assert_eq!(vested(&s, 1_000, 999), 1_000);
}

#[test]
fn time_lock_releases_at_the_end() {
    let s = linear(500, 500, 0, 500);
    assert_eq!(vested(&s, 7, 499), 0);
    assert_eq!(vested(&s, 7, 500), 7);
}

#[test]
fn stepped_releases_whole_steps_with_a_short_last_step() {
    // 100 seconds in steps of 30: releases at 30, 60, 90 and 100.
    let s = stepped(0, 0, 0, 100, 30);
    assert_eq!(vested(&s, 1_000, 29), 0);
    assert_eq!(vested(&s, 1_000, 30), 250);
    assert_eq!(vested(&s, 1_000, 59), 250);
    assert_eq!(vested(&s, 1_000, 60), 500);
    assert_eq!(vested(&s, 1_000, 90), 750);
    assert_eq!(vested(&s, 1_000, 99), 750);
    assert_eq!(vested(&s, 1_000, 100), 1_000);
}

#[test]
fn stepped_spreads_rounding_and_ends_exact() {
    // 10 units over 3 steps: 3, 6, then 10.
    let s = stepped(0, 0, 0, 3, 1);
    assert_eq!(vested(&s, 10, 1), 3);
    assert_eq!(vested(&s, 10, 2), 6);
    assert_eq!(vested(&s, 10, 3), 10);
}

#[test]
fn tranches_release_on_their_dates() {
    let s = tranches(0, 0, 0, &[(10, 1), (20, 2), (30, 3)]);
    assert_eq!(vested(&s, 6, 9), 0);
    assert_eq!(vested(&s, 6, 10), 1);
    assert_eq!(vested(&s, 6, 25), 3);
    assert_eq!(vested(&s, 6, 30), 6);
}

#[test]
fn tranches_before_the_cliff_unlock_at_the_cliff() {
    let s = tranches(0, 15, 0, &[(10, 1), (20, 2), (30, 3)]);
    assert_eq!(vested(&s, 6, 14), 0);
    assert_eq!(vested(&s, 6, 15), 1);
}

#[test]
fn start_in_the_past_is_claimable_at_once() {
    // Created at t = 1_000 for a schedule that started at 0.
    let s = linear(0, 0, 0, 4_000);
    assert_eq!(vested(&s, 4_000, 1_000), 1_000);
}

#[test]
fn huge_and_tiny_amounts() {
    // 10^30 units (a trillion tokens with 18 decimals) over ten years.
    let total = 10u128.pow(30);
    let ten_years = 10 * 365 * 24 * 3_600;
    let s = linear(0, 0, 0, ten_years);
    assert_eq!(vested(&s, total, ten_years / 2), total / 2);
    assert_eq!(vested(&s, total, ten_years), total);
    // One unit over a year: nothing until the very end.
    let s = linear(0, 0, 0, 365 * 24 * 3_600);
    assert_eq!(vested(&s, 1, 365 * 24 * 3_600 - 1), 0);
    assert_eq!(vested(&s, 1, 365 * 24 * 3_600), 1);
}

#[test]
fn amounts_beyond_u128_are_exact() {
    let total = BigUint::<Api>::from_bytes_be(&[0xff; 40]); // 320 bits
    let s = linear(0, 0, 0, 3);
    let third = s.vested_at(&total, 1);
    assert_eq!(to_big(&third), to_big(&total) / Big::from(3u32));
    assert_eq!(s.vested_at(&total, 3), total);
}

#[test]
fn next_release_reports_the_next_jump() {
    let s = linear(0, 100, 50, 1_000);
    assert_eq!(next(&s, 1_000, 0), Some((100, vested(&s, 1_000, 100))));
    // Past the cliff a linear curve still has an exact next release: 950 over
    // 1000 seconds grows by one unit at 102 (floor(950 * 102 / 1000) = 96).
    assert_eq!(next(&s, 1_000, 100), Some((102, 1)));
    // Fast linear: every second.
    let fast = linear(0, 0, 0, 10);
    assert_eq!(next(&fast, 1_000, 3), Some((4, 100)));
    // Slow linear: one unit over a year vests only at the end.
    let slow = linear(0, 0, 0, 365 * 86_400);
    assert_eq!(next(&slow, 1, 10), Some((365 * 86_400, 1)));
    // Not started yet, nothing at the cliff: the first unit.
    let later = linear(1_000, 1_000, 0, 2_000);
    assert_eq!(next(&later, 100, 0), Some((1_010, 1)));
    // Cliff equal to the total: nothing after the cliff.
    let all_at_cliff = linear(0, 100, 1_000, 1_000);
    assert_eq!(next(&all_at_cliff, 1_000, 100), None);
    let s = stepped(0, 0, 0, 100, 30);
    assert_eq!(next(&s, 1_000, 0), Some((30, 250)));
    assert_eq!(next(&s, 1_000, 30), Some((60, 250)));
    assert_eq!(next(&s, 1_000, 95), Some((100, 250)));
    assert_eq!(next(&s, 1_000, 100), None);
    let s = tranches(0, 0, 0, &[(10, 1), (20, 2), (30, 3)]);
    assert_eq!(next(&s, 6, 10), Some((20, 2)));
    // Steps worth nothing are skipped: 2 units over 10 steps.
    let s = stepped(0, 0, 0, 10, 1);
    assert_eq!(next(&s, 2, 0), Some((5, 1)));
    assert_eq!(next(&s, 2, 5), Some((10, 1)));
}

fn next(schedule: &Schedule<Api>, total: u128, now: u64) -> Option<(u64, u128)> {
    schedule
        .next_release(&big(total), now)
        .map(|(at, amount)| (at, amount.to_u64().unwrap() as u128))
}

// ------------------------------------------------- reference model + properties

/// What vests at `t`, written independently of the contract: stepped curves
/// list their release times explicitly instead of dividing.
fn reference(
    kind: &Kind,
    start: u64,
    cliff: u64,
    cliff_amount: &Big,
    end: u64,
    total: &Big,
    t: u64,
) -> Big {
    if t < cliff {
        return Big::from(0u32);
    }
    if t >= end {
        return total.clone();
    }
    let rest = total - cliff_amount;
    let released = match kind {
        Kind::Linear => &rest * Big::from(t - start) / Big::from(end - start),
        Kind::Stepped(interval) => {
            let mut times = Vec::new();
            let mut at = start + interval;
            while at < end {
                times.push(at);
                at += interval;
            }
            times.push(end);
            let passed = times.iter().filter(|time| **time <= t).count();
            &rest * Big::from(passed) / Big::from(times.len())
        }
        Kind::Tranches(list) => list
            .iter()
            .filter(|(time, _)| *time <= t)
            .map(|(_, amount)| Big::from(*amount))
            .sum(),
    };
    cliff_amount + released
}

#[derive(Debug, Clone)]
enum Kind {
    Linear,
    Stepped(u64),
    Tranches(Vec<(u64, u128)>),
}

#[derive(Debug, Clone)]
struct Case {
    kind: Kind,
    start: u64,
    cliff: u64,
    cliff_amount: u128,
    end: u64,
    total: u128,
}

impl Case {
    fn schedule(&self) -> Schedule<Api> {
        let curve = match &self.kind {
            Kind::Linear => Curve::Linear,
            Kind::Stepped(interval) => Curve::Stepped {
                interval: *interval,
            },
            Kind::Tranches(list) => {
                let mut vec = ManagedVec::new();
                for (time, amount) in list {
                    vec.push(Tranche {
                        time: *time,
                        amount: big(*amount),
                    });
                }
                Curve::Tranches(vec)
            }
        };
        Schedule {
            start: self.start,
            cliff: self.cliff,
            cliff_amount: big(self.cliff_amount),
            end: self.end,
            curve,
        }
    }

    fn reference(&self, t: u64) -> Big {
        reference(
            &self.kind,
            self.start,
            self.cliff,
            &Big::from(self.cliff_amount),
            self.end,
            &Big::from(self.total),
            t,
        )
    }
}

fn case() -> impl Strategy<Value = Case> {
    let amounts = prop_oneof![
        1u128..1_000,
        1u128..u64::MAX as u128,
        1u128..=10u128.pow(36)
    ];
    (0u64..2_000_000_000, 1u64..200_000_000, amounts, 0u8..3).prop_flat_map(
        |(start, duration, total, kind)| {
            let end = start + duration;
            let cliff = start..=end;
            let cliff_share = 0u128..=total;
            match kind {
                0 => (cliff, cliff_share)
                    .prop_map(move |(cliff, cliff_amount)| Case {
                        kind: Kind::Linear,
                        start,
                        cliff,
                        cliff_amount,
                        end,
                        total,
                    })
                    .boxed(),
                1 => (cliff, cliff_share, 1u64..=duration)
                    .prop_filter(
                        "at most 5000 steps for the reference",
                        move |(_, _, interval)| duration / interval <= 5_000,
                    )
                    .prop_map(move |(cliff, cliff_amount, interval)| Case {
                        kind: Kind::Stepped(interval),
                        start,
                        cliff,
                        cliff_amount,
                        end,
                        total,
                    })
                    .boxed(),
                _ => {
                    let max_count =
                        (MAX_TRANCHES as u128).min(total).min(duration as u128) as usize;
                    (cliff, 1usize..=max_count)
                        .prop_flat_map(move |(cliff, count)| {
                            (
                                Just(cliff),
                                0u128..=(total - count as u128),
                                proptest::collection::btree_set(start..end, count - 1),
                                proptest::collection::vec(any::<u64>(), count),
                            )
                        })
                        .prop_map(move |(cliff, cliff_amount, times, weights)| {
                            let mut times: Vec<u64> = times.into_iter().collect();
                            times.push(end);
                            // Every tranche at least 1; the rest spread by weight,
                            // the remainder in the last one.
                            let spare = total - cliff_amount - times.len() as u128;
                            let weight_sum: u128 = weights.iter().map(|w| *w as u128 + 1).sum();
                            let mut list = Vec::new();
                            let mut given = 0u128;
                            for (i, time) in times.iter().enumerate() {
                                let extra = if i + 1 == times.len() {
                                    spare - given
                                } else {
                                    let share = spare / weight_sum * (weights[i] as u128 + 1);
                                    given += share;
                                    share
                                };
                                list.push((*time, 1 + extra));
                            }
                            Case {
                                kind: Kind::Tranches(list),
                                start,
                                cliff,
                                cliff_amount,
                                end,
                                total,
                            }
                        })
                        .boxed()
                }
            }
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(2_000))]

    #[test]
    fn generated_schedules_are_valid(case in case()) {
        prop_assert_eq!(case.schedule().validate(&big(case.total)), Ok(()));
    }

    #[test]
    fn matches_the_reference(case in case(), offsets in proptest::collection::vec(any::<u64>(), 8)) {
        let schedule = case.schedule();
        let span = case.end - case.start + 2;
        let mut times = vec![0, case.start, case.cliff, case.end, case.end.saturating_sub(1), case.cliff.saturating_sub(1), u64::MAX];
        times.extend(offsets.iter().map(|o| case.start.saturating_sub(1) + o % span));
        for t in times {
            prop_assert_eq!(to_big(&schedule.vested_at(&big(case.total), t)), case.reference(t), "t = {}", t);
        }
    }

    #[test]
    fn monotonic_bounded_and_exact_at_the_end(case in case(), a in any::<u64>(), b in any::<u64>()) {
        let schedule = case.schedule();
        let total = big(case.total);
        let span = case.end - case.start + 2;
        let t1 = case.start.saturating_sub(1) + a % span;
        let t2 = t1.max(case.start.saturating_sub(1) + b % span);
        let v1 = schedule.vested_at(&total, t1);
        let v2 = schedule.vested_at(&total, t2);
        prop_assert!(v1 <= v2);
        prop_assert!(v2 <= total);
        prop_assert!(schedule.vested_at(&total, case.end) == total);
        if case.cliff > 0 {
            prop_assert!(schedule.vested_at(&total, case.cliff - 1) == 0u32);
        }
    }

    /// Claims at any moments, a cancel at any moment, then a last claim: the
    /// beneficiary and the canceller together get exactly the total.
    #[test]
    fn claims_and_cancel_always_sum_to_the_total(
        case in case(),
        claim_offsets in proptest::collection::vec(any::<u64>(), 0..6),
        cancel_offset in any::<u64>(),
    ) {
        let schedule = case.schedule();
        let total = big(case.total);
        let span = case.end - case.start + 2;
        let cancel_at = case.start.saturating_sub(1) + cancel_offset % span;
        let mut claim_times: Vec<u64> = claim_offsets.iter().map(|o| case.start.saturating_sub(1) + o % span).filter(|t| *t <= cancel_at).collect();
        claim_times.sort();
        let mut claimed = BigUint::<Api>::zero();
        for t in claim_times {
            let vested = schedule.vested_at(&total, t);
            prop_assert!(vested >= claimed);
            claimed = vested;
        }
        let vested_at_cancel = schedule.vested_at(&total, cancel_at);
        prop_assert!(vested_at_cancel >= claimed);
        let refund = &total - &vested_at_cancel;
        let last_claim = &vested_at_cancel - &claimed;
        prop_assert!(claimed + last_claim + refund == total);
    }

    /// The next release is a real jump, and nothing vests before it.
    #[test]
    fn next_release_is_the_next_jump(case in case(), offset in any::<u64>()) {
        let schedule = case.schedule();
        let total = big(case.total);
        let span = case.end - case.start + 2;
        let now = case.start.saturating_sub(1) + offset % span;
        match schedule.next_release(&total, now) {
            Some((at, amount)) => {
                prop_assert!(at > now);
                prop_assert!(amount > 0u32);
                let before = schedule.vested_at(&total, now);
                prop_assert!(schedule.vested_at(&total, at) == &before + &amount);
                prop_assert!(schedule.vested_at(&total, at - 1) == before);
            },
            None => {
                // Only when nothing more will ever vest.
                prop_assert!(schedule.vested_at(&total, now) == total);
            },
        }
    }
}
