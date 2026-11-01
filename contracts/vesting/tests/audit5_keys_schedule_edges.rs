//! Fifth audit (KEYS): the schedule maths at edges the random vectors and the
//! fourth audit's extremes do not pin, with expected values worked out by
//! hand (not printed by the code under test). The dApp's port runs the same
//! table: dapp/src/vesting/tests/audit5_keys_schedule_edges.test.ts. Every
//! test here passes: checked sound.

use multiversx_sc::types::{BigUint, ManagedVec};
use multiversx_sc_scenario::api::StaticApi;
use mvxvest::{
    errors::*,
    schedule::{Curve, Schedule, Tranche},
};

type Api = StaticApi;

fn big(value: u128) -> BigUint<Api> {
    BigUint::from(value)
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
    let value = schedule.vested_at(&big(total), t);
    let bytes = value.to_bytes_be();
    let mut out = 0u128;
    for byte in bytes.as_slice() {
        out = (out << 8) | u128::from(*byte);
    }
    out
}

fn next(schedule: &Schedule<Api>, total: u128, now: u64) -> Option<(u64, u128)> {
    schedule
        .next_release(&big(total), now)
        .map(|(at, amount)| (at, amount.to_u64().unwrap() as u128))
}

/// A hand-worked table: `(t, vested, next)`.
type Sample = (u64, u128, Option<(u64, u128)>);

fn check(name: &str, schedule: &Schedule<Api>, total: u128, samples: &[Sample]) {
    assert_eq!(schedule.validate(&big(total)), Ok(()), "{name}");
    for (t, expected, expected_next) in samples {
        assert_eq!(
            vested(schedule, total, *t),
            *expected,
            "{name}: vested at {t}"
        );
        assert_eq!(
            next(schedule, total, *t),
            *expected_next,
            "{name}: next release at {t}"
        );
    }
}

#[test]
fn safe_stepped_interval_not_dividing_the_duration() {
    // 4 steps of 3 s over 10 s, 7 units: released floor(7k/4) = 1, 3, 5, 7.
    let s = stepped(100, 100, 0, 110, 3);
    check(
        "stepped 10 s by 3",
        &s,
        7,
        &[
            (99, 0, Some((103, 1))),
            (100, 0, Some((103, 1))),
            (102, 0, Some((103, 1))),
            (103, 1, Some((106, 2))),
            (105, 1, Some((106, 2))),
            (106, 3, Some((109, 2))),
            (108, 3, Some((109, 2))),
            (109, 5, Some((110, 2))),
            (110, 7, None),
            (u64::MAX, 7, None),
        ],
    );
}

#[test]
fn safe_one_unit_over_a_long_linear_curve_vests_only_at_the_end() {
    let s = linear(0, 0, 0, 1_000);
    check(
        "1 unit over 1000 s",
        &s,
        1,
        &[
            (0, 0, Some((1_000, 1))),
            (999, 0, Some((1_000, 1))),
            (1_000, 1, None),
        ],
    );
}

#[test]
fn safe_a_cliff_amount_at_the_start_of_a_linear_curve() {
    // 40 at t = 0, then 60 over 100 s.
    let s = linear(0, 0, 40, 100);
    check(
        "cliff amount at start",
        &s,
        100,
        &[
            (0, 40, Some((2, 1))),
            (1, 40, Some((2, 1))),
            (2, 41, Some((4, 1))),
            (50, 70, Some((52, 1))),
            (99, 99, Some((100, 1))),
            (100, 100, None),
        ],
    );
}

#[test]
fn safe_tranches_before_the_cliff_and_nothing_at_the_cliff() {
    // Two tranches before the cliff catch up at it; the rest at the end.
    let s = tranches(0, 30, 0, &[(10, 5), (20, 5), (100, 90)]);
    check(
        "catch-up tranches",
        &s,
        100,
        &[
            (0, 0, Some((30, 10))),
            (29, 0, Some((30, 10))),
            (30, 10, Some((100, 90))),
            (99, 10, Some((100, 90))),
            (100, 100, None),
        ],
    );
    // Nothing unlocks at the cliff itself: the next release is the first
    // tranche after it.
    let s = tranches(0, 5, 0, &[(50, 1), (100, 1)]);
    check(
        "empty cliff",
        &s,
        2,
        &[
            (0, 0, Some((50, 1))),
            (5, 0, Some((50, 1))),
            (49, 0, Some((50, 1))),
            (50, 1, Some((100, 1))),
            (100, 2, None),
        ],
    );
}

#[test]
fn safe_a_stepped_curve_with_a_cliff_amount_and_a_cliff_after_two_steps() {
    // 10 at the cliff (t = 25, two steps done), 100 more in 10 steps of 10 s.
    let s = stepped(0, 25, 10, 100, 10);
    check(
        "stepped with cliff",
        &s,
        110,
        &[
            (0, 0, Some((25, 30))),
            (24, 0, Some((25, 30))),
            (25, 30, Some((30, 10))),
            (29, 30, Some((30, 10))),
            (30, 40, Some((40, 10))),
            (99, 100, Some((100, 10))),
            (100, 110, None),
        ],
    );
}

#[test]
fn safe_a_time_lock_at_timestamp_zero_and_one_tranche_at_the_start() {
    let s = linear(0, 0, 0, 0);
    check(
        "lock at 0",
        &s,
        5,
        &[(0, 5, None), (1, 5, None), (u64::MAX, 5, None)],
    );
    let s = tranches(100, 100, 0, &[(100, 7)]);
    check(
        "one tranche",
        &s,
        7,
        &[
            (0, 0, Some((100, 7))),
            (99, 0, Some((100, 7))),
            (100, 7, None),
        ],
    );
}

#[test]
fn safe_120_tranches_of_one_unit_each_second() {
    let list: Vec<(u64, u128)> = (1..=120).map(|i| (i, 1)).collect();
    let s = tranches(0, 0, 0, &list);
    check(
        "120 tranches",
        &s,
        120,
        &[
            (0, 0, Some((1, 1))),
            (1, 1, Some((2, 1))),
            (60, 60, Some((61, 1))),
            (119, 119, Some((120, 1))),
            (120, 120, None),
        ],
    );
}

#[test]
fn safe_a_tiny_total_over_two_billion_seconds() {
    // 3 units over 2e9 s: the first unit at ceil(2e9 / 3) = 666,666,667.
    let s = linear(0, 0, 0, 2_000_000_000);
    check(
        "3 over 2e9",
        &s,
        3,
        &[
            (0, 0, Some((666_666_667, 1))),
            (666_666_666, 0, Some((666_666_667, 1))),
            (666_666_667, 1, Some((1_333_333_334, 1))),
            (1_999_999_999, 2, Some((2_000_000_000, 1))),
            (2_000_000_000, 3, None),
        ],
    );
}

#[test]
fn safe_the_contract_refuses_every_malformed_edge() {
    let total = big(100);
    let cases: Vec<(&str, Schedule<Api>, &str)> = vec![
        ("zero total", linear(0, 0, 0, 10), ERR_ZERO_TOTAL),
        ("cliff before start", linear(10, 9, 0, 20), ERR_TIME_ORDER),
        ("cliff after end", linear(0, 21, 0, 20), ERR_TIME_ORDER),
        (
            "cliff amount above total",
            linear(0, 0, 101, 20),
            ERR_CLIFF_ABOVE_TOTAL,
        ),
        ("zero interval", stepped(0, 0, 0, 20, 0), ERR_ZERO_INTERVAL),
        (
            "interval longer than the schedule",
            stepped(0, 0, 0, 20, 21),
            ERR_INTERVAL_TOO_LONG,
        ),
        (
            "stepped with an empty duration",
            stepped(20, 20, 0, 20, 1),
            ERR_INTERVAL_TOO_LONG,
        ),
        ("no tranches", tranches(0, 0, 0, &[]), ERR_TRANCHE_COUNT),
        (
            "121 tranches",
            tranches(0, 0, 0, &(1..=121).map(|i| (i, 1)).collect::<Vec<_>>()),
            ERR_TRANCHE_COUNT,
        ),
        (
            "zero tranche",
            tranches(0, 0, 0, &[(10, 0), (20, 100)]),
            ERR_ZERO_TRANCHE,
        ),
        (
            "tranche before start",
            tranches(10, 10, 0, &[(9, 50), (20, 50)]),
            ERR_TRANCHE_BEFORE_START,
        ),
        (
            "duplicate times",
            tranches(0, 0, 0, &[(10, 50), (10, 50)]),
            ERR_TRANCHE_ORDER,
        ),
        (
            "unsorted",
            tranches(0, 0, 0, &[(20, 50), (10, 50)]),
            ERR_TRANCHE_ORDER,
        ),
        (
            "last tranche not at the end",
            Schedule {
                end: 30,
                ..tranches(0, 0, 0, &[(10, 50), (20, 50)])
            },
            ERR_LAST_TRANCHE_NOT_END,
        ),
        (
            "sum below the total",
            tranches(0, 0, 0, &[(10, 50), (20, 49)]),
            ERR_TRANCHE_SUM,
        ),
        (
            "sum above the total",
            tranches(0, 0, 0, &[(10, 50), (20, 51)]),
            ERR_TRANCHE_SUM,
        ),
        (
            "sum plus cliff amount above",
            tranches(0, 0, 1, &[(10, 50), (20, 50)]),
            ERR_TRANCHE_SUM,
        ),
    ];
    for (name, schedule, error) in cases {
        let checked = if name == "zero total" {
            schedule.validate(&big(0))
        } else {
            schedule.validate(&total)
        };
        assert_eq!(checked, Err(error), "{name}");
    }
}
