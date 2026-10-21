//! Fourth audit (contract money paths, 20 Oct 2026): the payment shapes of
//! `create` and `createBatch` that earlier tests do not pin.
//!
//! - an NFT next to a fungible payment, in either order, is refused and
//!   nothing is kept;
//! - a claim key sent to `create` is refused and stays with its holder: the
//!   contract never ends up holding a key through its own entry points;
//! - the same token in two entries is summed, so is EGLD paid as several
//!   `EGLD-000000` entries;
//! - the contract has no token argument: what is paid is what is vested, so
//!   "a token other than the one named" cannot happen on chain (the name is
//!   the dApp's business);
//! - a batch with one bad line creates nothing at all and keeps nothing;
//! - one unit of an 18-decimal token at the 2% cap pays no token fee and is
//!   still claimable to the unit.
//!
//! All pass on 322cb43.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

fn create_with(
    f: &mut Fixture,
    from: TestAddress,
    total: u128,
    pay: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Result<u64, String> {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(total),
            linear(T0, T0, 0, T0 + DAY),
            false,
            "shape",
        )
        .payment(pay)
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map_err(|e| e.message)
}

fn count(f: &mut Fixture) -> u64 {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count()
        .returns(ReturnsResult)
        .run()
}

#[test]
fn safe_an_nft_among_the_payments_is_refused_in_either_order_and_nothing_is_kept() {
    let mut f = Fixture::new();
    let mut first = payments(&[(Some(FOX), 1_000)]);
    first.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    assert_eq!(
        create_with(&mut f, CREATOR, 1_000, first),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    let mut second = ManagedVec::new();
    second.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    second.extend(payments(&[(Some(FOX), 1_000)]).iter().map(|p| p.clone()));
    assert_eq!(
        create_with(&mut f, CREATOR, 1_000, second),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    assert_eq!(count(&mut f), 0);
    f.world
        .check_account(CREATOR)
        .esdt_balance(FOX, big(10u128.pow(36)))
        .esdt_nft_balance_and_attributes(OTHER_NFT, 1, 1, "");
    f.world.check_account(SC).esdt_balance(FOX, big(0));
}

#[test]
fn safe_a_claim_key_sent_to_create_is_refused_and_stays_with_its_holder() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + DAY), true);
    let view = f.view(id);
    let nonce = view.vesting.claim_nonce;
    // Alice "vests" her claim key: refused, the key never enters the
    // contract through its own endpoints.
    assert_eq!(
        create_with(&mut f, ALICE, 1, key(KeyKind::Claim, nonce)),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    // Nor a cancel key, nor a key next to tokens.
    let cancel = view.vesting.cancel_nonce;
    assert_eq!(
        create_with(&mut f, CREATOR, 1, key(KeyKind::Cancel, cancel)),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    let mut mixed = payments(&[(Some(FOX), 1)]);
    mixed.push(Payment::new(
        token(CANCEL_KEY),
        cancel,
        NonZeroBigUint::one(),
    ));
    assert_eq!(
        create_with(&mut f, CREATOR, 1, mixed),
        Err(ERR_NOT_FUNGIBLE.to_string())
    );
    f.check_holds_key(ALICE, KeyKind::Claim, nonce, id, "FOX-a1b2c3");
    f.check_holds_key(CREATOR, KeyKind::Cancel, cancel, id, "FOX-a1b2c3");
    for kind in [KeyKind::Claim, KeyKind::Cancel] {
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, kind, OWNER)
            .returns(ExpectError(4, ERR_NO_HELD_KEY))
            .run();
    }
    assert_eq!(count(&mut f), 1);
    f.check_invariant(Some(FOX));
}

#[test]
fn safe_the_same_token_in_several_entries_is_summed_and_booked_once() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10 + EGLD / 20))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(10u32)
        .run();
    // 1,000 FOX as 600 + 400 + the 1 FOX fee, the 0.15 EGLD fee as 0.1 + 0.05.
    let pay = payments(&[
        (Some(FOX), 600),
        (None, EGLD / 10),
        (Some(FOX), 401),
        (None, EGLD / 20),
    ]);
    let id = create_with(&mut f, CREATOR, 1_000, pay).unwrap();
    let view = f.view(id);
    assert_eq!(view.vesting.total, big(1_000));
    assert_eq!(view.vesting.token, token(FOX));
    let totals = f.totals(token(FOX));
    assert_eq!(totals.deposited, big(1_000));
    assert_eq!(f.fees_accrued(), big(EGLD / 10 + EGLD / 20));
    f.check_fox(OWNER, 1);
    f.check_invariant(Some(FOX));
    f.check_invariant(None);
    // Split differently so the sum is one unit short: refused.
    let short = payments(&[
        (Some(FOX), 600),
        (Some(FOX), 400),
        (None, EGLD / 10 + EGLD / 20),
    ]);
    assert_eq!(
        create_with(&mut f, CREATOR, 1_000, short),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    let short_fee = payments(&[(Some(FOX), 1_001), (None, EGLD / 10), (None, EGLD / 20 - 1)]);
    assert_eq!(
        create_with(&mut f, CREATOR, 1_000, short_fee),
        Err(ERR_WRONG_FEE.to_string())
    );
    assert_eq!(count(&mut f), 1);
}

#[test]
fn safe_what_is_paid_is_what_is_vested_there_is_no_token_to_name() {
    let mut f = Fixture::new();
    // The creator meant FOX but pays USDC: the vesting is of USDC, its key
    // says so, and the FOX books are untouched.
    let id = create_with(&mut f, CREATOR, 1_000, payments(&[(Some(USDC), 1_000)])).unwrap();
    let view = f.view(id);
    assert_eq!(view.vesting.token, token(USDC));
    f.check_holds_key(
        ALICE,
        KeyKind::Claim,
        view.vesting.claim_nonce,
        id,
        "USDC-a1b2c3",
    );
    let fox = f.totals(token(FOX));
    assert_eq!(fox.deposited, big(0));
    let usdc = f.totals(token(USDC));
    assert_eq!(usdc.deposited, big(1_000));
    f.check_invariant(Some(USDC));
    f.set_time(T0 + DAY);
    f.claim(ALICE, &[view.vesting.claim_nonce]);
    f.world.check_account(ALICE).esdt_balance(USDC, big(1_000));
}

#[test]
fn safe_a_batch_with_one_bad_line_creates_nothing_and_keeps_nothing() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    let good = || linear(T0, T0, 0, T0 + DAY);
    let bad_lines: Vec<(ManagedAddress<StaticApi>, u128, Schedule<StaticApi>, &str)> = vec![
        (SC.to_managed_address(), 10, good(), ERR_BAD_BENEFICIARY),
        (ManagedAddress::zero(), 10, good(), ERR_BAD_BENEFICIARY),
        (BOB.to_managed_address(), 0, good(), ERR_ZERO_TOTAL),
        (
            BOB.to_managed_address(),
            10,
            linear(T0, T0, 11, T0 + DAY),
            ERR_CLIFF_ABOVE_TOTAL,
        ),
        (
            BOB.to_managed_address(),
            10,
            linear(T0 + 1, T0, 0, T0 + DAY),
            ERR_TIME_ORDER,
        ),
        (
            BOB.to_managed_address(),
            10,
            stepped(T0, T0 + DAY, DAY + 1),
            ERR_INTERVAL_TOO_LONG,
        ),
        (
            BOB.to_managed_address(),
            10,
            linear(T0, T0, 0, T0 + 30 * 365 * DAY + 1),
            ERR_TOO_FAR,
        ),
    ];
    for (beneficiary, total, schedule, error) in bad_lines {
        let mut list = MultiValueEncoded::new();
        list.push((ALICE.to_managed_address(), big(10u128), good()).into());
        list.push((ALICE.to_managed_address(), big(10u128), good()).into());
        list.push((beneficiary, big(total), schedule).into());
        let result = f
            .world
            .tx()
            .from(CREATOR)
            .to(SC)
            .typed(MvxvestProxy)
            .create_batch(true, "shape", list)
            .payment(payments(&[(Some(FOX), 20 + total), (None, 3 * EGLD / 10)]))
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message);
        assert_eq!(result, Err(error.to_string()));
    }
    assert_eq!(count(&mut f), 0);
    assert_eq!(f.fees_accrued(), big(0));
    f.world
        .check_account(CREATOR)
        .esdt_balance(FOX, big(10u128.pow(36)))
        .balance(big(1_000_000 * EGLD));
    f.world
        .check_account(SC)
        .esdt_balance(FOX, big(0))
        .balance(big(0));
    // No key was minted either: the next vesting gets nonce 1 (fee back to
    // 0, as the fixture's helper pays none).
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(0))
        .run();
    let id = f.create_fox(ALICE, 10, good(), true);
    let view = f.view(id);
    assert_eq!(
        (id, view.vesting.claim_nonce, view.vesting.cancel_nonce),
        (1, 1, 1)
    );
}

#[test]
fn safe_one_unit_at_the_fee_cap_pays_no_token_fee_and_is_claimable_to_the_unit() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(200u32)
        .run();
    let id = create_with(&mut f, CREATOR, 1, payments(&[(Some(FOX), 1)])).unwrap();
    // Paying a unit of fee anyway is refused.
    assert_eq!(
        create_with(&mut f, CREATOR, 1, payments(&[(Some(FOX), 2)])),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    f.check_fox(OWNER, 0);
    let view = f.view(id);
    f.set_time(T0 + DAY / 2);
    // Half a unit rounds down to nothing: nothing to claim yet.
    f.claim_fails(ALICE, &[view.vesting.claim_nonce], ERR_NOTHING_TO_CLAIM);
    f.set_time(T0 + DAY);
    f.claim(ALICE, &[view.vesting.claim_nonce]);
    f.check_fox(ALICE, 1);
    f.check_invariant(Some(FOX));
    f.world.check_account(SC).esdt_balance(FOX, big(0));
}
