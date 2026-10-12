//! Review finding: for an EGLD vesting made with `create`, the total is
//! "EGLD paid minus the current fee". `setFee` (src/admin.rs) and
//! DECISIONS.md promise that "a creation must pay exactly the current fee, so
//! a change between preview and signing makes it fail, never overcharge".
//! That holds for ESDT vestings and for `createBatch` (totals are explicit),
//! but not for an EGLD `create`: if the fee changes while the creator's
//! transaction is pending, the transaction still succeeds and the difference
//! is silently taken from (or added to) the beneficiary's vested total.
//!
//! Expected once fixed: the transaction fails, or the vesting has exactly the
//! total the creator previewed and signed for.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[test]
fn fee_raised_before_an_egld_create_lands_does_not_shrink_the_vesting() {
    let mut f = Fixture::new();
    // The dApp previews: fee 0, vest 5 EGLD for Alice, so pay 5 EGLD.
    let previewed_total = 5 * EGLD;
    // Before the creator's transaction lands, the fee goes to 1 EGLD.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD))
        .run();
    let result = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(previewed_total),
            linear(T0, T0, 0, T0 + DAY),
            false,
            "team",
        )
        .egld(big(previewed_total))
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run();
    let Ok(id) = result else {
        // Refused: the fee change made it fail, as promised.
        return;
    };
    let total = f.view(id).vesting.total.to_u64().unwrap();
    let fees = f.fees_accrued().to_u64().unwrap();
    assert_eq!(
        total as u128, previewed_total,
        "signed for a 5 EGLD vesting; got a {total} wei vesting and {fees} wei of fees: \
         the fee change was taken out of the beneficiary's vesting"
    );
}

#[test]
fn fee_lowered_before_an_egld_create_lands_does_not_change_the_vesting() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    // Previewed with a fee of 0.1 EGLD: pay 5.1 EGLD to vest 5 EGLD.
    let previewed_total = 5 * EGLD;
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(0))
        .run();
    let result = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(previewed_total),
            linear(T0, T0, 0, T0 + DAY),
            false,
            "team",
        )
        .egld(big(previewed_total + EGLD / 10))
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run();
    let Ok(id) = result else {
        return;
    };
    let total = f.view(id).vesting.total.to_u64().unwrap();
    assert_eq!(
        total as u128, previewed_total,
        "signed for a 5 EGLD vesting; got a {total} wei vesting after a fee change"
    );
}
