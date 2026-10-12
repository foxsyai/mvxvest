//! Review 2, verified safe (F3): the linear branch of `next_release` at the
//! extremes the existing property test does not reach: totals up to 320
//! bits, durations up to MAX_T, timestamps next to it, cliffs with nothing
//! at the cliff. The released amount is also checked against an independent
//! big-integer formula.
//!
//! MAX_T is i64::MAX: the framework's `BigUint * u64` and `BigUint / u64`
//! signal "cast to i64 error" for a u64 above it, so the schedule maths
//! (old and new alike) cannot run on durations beyond i64::MAX seconds.
//! The contract never meets one: `create` caps `end` at now + 30 years.

use multiversx_sc::types::BigUint;
use multiversx_sc_scenario::api::StaticApi;
use mvxvest::schedule::{Curve, Schedule};
use num_bigint::BigUint as Big;
use proptest::prelude::*;

type Api = StaticApi;

const MAX_T: u64 = i64::MAX as u64;

fn to_big(value: &BigUint<Api>) -> Big {
    Big::from_bytes_be(value.to_bytes_be().as_slice())
}

fn from_big(value: &Big) -> BigUint<Api> {
    BigUint::from_bytes_be(&value.to_bytes_be())
}

fn linear(start: u64, cliff: u64, cliff_amount: &Big, end: u64) -> Schedule<Api> {
    Schedule {
        start,
        cliff,
        cliff_amount: from_big(cliff_amount),
        end,
        curve: Curve::Linear,
    }
}

/// vested(t) from the spec, written out with num_bigint.
fn reference(start: u64, cliff: u64, cliff_amount: &Big, end: u64, total: &Big, t: u64) -> Big {
    if t < cliff {
        return Big::from(0u32);
    }
    if t >= end {
        return total.clone();
    }
    let rest = total - cliff_amount;
    cliff_amount + rest * Big::from(t - start) / Big::from(end - start)
}

/// The next-release contract: a real jump, nothing before it, and `None`
/// only once everything has vested.
fn check(s: &Schedule<Api>, total: &Big, now: u64) -> Result<(), TestCaseError> {
    let total_mx = from_big(total);
    let vested = |t: u64| to_big(&s.vested_at(&total_mx, t));
    let r = |t: u64| reference(s.start, s.cliff, &to_big(&s.cliff_amount), s.end, total, t);
    prop_assert_eq!(vested(now), r(now));
    match s.next_release(&total_mx, now) {
        Some((at, amount)) => {
            let amount = to_big(&amount);
            prop_assert!(at > now && at <= s.end, "at = {}", at);
            prop_assert!(amount > Big::from(0u32));
            prop_assert_eq!(vested(at), r(at));
            prop_assert_eq!(vested(at), vested(now) + &amount);
            prop_assert_eq!(vested(at - 1), vested(now), "an earlier jump at {}", at - 1);
        }
        None => prop_assert_eq!(vested(now), total.clone()),
    }
    Ok(())
}

fn big_from_bytes(bytes: &[u8]) -> Big {
    Big::from_bytes_be(bytes)
}

#[test]
fn hand_picked_extremes() {
    let one = Big::from(1u32);
    let zero = Big::from(0u32);
    let huge = big_from_bytes(&[0xff; 40]);
    // One unit over the whole u64 range: only at the very end.
    let s = linear(0, 0, &zero, MAX_T);
    assert_eq!(
        s.next_release(&from_big(&one), 0)
            .map(|(at, a)| (at, to_big(&a))),
        Some((MAX_T, one.clone()))
    );
    check(&s, &one, 0).unwrap();
    check(&s, &one, MAX_T - 1).unwrap();
    // A 320-bit total over the whole u64 range grows every second.
    check(&s, &huge, 0).unwrap();
    check(&s, &huge, MAX_T / 2).unwrap();
    check(&s, &huge, MAX_T - 1).unwrap();
    // A 320-bit total over one second, next to MAX_T.
    let s = linear(MAX_T - 1, MAX_T - 1, &zero, MAX_T);
    check(&s, &huge, MAX_T - 1).unwrap();
    // Nothing at the cliff: 10 units over 100 s, cliff at 5 (released 0
    // there), so the first unit is at 10.
    let s = linear(1_000, 1_005, &zero, 1_100);
    assert_eq!(
        s.next_release(&from_big(&Big::from(10u32)), 0)
            .map(|(at, a)| (at, to_big(&a))),
        Some((1_010, one.clone()))
    );
    for now in [0, 999, 1_000, 1_004, 1_005, 1_009, 1_010, 1_099] {
        check(&s, &Big::from(10u32), now).unwrap();
    }
    // Cliff amount equal to the total: nothing after the cliff.
    let s = linear(0, 50, &huge, 100);
    check(&s, &huge, 10).unwrap();
    check(&s, &huge, 50).unwrap();
    assert!(s.next_release(&from_big(&huge), 60).is_none());
}

fn schedule_case() -> impl Strategy<Value = (u64, u64, u64, Big, Big)> {
    (
        any::<u64>(),
        prop_oneof![1u64..=10, 1u64..=1_000_000_000, any::<u64>()],
        proptest::collection::vec(any::<u8>(), 1..=40),
        any::<u64>(),
        any::<u64>(),
    )
        .prop_map(|(start, duration, total_bytes, cliff_pick, share)| {
            let start = start % MAX_T;
            let end = start + duration.max(1).min(MAX_T - start);
            let cliff = start + cliff_pick % (end - start + 1);
            let total = big_from_bytes(&total_bytes) + 1u32;
            // A cliff amount anywhere from 0 to the total.
            let cliff_amount = match share % 4 {
                0 => Big::from(0u32),
                1 => total.clone(),
                _ => &total * Big::from(share) / Big::from(u64::MAX),
            };
            (start, cliff, end, cliff_amount, total)
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(5_000))]

    #[test]
    fn linear_next_release_at_the_extremes(
        (start, cliff, end, cliff_amount, total) in schedule_case(),
        pick in any::<u64>(),
    ) {
        let s = linear(start, cliff, &cliff_amount, end);
        prop_assert_eq!(s.validate(&from_big(&total)), Ok(()));
        let span = end - start;
        let mut times = vec![
            start.saturating_sub(1), start, cliff.saturating_sub(1), cliff,
            cliff.saturating_add(1).min(end), end - 1, end,
        ];
        times.push(start + pick % span.saturating_add(1).max(1));
        for now in times {
            check(&s, &total, now)?;
        }
    }
}
