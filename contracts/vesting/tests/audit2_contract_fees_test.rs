//! Second audit (Claude Fable 5.1, max effort, 14 October 2026): version 2
//! on the Rust VM. The token fee, surplus recovery by amount and the
//! cancelable marker, attacked from every side the first audit listed.
//!
//! Every test here is named `safe_*`: it passes on version 2 and pins a
//! behaviour the audit relied on to call the upgrade sound. The module
//! comment of each one says what would go wrong if it ever failed.

mod common;

use common::*;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};
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

fn set_fee(f: &mut Fixture, fee: u128) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(fee))
        .run();
}

/// `create` for Alice, linear over a day, with an explicit payment list.
fn create_with(
    f: &mut Fixture,
    total: u128,
    cancelable: bool,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Result<u64, String> {
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(total),
            linear(T0, T0, 0, T0 + DAY),
            cancelable,
            "audit2",
        )
        .payment(payment)
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map_err(|e| e.message)
}

/// `createBatch` of plain vestings for Alice with the given totals, paying
/// `paid` FOX (and `egld` EGLD when not 0).
fn batch_with(
    f: &mut Fixture,
    totals: &[u128],
    paid: u128,
    egld: u128,
) -> Result<Vec<u64>, String> {
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
    let mut pay = vec![(Some(FOX), paid)];
    if egld > 0 {
        pay.push((None, egld));
    }
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "audit2", entries)
        .payment(payments(&pay))
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map(|ids: MultiValueEncoded<StaticApi, u64>| ids.to_vec().into_iter().collect())
        .map_err(|e| e.message)
}

fn vesting_count(f: &mut Fixture) -> u64 {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count()
        .returns(ReturnsResult)
        .run()
}

fn surplus(f: &mut Fixture, token_id: TokenId<StaticApi>) -> BigUint<StaticApi> {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(token_id)
        .returns(ReturnsResult)
        .run()
}

fn recover(
    f: &mut Fixture,
    token_id: TokenId<StaticApi>,
    to: TestAddress,
    amount: Option<u128>,
) -> Result<(), String> {
    let amount = match amount {
        Some(amount) => OptionalValue::Some(big(amount)),
        None => OptionalValue::None,
    };
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token_id, to, amount)
        .returns(ReturnsHandledOrError::new())
        .run()
        .map(|_| ())
        .map_err(|e| e.message)
}

/// The owner's EGLD after the fixture issued both collections.
const OWNER_EGLD: u128 = 10 * EGLD - 2 * ISSUE_COST;

/// SAFE: an EGLD vesting paid as `EGLD-000000` entries of a multi-transfer
/// (what a wallet sends when the EGLD fee rides next to the deposit) settles
/// the total, the token fee and the EGLD fee exactly, split over any number
/// of entries, and one unit either way is refused. The token fee of an EGLD
/// vesting reaches the owner as plain EGLD; the flat fee stays booked.
#[test]
fn safe_egld_vesting_as_egld_000000_entries_pays_both_fees_exactly() {
    let mut f = Fixture::new();
    set_fee(&mut f, EGLD / 10);
    set_token_fee(&mut f, 150);
    let total = 2 * EGLD;
    let token_fee = 3 * EGLD / 100;
    let flat = EGLD / 10;
    // One wei short and one wei over: refused, nothing taken.
    for wrong in [total + token_fee + flat - 1, total + token_fee + flat + 1] {
        assert_eq!(
            create_with(&mut f, total, true, payments(&[(None, wrong)])),
            Err(ERR_WRONG_DEPOSIT.to_string())
        );
    }
    // The old amount, as previewed before the token fee existed.
    assert_eq!(
        create_with(&mut f, total, true, payments(&[(None, total + flat)])),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    assert_eq!(vesting_count(&mut f), 0);
    f.world.check_account(OWNER).balance(big(OWNER_EGLD));
    // Split over three entries, in any order.
    let id = create_with(
        &mut f,
        total,
        true,
        payments(&[(None, flat), (None, EGLD), (None, EGLD + token_fee)]),
    )
    .unwrap();
    assert_eq!(f.view(id).vesting.total, big(total));
    f.world
        .check_account(OWNER)
        .balance(big(OWNER_EGLD + token_fee));
    assert_eq!(f.fees_accrued(), big(flat));
    assert_eq!(f.totals(native()).deposited, big(total));
    f.check_invariant(None);
    assert_eq!(surplus(&mut f, native()), big(0));
    // An ESDT vesting with the EGLD fee as an EGLD-000000 entry, token fee
    // included in the token amount, split too.
    let id = create_with(
        &mut f,
        1_000,
        false,
        payments(&[(Some(FOX), 400), (None, flat), (Some(FOX), 615)]),
    )
    .unwrap();
    assert_eq!(f.view(id).vesting.total, big(1_000));
    f.world.check_account(OWNER).esdt_balance(FOX, big(15));
    assert_eq!(f.fees_accrued(), big(2 * flat));
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
    // The beneficiary collects exactly the totals, never a fee.
    f.set_time(T0 + DAY);
    f.claim(ALICE, &[1, 2]);
    f.check_fox(ALICE, 1_000);
    f.world
        .check_account(ALICE)
        .balance(big(100 * EGLD + total));
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
}

/// SAFE: the fee of a batch is the sum of each entry's fee rounded down, not
/// the rounded-down fee of the sum. Paying the latter (one unit more) is
/// refused, so the dApp's `tokenFeeOfAll` and the contract agree to the unit.
/// Below `10,000 / bps` units a vesting pays nothing (at the planned 10 bps:
/// 999 units pay 0, 1,000 pay 1), which is the rounding the spec documents.
#[test]
fn safe_batch_fee_is_the_sum_of_per_entry_floors() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // 1% of 199 is 1 (floor), twice: 2. 1% of 398 would be 3.
    assert_eq!(
        batch_with(&mut f, &[199, 199], 398 + 3, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    let ids = batch_with(&mut f, &[199, 199], 398 + 2, 0).unwrap();
    assert_eq!(ids, vec![1, 2]);
    f.world.check_account(OWNER).esdt_balance(FOX, big(2));
    assert_eq!(f.totals(token(FOX)).deposited, big(398));
    f.check_invariant(Some(FOX));
    // The planned rate: 0.1%.
    set_token_fee(&mut f, 10);
    create_with(&mut f, 999, false, payments(&[(Some(FOX), 999)])).unwrap();
    f.world.check_account(OWNER).esdt_balance(FOX, big(2));
    assert_eq!(
        create_with(&mut f, 1_000, false, payments(&[(Some(FOX), 1_000)])),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    create_with(&mut f, 1_000, false, payments(&[(Some(FOX), 1_001)])).unwrap();
    f.world.check_account(OWNER).esdt_balance(FOX, big(3));
    f.check_invariant(Some(FOX));
}

/// SAFE: a fee change between the creator's preview and the inclusion of its
/// transaction never costs the creator more than it signed for. A change of
/// the token fee alone, up or down, refuses the transaction (single and
/// batch), and nothing is created or kept. When the owner moves both fees at
/// once so that the EGLD sum is unchanged, the transaction passes, the
/// vesting has exactly the signed total and the creator paid exactly the
/// signed amount: only the split between the two fees differs, which is the
/// owner's money either way.
#[test]
fn safe_fee_changes_in_flight_never_overcharge_the_creator() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    // Previewed at 1%: two vestings of 1,000 cost 2,020.
    set_token_fee(&mut f, 200);
    assert_eq!(
        batch_with(&mut f, &[1_000, 1_000], 2_020, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    set_token_fee(&mut f, 50);
    assert_eq!(
        batch_with(&mut f, &[1_000, 1_000], 2_020, 0),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    assert_eq!(
        create_with(&mut f, 1_000, false, payments(&[(Some(FOX), 1_010)])),
        Err(ERR_WRONG_DEPOSIT.to_string())
    );
    assert_eq!(vesting_count(&mut f), 0);
    f.check_fox(CREATOR, 10u128.pow(36));
    f.world.check_account(OWNER).esdt_balance(FOX, big(0));

    // EGLD: previewed at 1% plus 0.1 EGLD, so 1 EGLD vests for 1.11 EGLD.
    set_token_fee(&mut f, 100);
    set_fee(&mut f, EGLD / 10);
    let signed = EGLD + EGLD / 100 + EGLD / 10;
    // The owner moves the whole fee to the flat one before inclusion.
    set_token_fee(&mut f, 0);
    set_fee(&mut f, EGLD / 100 + EGLD / 10);
    let id = create_with(&mut f, EGLD, false, payments(&[(None, signed)])).unwrap();
    assert_eq!(f.view(id).vesting.total, big(EGLD));
    f.world
        .check_account(CREATOR)
        .balance(big(1_000_000 * EGLD - signed));
    assert_eq!(f.fees_accrued(), big(EGLD / 100 + EGLD / 10));
    f.world.check_account(OWNER).balance(big(OWNER_EGLD));
    f.check_invariant(None);
}

/// SAFE, the owner's limits: the framework reads the legacy `EGLD` and the
/// empty identifier as `EGLD-000000` when it decodes a `TokenId` argument,
/// so `recoverSurplus("EGLD")` and `recoverSurplus("")` meet the EGLD totals
/// stored under `EGLD-000000` and find no surplus. Were either alias decoded
/// as a different token, its totals would read zero and the owner could move
/// every locked EGLD as "surplus" (the first audit pinned the storage key;
/// this pins the argument side).
#[test]
fn safe_legacy_egld_aliases_cannot_turn_locked_egld_into_surplus() {
    let mut f = Fixture::new();
    set_fee(&mut f, EGLD / 10);
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, 5 * EGLD + EGLD / 10)]),
    );
    f.world.check_account(SC).balance(big(5 * EGLD + EGLD / 10));
    for alias in ["EGLD", ""] {
        let seen: BigUint<StaticApi> = f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_surplus(alias)
            .returns(ReturnsResult)
            .run();
        assert_eq!(seen, big(0), "surplus seen through the alias {alias:?}");
        let totals: TokenTotals<StaticApi> = f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_token_totals(alias)
            .returns(ReturnsResult)
            .run();
        assert_eq!(totals.deposited, big(5 * EGLD));
        for amount in [None, Some(1u128), Some(5 * EGLD)] {
            let amount = match amount {
                Some(amount) => OptionalValue::Some(big(amount)),
                None => OptionalValue::None,
            };
            let result = f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .recover_surplus(alias, OWNER, amount)
                .returns(ReturnsHandledOrError::new())
                .run();
            assert_eq!(
                result.map(|_| ()).map_err(|e| e.message),
                Err(ERR_NO_SURPLUS.to_string()),
                "the alias {alias:?} let the owner move locked EGLD"
            );
        }
    }
    f.world.check_account(SC).balance(big(5 * EGLD + EGLD / 10));
    f.world.check_account(OWNER).balance(big(OWNER_EGLD));
    f.check_invariant(None);
}

/// SAFE, the books: creations with the token fee leave no surplus (the fee
/// is sent, never booked), so `recoverSurplus` has nothing to move. A fee
/// that bounced back from the owner (a multisig in another shard that could
/// not take the token) is a surplus of exactly the fee, which the owner
/// returns to itself by amount; the locked total never moves and the
/// beneficiary still collects all of it.
#[test]
fn safe_fee_creations_leave_no_surplus_and_a_bounced_fee_is_recoverable() {
    let mut f = Fixture::new();
    set_token_fee(&mut f, 100);
    create_with(&mut f, 10_000, true, payments(&[(Some(FOX), 10_100)])).unwrap();
    f.world.check_account(OWNER).esdt_balance(FOX, big(100));
    assert_eq!(surplus(&mut f, token(FOX)), big(0));
    assert_eq!(
        recover(&mut f, token(FOX), OWNER, None),
        Err(ERR_NO_SURPLUS.to_string())
    );
    assert_eq!(
        recover(&mut f, token(FOX), OWNER, Some(1)),
        Err(ERR_NO_SURPLUS.to_string())
    );
    f.check_invariant(Some(FOX));
    // The fee comes back (the protocol credits a refund to the contract
    // whether or not it is payable).
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .payment(payments(&[(Some(FOX), 100)]))
        .whitebox(mvxvest::contract_obj, |_| {});
    assert_eq!(surplus(&mut f, token(FOX)), big(100));
    assert_eq!(
        recover(&mut f, token(FOX), OWNER, Some(101)),
        Err(ERR_ABOVE_SURPLUS.to_string())
    );
    recover(&mut f, token(FOX), OWNER, Some(100)).unwrap();
    f.world.check_account(OWNER).esdt_balance(FOX, big(100));
    assert_eq!(surplus(&mut f, token(FOX)), big(0));
    f.check_invariant(Some(FOX));
    // Half way: the creator cancels, the beneficiary gets the vested half,
    // the creator the rest; the fee was never part of it.
    f.set_time(T0 + DAY / 2);
    f.cancel(CREATOR, &[1]);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 5_000);
    f.check_fox(CREATOR, 10u128.pow(36) - 10_100 + 5_000);
    f.check_invariant(Some(FOX));
    assert_eq!(surplus(&mut f, token(FOX)), big(0));
}

const BUILTINS: &[&str] = &[
    "ESDTNFTCreate",
    "ESDTNFTBurn",
    "ESDTNFTTransfer",
    "MultiESDTNFTTransfer",
    "ESDTTransfer",
    "ESDTNFTAddQuantity",
    "ESDTLocalBurn",
    "ESDTLocalMint",
];

fn builtin_calls(logs: &[Log]) -> usize {
    let sc = SC.to_address();
    logs.iter()
        .filter(|log| log.address == sc && BUILTINS.contains(&log.endpoint.as_str()))
        .count()
}

/// The `tokenFeePaid` events of a transaction: `(token, to, amount)`.
fn fee_events(logs: &[Log]) -> Vec<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    logs.iter()
        .filter(|log| log.topics.first().map(|t| t.as_slice()) == Some(b"tokenFeePaid"))
        .map(|log| {
            (
                log.topics[1].clone(),
                log.topics[2].clone(),
                log.data.first().cloned().unwrap_or_default(),
            )
        })
        .collect()
}

/// A `tokenFeePaid` event: token, recipient, amount (raw topics and data).
type FeeEvent = (Vec<u8>, Vec<u8>, Vec<u8>);

/// A batch of `count` EGLD vestings of 10 EGLD for Alice with both fees set
/// to 0.1 EGLD and 1%: the ids, the built-in calls and the fee events.
fn egld_batch(f: &mut Fixture, cancelable: bool, count: u64) -> (usize, Vec<FeeEvent>) {
    let mut entries = MultiValueEncoded::new();
    for _ in 0..count {
        entries.push(
            (
                ALICE.to_managed_address(),
                big(10 * EGLD),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    let per_vesting = 10 * EGLD + EGLD / 10 + EGLD / 10;
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(cancelable, "egld", entries)
        .egld(big(per_vesting * count as u128))
        .returns(ReturnsLogs)
        .run();
    (builtin_calls(&logs), fee_events(&logs))
}

/// SAFE, the network's budget of 100 built-in calls per transaction, for the
/// paths review 5 did not count: EGLD vestings with both fees. The token fee
/// of an EGLD vesting leaves as a plain value transfer, not a built-in call,
/// so the largest EGLD batches make 98 (49 plain) and 97 (32 cancelable)
/// calls; a single cancelable ESDT creation with the fee makes 5. One
/// `tokenFeePaid` event per transaction names the token, the owner and the
/// whole fee; a creation whose fee rounds to zero emits none.
#[test]
fn safe_egld_batches_with_both_fees_stay_within_the_builtin_call_budget() {
    let mut f = Fixture::new();
    set_fee(&mut f, EGLD / 10);
    set_token_fee(&mut f, 100);
    let (plain, events) = egld_batch(&mut f, false, 49);
    assert_eq!(plain, 98);
    assert_eq!(
        events,
        vec![(
            b"EGLD-000000".to_vec(),
            OWNER.to_address().as_bytes().to_vec(),
            big(49 * EGLD / 10).to_bytes_be().into_vec(),
        )]
    );
    let (cancelable, events) = egld_batch(&mut f, true, 32);
    assert_eq!(cancelable, 97);
    assert_eq!(events.len(), 1);
    f.world
        .check_account(OWNER)
        .balance(big(OWNER_EGLD + 81 * EGLD / 10));
    assert_eq!(f.fees_accrued(), big(81 * EGLD / 10));
    f.check_invariant(None);
    // A single cancelable ESDT creation with the fee: two mints, the claim
    // key, the cancel key and the fee transfer.
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(BOB, big(10_000), linear(T0, T0, 0, T0 + DAY), true, "fox")
        .payment(payments(&[(Some(FOX), 10_100), (None, EGLD / 10)]))
        .returns(ReturnsLogs)
        .run();
    assert_eq!(builtin_calls(&logs), 5);
    assert_eq!(
        fee_events(&logs),
        vec![(
            b"FOX-a1b2c3".to_vec(),
            OWNER.to_address().as_bytes().to_vec(),
            vec![100],
        )]
    );
    // Dust: no fee, no transfer, no event; 4 calls.
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(BOB, big(99), linear(T0, T0, 0, T0 + DAY), true, "dust")
        .payment(payments(&[(Some(FOX), 99), (None, EGLD / 10)]))
        .returns(ReturnsLogs)
        .run();
    assert_eq!(builtin_calls(&logs), 4);
    assert!(fee_events(&logs).is_empty());
    f.check_invariant(Some(FOX));
}

/// SAFE, the marker: with a key display set, a claim key of a cancelable
/// vesting says `cancelable:1`, of a plain one `cancelable:0`, and a cancel
/// key always `cancelable:1`, each followed by the owner's `metadata`. The
/// contract never reads the marker: a vesting's cancelability comes from
/// storage, so a key cannot be made to lie about it after a cancel either
/// (the attributes are fixed at the mint).
#[test]
fn safe_cancelable_marker_is_right_for_both_kinds_of_key_with_a_display() {
    let mut f = Fixture::new();
    for (kind, name) in [(KeyKind::Claim, "claim"), (KeyKind::Cancel, "cancel")] {
        let mut uris = MultiValueEncoded::new();
        uris.push(ManagedBuffer::from(format!(
            "https://mvxvest.io/nft/{name}.png"
        )));
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_key_display(kind, format!("bafy/{name}.json").as_str(), uris)
            .run();
    }
    set_token_fee(&mut f, 100);
    let plain = create_with(&mut f, 1_000, false, payments(&[(Some(FOX), 1_010)])).unwrap();
    let cancelable = create_with(&mut f, 1_000, true, payments(&[(Some(FOX), 1_010)])).unwrap();
    f.world.check_account(ALICE).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        1,
        1,
        format!("tags:mvxvest,vesting;vesting:{plain};token:FOX-a1b2c3;cancelable:0;metadata:bafy/claim.json")
            .as_bytes(),
    );
    f.world.check_account(ALICE).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        2,
        1,
        format!("tags:mvxvest,vesting;vesting:{cancelable};token:FOX-a1b2c3;cancelable:1;metadata:bafy/claim.json")
            .as_bytes(),
    );
    f.world.check_account(CREATOR).esdt_nft_balance_and_attributes(
        CANCEL_KEY,
        1,
        1,
        format!("tags:mvxvest,vesting;vesting:{cancelable};token:FOX-a1b2c3;cancelable:1;metadata:bafy/cancel.json")
            .as_bytes(),
    );
    assert!(!f.view(plain).vesting.cancelable);
    assert!(f.view(cancelable).vesting.cancelable);
    // The plain vesting has no cancel key: its nonce is 0 and nothing stops it.
    assert_eq!(f.view(plain).vesting.cancel_nonce, 0);
    f.cancel(CREATOR, &[1]);
    assert_eq!(f.view(cancelable).cancelled_at, T0);
    assert_eq!(f.view(plain).cancelled_at, 0);
    f.check_invariant(Some(FOX));
}
