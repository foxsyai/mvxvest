//! Fifth audit (reviewer MONEY, 1 Nov 2026): every curve cancelled at every
//! second, with the claim before or after the cancel in the same second, and
//! the extremes of amounts and durations. Deterministic where the random walk
//! (`audit5_money_random_walk`) is not.
//!
//! For each schedule shape and each second `t` from before the start to past
//! the end: a vesting is created, (a) cancelled at `t` then claimed at `t`
//! and again after the end, or (b) claimed at `t` then cancelled at `t` and
//! claimed again after the end. In every case what the claim key paid plus
//! what the cancel key paid is exactly the total, the claim key paid exactly
//! the model's `vested(t)`, both keys are burned, and the books read exactly
//! what is owed (0 at the end).
//!
//! The extremes: one unit vested over the full 30 year horizon on each curve
//! (nothing claimable until the last second, then the unit); 1e30 units over
//! 30 years (vested one second before the end is below the total, the end
//! pays it all, `getNextRelease` and `getVestedAt(u64::MAX)` answer);
//! 120 tranches of 1e28 each.
//!
//! It passes on 26b0d4c.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

#[derive(Clone, Debug)]
enum Shape {
    Linear,
    Stepped(u64),
    Tranches(Vec<(u64, u128)>),
}

/// (start, cliff, cliff_amount, end, shape)
#[derive(Clone, Debug)]
struct Sched {
    start: u64,
    cliff: u64,
    cliff_amount: u128,
    end: u64,
    shape: Shape,
}

fn vested(s: &Sched, total: u128, t: u64) -> u128 {
    if t < s.cliff {
        return 0;
    }
    if t >= s.end {
        return total;
    }
    let rest = total - s.cliff_amount;
    let released = match &s.shape {
        Shape::Linear => rest * (t - s.start) as u128 / (s.end - s.start) as u128,
        Shape::Stepped(interval) => {
            let steps = (s.end - s.start).div_ceil(*interval) as u128;
            let done = ((t - s.start) / interval) as u128;
            rest * done / steps
        }
        Shape::Tranches(list) => list
            .iter()
            .filter(|(time, _)| *time <= t)
            .map(|(_, a)| a)
            .sum(),
    };
    s.cliff_amount + released
}

fn to_schedule(s: &Sched) -> Schedule<StaticApi> {
    let curve = match &s.shape {
        Shape::Linear => Curve::Linear,
        Shape::Stepped(interval) => Curve::Stepped {
            interval: *interval,
        },
        Shape::Tranches(list) => {
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
        start: s.start,
        cliff: s.cliff,
        cliff_amount: big(s.cliff_amount),
        end: s.end,
        curve,
    }
}

fn claim(f: &mut Fixture, from: TestAddress, nonce: u64) -> Result<(), String> {
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

fn key_count(f: &mut Fixture, account: TestAddress, kind: KeyKind, nonce: u64) -> u64 {
    let collection = match kind {
        KeyKind::Claim => CLAIM_KEY,
        KeyKind::Cancel => CANCEL_KEY,
    };
    let address: ManagedAddress<StaticApi> = account.to_managed_address();
    let mut found = 0u64;
    f.world
        .query()
        .to(SC)
        .whitebox(mvxvest::contract_obj, |sc| {
            found = sc
                .blockchain()
                .get_esdt_token_data(
                    &ManagedAddress::from(address.to_address()),
                    &EsdtTokenIdentifier::from(collection.as_str()),
                    nonce,
                )
                .amount
                .to_u64()
                .unwrap();
        });
    found
}

/// Linear, stepped with an interval that does not divide the duration,
/// tranches, a cliff amount, a cliff with nothing at it, everything at a
/// cliff that is the end, and a one second schedule.
fn shapes(t0: u64, total: u128) -> Vec<Sched> {
    vec![
        Sched {
            start: t0,
            cliff: t0,
            cliff_amount: 0,
            end: t0 + 20,
            shape: Shape::Linear,
        },
        Sched {
            start: t0,
            cliff: t0 + 5,
            cliff_amount: total / 3,
            end: t0 + 20,
            shape: Shape::Linear,
        },
        Sched {
            start: t0,
            cliff: t0,
            cliff_amount: 0,
            end: t0 + 20,
            shape: Shape::Stepped(7),
        },
        Sched {
            start: t0,
            cliff: t0 + 9,
            cliff_amount: 1,
            end: t0 + 20,
            shape: Shape::Stepped(6),
        },
        Sched {
            start: t0,
            cliff: t0,
            cliff_amount: 0,
            end: t0 + 20,
            shape: Shape::Tranches(vec![
                (t0 + 3, 1),
                (t0 + 4, total / 2),
                (t0 + 20, total - 1 - total / 2),
            ]),
        },
        Sched {
            start: t0,
            cliff: t0 + 10,
            cliff_amount: total - 2,
            end: t0 + 20,
            shape: Shape::Tranches(vec![(t0 + 2, 1), (t0 + 20, 1)]),
        },
        Sched {
            start: t0,
            cliff: t0 + 10,
            cliff_amount: total,
            end: t0 + 10,
            shape: Shape::Linear,
        },
        Sched {
            start: t0 + 10,
            cliff: t0 + 10,
            cliff_amount: 0,
            end: t0 + 11,
            shape: Shape::Linear,
        },
    ]
}

#[test]
fn safe_every_curve_cancelled_at_every_second_splits_the_total_exactly() {
    let t0 = T0 + 100;
    let total: u128 = 1_000;
    let mut f = Fixture::new();
    let mut cases = 0;
    let mut alice_fox: u128 = 0;
    let mut creator_fox: u128 = 10u128.pow(36);
    for sched in shapes(t0, total) {
        for t in (t0 - 2)..=(t0 + 22) {
            for claim_first in [false, true] {
                f.set_time(t0 - 10);
                let id = f.create_fox(ALICE, total, to_schedule(&sched), true);
                creator_fox -= total;
                let view = f.view(id);
                let (claim_nonce, cancel_nonce) =
                    (view.vesting.claim_nonce, view.vesting.cancel_nonce);
                f.set_time(t);
                let expected_vested = vested(&sched, total, t);
                if claim_first {
                    let r = claim(&mut f, ALICE, claim_nonce);
                    if expected_vested == 0 {
                        assert_eq!(r, Err(ERR_NOTHING_TO_CLAIM.to_string()), "{sched:?} at {t}");
                    } else {
                        assert_eq!(r, Ok(()), "{sched:?} at {t}");
                        alice_fox += expected_vested;
                        f.check_fox(ALICE, alice_fox);
                    }
                }
                f.cancel(CREATOR, &[cancel_nonce]);
                creator_fox += total - expected_vested;
                f.check_fox(CREATOR, creator_fox);
                assert_eq!(key_count(&mut f, CREATOR, KeyKind::Cancel, cancel_nonce), 0);
                // The claim key now collects exactly the frozen part, in this
                // second or long after, and is burned once it has.
                let r = claim(&mut f, ALICE, claim_nonce);
                if claim_first && expected_vested == total {
                    // The first claim paid the whole total and burned the
                    // key: there is no key to send any more.
                    assert!(r.is_err(), "{sched:?} at {t} second claim");
                } else if claim_first {
                    // Already paid everything the cancel froze: this one
                    // only burns the key (allowed, nothing paid).
                    assert_eq!(r, Ok(()), "{sched:?} at {t} second claim");
                } else {
                    assert_eq!(r, Ok(()), "{sched:?} at {t}");
                    alice_fox += expected_vested;
                }
                f.check_fox(ALICE, alice_fox);
                assert_eq!(
                    key_count(&mut f, ALICE, KeyKind::Claim, claim_nonce),
                    0,
                    "{sched:?} at {t}: key burned"
                );
                f.set_time(t0 + 1_000);
                let r = claim(&mut f, ALICE, claim_nonce);
                assert!(r.is_err(), "{sched:?} at {t}: the burned key cannot claim");
                f.check_fox(ALICE, alice_fox);
                f.check_fox(CREATOR, creator_fox);
                let view = f.view(id);
                assert_eq!(view.claimed, big(expected_vested));
                assert_eq!(view.final_amount, big(expected_vested));
                assert_eq!(view.refunded, big(total - expected_vested));
                assert_eq!(view.cancelled_at, t);
                f.check_invariant(Some(FOX));
                f.world.check_account(SC).esdt_balance(FOX, big(0));
                cases += 1;
            }
        }
    }
    println!("{cases} cases");
    assert!(cases >= 400);
}

fn create_with_amount(f: &mut Fixture, total: u128, schedule: Schedule<StaticApi>) -> u64 {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), schedule, true, "x")
        .payment(payments(&[(Some(FOX), total)]))
        .returns(ReturnsResult)
        .run()
}

#[test]
fn safe_one_unit_over_thirty_years_pays_the_unit_only_at_the_end() {
    let mut f = Fixture::new();
    let horizon = 30 * 365 * 24 * 60 * 60;
    let end = T0 + horizon;
    let mut alice_fox: u128 = 0;
    for schedule in [
        linear(T0, T0, 0, end),
        stepped(T0, end, 1),
        stepped(T0, end, horizon),
        tranches(T0, &[(end, 1)]),
    ] {
        let id = create_with_amount(&mut f, 1, schedule);
        let nonce = f.view(id).vesting.claim_nonce;
        for t in [T0, T0 + 1, T0 + horizon / 2, end - 1] {
            f.set_time(t);
            assert_eq!(f.view(id).claimable, big(0), "#{id} at {t}");
            assert_eq!(
                claim(&mut f, ALICE, nonce),
                Err(ERR_NOTHING_TO_CLAIM.to_string())
            );
        }
        f.set_time(end);
        assert_eq!(f.view(id).claimable, big(1));
        claim(&mut f, ALICE, nonce).unwrap();
        alice_fox += 1;
        f.check_fox(ALICE, alice_fox);
        f.set_time(T0);
    }
    // A schedule one second beyond the horizon is refused.
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, end + 1),
        true,
        payments(&[(Some(FOX), 1)]),
        ERR_TOO_FAR,
    );
    f.check_invariant(Some(FOX));
}

#[test]
fn safe_a_1e30_supply_over_thirty_years_and_120_tranches_of_1e28_round_only_down() {
    let mut f = Fixture::new();
    let horizon: u64 = 30 * 365 * 24 * 60 * 60;
    let end = T0 + horizon;
    let supply: u128 = 10u128.pow(30);
    let id = create_with_amount(&mut f, supply, linear(T0, T0, 0, end));
    let nonce = f.view(id).vesting.claim_nonce;
    f.set_time(T0 + 1);
    let one_second = supply / horizon as u128;
    assert_eq!(f.view(id).claimable, big(one_second));
    f.set_time(end - 1);
    let before_end = supply - supply.div_ceil(horizon as u128);
    assert_eq!(f.view(id).claimable, big(before_end));
    assert!(before_end < supply);
    // The views that convert to u64 answer, and the next release is the end.
    let next: OptionalValue<MultiValue2<u64, BigUint<StaticApi>>> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_next_release(id)
        .returns(ReturnsResult)
        .run();
    match next {
        OptionalValue::Some(pair) => {
            let (at, amount) = pair.into_tuple();
            assert_eq!(at, end);
            assert_eq!(amount, big(supply - before_end));
        }
        OptionalValue::None => panic!("a release is still due"),
    }
    let at_max: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vested_at(id, u64::MAX)
        .returns(ReturnsResult)
        .run();
    assert_eq!(at_max, big(supply));
    claim(&mut f, ALICE, nonce).unwrap();
    f.check_fox(ALICE, before_end);
    // The stamp of a 1e30 key: 99% claimed, the exact units in the attributes.
    f.check_holds_key(ALICE, KeyKind::Claim, nonce, id, FOX.as_str());
    f.set_time(end);
    claim(&mut f, ALICE, nonce).unwrap();
    f.check_fox(ALICE, supply);
    assert_eq!(key_count(&mut f, ALICE, KeyKind::Claim, nonce), 0);
    f.check_invariant(Some(FOX));

    // 120 tranches of 1e28, one per day: a claim after each day pays one
    // tranche, the sum is the total.
    let per = 10u128.pow(28);
    let list: Vec<(u64, u128)> = (1..=120u64).map(|d| (T0 + d * DAY, per)).collect();
    let id = create_with_amount(&mut f, per * 120, tranches(T0, &list));
    let nonce = f.view(id).vesting.claim_nonce;
    for d in 1..=120u64 {
        f.set_time(T0 + d * DAY);
        claim(&mut f, ALICE, nonce).unwrap();
        f.check_fox(ALICE, supply + per * d as u128);
    }
    assert_eq!(key_count(&mut f, ALICE, KeyKind::Claim, nonce), 0);
    f.check_invariant(Some(FOX));
    f.world.check_account(SC).esdt_balance(FOX, big(0));
}

/// EGLD is both the vested asset and the fee: a bounced payout of EGLD is
/// the only EGLD the owner can ever move, never the vested part nor the
/// accrued fees, and `claimFees` takes exactly the fees.
#[test]
fn safe_egld_as_asset_and_fee_the_owner_moves_only_what_bounced() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(200u32)
        .run();
    let total = 50 * EGLD;
    let token_fee = total * 200 / 10_000;
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(total),
            linear(T0, T0, 0, T0 + 1_000),
            true,
            "egld",
        )
        .egld(big(total + token_fee + EGLD))
        .returns(ReturnsResult)
        .run();
    // The token fee went to the owner at once; the contract holds the total
    // and the EGLD fee.
    f.world.check_account(SC).balance(big(total + EGLD));
    f.world
        .check_account(OWNER)
        .balance(big(10 * EGLD - 2 * ISSUE_COST + token_fee));
    let surplus = |f: &mut Fixture| -> BigUint<StaticApi> {
        f.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_surplus(native())
            .returns(ReturnsResult)
            .run()
    };
    assert_eq!(surplus(&mut f), big(0));
    let recover = |f: &mut Fixture, amount: Option<u128>| -> Result<(), String> {
        let amount = match amount {
            Some(a) => OptionalValue::Some(big(a)),
            None => OptionalValue::None,
        };
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_surplus(native(), OWNER.to_managed_address(), amount)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    };
    assert_eq!(recover(&mut f, None), Err(ERR_NO_SURPLUS.to_string()));
    assert_eq!(recover(&mut f, Some(1)), Err(ERR_NO_SURPLUS.to_string()));

    // A payout of 7 EGLD bounced back.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .egld(big(7 * EGLD))
        .whitebox(mvxvest::contract_obj, |_| {});
    assert_eq!(surplus(&mut f), big(7 * EGLD));
    assert_eq!(
        recover(&mut f, Some(7 * EGLD + 1)),
        Err(ERR_ABOVE_SURPLUS.to_string())
    );
    recover(&mut f, Some(3 * EGLD)).unwrap();
    assert_eq!(surplus(&mut f), big(4 * EGLD));
    // Halfway, Alice claims 25 EGLD: the surplus is still the bounce.
    f.set_time(T0 + 500);
    claim(&mut f, ALICE, 1).unwrap();
    f.world
        .check_account(ALICE)
        .balance(big(100 * EGLD + total / 2));
    assert_eq!(surplus(&mut f), big(4 * EGLD));
    // The owner collects the fee: exactly 1 EGLD, the surplus unchanged.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim_fees()
        .run();
    f.world
        .check_account(OWNER)
        .balance(big(10 * EGLD - 2 * ISSUE_COST
            + token_fee
            + 3 * EGLD
            + EGLD));
    assert_eq!(surplus(&mut f), big(4 * EGLD));
    f.world.check_account(SC).balance(big(total / 2 + 4 * EGLD));
    recover(&mut f, None).unwrap();
    assert_eq!(recover(&mut f, None), Err(ERR_NO_SURPLUS.to_string()));
    f.world.check_account(SC).balance(big(total / 2));
    // The creator cancels: the other 25 EGLD go back; the claim key burns.
    f.cancel(CREATOR, &[1]);
    f.world.check_account(SC).balance(big(0));
    claim(&mut f, ALICE, 1).unwrap();
    assert_eq!(key_count(&mut f, ALICE, KeyKind::Claim, 1), 0);
    f.check_invariant(None);
}
