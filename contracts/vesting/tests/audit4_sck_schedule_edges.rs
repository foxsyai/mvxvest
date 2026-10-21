//! Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK: the schedule
//! maths at its edges, through the contract's endpoints and views rather than
//! the unit functions (`schedule_math.rs` covers those). All pass on 322cb43
//! (`safe_*`).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

fn vested_at(f: &mut Fixture, id: u64, t: u64) -> u128 {
    let value: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vested_at(id, t)
        .returns(ReturnsResult)
        .run();
    value.to_u64().unwrap() as u128
}

fn next(f: &mut Fixture, id: u64) -> Option<(u64, u128)> {
    let result: OptionalValue<MultiValue2<u64, BigUint<StaticApi>>> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_next_release(id)
        .returns(ReturnsResult)
        .run();
    result
        .into_option()
        .map(|value| value.into_tuple())
        .map(|(at, amount)| (at, amount.to_u64().unwrap() as u128))
}

fn schedule(
    start: u64,
    cliff: u64,
    cliff_amount: u128,
    end: u64,
    curve: Curve<StaticApi>,
) -> Schedule<StaticApi> {
    Schedule {
        start,
        cliff,
        cliff_amount: big(cliff_amount),
        end,
        curve,
    }
}

fn tranche_list(list: &[(u64, u128)]) -> Curve<StaticApi> {
    let mut vec = ManagedVec::new();
    for (time, amount) in list {
        vec.push(Tranche {
            time: *time,
            amount: big(*amount),
        });
    }
    Curve::Tranches(vec)
}

/// SAFE: a plain time lock on every curve that allows one. Nothing one
/// second before, everything at the end, the next release is the end itself,
/// and the key is burned by the one claim.
#[test]
fn safe_time_locks_on_every_curve_that_allows_one() {
    let mut f = Fixture::new();
    let end = T0 + 100;
    let cases = [
        // start = cliff = end
        linear(end, end, 0, end),
        // start < cliff = end, with a cliff amount: all of it at the end
        linear(T0, end, 300, end),
        // one tranche, at start = cliff = end
        schedule(end, end, 0, end, tranche_list(&[(end, 1_000)])),
        // one step as long as the schedule
        stepped(T0, end, 100),
    ];
    let mut ids = Vec::new();
    for case in cases {
        ids.push(f.create_fox(ALICE, 1_000, case, false));
    }
    // A stepped curve with an empty duration has no room for any interval.
    f.create_fails(
        ALICE.to_managed_address(),
        stepped(end, end, 1),
        false,
        payments(&[(Some(FOX), 1_000)]),
        ERR_INTERVAL_TOO_LONG,
    );
    for id in &ids {
        assert_eq!(vested_at(&mut f, *id, end - 1), 0);
        assert_eq!(vested_at(&mut f, *id, end), 1_000);
        assert_eq!(next(&mut f, *id), Some((end, 1_000)), "vesting {id}");
    }
    f.set_time(end - 1);
    f.claim_fails(ALICE, &ids, ERR_NOTHING_TO_CLAIM);
    f.set_time(end);
    f.claim(ALICE, &ids);
    f.check_fox(ALICE, 4_000);
    for id in &ids {
        assert_eq!(next(&mut f, *id), None);
        assert_eq!(f.view(*id).claimed, big(1_000));
    }
    f.check_invariant(Some(FOX));
}

/// SAFE: a cliff amount equal to the total releases everything at the cliff
/// on the linear and stepped curves; `getNextRelease` names the cliff before
/// it and is empty from the cliff on (everything has vested, though the end
/// is later); tranches cannot sum to zero so the shape is refused there.
#[test]
fn safe_cliff_amount_equal_to_the_total() {
    let mut f = Fixture::new();
    let cliff = T0 + 10;
    let end = T0 + 100;
    let linear_id = f.create_fox(ALICE, 1_000, linear(T0, cliff, 1_000, end), false);
    let stepped_id = f.create_fox(
        ALICE,
        1_000,
        schedule(T0, cliff, 1_000, end, Curve::Stepped { interval: 10 }),
        false,
    );
    f.create_fails(
        ALICE.to_managed_address(),
        schedule(T0, cliff, 1_000, end, tranche_list(&[(end, 1)])),
        false,
        payments(&[(Some(FOX), 1_000)]),
        ERR_TRANCHE_SUM,
    );
    for id in [linear_id, stepped_id] {
        assert_eq!(vested_at(&mut f, id, cliff - 1), 0);
        assert_eq!(vested_at(&mut f, id, cliff), 1_000);
        assert_eq!(vested_at(&mut f, id, end - 1), 1_000);
        assert_eq!(next(&mut f, id), Some((cliff, 1_000)));
    }
    f.set_time(cliff);
    for id in [linear_id, stepped_id] {
        assert_eq!(next(&mut f, id), None, "everything vested at the cliff");
    }
    f.set_time(T0 + 50);
    for id in [linear_id, stepped_id] {
        assert_eq!(next(&mut f, id), None);
    }
    f.claim(ALICE, &[linear_id, stepped_id]);
    f.check_fox(ALICE, 2_000);
    // Both keys are burned: the next claim cannot even be sent.
    for id in [linear_id, stepped_id] {
        f.world
            .tx()
            .from(ALICE)
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(key(KeyKind::Claim, id))
            .returns(ExpectStatus(10))
            .run();
    }
    f.check_invariant(Some(FOX));
}

/// SAFE: every malformed tranche list is refused with its own error, 120
/// tranches are accepted and 121 are not, and a tranche exactly at `start`
/// vests at once when the cliff is there too.
#[test]
fn safe_tranche_shapes_the_contract_refuses_and_accepts() {
    let mut f = Fixture::new();
    let alice = ALICE.to_managed_address();
    let fox = || payments(&[(Some(FOX), 1_000)]);
    let refused = [
        (
            tranche_list(&[(T0 + 10, 500), (T0 + 10, 500)]),
            T0 + 10,
            ERR_TRANCHE_ORDER,
        ),
        (
            tranche_list(&[(T0 + 10, 1_000), (T0 + 20, 0)]),
            T0 + 20,
            ERR_ZERO_TRANCHE,
        ),
        (
            tranche_list(&[(T0 - 1, 500), (T0 + 20, 500)]),
            T0 + 20,
            ERR_TRANCHE_BEFORE_START,
        ),
        (
            tranche_list(&[(T0 + 10, 1_000)]),
            T0 + 20,
            ERR_LAST_TRANCHE_NOT_END,
        ),
        (tranche_list(&[]), T0 + 20, ERR_TRANCHE_COUNT),
        (
            tranche_list(&[(T0 + 10, 999), (T0 + 20, 2)]),
            T0 + 20,
            ERR_TRANCHE_SUM,
        ),
    ];
    for (curve, end, error) in refused {
        f.create_fails(
            alice.clone(),
            schedule(T0, T0, 0, end, curve),
            false,
            fox(),
            error,
        );
    }
    let many = |count: u64| -> Vec<(u64, u128)> { (1..=count).map(|i| (T0 + i, 1u128)).collect() };
    f.create_fails(
        alice.clone(),
        schedule(T0, T0, 0, T0 + 121, tranche_list(&many(121))),
        false,
        payments(&[(Some(FOX), 121)]),
        ERR_TRANCHE_COUNT,
    );
    let hundred_twenty = f.create(
        CREATOR,
        ALICE,
        schedule(T0, T0, 0, T0 + 120, tranche_list(&many(120))),
        false,
        payments(&[(Some(FOX), 120)]),
    );
    assert_eq!(vested_at(&mut f, hundred_twenty, T0 + 60), 60);

    let at_start = f.create(
        CREATOR,
        ALICE,
        schedule(
            T0,
            T0,
            0,
            T0 + 100,
            tranche_list(&[(T0, 400), (T0 + 100, 600)]),
        ),
        false,
        payments(&[(Some(FOX), 1_000)]),
    );
    assert_eq!(vested_at(&mut f, at_start, T0), 400);
    assert_eq!(next(&mut f, at_start), Some((T0 + 100, 600)));
    f.claim(ALICE, &[at_start]);
    f.check_fox(ALICE, 400);
    f.check_invariant(Some(FOX));
}

/// SAFE: `getVestedAt` at the ends of time, with and without a cancel: 0 at
/// the epoch, the total at `u64::MAX`, the frozen amount at `u64::MAX` after
/// a cancel, and the past untouched by the cancel.
#[test]
fn safe_timestamp_extremes_in_the_views() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    assert_eq!(vested_at(&mut f, id, 0), 0);
    assert_eq!(vested_at(&mut f, id, T0 - 1), 0);
    assert_eq!(vested_at(&mut f, id, T0 + 500), 500);
    assert_eq!(vested_at(&mut f, id, T0 + 999), 999);
    assert_eq!(vested_at(&mut f, id, u64::MAX), 1_000);
    f.set_time(T0 + 300);
    f.cancel(CREATOR, &[1]);
    assert_eq!(vested_at(&mut f, id, T0 + 299), 299);
    assert_eq!(vested_at(&mut f, id, T0 + 300), 300);
    assert_eq!(vested_at(&mut f, id, T0 + 301), 300);
    assert_eq!(vested_at(&mut f, id, u64::MAX), 300);
    assert_eq!(next(&mut f, id), None);
    let view = f.view(id);
    assert_eq!(
        (view.vested, view.final_amount, view.refunded),
        (big(300), big(300), big(700))
    );
    // The test clock keeps milliseconds in a u64, so the block time stops
    // short of u64::MAX here; the view argument above does not.
    let far = u64::MAX / 1_000 - 1;
    f.set_time(far);
    let view = f.view(id);
    assert_eq!(
        (view.vested, view.claimable, view.timestamp),
        (big(300), big(300), far)
    );
    assert_eq!(next(&mut f, id), None);
    f.check_invariant(Some(FOX));
}

/// Walks every second from one before the start to one past the end and
/// checks, through the views: vested never decreases, never exceeds the
/// total, is exactly the total at the end; `getNextRelease` at every second
/// names a real jump with nothing in between.
fn walk(f: &mut Fixture, id: u64, total: u128, start: u64, end: u64) {
    let mut previous = 0u128;
    for t in (start - 1)..=(end + 1) {
        let v = vested_at(f, id, t);
        assert!(v >= previous, "vesting {id}: vested fell at {t}");
        assert!(v <= total);
        if t >= end {
            assert_eq!(v, total);
        }
        previous = v;
        f.set_time(t);
        match next(f, id) {
            None => assert!(t >= end, "vesting {id}: empty before the end at {t}"),
            Some((at, amount)) => {
                assert!(t < end);
                assert!(at > t && at <= end, "vesting {id}: next at {at} from {t}");
                assert_eq!(amount, vested_at(f, id, at) - v, "vesting {id} at {t}");
                assert!(amount > 0);
                assert_eq!(
                    vested_at(f, id, at - 1),
                    v,
                    "vesting {id}: a jump before {at}"
                );
            }
        }
    }
}

/// SAFE: the walk over four shapes: a linear curve whose cliff catches up on
/// a slow release, a stepped curve with a short last step, a stepped curve
/// releasing fewer units than it has steps, and tranches gated by a cliff.
#[test]
fn safe_vested_never_decreases_and_next_release_is_the_next_jump() {
    let mut f = Fixture::new();
    let cases: [(u128, Schedule<StaticApi>); 4] = [
        (7, linear(T0, T0 + 3, 2, T0 + 50)),
        (1_000, stepped(T0, T0 + 100, 30)),
        (2, stepped(T0, T0 + 100, 10)),
        (
            1_000,
            schedule(
                T0,
                T0 + 50,
                0,
                T0 + 100,
                tranche_list(&[(T0 + 10, 100), (T0 + 20, 100), (T0 + 100, 800)]),
            ),
        ),
    ];
    for (total, case) in cases {
        let (start, end) = (case.start, case.end);
        let id = f.create_fox(ALICE, total, case, false);
        walk(&mut f, id, total, start, end);
    }
}

/// SAFE: rounding never loses a unit: the remainders land at the end (or
/// spread by one unit per step), and the claims add up to the total exactly.
#[test]
fn safe_rounding_lands_remainders_at_the_end_and_claims_sum_to_the_total() {
    let mut f = Fixture::new();
    let linear_id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 3), false);
    let stepped_id = f.create_fox(ALICE, 10, stepped(T0, T0 + 30, 10), false);
    let sparse_id = f.create_fox(ALICE, 2, stepped(T0, T0 + 100, 10), false);
    let mut paid = 0u128;
    for (t, expected) in [(T0 + 1, 333), (T0 + 2, 333), (T0 + 3, 334)] {
        f.set_time(t);
        f.claim(ALICE, &[linear_id]);
        paid += expected;
        f.check_fox(ALICE, paid);
    }
    for (t, expected) in [(T0 + 10, 3), (T0 + 20, 3), (T0 + 30, 4)] {
        f.set_time(t);
        f.claim(ALICE, &[stepped_id]);
        paid += expected;
        f.check_fox(ALICE, paid);
    }
    assert_eq!(vested_at(&mut f, sparse_id, T0 + 49), 0);
    assert_eq!(vested_at(&mut f, sparse_id, T0 + 50), 1);
    assert_eq!(vested_at(&mut f, sparse_id, T0 + 99), 1);
    f.set_time(T0 + 49);
    f.claim_fails(ALICE, &[sparse_id], ERR_NOTHING_TO_CLAIM);
    for (t, expected) in [(T0 + 50, 1), (T0 + 100, 1)] {
        f.set_time(t);
        f.claim(ALICE, &[sparse_id]);
        paid += expected;
        f.check_fox(ALICE, paid);
    }
    assert_eq!(paid, 1_000 + 10 + 2);
    f.check_invariant(Some(FOX));
}
