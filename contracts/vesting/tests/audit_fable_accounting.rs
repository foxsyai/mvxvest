//! Audit of 2026-10-13 (Claude Fable 5.1, max effort): accounting, surplus
//! recovery and upgrade guards.
//!
//! Tests named `finding_*` fail on the audited code (fd32f4e1, mainnet) and
//! document a finding; tests named `safe_*` pass and pin behaviour the audit
//! relied on, so that a later change that breaks it is caught.

mod common;

use common::*;
use multiversx_sc::codec::TopEncode;
use multiversx_sc_scenario::imports::*;
use mvxvest::{errors::*, storage::TokenTotals};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A payout that bounced: `amount` FOX come back to the contract with no call
/// (the protocol credits a refund SCR to the contract whether or not it is
/// payable: `mustVerifyPayable` is false for `ReturnCallAfterError`).
fn bounce_funds(f: &mut Fixture, amount: u128) {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(payments(&[(Some(FOX), amount)]))
        .whitebox(mvxvest::contract_obj, |_| {});
}

/// `recoverSurplus(FOX, to, amount)`: all of the surplus when `amount` is None.
fn recover_surplus(f: &mut Fixture, to: TestAddress, amount: Option<u128>) -> Result<(), String> {
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

/// FINDING (low): `recoverSurplus(token, to)` always moves the whole surplus.
/// When the payouts of two different holders bounced (two smart contracts
/// that cannot receive tokens, in another shard), the owner cannot give each
/// one its own amount back: the first recovery takes everything, the second
/// finds "no surplus". The owner has to route the money through a wallet it
/// controls and split it by hand, outside the contract and its events.
/// Fix: an `amount` argument (`amount <= surplus`), storage unchanged, so the
/// upgrade is compatible with every existing vesting.
/// Fixed in version 2: each holder gets its own payout back.
#[test]
fn finding_surplus_recovery_cannot_return_two_bounced_payouts_separately() {
    let mut f = Fixture::new();
    // Two holders, each claims 1,000 FOX at the end; both payouts bounce.
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), false);
    f.create_fox(BOB, 1_000, linear(T0, T0, 0, T0 + 100), false);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.claim(BOB, &[2]);
    bounce_funds(&mut f, 1_000);
    bounce_funds(&mut f, 1_000);
    // The owner returns each holder its own payout. On the audited code the
    // first call sent 2,000 to Alice and the second failed.
    recover_surplus(&mut f, ALICE, Some(1_000)).unwrap();
    let second = recover_surplus(&mut f, BOB, Some(1_000));
    assert_eq!(second, Ok(()), "the second holder gets nothing back");
    // The test cannot make a claim really bounce: each holder kept its
    // claimed 1,000 (the "bounce" came from the creator) and got 1,000 back.
    f.check_fox(ALICE, 2_000);
    f.check_fox(BOB, 2_000);
    f.check_invariant(Some(FOX));
}

/// SAFE: a cancel sent after the claim key was burned (everything claimed)
/// moves no money: refund 0, totals unchanged, the cancel key burned. The
/// vesting then reads as cancelled with `refunded` 0 and `final_amount` equal
/// to the total (cosmetic: the dApp should not call it "stopped").
#[test]
fn safe_cancel_after_everything_was_claimed_moves_nothing() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), true);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    let before = f.totals(token(FOX));
    f.cancel(CREATOR, &[1]);
    let after = f.totals(token(FOX));
    assert_eq!(before.refunded, after.refunded);
    assert_eq!(after.refunded, big(0));
    let view = f.view(1);
    assert_eq!(view.cancelled_at, T0 + 100);
    assert_eq!(view.refunded, big(0));
    assert_eq!(view.final_amount, big(1_000));
    assert_eq!(view.claimable, big(0));
    f.check_fox(CREATOR, 10u128.pow(36) - 1_000);
    f.check_invariant(Some(FOX));
}

/// SAFE, upgrade guard: the per-token totals of EGLD vestings live under the
/// storage key `tokenTotals` + nested `EGLD-000000` (framework 0.66.2,
/// `TokenId::native()`). `recoverSurplus` subtracts these totals from the
/// balance: an upgrade built with a framework that encodes the native token
/// differently would read zero totals and let the owner move locked EGLD as
/// "surplus". This pins the key and the encoding.
#[test]
fn safe_egld_totals_are_stored_under_the_egld_000000_key() {
    let mut f = Fixture::new();
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, 5 * EGLD)]),
    );
    let mut expected = Vec::new();
    TokenTotals::<StaticApi> {
        deposited: big(5 * EGLD),
        claimed: big(0),
        refunded: big(0),
    }
    .top_encode(&mut expected)
    .unwrap();
    f.world.check_account(SC).check_storage(
        "str:tokenTotals|nested:str:EGLD-000000",
        &format!("0x{}", hex(&expected)),
    );
    f.world
        .check_account(SC)
        .check_storage("str:tokenVestings|nested:str:EGLD-000000|str:.len", "1");
    // And the surplus is zero: the whole balance is owed.
    let surplus: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(native())
        .returns(ReturnsResult)
        .run();
    assert_eq!(surplus, big(0));
}

/// SAFE, upgrade guard: the bytes of a stored vesting record. `Vesting`,
/// `Schedule` and `Curve` are nested-encoded field by field with no length or
/// version prefix, so an upgrade must not add, remove or reorder a field of
/// these structs (new state goes in a new mapper, as `claimed` and
/// `cancelledAt` do). The two mainnet vestings are stored in this layout.
#[test]
fn safe_stored_vesting_layout_is_pinned() {
    let mut f = Fixture::new();
    let schedule = Schedule {
        start: T0,
        cliff: T0 + 10,
        cliff_amount: big(100),
        end: T0 + 1_000,
        curve: Curve::Stepped { interval: 90 },
    };
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(1_000), schedule, true, "team")
        .payment(payments(&[(Some(FOX), 1_000)]))
        .run();
    let creator = hex(CREATOR.to_address().as_bytes());
    let alice = hex(ALICE.to_address().as_bytes());
    let expected = format!(
        "0x{creator}{alice}\
         0000000a{fox}\
         0000000203e8\
         {start:016x}{cliff:016x}0000000164{end:016x}01{interval:016x}\
         01\
         {start:016x}\
         0000000000000001\
         0000000000000001\
         000000047465616d",
        fox = hex(FOX.as_str().as_bytes()),
        start = T0,
        cliff = T0 + 10,
        end = T0 + 1_000,
        interval = 90u64,
    );
    f.world
        .check_account(SC)
        .check_storage("str:vesting|u64:1", &expected);
}

/// SAFE: a batch whose raw arguments do not form whole `(beneficiary, total,
/// schedule)` entries is refused as a whole; nothing is created or kept.
#[test]
fn safe_batch_with_a_dangling_argument_is_refused() {
    let mut f = Fixture::new();
    let result = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .raw_call("createBatch")
        .argument(&false)
        .argument(&ManagedBuffer::<StaticApi>::from("x"))
        .argument(&ALICE.to_managed_address::<StaticApi>())
        .argument(&big(10))
        .argument(&linear(T0, T0, 0, T0 + DAY))
        .argument(&BOB.to_managed_address::<StaticApi>())
        .payment(payments(&[(Some(FOX), 10)]))
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(result.is_err(), "a dangling entry must be refused");
    let count: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count()
        .returns(ReturnsResult)
        .run();
    assert_eq!(count, 0);
    f.check_fox(CREATOR, 10u128.pow(36));
}

/// SAFE: the same claim key twice in one call cannot pay twice: the transfer
/// of a second unit of a key the holder has one of is refused before the
/// contract runs (the network processes the multi-transfer entry by entry).
#[test]
fn safe_the_same_key_twice_in_one_claim_is_refused() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), false);
    f.set_time(T0 + 50);
    let result = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, &[1, 1]))
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(result.is_err());
    f.check_fox(ALICE, 0);
    assert_eq!(f.view(1).claimed, big(0));
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
}

/// SAFE: `recoverSurplus` never reaches owed funds, even when a payout that
/// bounced sits next to live vestings of the same token and some of them are
/// cancelled: only the bounced amount can move, before and after further
/// claims and cancels.
#[test]
fn safe_surplus_stays_the_bounced_amount_through_claims_and_cancels() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), true);
    f.create_fox(BOB, 500, stepped(T0, T0 + 100, 10), true);
    f.set_time(T0 + 40);
    f.claim(ALICE, &[1]);
    bounce_funds(&mut f, 400);
    f.cancel(CREATOR, &[2]);
    f.set_time(T0 + 70);
    f.claim(BOB, &[2]);
    let surplus: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(token(FOX))
        .returns(ReturnsResult)
        .run();
    assert_eq!(surplus, big(400));
    recover_surplus(&mut f, ALICE, None).unwrap();
    assert_eq!(
        recover_surplus(&mut f, OWNER, None),
        Err(ERR_NO_SURPLUS.to_string())
    );
    f.check_invariant(Some(FOX));
    // Everyone can still collect what they are owed.
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 400 + 1_000);
    f.check_invariant(Some(FOX));
}

/// SAFE, upgrade guard: the mutable state and the nonce maps live in their
/// own entries (`claimed`, `cancelledAt`, `claimKeyVesting`,
/// `cancelKeyVesting`), keyed by the id or the nonce, with 0 meaning "not
/// cancelled". An upgrade must keep these keys and that meaning.
#[test]
fn safe_mutable_state_keys_are_pinned() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 100), true);
    f.set_time(T0 + 40);
    f.claim(ALICE, &[1]);
    f.cancel(CREATOR, &[1]);
    f.world
        .check_account(SC)
        .check_storage("str:claimKeyVesting|u64:1", "1")
        .check_storage("str:cancelKeyVesting|u64:1", "1")
        .check_storage("str:claimed|u64:1", "400")
        .check_storage("str:cancelledAt|u64:1", &format!("{}", T0 + 40))
        .check_storage("str:lastVestingId", "1")
        .check_storage("str:creatorVestings|address:creator|str:.len", "1")
        .check_storage("str:tokenVestings|nested:str:FOX-a1b2c3|str:.len", "1");
}
