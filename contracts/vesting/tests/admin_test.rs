//! Owner powers and their limits: fee, pause, key display, fees, recovery.
//! The owner can never move locked funds.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

#[test]
fn fee_is_capped_and_owner_only() {
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
        .set_fee(big(EGLD + 1))
        .returns(ExpectError(4, ERR_FEE_ABOVE_CAP))
        .run();
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(0))
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
}

#[test]
fn owner_collects_fees_and_nothing_else() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, 5 * EGLD + EGLD / 10)]),
    );
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 1_000), (None, EGLD / 10)]),
    );
    let owner_before = 10 * EGLD - 2 * ISSUE_COST;
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim_fees()
        .run();
    f.world
        .check_account(OWNER)
        .balance(big(owner_before + EGLD / 5));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim_fees()
        .returns(ExpectError(4, ERR_NO_FEES))
        .run();
    // The locked EGLD and FOX are untouched, and there is no surplus.
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(native(), OWNER)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), OWNER)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
}

#[test]
fn pause_stops_creation_only() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .pause_creation()
        .run();
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 10)]),
        ERR_CREATION_PAUSED,
    );
    let paused: bool = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .is_creation_paused()
        .returns(ReturnsResult)
        .run();
    assert!(paused);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .unpause_creation()
        .run();
    f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .pause_creation()
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
}

#[test]
fn key_display_applies_to_new_keys() {
    let mut f = Fixture::new();
    let mut uris = MultiValueEncoded::new();
    uris.push(ManagedBuffer::from("https://mvxvest.io/nft/claim.svg"));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(KeyKind::Claim, "bafyexample/claim.json", uris)
        .run();
    f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    f.world
        .check_account(ALICE)
        .esdt_nft_balance_and_attributes(
            CLAIM_KEY,
            1,
            1,
            "tags:mvxvest,vesting;vesting:1;token:FOX-a1b2c3;metadata:bafyexample/claim.json"
                .as_bytes(),
        );
}

#[test]
fn surplus_from_a_bounced_payout_can_be_returned_but_locked_funds_cannot() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // A payout that bounced: 40 FOX come back to the contract with no call.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(payments(&[(Some(FOX), 40)]))
        .whitebox(mvxvest::contract_obj, |_| {});
    let surplus: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(token(FOX))
        .returns(ReturnsResult)
        .run();
    assert_eq!(surplus, big(40));
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), MALLORY)
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), BOB)
        .run();
    f.check_fox(BOB, 40);
    // Exactly the locked 1000 remain.
    f.check_invariant(Some(FOX));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), BOB)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
}

#[test]
fn claim_key_that_bounced_at_creation_goes_where_the_creator_says() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    // Simulate the bounce: the key comes back to the contract.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .whitebox(mvxvest::contract_obj, |_| {});
    // Neither the beneficiary nor a stranger may redirect it.
    for caller in [ALICE, MALLORY] {
        f.world
            .tx()
            .from(caller)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_keys(1u64, caller)
            .returns(ExpectError(4, ERR_NOT_ALLOWED))
            .run();
    }
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, BOB)
        .run();
    f.check_holds_key(BOB, KeyKind::Claim, 1, 1, FOX.as_str());
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 1_000);
    f.check_invariant(Some(FOX));
}

#[test]
fn claim_key_that_bounced_after_a_claim_is_for_the_owner_to_return() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .whitebox(mvxvest::contract_obj, |_| {});
    // Something was claimed, so the creator may no longer redirect it.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, CREATOR)
        .returns(ExpectError(4, ERR_NOT_ALLOWED))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, ALICE)
        .run();
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
}

#[test]
fn recovery_needs_a_held_key_and_a_valid_recipient() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, CREATOR)
        .returns(ExpectError(4, ERR_NO_HELD_KEY))
        .run();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, SC)
        .returns(ExpectError(4, ERR_BAD_RECIPIENT))
        .run();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(9u64, CREATOR)
        .returns(ExpectError(4, ERR_UNKNOWN_VESTING))
        .run();
}

#[test]
fn cancel_key_that_bounced_goes_back_to_the_creator() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(key(KeyKind::Cancel, 1))
        .whitebox(mvxvest::contract_obj, |_| {});
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, MALLORY)
        .returns(ExpectError(4, ERR_NOT_ALLOWED))
        .run();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(1u64, CREATOR)
        .run();
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
}

#[test]
fn upgrade_keeps_every_vesting() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .run();
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 500);
    f.check_invariant(Some(FOX));
}
