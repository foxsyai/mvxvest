//! Version 2: the token fee (DECISIONS.md #10), surplus recovery by amount
//! (audit C1) and the cancelable marker on new keys (audit RT3).
//!
//! The token fee is a share of each vesting's total, in its own token, paid
//! by the creator on top of the total and sent to the owner at once. The
//! beneficiary always gets exactly the total; the fee never enters the
//! contract's books.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

fn set_token_fee(f: &mut Fixture, bps: u32) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(bps)
        .run();
}

fn token_fee(f: &mut Fixture) -> u32 {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_token_fee()
        .returns(ReturnsResult)
        .run()
}

/// `create` of a linear FOX vesting for Alice paying `paid` FOX (and
/// `egld` EGLD when not 0); the id, or the error message.
fn create_paying(f: &mut Fixture, total: u128, paid: u128, egld: u128) -> Result<u64, String> {
    let mut pay = vec![(Some(FOX), paid)];
    if egld > 0 {
        pay.push((None, egld));
    }
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), linear(T0, T0, 0, T0 + DAY), false, "v2")
        .payment(payments(&pay))
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map_err(|e| e.message)
}

fn owner_fox(f: &mut Fixture, expected: u128) {
    f.world
        .check_account(OWNER)
        .esdt_balance(FOX, big(expected));
}

#[test]
fn the_token_fee_starts_at_zero_and_only_the_owner_sets_it_up_to_2_percent() {
    let mut f = Fixture::new();
    assert_eq!(token_fee(&mut f), 0);
    let max: u32 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_max_token_fee()
        .returns(ReturnsResult)
        .run();
    assert_eq!(max, 200);
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(100u32)
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(201u32)
        .returns(ExpectError(4, ERR_TOKEN_FEE_ABOVE_CAP))
        .run();
    set_token_fee(&mut f, 200);
    assert_eq!(token_fee(&mut f), 200);
    set_token_fee(&mut f, 0);
    assert_eq!(token_fee(&mut f), 0);
}

#[test]
fn a_creation_pays_exactly_the_total_plus_one_percent_and_the_owner_gets_it() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // The amount a dApp previewed before the fee: refused, never taken.
    assert_eq!(
        create_paying(&mut f, 1_000, 1_000, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    assert_eq!(
        create_paying(&mut f, 1_000, 1_011, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    let id = create_paying(&mut f, 1_000, 1_010, 0).unwrap();
    owner_fox(&mut f, 10);
    // The beneficiary's vesting is the total, and the books hold only it.
    assert_eq!(f.view(id).vesting.total, big(1_000));
    assert_eq!(f.totals(token(FOX)).deposited, big(1_000));
    f.check_invariant(Some(FOX));
    f.set_time(T0 + DAY);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    f.check_invariant(Some(FOX));
}

#[test]
fn the_egld_fee_is_still_paid_in_egld_next_to_the_token_fee() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    assert_eq!(
        create_paying(&mut f, 1_000, 1_010, 0),
        Err(ERR_WRONG_FEE.to_string())
    );
    create_paying(&mut f, 1_000, 1_010, EGLD / 10).unwrap();
    owner_fox(&mut f, 10);
    assert_eq!(f.fees_accrued(), big(EGLD / 10));
}

#[test]
fn a_batch_pays_each_vestings_fee_rounded_down() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // 1% of 150, 99 and 1 is 1, 0 and 0: the batch pays 1, as the three
    // created one by one would.
    let mut entries = MultiValueEncoded::new();
    for total in [150u128, 99, 1] {
        entries.push(
            (
                ALICE.to_managed_address(),
                big(total),
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
        .create_batch(false, "batch", entries)
        .payment(payments(&[(Some(FOX), 250 + 1)]))
        .run();
    owner_fox(&mut f, 1);
    assert_eq!(f.totals(token(FOX)).deposited, big(250));
    f.check_invariant(Some(FOX));
}

#[test]
fn an_egld_vesting_pays_total_plus_token_fee_plus_egld_fee_all_in_egld() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 150);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    let owner_before = 10 * EGLD - 2 * ISSUE_COST;
    // 1.5% of 2 EGLD is 0.03 EGLD.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(2 * EGLD),
            linear(T0, T0, 0, T0 + DAY),
            false,
            "egld",
        )
        .egld(big(2 * EGLD + 3 * EGLD / 100 + EGLD / 10))
        .run();
    f.world
        .check_account(OWNER)
        .balance(big(owner_before + 3 * EGLD / 100));
    assert_eq!(f.fees_accrued(), big(EGLD / 10));
    assert_eq!(f.totals(native()).deposited, big(2 * EGLD));
    // The contract holds exactly what it owes plus the EGLD fees: no surplus.
    f.world.check_account(SC).balance(big(2 * EGLD + EGLD / 10));
}

#[test]
fn dust_pays_no_token_fee_and_sends_nothing() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // 1% of 99 units rounds to 0: what is paid is the total alone.
    create_paying(&mut f, 99, 99, 0).unwrap();
    owner_fox(&mut f, 0);
}

#[test]
fn a_fee_change_between_preview_and_signing_fails_the_creation() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // Previewed at 1%: 1,010. The owner moves it to 2% first.
    set_token_fee(&mut f, 200);
    assert_eq!(
        create_paying(&mut f, 1_000, 1_010, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    owner_fox(&mut f, 0);
}

#[test]
fn new_keys_say_whether_the_vesting_can_be_cancelled() {
    let mut f = Fixture::new();
    let plain = f.create_fox(ALICE, 100, linear(T0, T0, 0, T0 + DAY), false);
    let cancelable = f.create_fox(BOB, 100, linear(T0, T0, 0, T0 + DAY), true);
    f.world
        .check_account(ALICE)
        .esdt_nft_balance_and_attributes(
            CLAIM_KEY,
            1,
            1,
            format!("tags:mvxvest,vesting;vesting:{plain};token:FOX-a1b2c3;cancelable:0")
                .as_bytes(),
        );
    f.world.check_account(BOB).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        2,
        1,
        format!("tags:mvxvest,vesting;vesting:{cancelable};token:FOX-a1b2c3;cancelable:1")
            .as_bytes(),
    );
    f.world
        .check_account(CREATOR)
        .esdt_nft_balance_and_attributes(
            CANCEL_KEY,
            1,
            1,
            format!("tags:mvxvest,vesting;vesting:{cancelable};token:FOX-a1b2c3;cancelable:1")
                .as_bytes(),
        );
}

/// 60 FOX of payouts bounced back (from the creator, as in the C1 proof).
fn bounce(f: &mut Fixture, amount: u128) {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(payments(&[(Some(FOX), amount)]))
        .whitebox(mvxvest::contract_obj, |_| {});
}

fn recover(f: &mut Fixture, to: TestAddress, amount: Option<u128>) -> Result<(), String> {
    let amount = match amount {
        Some(amount) => OptionalValue::Some(big(amount)),
        None => OptionalValue::None,
    };
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), to, amount)
        .returns(ReturnsHandledOrError::new())
        .run()
        .map(|_| ())
        .map_err(|e| e.message)
}

#[test]
fn the_surplus_is_returned_in_parts_never_beyond_it() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + DAY), false);
    bounce(&mut f, 60);
    assert_eq!(
        recover(&mut f, BOB, Some(0)),
        Err(ERR_ZERO_AMOUNT.to_string())
    );
    assert_eq!(
        recover(&mut f, BOB, Some(61)),
        Err(ERR_ABOVE_SURPLUS.to_string())
    );
    recover(&mut f, BOB, Some(40)).unwrap();
    f.check_fox(BOB, 40);
    // Without an amount: the rest, as in version 1.
    recover(&mut f, ALICE, None).unwrap();
    f.check_fox(ALICE, 20);
    assert_eq!(
        recover(&mut f, ALICE, Some(1)),
        Err(ERR_NO_SURPLUS.to_string())
    );
    // The locked 1,000 never moved.
    f.check_invariant(Some(FOX));
}
