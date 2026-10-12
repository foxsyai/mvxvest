//! Review finding: `getNextRelease` is empty for a linear vesting that is not
//! vesting at all yet. The spec (section 4) says it is empty only "after a
//! cancel, at the end, or while a linear curve vests every second", and the
//! code's own doc reads "Empty when nothing more will vest". Two cases where
//! the view is empty although the next release is a definite future moment:
//!
//! 1. a linear schedule whose start (= cliff, no cliff amount) is in the
//!    future: nothing vests for a day, then it starts;
//! 2. a linear schedule that releases less than one unit per second (1 unit
//!    over a year): nothing vests until the very end.
//!
//! A dApp that follows the documented meaning shows "nothing more will vest"
//! for a vesting that still holds its whole total.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

fn next(f: &mut Fixture, id: u64) -> Option<(u64, BigUint<StaticApi>)> {
    let result: OptionalValue<MultiValue2<u64, BigUint<StaticApi>>> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_next_release(id)
        .returns(ReturnsResult)
        .run();
    result.into_option().map(|value| value.into_tuple())
}

fn vested_at(f: &mut Fixture, id: u64, t: u64) -> BigUint<StaticApi> {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vested_at(id, t)
        .returns(ReturnsResult)
        .run()
}

#[test]
fn next_release_of_a_linear_vesting_that_has_not_started() {
    let mut f = Fixture::new();
    let id = f.create_fox(
        ALICE,
        1_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    // Nothing has vested and nothing vests for a whole day.
    assert_eq!(f.view(id).vested, big(0));
    assert_eq!(vested_at(&mut f, id, T0 + DAY), big(0));
    // The first unit vests at start + ceil(86_400 / 1_000) = start + 87.
    assert_eq!(vested_at(&mut f, id, T0 + DAY + 87), big(1));
    let next = next(&mut f, id);
    assert!(
        next.is_some(),
        "getNextRelease is empty at T0 for a linear vesting that starts at T0 + 1 day \
         (1000 FOX still to vest): the view reads as 'nothing more will vest'"
    );
    let (at, amount) = next.unwrap();
    assert!(at > T0 && amount > 0u32);
}

#[test]
fn next_release_of_a_linear_vesting_slower_than_one_unit_per_second() {
    let mut f = Fixture::new();
    let year = 365 * DAY;
    let id = f.create_fox(ALICE, 1, linear(T0, T0, 0, T0 + year), false);
    f.set_time(T0 + 10);
    // The single unit vests only at the end.
    assert_eq!(vested_at(&mut f, id, T0 + year - 1), big(0));
    assert_eq!(vested_at(&mut f, id, T0 + year), big(1));
    assert_eq!(
        next(&mut f, id),
        Some((T0 + year, big(1))),
        "getNextRelease should report the end (the only release), not 'vests every second'"
    );
}
