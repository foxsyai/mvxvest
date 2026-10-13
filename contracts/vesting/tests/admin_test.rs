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
        .recover_surplus(native(), OWNER, OptionalValue::<BigUint<StaticApi>>::None)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), OWNER, OptionalValue::<BigUint<StaticApi>>::None)
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
            "tags:mvxvest,vesting;vesting:1;token:FOX-a1b2c3;cancelable:0;metadata:bafyexample/claim.json"
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
        .recover_surplus(
            token(FOX),
            MALLORY,
            OptionalValue::<BigUint<StaticApi>>::None,
        )
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), BOB, OptionalValue::<BigUint<StaticApi>>::None)
        .run();
    f.check_fox(BOB, 40);
    // Exactly the locked 1000 remain.
    f.check_invariant(Some(FOX));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), BOB, OptionalValue::<BigUint<StaticApi>>::None)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
}

/// The contract takes `key` back, as when sending it to a smart contract
/// that cannot receive it bounces.
fn bounce(f: &mut Fixture, from: TestAddress, kind: KeyKind, nonce: u64) {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .payment(key(kind, nonce))
        .whitebox(mvxvest::contract_obj, |_| {});
}

fn recover(f: &mut Fixture, caller: TestAddress, id: u64, kind: KeyKind, to: TestAddress) {
    f.world
        .tx()
        .from(caller)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(id, kind, to)
        .run();
}

fn recover_fails(
    f: &mut Fixture,
    caller: TestAddress,
    id: u64,
    kind: KeyKind,
    to: TestAddress,
    error: &str,
) {
    f.world
        .tx()
        .from(caller)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(id, kind, to)
        .returns(ExpectError(4, error))
        .run();
}

#[test]
fn only_the_owner_moves_a_key_that_bounced_at_creation() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    bounce(&mut f, ALICE, KeyKind::Claim, 1);
    // Not the creator, not the beneficiary, not a stranger.
    for caller in [CREATOR, ALICE, MALLORY] {
        recover_fails(&mut f, caller, 1, KeyKind::Claim, caller, ERR_ONLY_OWNER);
    }
    recover(&mut f, OWNER, 1, KeyKind::Claim, BOB);
    f.check_holds_key(BOB, KeyKind::Claim, 1, 1, FOX.as_str());
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 1_000);
    f.check_invariant(Some(FOX));
}

#[test]
fn a_key_that_bounced_after_a_claim_goes_back_through_the_owner() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    bounce(&mut f, ALICE, KeyKind::Claim, 1);
    recover_fails(&mut f, CREATOR, 1, KeyKind::Claim, CREATOR, ERR_ONLY_OWNER);
    recover(&mut f, OWNER, 1, KeyKind::Claim, ALICE);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_invariant(Some(FOX));
}

#[test]
fn each_bounced_key_goes_back_to_its_own_holder() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    bounce(&mut f, ALICE, KeyKind::Claim, 1);
    bounce(&mut f, CREATOR, KeyKind::Cancel, 1);
    recover(&mut f, OWNER, 1, KeyKind::Cancel, CREATOR);
    recover(&mut f, OWNER, 1, KeyKind::Claim, ALICE);
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
}

#[test]
fn recovery_needs_a_held_key_and_a_valid_recipient() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // Alice holds her key: nothing to recover.
    recover_fails(&mut f, OWNER, 1, KeyKind::Claim, OWNER, ERR_NO_HELD_KEY);
    // A non-cancelable vesting has no cancel key at all.
    recover_fails(&mut f, OWNER, 2, KeyKind::Cancel, OWNER, ERR_NO_HELD_KEY);
    bounce(&mut f, ALICE, KeyKind::Claim, 1);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, SC)
        .returns(ExpectError(4, ERR_BAD_RECIPIENT))
        .run();
    recover_fails(&mut f, OWNER, 9, KeyKind::Claim, OWNER, ERR_UNKNOWN_VESTING);
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

#[test]
fn only_the_owner_disables_key_burning_and_only_once_issued() {
    let mut f = Fixture::without_keys();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .disable_key_burn_by_holders(KeyKind::Claim)
        .returns(ExpectError(4, ERR_CLAIM_KEY_NOT_ISSUED))
        .run();
    f.issue_keys();
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .disable_key_burn_by_holders(KeyKind::Cancel)
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();
    // The call itself goes to the ESDT system contract on the metachain; its
    // effect is checked on devnet (scripts/src/setup.ts).
}
