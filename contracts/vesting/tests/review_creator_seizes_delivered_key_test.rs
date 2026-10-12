//! Review finding: `recoverBouncedKeys` uses "nothing claimed yet" as proof
//! that a claim key bounced at creation, and lets the creator redirect it.
//! But a key that WAS delivered can also come back with nothing claimed: a
//! "claim all" with several keys returns the keys that paid nothing together
//! with the payout of the others, and if that return transfer bounces (a
//! smart contract holder that cannot receive, the case spec section 5 says is
//! recoverable), the contract holds a delivered key with `claimed == 0`.
//! The creator can then take it, even for a NON-cancelable vesting, and
//! collect the whole total: "a non-cancelable vesting ... cannot be stopped"
//! no longer holds.
//!
//! Expected once fixed: the creator cannot obtain the key (only the owner may
//! return it), or the multi-key claim refuses to hand back a key that paid
//! nothing (so a returned key always has `claimed > 0`).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

#[test]
fn creator_cannot_seize_a_delivered_claim_key_after_a_bounced_multi_claim() {
    let mut f = Fixture::new();
    // Vesting #1: running, half vested at T0 + 500.
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // Vesting #2: NON-cancelable, 5000 FOX, starts in a day.
    f.create_fox(
        ALICE,
        5_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    // Both keys were delivered to Alice: no bounce at creation.
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 2, 2, FOX.as_str());
    let creator_fox_after_creating = 10u128.pow(36) - 6_000;

    // "Claim all" at T0 + 500: #1 pays 500, #2 pays nothing; both keys go
    // back to the caller in one transfer.
    f.set_time(T0 + 500);
    let claim = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, &[1, 2]))
        .returns(ReturnsHandledOrError::new())
        .run();
    if claim.is_err() {
        // A fix that refuses to return keys that paid nothing closes the hole.
        return;
    }
    f.check_fox(ALICE, 500);
    assert_eq!(f.view(2).claimed, big(0));

    // The holder is a smart contract in another shard that cannot receive
    // tokens: the return transfer (500 FOX + both keys) bounces back.
    let mut bounced = ManagedVec::new();
    bounced.push(Payment::new(
        token(FOX),
        0,
        NonZeroBigUint::new_or_panic(big(500)),
    ));
    bounced.extend(keys(KeyKind::Claim, &[1, 2]).iter().map(|p| p.clone()));
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(bounced)
        .whitebox(mvxvest::contract_obj, |_| {});

    // The creator of the non-cancelable vesting #2 tries to take its key.
    let recovered = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(2u64, CREATOR)
        .returns(ReturnsHandledOrError::new())
        .run();
    if recovered.is_ok() {
        // Show the impact: the creator now claims all of vesting #2.
        f.set_time(T0 + 2 * DAY);
        f.claim(CREATOR, &[2]);
        f.check_fox(CREATOR, creator_fox_after_creating + 5_000);
        panic!(
            "creator recovered the claim key of non-cancelable vesting #2, which had \
             been delivered to the beneficiary, and claimed its full 5000 FOX"
        );
    }
    assert_eq!(
        recovered.unwrap_err().message,
        ERR_NOT_ALLOWED,
        "the refusal should be ERR_NOT_ALLOWED"
    );
}
