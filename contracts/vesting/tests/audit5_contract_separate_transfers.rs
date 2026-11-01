//! Fifth audit (RT-1, PROTO-1): what `claim` and `cancel` send, transfer by
//! transfer. What shares a transfer bounces together in another shard, so a
//! token that refuses (a holder frozen for it) must bounce alone: each token
//! has its own transfer and the returned keys have theirs (version 4).
//! Version 3 sends one transfer of everything: these tests fail on it.
//! `audit5_contract_go_vm` pins the same on the validators' VM.

mod common;

use common::*;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};

fn claim_logs(f: &mut Fixture, from: TestAddress, nonces: &[u64]) -> Vec<Log> {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, nonces))
        .returns(ReturnsLogs)
        .run()
}

fn item(id: &str, nonce: u64, amount: u128) -> Sent {
    (id.to_string(), nonce, amount)
}

fn claim_key(nonce: u64) -> Sent {
    item(CLAIM_KEY.as_str(), nonce, 1)
}

/// The transfers, after checking that all of them go to `to`.
fn transfers_to(logs: &[Log], to: TestAddress) -> Vec<Vec<Sent>> {
    sent_by_contract(logs)
        .into_iter()
        .map(|(items, receiver)| {
            assert_eq!(receiver, to.to_address().as_bytes());
            items
        })
        .collect()
}

/// FINDING RT-1: five keys of four tokens. FOX pays for two keys and is one
/// transfer; PTS, USDC and EGLD have one each; the four keys that go back
/// have theirs; the USDC key is finished and burned.
#[test]
fn finding_a_claim_sends_each_token_and_the_keys_apart() {
    let mut f = Fixture::new();
    let plan = linear(T0, T0, 0, T0 + 1_000);
    f.create_fox(ALICE, 1_000, plan.clone(), false);
    f.create_fox(ALICE, 1_000, plan.clone(), false);
    f.create(
        CREATOR,
        ALICE,
        plan.clone(),
        false,
        payments(&[(Some(PTS), 10)]),
    );
    f.create(
        CREATOR,
        ALICE,
        linear(T0 - 10, T0 - 10, 0, T0 - 1),
        false,
        payments(&[(Some(USDC), 100)]),
    );
    f.create(CREATOR, ALICE, plan, false, payments(&[(None, 1_000)]));

    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[1, 2, 3, 4, 5]);
    assert_eq!(
        transfers_to(&logs, ALICE),
        vec![
            vec![item(FOX.as_str(), 0, 1_000)],
            vec![item(PTS.as_str(), 0, 5)],
            vec![item(USDC.as_str(), 0, 100)],
            vec![item("EGLD-000000", 0, 500)],
            vec![claim_key(1), claim_key(2), claim_key(3), claim_key(5)],
        ]
    );
    f.world.check_account(ALICE).balance(big(100 * EGLD + 500));
    f.check_fox(ALICE, 1_000);
    f.check_invariant(Some(FOX));
    f.check_invariant(Some(USDC));
    f.check_invariant(Some(PTS));
    f.check_invariant(None);
}

/// FINDING RT-1, in `cancel`: each token of the refunds has its own transfer,
/// merged by token.
#[test]
fn finding_a_cancel_refunds_each_token_apart() {
    let mut f = Fixture::new();
    let plan = linear(T0, T0, 0, T0 + 1_000);
    f.create_fox(ALICE, 1_000, plan.clone(), true);
    f.create_fox(ALICE, 1_000, plan.clone(), true);
    f.create(
        CREATOR,
        ALICE,
        plan.clone(),
        true,
        payments(&[(Some(USDC), 100)]),
    );
    f.create(CREATOR, ALICE, plan, true, payments(&[(None, 1_000)]));

    f.set_time(T0 + 500);
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .payment(keys(KeyKind::Cancel, &[1, 2, 3, 4]))
        .returns(ReturnsLogs)
        .run();
    assert_eq!(
        transfers_to(&logs, CREATOR),
        vec![
            vec![item(FOX.as_str(), 0, 1_000)],
            vec![item(USDC.as_str(), 0, 50)],
            vec![item("EGLD-000000", 0, 500)],
        ]
    );
    f.check_invariant(Some(FOX));
    f.check_invariant(Some(USDC));
    f.check_invariant(None);
}

/// FINDING RT-1, at its smallest: one key that pays and goes back is two
/// transfers, the money and the key, so a frozen holder keeps the key
/// (PROTO-1).
#[test]
fn finding_one_key_and_its_payout_go_apart() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[1]);
    assert_eq!(
        transfers_to(&logs, ALICE),
        vec![vec![item(FOX.as_str(), 0, 500)], vec![claim_key(1)]]
    );
}

/// SAFE: what has nothing to send sends nothing. A finished key is burned, so
/// only its token goes out; a key that paid nothing goes back with the others
/// and pays nothing; a cancel after the end refunds nothing.
#[test]
fn safe_no_empty_transfer() {
    let mut f = Fixture::new();
    let plan = linear(T0, T0, 0, T0 + 1_000);
    f.create_fox(ALICE, 1_000, plan.clone(), false);
    // Paid nothing yet: its cliff is far off.
    f.create_fox(ALICE, 1_000, linear(T0, T0 + 5_000, 0, T0 + 10_000), false);
    f.create_fox(BOB, 1_000, plan, true);

    f.set_time(T0 + 1_000);
    // Key 1 finishes, key 2 paid nothing and goes back unchanged.
    let logs = claim_logs(&mut f, ALICE, &[1, 2]);
    assert_eq!(
        transfers_to(&logs, ALICE),
        vec![vec![item(FOX.as_str(), 0, 1_000)], vec![claim_key(2)]]
    );
    // Key 3 (BOB's, nonce 3) finishes: the token only, no key transfer.
    let logs = claim_logs(&mut f, BOB, &[3]);
    assert_eq!(
        transfers_to(&logs, BOB),
        vec![vec![item(FOX.as_str(), 0, 1_000)]]
    );
    // Its cancel key after the end: burned, no transfer at all.
    let logs = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .cancel()
        .payment(keys(KeyKind::Cancel, &[1]))
        .returns(ReturnsLogs)
        .run();
    assert!(transfers_to(&logs, CREATOR).is_empty());
    f.check_invariant(Some(FOX));
}

/// SAFE: every event, stamp and burn comes before the first transfer. The
/// booking is done when anything leaves: the transfers are the last thing
/// `claim` does.
#[test]
fn safe_every_transfer_comes_last() {
    let mut f = Fixture::new();
    let plan = linear(T0, T0, 0, T0 + 1_000);
    f.create_fox(ALICE, 1_000, plan.clone(), false);
    f.create(CREATOR, ALICE, plan, false, payments(&[(Some(USDC), 100)]));
    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[1, 2]);
    let endpoints: Vec<&str> = logs.iter().map(|log| log.endpoint.as_str()).collect();
    let first_transfer = endpoints
        .iter()
        .position(|name| name.contains("Transfer"))
        .unwrap();
    assert_eq!(first_transfer, 4, "{endpoints:?}");
    assert!(
        endpoints[first_transfer..]
            .iter()
            .all(|name| name.contains("Transfer")),
        "{endpoints:?}"
    );
}
