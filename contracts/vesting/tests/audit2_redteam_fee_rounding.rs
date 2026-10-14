//! Audit 2 (red team): the token fee and rounding. Every test PASSES on the
//! current code; each pins a behaviour the report describes.
//!
//! The fee is `total * bps / 10,000`, rounded down per vesting. At the agreed
//! 10 bps (0.1%) any vesting under 1,000 units pays nothing, and a batch pays
//! the sum of its entries' rounded fees, so splitting lowers the fee. For a
//! token with 18 decimals that is dust; for one with 0 decimals (`PTS` here)
//! it is the whole fee. The EGLD fee (0.1 EGLD per vesting) is what makes the
//! split cost something.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

fn set_token_fee(f: &mut Fixture, bps: u32) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(bps)
        .run();
}

fn owner_pts(f: &mut Fixture, expected: u128) {
    f.world
        .check_account(OWNER)
        .esdt_balance(PTS, big(expected));
}

fn create_pts(f: &mut Fixture, total: u128, paid: u128) {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), linear(T0, T0, 0, T0 + DAY), false, "pts")
        .payment(payments(&[(Some(PTS), paid)]))
        .run();
}

fn batch_pts(f: &mut Fixture, totals: &[u128], paid: u128) {
    let mut entries = MultiValueEncoded::new();
    for total in totals {
        entries.push(
            (
                ALICE.to_managed_address(),
                big(*total),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "pts", entries)
        .payment(payments(&[(Some(PTS), paid)]))
        .run();
}

#[test]
fn at_10_bps_one_vesting_of_97951_pays_97_but_the_same_amount_in_49_pieces_pays_49() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 10);
    // One vesting: 0.1% of 97,951 is 97 (rounded down from 97.951).
    create_pts(&mut f, 97_951, 97_951 + 97);
    owner_pts(&mut f, 97);
    // The same 97,951 as 49 vestings of 1,999: each pays 1 (rounded down
    // from 1.999), 49 in all, half of the fee one vesting pays.
    batch_pts(&mut f, &[1_999; 49], 49 * 1_999 + 49);
    owner_pts(&mut f, 97 + 49);
    f.check_invariant(Some(PTS));
}

#[test]
fn at_10_bps_vestings_under_1000_units_pay_no_token_fee_at_all() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 10);
    // 49 vestings of 999 units: 48,951 units vested, no fee.
    batch_pts(&mut f, &[999; 49], 49 * 999);
    owner_pts(&mut f, 0);
    // The same 48,951 units as one vesting: 48.
    create_pts(&mut f, 48_951, 48_951 + 48);
    owner_pts(&mut f, 48);
    f.check_invariant(Some(PTS));
}

#[test]
fn the_cap_of_2_percent_still_rounds_down_so_49_units_pay_nothing_at_200_bps() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 200);
    create_pts(&mut f, 49, 49);
    owner_pts(&mut f, 0);
    create_pts(&mut f, 50, 51);
    owner_pts(&mut f, 1);
}
