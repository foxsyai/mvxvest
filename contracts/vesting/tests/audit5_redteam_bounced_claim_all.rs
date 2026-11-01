//! Fifth audit, red team (RT-1 and PROTO-1): what a cross-shard "Claim all"
//! leaves behind when a token it pays is refused.
//!
//! Seen on devnet on version 3, 1 November 2026, contract in shard 0, claim tx
//! f17518c55f103050e1ea5510223341ec41509222da3a186580c505f874fc9d64: a victim
//! in shard 1 sent a real TFOX claim key and a griefer's dust key together. The
//! griefer, issuer of DUST (about 0.15 EGLD in all), had frozen the victim for
//! it. `claim` booked both and sent one MultiESDTNFTTransfer of the TFOX, the
//! DUST and the returned key. It failed in shard 1 with "account is frozen for
//! this esdt token" and came back whole: the real key sat in the contract and
//! 50.03 TFOX in surplus, and only one multisig vote per key plus one per token
//! could get them out. PROTO-1 is the same root with no griefer: the issuer of
//! the vested token freezes a holder, and the key bounces with its payout.
//!
//! Version 4 sends each token and the keys apart. Neither VM here crosses a
//! shard, so these tests model the bounce as `admin_test` does: every transfer
//! `claim` really made that holds the refused token comes back to the contract
//! with no call, whole, as the protocol returns it, and the rest stays where
//! it went. The transfers are read from the claim's logs, so on version 3 the
//! model returns everything, as devnet did, and these tests fail. The real
//! proof is `scripts/src/audit5-bounce-rehearsal.ts`, on devnet.

mod common;

use common::*;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};

/// The griefer's token: any token but the victim's, here the fixture's PTS.
const EVIL: TestTokenId = PTS;

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

/// In the holder's shard, every transfer holding `refused` fails and comes
/// back to the contract as it left, with no call.
fn bounce(f: &mut Fixture, holder: TestAddress, logs: &[Log], refused: TestTokenId) {
    for (items, _) in sent_by_contract(logs) {
        if !items.iter().any(|(id, _, _)| id == refused.as_str()) {
            continue;
        }
        let mut back = ManagedVec::<StaticApi, Payment<StaticApi>>::new();
        for (id, nonce, amount) in items {
            back.push(Payment::new(
                TokenId::from(id.as_str()),
                nonce,
                NonZeroBigUint::new_or_panic(big(amount)),
            ));
        }
        f.world
            .tx()
            .from(holder)
            .to(SC)
            .payment(back)
            .whitebox(mvxvest::contract_obj, |_| {});
    }
}

fn surplus(f: &mut Fixture, id: TestTokenId) -> BigUint<StaticApi> {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(token(id))
        .returns(ReturnsResult)
        .run()
}

/// FINDING RT-1, the griefer's attack: two real keys and a dust key of a token
/// the victim is frozen for. Only the dust comes back. The victim has the
/// money and the keys, needs no vote and claims on as if nothing had happened.
#[test]
fn finding_a_refused_dust_token_bounces_alone_and_the_victim_keeps_money_and_keys() {
    let mut f = Fixture::new();
    // Two real vestings for Alice, 1,000 FOX each, linear over 1,000 s.
    let salary = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let bonus = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // The griefer's dust vesting: 1 EVIL, ended before it was created, so it
    // is "worth claiming" and Claim all takes it along. (Who creates it does
    // not matter: the fixture's creator holds the token.)
    let dust = f.create(
        CREATOR,
        ALICE,
        linear(T0 - 10, T0 - 10, 0, T0 - 1),
        false,
        payments(&[(Some(EVIL), 1)]),
    );
    assert_eq!((salary, bonus, dust), (1, 2, 3));

    // Alice claims all three at T0+500: the contract books 500 + 500 + 1 and
    // sends 1,000 FOX, 1 EVIL and the two FOX keys (the EVIL key is finished
    // and burned). The EVIL transfer is refused in her shard.
    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[1, 2, 3]);
    bounce(&mut f, ALICE, &logs, EVIL);

    // She has it all but the dust, and nothing of hers is in the contract.
    f.check_fox(ALICE, 1_000);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, salary, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 2, bonus, FOX.as_str());
    assert_eq!(surplus(&mut f, FOX), big(0));
    f.check_invariant(Some(FOX));
    assert_eq!(f.view(salary).claimed, big(500));
    assert_eq!(f.view(bonus).claimed, big(500));
    assert_eq!(f.view(dust).claimed, big(1));

    // The griefer's dust is the only surplus, and only the owner can move it.
    assert_eq!(surplus(&mut f, EVIL), big(1));
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(
            token(EVIL),
            MALLORY,
            OptionalValue::<BigUint<StaticApi>>::None,
        )
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();

    // No vote stands between Alice and her next claim.
    f.set_time(T0 + 750);
    f.claim(ALICE, &[1, 2]);
    f.check_fox(ALICE, 1_500);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, salary, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 2, bonus, FOX.as_str());
    f.check_invariant(Some(FOX));
}

/// FINDING RT-1, with dust that lasts: a griefer's vesting that has not ended
/// sends its key back too. That key is the griefer's gift and stays with the
/// keys, not with the refused token, so every key is delivered.
#[test]
fn finding_a_dust_key_that_goes_back_is_not_held_by_the_bounce() {
    let mut f = Fixture::new();
    let salary = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let dust = f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        false,
        payments(&[(Some(EVIL), 10)]),
    );
    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[salary, dust]);
    bounce(&mut f, ALICE, &logs, EVIL);

    f.check_fox(ALICE, 500);
    f.check_holds_key(ALICE, KeyKind::Claim, salary, salary, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, dust, dust, EVIL.as_str());
    assert_eq!(surplus(&mut f, EVIL), big(5));
    assert_eq!(surplus(&mut f, FOX), big(0));
}

/// FINDING PROTO-1: no griefer, the issuer of the vested token freezes the
/// holder. The payout bounces and the holder keeps the key, so nobody needs to
/// vote to give the key back. The payout waits as surplus for one vote, and
/// what vests later waits for the issuer to lift the freeze.
#[test]
fn finding_a_holder_frozen_for_the_vested_token_keeps_the_key() {
    let mut f = Fixture::new();
    let salary = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    let logs = claim_logs(&mut f, ALICE, &[salary]);
    bounce(&mut f, ALICE, &logs, FOX);

    f.check_fox(ALICE, 0);
    f.check_holds_key(ALICE, KeyKind::Claim, salary, salary, FOX.as_str());
    assert_eq!(surplus(&mut f, FOX), big(500));

    // The owner returns the payout in one vote, once the holder can receive.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), ALICE, OptionalValue::<BigUint<StaticApi>>::None)
        .run();
    f.check_fox(ALICE, 500);
    f.check_invariant(Some(FOX));

    // The key still works.
    f.set_time(T0 + 750);
    f.claim(ALICE, &[salary]);
    f.check_fox(ALICE, 750);
    f.check_invariant(Some(FOX));
}
