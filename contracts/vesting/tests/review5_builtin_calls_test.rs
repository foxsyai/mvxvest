//! Fifth review: built-in calls per transaction.
//!
//! The network refuses a transaction whose execution makes more than 100
//! built-in calls (mx-chain-go `usageCounter.ProcessMaxBuiltInCounters`:
//! counter incremented, then `> MaxBuiltInCallsPerTx`, 100 in every gas
//! schedule) or moves more than 250 ESDT transfers. The counters are reset
//! after the payment that comes with the transaction and before the contract
//! runs, so the incoming transfer (keys, tokens, the fee) does not count.
//! Neither test VM enforces the limit, so these tests count the contract's
//! own built-in calls from the logs the Rust VM writes for each one, and pin
//! the numbers the limits rest on.

mod common;

use common::*;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};

/// The network's limit (gas schedule, `MaxPerTransaction`).
const MAX_BUILTIN_CALLS: usize = 100;

const BUILTINS: &[&str] = &[
    "ESDTNFTCreate",
    "ESDTNFTBurn",
    "ESDTNFTTransfer",
    "MultiESDTNFTTransfer",
    "ESDTTransfer",
    "ESDTNFTAddQuantity",
    "ESDTLocalBurn",
    "ESDTLocalMint",
    "ESDTMetaDataUpdate",
];

/// Built-in calls made by the contract itself (not the incoming payment,
/// which is logged with the sender's address).
fn builtin_calls(logs: &[Log]) -> usize {
    let sc = SC.to_address();
    logs.iter()
        .filter(|log| log.address == sc && BUILTINS.contains(&log.endpoint.as_str()))
        .count()
}

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

/// A batch of `count` linear vestings of 10 FOX for `who`, ending at
/// `T0 + DAY`, paying the EGLD fee; returns the ids and the built-in calls.
fn batch(
    f: &mut Fixture,
    cancelable: bool,
    count: u64,
    who: TestAddress,
    fee: u128,
) -> (Vec<u64>, usize) {
    batch_of(f, cancelable, count, who, fee, 10, 0)
}

/// The same with `total` FOX each and a token fee of `token_fee` FOX each.
fn batch_of(
    f: &mut Fixture,
    cancelable: bool,
    count: u64,
    who: TestAddress,
    fee: u128,
    total: u128,
    token_fee: u128,
) -> (Vec<u64>, usize) {
    let mut entries = MultiValueEncoded::new();
    for _ in 0..count {
        entries.push(
            (
                who.to_managed_address(),
                big(total),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    let mut pay = vec![(Some(FOX), (total + token_fee) * count as u128)];
    if fee > 0 {
        pay.push((None, fee * count as u128));
    }
    let (ids, logs) = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(cancelable, "batch", entries)
        .payment(payments(&pay))
        .returns(ReturnsResult)
        .returns(ReturnsLogs)
        .run();
    (ids.to_vec().into_iter().collect(), builtin_calls(&logs))
}

fn claim_calls(f: &mut Fixture, from: TestAddress, nonces: &[u64]) -> usize {
    let logs = f
        .world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, nonces))
        .returns(ReturnsLogs)
        .run();
    builtin_calls(&logs)
}

fn cancel_calls(f: &mut Fixture, nonces: &[u64]) -> usize {
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .payment(keys(KeyKind::Cancel, nonces))
        .returns(ReturnsLogs)
        .run();
    builtin_calls(&logs)
}

/// SAFE (version 2): the largest batches fit with both fees set. The EGLD
/// fee comes in with the payment and adds no call; the token fee goes out in
/// one transfer. 49 plain = 49 mints + 49 key transfers + 1 fee transfer = 99;
/// 32 cancelable = 64 mints + 32 claim key transfers + 1 transfer of all
/// cancel keys + 1 fee transfer = 98. The counts are 2n + 1 and 3n + 2, so
/// 50 plain or 33 cancelable would make 101, which the network refuses: the
/// limits had to drop by one when the token fee came (they were 50 and 33).
#[test]
fn safe_largest_batches_fit_with_both_fees() {
    let mut f = Fixture::new();
    set_fee(&mut f, EGLD / 100);
    set_token_fee(&mut f, 100);
    let (_, plain) = batch_of(&mut f, false, 49, ALICE, EGLD / 100, 10_000, 100);
    assert_eq!(plain, 99);
    let (_, cancelable) = batch_of(&mut f, true, 32, ALICE, EGLD / 100, 10_000, 100);
    assert_eq!(cancelable, 98);
    // Linear in the size: 2n + 1 plain, 3n + 2 cancelable.
    let (_, small_plain) = batch_of(&mut f, false, 7, BOB, EGLD / 100, 10_000, 100);
    assert_eq!(small_plain, 15);
    let (_, small_cancelable) = batch_of(&mut f, true, 7, BOB, EGLD / 100, 10_000, 100);
    assert_eq!(small_cancelable, 23);
    // One more vesting adds 2 calls (plain) or 3 (cancelable): over the limit.
    assert!(plain + 2 > MAX_BUILTIN_CALLS);
    assert!(cancelable + 3 > MAX_BUILTIN_CALLS);
    f.check_invariant(Some(FOX));
}

/// SAFE: without a token fee (0, as after the upgrade until the owner sets
/// one) nothing goes out, so the same batches make one call fewer.
#[test]
fn safe_no_token_fee_no_transfer() {
    let mut f = Fixture::new();
    let (_, plain) = batch(&mut f, false, 49, ALICE, 0);
    assert_eq!(plain, 98);
    let (_, cancelable) = batch(&mut f, true, 32, ALICE, 0);
    assert_eq!(cancelable, 97);
}

/// `count` plain vestings of 10 FOX for `who`, in batches of at most 49.
fn plain_vestings(f: &mut Fixture, count: u64, who: TestAddress) -> Vec<u64> {
    let mut ids = Vec::new();
    let mut left = count;
    while left > 0 {
        let size = left.min(49);
        ids.extend(batch(f, false, size, who, 0).0);
        left -= size;
    }
    ids
}

/// SAFE, and the dApp's cap: a claim makes one burn per finished key plus
/// one transfer of the payout and the returned keys. 99 finished keys make
/// 100 calls; 100 finished keys make 101, which the network refuses (the
/// transaction reverts; each key still claims alone or in a smaller set).
/// One key alone needs at most 2, so no vesting can become unclaimable.
#[test]
fn safe_claim_all_fits_99_keys_and_one_key_always_fits() {
    let mut f = Fixture::new();
    let ids = plain_vestings(&mut f, 100, ALICE);
    // Plain vestings: claim key nonce = id.
    f.set_time(T0 + 2 * DAY);
    assert_eq!(claim_calls(&mut f, ALICE, &ids[..99]), 99 + 1);
    // What 100 finished keys would need, from a fresh copy of the same state.
    let mut g = Fixture::new();
    let more = plain_vestings(&mut g, 100, ALICE);
    g.set_time(T0 + 2 * DAY);
    assert_eq!(claim_calls(&mut g, ALICE, &more), MAX_BUILTIN_CALLS + 1);
    // The last key of the first fixture, alone: burn + payout.
    assert_eq!(claim_calls(&mut f, ALICE, &ids[99..]), 2);
    f.check_fox(ALICE, 1000);
    f.check_invariant(Some(FOX));
}

/// SAFE, and still the dApp's cap since version 3: a claim of keys that are
/// not finished burns nothing, but stamps each key that paid
/// (`ESDTMetaDataUpdate`) before the one transfer back. 99 such keys make 100
/// calls; 100 make 101, which the network refuses. A key that pays nothing
/// is not stamped. (The 250-transfer limit is reached first only past 125
/// keys of 125 different tokens, above the 99 cap.)
#[test]
fn safe_claim_of_unfinished_keys_stamps_each_and_99_still_fit() {
    let mut f = Fixture::new();
    let ids = plain_vestings(&mut f, 100, ALICE);
    f.set_time(T0 + DAY / 2);
    assert_eq!(claim_calls(&mut f, ALICE, &ids[..99]), 99 + 1);
    let mut g = Fixture::new();
    let more = plain_vestings(&mut g, 100, ALICE);
    g.set_time(T0 + DAY / 2);
    assert_eq!(claim_calls(&mut g, ALICE, &more), MAX_BUILTIN_CALLS + 1);
    // The 100th key alone, which still pays: one stamp and the transfer.
    assert_eq!(claim_calls(&mut f, ALICE, &ids[99..]), 2);
    f.check_invariant(Some(FOX));
}

/// SAFE, and the dApp's cap: a cancel burns each cancel key and sends the
/// refunds in one transfer: 99 keys make 100 calls.
#[test]
fn safe_cancel_all_fits_99_keys() {
    let mut f = Fixture::new();
    let mut ids = Vec::new();
    for size in [32, 32, 32, 3] {
        ids.extend(batch(&mut f, true, size, ALICE, 0).0);
    }
    assert_eq!(ids.len(), 99);
    // Cancelable vestings created alone in their batches: cancel key nonce = id.
    f.set_time(T0 + DAY / 2);
    assert_eq!(cancel_calls(&mut f, &ids), 99 + 1);
    f.check_invariant(Some(FOX));
}
