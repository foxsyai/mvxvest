//! Review 2, verified safe (F2): `create` with an explicit total settles the
//! payment exactly, for EGLD and ESDT, with and without a fee, as plain value
//! or in a multi-transfer with `EGLD-000000`, and refuses every mismatch.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

fn set_fee(f: &mut Fixture, fee: u128) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(fee))
        .run();
}

fn create_with(
    f: &mut Fixture,
    total: u128,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Result<u64, String> {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), linear(T0, T0, 0, T0 + DAY), false, "x")
        .payment(payment)
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map_err(|e| e.message)
}

fn create_egld_value(f: &mut Fixture, total: u128, value: u128) -> Result<u64, String> {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), linear(T0, T0, 0, T0 + DAY), false, "x")
        .egld(big(value))
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map_err(|e| e.message)
}

#[test]
fn every_correct_payment_shape_is_accepted_and_booked_exactly() {
    let mut f = Fixture::new();
    let fee = EGLD / 10;
    set_fee(&mut f, fee);
    // EGLD as plain value: total plus fee.
    let a = create_egld_value(&mut f, 5 * EGLD, 5 * EGLD + fee).unwrap();
    // EGLD as EGLD-000000, split over several entries.
    let b = create_with(
        &mut f,
        2 * EGLD,
        payments(&[(None, EGLD), (None, EGLD + fee)]),
    )
    .unwrap();
    // ESDT with the fee as EGLD-000000 in the same multi-transfer.
    let c = create_with(&mut f, 700, payments(&[(Some(FOX), 700), (None, fee)])).unwrap();
    // ESDT split over two entries of the same token, fee split too.
    let d = create_with(
        &mut f,
        700,
        payments(&[
            (Some(FOX), 300),
            (None, fee / 2),
            (Some(FOX), 400),
            (None, fee / 2),
        ]),
    )
    .unwrap();
    assert_eq!(f.view(a).vesting.total, big(5 * EGLD));
    assert_eq!(f.view(b).vesting.total, big(2 * EGLD));
    assert_eq!(f.view(c).vesting.total, big(700));
    assert_eq!(f.view(d).vesting.total, big(700));
    assert_eq!(f.fees_accrued(), big(4 * fee));
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
    // Fee 0: an ESDT vesting with no EGLD at all.
    set_fee(&mut f, 0);
    create_with(&mut f, 9, payments(&[(Some(FOX), 9)])).unwrap();
    create_egld_value(&mut f, 9, 9).unwrap();
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
}

#[test]
fn every_mismatch_is_refused() {
    let mut f = Fixture::new();
    let fee = EGLD / 10;
    set_fee(&mut f, fee);
    let deposit = Err(ERR_WRONG_DEPOSIT.to_string());
    let wrong_fee = Err(ERR_WRONG_FEE.to_string());
    // EGLD: fee missing, one wei too much, one wei too little.
    assert_eq!(create_egld_value(&mut f, 5 * EGLD, 5 * EGLD), deposit);
    assert_eq!(
        create_egld_value(&mut f, 5 * EGLD, 5 * EGLD + fee + 1),
        deposit
    );
    assert_eq!(
        create_egld_value(&mut f, 5 * EGLD, 5 * EGLD + fee - 1),
        deposit
    );
    // The total claimed bigger than paid, with the fee alone.
    assert_eq!(create_egld_value(&mut f, fee, fee), deposit);
    // ESDT: the token amount must be the total, the EGLD the fee.
    assert_eq!(
        create_with(&mut f, 700, payments(&[(Some(FOX), 701), (None, fee)])),
        deposit
    );
    assert_eq!(
        create_with(&mut f, 701, payments(&[(Some(FOX), 700), (None, fee)])),
        deposit
    );
    assert_eq!(
        create_with(&mut f, 700, payments(&[(Some(FOX), 700)])),
        wrong_fee
    );
    assert_eq!(
        create_with(&mut f, 700, payments(&[(Some(FOX), 700), (None, fee + 1)])),
        wrong_fee
    );
    // Two tokens, and a zero total.
    assert_eq!(
        create_with(
            &mut f,
            700,
            payments(&[(Some(FOX), 700), (Some(USDC), 1), (None, fee)])
        ),
        Err(ERR_ONE_TOKEN.to_string())
    );
    assert_eq!(
        create_egld_value(&mut f, 0, fee),
        Err(ERR_ZERO_TOTAL.to_string())
    );
    // Fee 0 and stray EGLD next to an ESDT.
    set_fee(&mut f, 0);
    assert_eq!(
        create_with(&mut f, 700, payments(&[(Some(FOX), 700), (None, 1)])),
        wrong_fee
    );
    assert_eq!(f.fees_accrued(), big(0));
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
}
