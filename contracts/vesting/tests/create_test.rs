//! Creating vestings: keys, storage, payments, fees and every rejection.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

const FOX_UNIT: u128 = 1_000_000_000_000_000_000;

#[test]
fn issue_sets_both_collections() {
    let mut f = Fixture::new();
    let claim: ManagedBuffer<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claim_key_collection()
        .returns(ReturnsResult)
        .run();
    assert_eq!(claim, ManagedBuffer::from(CLAIM_KEY.as_str()));
    // A second issue of the same collection is refused.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .issue_claim_key("MvxVestClaimKey", "VESTKEY")
        .egld(big(ISSUE_COST))
        .returns(ExpectError(4, "Token ID already set"))
        .run();
}

#[test]
fn only_the_owner_issues() {
    let mut f = Fixture::without_keys();
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .issue_claim_key("MvxVestClaimKey", "VESTKEY")
        .egld(big(ISSUE_COST))
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
}

#[test]
fn create_mints_both_keys_and_stores_the_vesting() {
    let mut f = Fixture::new();
    let schedule = linear(T0, T0 + 30 * DAY, 100 * FOX_UNIT, T0 + 365 * DAY);
    let id = f.create_fox(ALICE, 1_000 * FOX_UNIT, schedule, true);
    assert_eq!(id, 1);

    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());

    let view = f.view(1);
    assert_eq!(view.id, 1);
    assert_eq!(view.vesting.creator, CREATOR.to_managed_address());
    assert_eq!(view.vesting.beneficiary, ALICE.to_managed_address());
    assert_eq!(view.vesting.token, token(FOX));
    assert_eq!(view.vesting.total, big(1_000 * FOX_UNIT));
    assert!(view.vesting.cancelable);
    assert_eq!(view.vesting.created_at, T0);
    assert_eq!(view.vesting.claim_nonce, 1);
    assert_eq!(view.vesting.cancel_nonce, 1);
    assert_eq!(view.vesting.label, ManagedBuffer::from("team"));
    assert_eq!(view.claimed, big(0));
    assert_eq!(view.cancelled_at, 0);
    assert_eq!(view.vested, big(0));
    assert_eq!(view.claimable, big(0));
    assert_eq!(view.final_amount, big(1_000 * FOX_UNIT));
    assert_eq!(view.refunded, big(0));
    assert_eq!(view.timestamp, T0);

    let totals = f.totals(token(FOX));
    assert_eq!(totals.deposited, big(1_000 * FOX_UNIT));
    f.check_invariant(Some(FOX));
}

#[test]
fn non_cancelable_vesting_has_no_cancel_key() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 500, linear(T0, T0, 0, T0 + DAY), false);
    let view = f.view(id);
    assert!(!view.vesting.cancelable);
    assert_eq!(view.vesting.cancel_nonce, 0);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    f.check_invariant(Some(FOX));
}

#[test]
fn ids_and_nonces_increase() {
    let mut f = Fixture::new();
    let a = f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    let b = f.create_fox(BOB, 20, linear(T0, T0, 0, T0 + DAY), true);
    let c = f.create_fox(ALICE, 30, linear(T0, T0, 0, T0 + DAY), true);
    assert_eq!((a, b, c), (1, 2, 3));
    assert_eq!(f.view(b).vesting.claim_nonce, 2);
    assert_eq!(f.view(b).vesting.cancel_nonce, 1);
    assert_eq!(f.view(c).vesting.claim_nonce, 3);
    assert_eq!(f.view(c).vesting.cancel_nonce, 2);
    f.check_invariant(Some(FOX));
}

#[test]
fn egld_vesting_as_plain_value() {
    let mut f = Fixture::new();
    let id: u64 = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(5 * EGLD),
            linear(T0, T0, 0, T0 + DAY),
            true,
            "egld",
        )
        .egld(big(5 * EGLD))
        .returns(ReturnsResult)
        .run();
    let view = f.view(id);
    assert_eq!(view.vesting.token, native());
    assert_eq!(view.vesting.total, big(5 * EGLD));
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, "EGLD-000000");
    f.check_invariant(None);
}

#[test]
fn egld_vesting_inside_a_multi_transfer() {
    let mut f = Fixture::new();
    let id = f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, 2 * EGLD), (None, 3 * EGLD)]),
    );
    assert_eq!(f.view(id).vesting.total, big(5 * EGLD));
    f.check_invariant(None);
}

#[test]
fn tokens_with_0_6_and_18_decimals() {
    let mut f = Fixture::new();
    for (id, amount) in [(PTS, 7u128), (USDC, 1_234_567_890), (FOX, 10u128.pow(30))] {
        let vesting = f.create(
            CREATOR,
            ALICE,
            linear(T0, T0, 0, T0 + DAY),
            false,
            payments(&[(Some(id), amount)]),
        );
        assert_eq!(f.view(vesting).vesting.total, big(amount));
        f.check_invariant(Some(id));
    }
}

#[test]
fn fee_is_paid_in_egld_on_top_and_accrues() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();

    // ESDT vesting: the token, plus the fee in EGLD.
    let id = f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 1_000), (None, EGLD / 10)]),
    );
    assert_eq!(f.view(id).vesting.total, big(1_000));
    // EGLD vesting: the total plus the fee, in one EGLD amount.
    let id = f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, 2 * EGLD + EGLD / 10)]),
    );
    assert_eq!(f.view(id).vesting.total, big(2 * EGLD));
    assert_eq!(f.fees_accrued(), big(EGLD / 5));
    f.check_invariant(Some(FOX));
    f.check_invariant(None);
}

#[test]
fn wrong_fee_is_refused() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    let alice = ALICE.to_managed_address();
    let schedule = || linear(T0, T0, 0, T0 + DAY);
    // Missing, too low, too high.
    f.create_fails(
        alice.clone(),
        schedule(),
        false,
        payments(&[(Some(FOX), 1_000)]),
        ERR_WRONG_FEE,
    );
    f.create_fails(
        alice.clone(),
        schedule(),
        false,
        payments(&[(Some(FOX), 1_000), (None, EGLD / 20)]),
        ERR_WRONG_FEE,
    );
    f.create_fails(
        alice.clone(),
        schedule(),
        false,
        payments(&[(Some(FOX), 1_000), (None, EGLD)]),
        ERR_WRONG_FEE,
    );
    // An EGLD vesting must pay its total plus the fee, exactly.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(alice, big(EGLD), schedule(), false, "team")
        .egld(big(EGLD))
        .returns(ExpectError(4, ERR_WRONG_DEPOSIT))
        .run();
}

#[test]
fn bad_payments_are_refused() {
    let mut f = Fixture::new();
    let alice = ALICE.to_managed_address();
    let schedule = || linear(T0, T0, 0, T0 + DAY);
    f.create_fails(
        alice.clone(),
        schedule(),
        false,
        ManagedVec::new(),
        ERR_NO_PAYMENT,
    );
    f.create_fails(
        alice.clone(),
        schedule(),
        false,
        payments(&[(Some(FOX), 10), (Some(USDC), 10)]),
        ERR_ONE_TOKEN,
    );
    let mut nft = ManagedVec::new();
    nft.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    f.create_fails(alice, schedule(), false, nft, ERR_NOT_FUNGIBLE);
}

#[test]
fn bad_beneficiaries_are_refused() {
    let mut f = Fixture::new();
    let schedule = || linear(T0, T0, 0, T0 + DAY);
    f.create_fails(
        ManagedAddress::zero(),
        schedule(),
        false,
        payments(&[(Some(FOX), 10)]),
        ERR_BAD_BENEFICIARY,
    );
    f.create_fails(
        SC.to_managed_address(),
        schedule(),
        false,
        payments(&[(Some(FOX), 10)]),
        ERR_BAD_BENEFICIARY,
    );
}

#[test]
fn schedule_errors_reach_the_caller() {
    let mut f = Fixture::new();
    let alice = ALICE.to_managed_address();
    let fox = || payments(&[(Some(FOX), 100)]);
    f.create_fails(
        alice.clone(),
        linear(T0, T0 - 1, 0, T0 + DAY),
        false,
        fox(),
        ERR_TIME_ORDER,
    );
    f.create_fails(
        alice.clone(),
        linear(T0, T0, 101, T0 + DAY),
        false,
        fox(),
        ERR_CLIFF_ABOVE_TOTAL,
    );
    f.create_fails(
        alice.clone(),
        stepped(T0, T0 + DAY, 0),
        false,
        fox(),
        ERR_ZERO_INTERVAL,
    );
    // Explicit tranches out of order.
    f.create_fails(
        alice.clone(),
        tranches(T0, &[(T0 + 2 * DAY, 50), (T0 + DAY, 50)]),
        false,
        fox(),
        ERR_TRANCHE_ORDER,
    );
    f.create_fails(
        alice,
        tranches(T0, &[(T0 + DAY, 50), (T0 + 2 * DAY, 40)]),
        false,
        fox(),
        ERR_TRANCHE_SUM,
    );
}

#[test]
fn horizon_and_label_limits() {
    let mut f = Fixture::new();
    let horizon = 30 * 365 * DAY;
    // Exactly at the horizon is fine, one second past is not.
    f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + horizon), false);
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, T0 + horizon + 1),
        false,
        payments(&[(Some(FOX), 10)]),
        ERR_TOO_FAR,
    );
    let long_label = "x".repeat(65);
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(10),
            linear(T0, T0, 0, T0 + DAY),
            false,
            long_label.as_str(),
        )
        .payment(payments(&[(Some(FOX), 10)]))
        .returns(ExpectError(4, ERR_LABEL_TOO_LONG))
        .run();
}

#[test]
fn keys_must_be_issued_first() {
    let mut f = Fixture::without_keys();
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 10)]),
        ERR_CLAIM_KEY_NOT_ISSUED,
    );
}

#[test]
fn start_in_the_past_vests_at_once() {
    let mut f = Fixture::new();
    // A four-year schedule that began a year ago: a quarter is claimable now.
    let id = f.create_fox(
        ALICE,
        4_000,
        linear(T0 - 365 * DAY, T0 - 365 * DAY, 0, T0 + 3 * 365 * DAY),
        false,
    );
    assert_eq!(f.view(id).claimable, big(1_000));
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    f.check_invariant(Some(FOX));
}

#[test]
fn batch_creates_one_vesting_per_line() {
    let mut f = Fixture::new();
    let mut entries = MultiValueEncoded::new();
    entries.push(
        (
            ALICE.to_managed_address(),
            big(100),
            linear(T0, T0, 0, T0 + DAY),
        )
            .into(),
    );
    entries.push(
        (
            BOB.to_managed_address(),
            big(200),
            stepped(T0, T0 + 10 * DAY, DAY),
        )
            .into(),
    );
    entries.push(
        (
            ALICE.to_managed_address(),
            big(300),
            tranches(T0, &[(T0 + DAY, 100), (T0 + 2 * DAY, 200)]),
        )
            .into(),
    );
    let ids: MultiValueEncoded<StaticApi, u64> = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(true, "seed round", entries)
        .payment(payments(&[(Some(FOX), 600)]))
        .returns(ReturnsResult)
        .run();
    assert_eq!(
        ids.to_vec().into_iter().collect::<Vec<u64>>(),
        vec![1, 2, 3]
    );
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(BOB, KeyKind::Claim, 2, 2, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 3, 3, FOX.as_str());
    for nonce in 1..=3 {
        f.check_holds_key(CREATOR, KeyKind::Cancel, nonce, nonce, FOX.as_str());
    }
    assert_eq!(f.view(2).vesting.label, ManagedBuffer::from("seed round"));
    f.check_invariant(Some(FOX));
}

#[test]
fn batch_must_pay_the_exact_sum() {
    let mut f = Fixture::new();
    let mut entries = MultiValueEncoded::new();
    entries.push(
        (
            ALICE.to_managed_address(),
            big(100),
            linear(T0, T0, 0, T0 + DAY),
        )
            .into(),
    );
    entries.push(
        (
            BOB.to_managed_address(),
            big(200),
            linear(T0, T0, 0, T0 + DAY),
        )
            .into(),
    );
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "x", entries)
        .payment(payments(&[(Some(FOX), 301)]))
        .returns(ExpectError(4, ERR_WRONG_DEPOSIT))
        .run();
}

#[test]
fn batch_size_is_bounded() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "x", MultiValueEncoded::new())
        .payment(payments(&[(Some(FOX), 1)]))
        .returns(ExpectError(4, ERR_BATCH_SIZE))
        .run();
    let mut entries = MultiValueEncoded::new();
    for _ in 0..101 {
        entries.push(
            (
                ALICE.to_managed_address(),
                big(1),
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
        .create_batch(false, "x", entries)
        .payment(payments(&[(Some(FOX), 101)]))
        .returns(ExpectError(4, ERR_BATCH_SIZE))
        .run();
}
