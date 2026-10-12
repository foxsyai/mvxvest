//! Review 4 (a3d7b68), passing: `claim` without the `claimKeyUsed` flag. One
//! claim mixing a key that pays, a key that pays nothing (returned, no event),
//! a key that pays and finishes (burned) and a key that finishes having paid
//! nothing (cancelled before its cliff: burned, event with amount 0). Then
//! "nothing to claim yet" for non-paying keys alone, and for a second claim in
//! the same block. The contract holds no key afterwards.

mod common;

use common::*;
use multiversx_sc::codec::TopDecode;
use multiversx_sc_scenario::imports::*;
use multiversx_sc_scenario::scenario_model::Log;
use mvxvest::errors::*;
use mvxvest::events::ClaimedEvent;

/// `(id, amount, claimed_total, finished)` of every `vestingClaimed` log.
fn claimed_events(logs: &[Log]) -> Vec<(u64, u128, u128, bool)> {
    logs.iter()
        .filter(|log| log.topics.first().map(|t| t.as_slice()) == Some(b"vestingClaimed"))
        .map(|log| {
            let id_bytes = &log.topics[1];
            let mut id = 0u64;
            for b in id_bytes {
                id = (id << 8) | *b as u64;
            }
            assert_eq!(log.topics[2], ALICE.to_address().as_bytes().to_vec());
            let event = ClaimedEvent::<StaticApi>::top_decode(log.data[0].as_slice()).unwrap();
            (
                id,
                event.amount.to_u64().unwrap() as u128,
                event.claimed_total.to_u64().unwrap() as u128,
                event.finished,
            )
        })
        .collect()
}

fn claim_logs(f: &mut Fixture, nonces: &[u64]) -> Vec<Log> {
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, nonces))
        .returns(ReturnsLogs)
        .run()
}

fn contract_holds_no_key(f: &mut Fixture, ids: &[u64], cancel_ids: &[u64]) {
    for id in ids {
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(*id, KeyKind::Claim, OWNER)
            .returns(ExpectError(4, ERR_NO_HELD_KEY))
            .run();
    }
    for id in cancel_ids {
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(*id, KeyKind::Cancel, OWNER)
            .returns(ExpectError(4, ERR_NO_HELD_KEY))
            .run();
    }
}

#[test]
fn a_mixed_claim_pays_returns_burns_and_logs_exactly() {
    let mut f = Fixture::new();
    // 1: pays 100 at T0 + 100.
    let paying = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // 2: cliff at T0 + 500, pays nothing at T0 + 100.
    let waiting = f.create_fox(ALICE, 1_000, linear(T0, T0 + 500, 0, T0 + 1_000), false);
    // 3: ended at T0 + 50: pays everything and finishes.
    let ending = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 50), false);
    // 4: cancelled before its cliff: can pay nothing ever, finishes at 0.
    let dead = f.create_fox(ALICE, 1_000, linear(T0, T0 + 500, 0, T0 + 1_000), true);
    f.set_time(T0 + 10);
    f.cancel(CREATOR, &[1]);
    f.check_fox(CREATOR, 10u128.pow(36) - 4_000 + 1_000);

    f.set_time(T0 + 100);
    let logs = claim_logs(&mut f, &[paying, waiting, ending, dead]);
    assert_eq!(
        claimed_events(&logs),
        vec![
            (paying, 100, 100, false),
            (ending, 1_000, 1_000, true),
            (dead, 0, 0, true),
        ],
        "one event per key that paid or burned, none for the key that paid nothing"
    );
    f.check_fox(ALICE, 1_100);
    f.check_holds_key(ALICE, KeyKind::Claim, paying, paying, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, waiting, waiting, FOX.as_str());
    // 3 and 4 are burned: Alice cannot send them, the contract does not hold them.
    for nonce in [ending, dead] {
        f.world
            .tx()
            .from(ALICE)
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(key(KeyKind::Claim, nonce))
            .returns(ExpectStatus(10))
            .run();
    }
    contract_holds_no_key(&mut f, &[paying, waiting, ending, dead], &[dead]);
    f.check_invariant(Some(FOX));

    // Keys that can pay nothing now, alone: refused, and kept by Alice.
    f.claim_fails(ALICE, &[waiting], ERR_NOTHING_TO_CLAIM);
    // Same block again: the paying key has nothing more either.
    f.claim_fails(ALICE, &[paying, waiting], ERR_NOTHING_TO_CLAIM);
    f.check_holds_key(ALICE, KeyKind::Claim, waiting, waiting, FOX.as_str());

    // Later both pay; the cliff releases what the curve accrued since the start.
    f.set_time(T0 + 600);
    let logs = claim_logs(&mut f, &[waiting, paying]);
    assert_eq!(
        claimed_events(&logs),
        vec![(waiting, 600, 600, false), (paying, 500, 600, false)]
    );
    f.check_fox(ALICE, 1_100 + 600 + 500);
    f.set_time(T0 + 1_000);
    f.claim(ALICE, &[paying, waiting]);
    f.check_fox(ALICE, 4_000 - 1_000);
    contract_holds_no_key(&mut f, &[paying, waiting], &[]);
    f.check_invariant(Some(FOX));
}
