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
];

/// Built-in calls made by the contract itself (not the incoming payment,
/// which is logged with the sender's address).
fn builtin_calls(logs: &[Log]) -> usize {
    let sc = SC.to_address();
    logs.iter()
        .filter(|log| log.address == sc && BUILTINS.contains(&log.endpoint.as_str()))
        .count()
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
/// `T0 + DAY`, paying the fee; returns the ids and the built-in calls.
fn batch(
    f: &mut Fixture,
    cancelable: bool,
    count: u64,
    who: TestAddress,
    fee: u128,
) -> (Vec<u64>, usize) {
    let mut entries = MultiValueEncoded::new();
    for _ in 0..count {
        entries.push(
            (
                who.to_managed_address(),
                big(10),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    let mut pay = vec![(Some(FOX), 10 * count as u128)];
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

/// SAFE: the largest batches make exactly 100 built-in calls, with the fee
/// paid in EGLD next to the token (the fee adds none): 50 plain = 50 mints +
/// 50 key transfers; 33 cancelable = 66 mints + 33 claim key transfers + 1
/// transfer of all cancel keys. One more vesting would make 102 or 103.
#[test]
fn safe_largest_batches_make_exactly_100_builtin_calls() {
    let mut f = Fixture::new();
    set_fee(&mut f, EGLD / 100);
    let (_, plain) = batch(&mut f, false, 50, ALICE, EGLD / 100);
    assert_eq!(plain, MAX_BUILTIN_CALLS);
    let (_, cancelable) = batch(&mut f, true, 33, ALICE, EGLD / 100);
    assert_eq!(cancelable, MAX_BUILTIN_CALLS);
    // Linear in the size: 2 per plain vesting, 3 + 1 per cancelable batch.
    let (_, small_plain) = batch(&mut f, false, 7, BOB, EGLD / 100);
    assert_eq!(small_plain, 14);
    let (_, small_cancelable) = batch(&mut f, true, 7, BOB, EGLD / 100);
    assert_eq!(small_cancelable, 22);
    f.check_invariant(Some(FOX));
}

/// SAFE, and the dApp's cap: a claim makes one burn per finished key plus
/// one transfer of the payout and the returned keys. 99 finished keys make
/// 100 calls; 100 finished keys make 101, which the network refuses (the
/// transaction reverts; each key still claims alone or in a smaller set).
/// One key alone needs at most 2, so no vesting can become unclaimable.
#[test]
fn safe_claim_all_fits_99_keys_and_one_key_always_fits() {
    let mut f = Fixture::new();
    let (mut ids, _) = batch(&mut f, false, 50, ALICE, 0);
    ids.extend(batch(&mut f, false, 50, ALICE, 0).0);
    // Plain vestings: claim key nonce = id.
    f.set_time(T0 + 2 * DAY);
    assert_eq!(claim_calls(&mut f, ALICE, &ids[..99]), 99 + 1);
    // What 100 finished keys would need, from a fresh copy of the same state.
    let mut g = Fixture::new();
    let (mut more, _) = batch(&mut g, false, 50, ALICE, 0);
    more.extend(batch(&mut g, false, 50, ALICE, 0).0);
    g.set_time(T0 + 2 * DAY);
    assert_eq!(claim_calls(&mut g, ALICE, &more), MAX_BUILTIN_CALLS + 1);
    // The last key of the first fixture, alone: burn + payout.
    assert_eq!(claim_calls(&mut f, ALICE, &ids[99..]), 2);
    f.check_fox(ALICE, 1000);
    f.check_invariant(Some(FOX));
}

/// SAFE: a claim of keys that are not finished burns nothing: one transfer,
/// whatever the number of keys (the 250-transfer limit is reached first only
/// past 125 keys of 125 different tokens, above the 99 cap).
#[test]
fn safe_claim_of_unfinished_keys_is_one_builtin_call() {
    let mut f = Fixture::new();
    let (ids, _) = batch(&mut f, false, 50, ALICE, 0);
    f.set_time(T0 + DAY / 2);
    assert_eq!(claim_calls(&mut f, ALICE, &ids), 1);
}

/// SAFE, and the dApp's cap: a cancel burns each cancel key and sends the
/// refunds in one transfer: 99 keys make 100 calls.
#[test]
fn safe_cancel_all_fits_99_keys() {
    let mut f = Fixture::new();
    let mut ids = Vec::new();
    for _ in 0..3 {
        ids.extend(batch(&mut f, true, 33, ALICE, 0).0);
    }
    assert_eq!(ids.len(), 99);
    // Cancelable vestings created alone in their batches: cancel key nonce = id.
    f.set_time(T0 + DAY / 2);
    assert_eq!(cancel_calls(&mut f, &ids), 99 + 1);
    f.check_invariant(Some(FOX));
}
