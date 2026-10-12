//! Claiming: what is paid when, who can claim, and when the key is burned.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

#[test]
fn claim_pays_what_vested_and_returns_the_same_key() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);

    f.set_time(T0 + 250);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 250);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    assert_eq!(f.view(id).claimed, big(250));
    f.check_invariant(Some(FOX));

    f.set_time(T0 + 600);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 600);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());
    f.check_invariant(Some(FOX));
}

#[test]
fn claim_twice_in_one_block_pays_once() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1]);
    f.claim_fails(ALICE, &[1], ERR_NOTHING_TO_CLAIM);
    f.check_fox(ALICE, 500);
    f.check_invariant(Some(FOX));
}

#[test]
fn nothing_to_claim_before_the_cliff() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0 + 100, 0, T0 + 1_000), false);
    f.set_time(T0 + 99);
    f.claim_fails(ALICE, &[1], ERR_NOTHING_TO_CLAIM);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 100);
}

#[test]
fn last_claim_pays_the_rest_exactly_and_burns_the_key() {
    let mut f = Fixture::new();
    // 1000 over 3 seconds: the rounding remainder lands at the end.
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 3), false);
    f.set_time(T0 + 1);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 333);
    f.set_time(T0 + 3);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    // The key is gone: it can no longer be sent anywhere.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Claim, 1))
        .returns(ExpectStatus(10))
        .run();
    let view = f.view(id);
    assert_eq!(view.claimed, big(1_000));
    assert_eq!(view.claimable, big(0));
    f.check_invariant(Some(FOX));
}

#[test]
fn moved_key_claims_for_its_new_holder_only() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);

    f.send_key(KeyKind::Claim, 1, ALICE, BOB);
    f.set_time(T0 + 400);
    // Alice no longer holds the key: she cannot even send it.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Claim, 1))
        .returns(ExpectStatus(10))
        .run();
    f.claim(BOB, &[1]);
    f.check_fox(ALICE, 100);
    f.check_fox(BOB, 300);
    f.check_holds_key(BOB, KeyKind::Claim, 1, id, FOX.as_str());
    f.check_invariant(Some(FOX));
}

#[test]
fn claim_several_keys_at_once() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.create_fox(ALICE, 2_000, linear(T0, T0, 0, T0 + 1_000), false);
    // A third one has nothing yet: it is returned, the others still pay.
    f.create_fox(ALICE, 3_000, linear(T0, T0 + 900, 0, T0 + 1_000), false);
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        false,
        payments(&[(Some(USDC), 4_000)]),
    );
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1, 2, 3, 4]);
    f.check_fox(ALICE, 1_500);
    f.world.check_account(ALICE).esdt_balance(USDC, big(2_000));
    for (nonce, id) in [(1, 1), (2, 2), (3, 3)] {
        f.check_holds_key(ALICE, KeyKind::Claim, nonce, id, FOX.as_str());
    }
    f.check_holds_key(ALICE, KeyKind::Claim, 4, 4, USDC.as_str());
    f.check_invariant(Some(FOX));
    f.check_invariant(Some(USDC));
}

#[test]
fn egld_vesting_pays_egld() {
    let mut f = Fixture::new();
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        false,
        payments(&[(None, 10 * EGLD)]),
    );
    f.set_time(T0 + 1_000);
    f.claim(ALICE, &[1]);
    f.world.check_account(ALICE).balance(big(110 * EGLD));
    f.check_invariant(None);
}

#[test]
fn only_claim_keys_are_accepted() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 500);
    // A cancel key, another NFT, a fungible token, nothing.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Cancel, 1))
        .returns(ExpectError(4, ERR_NOT_CLAIM_KEY))
        .run();
    let mut other = ManagedVec::new();
    other.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(other)
        .returns(ExpectError(4, ERR_NOT_CLAIM_KEY))
        .run();
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(payments(&[(Some(FOX), 1)]))
        .returns(ExpectError(4, ERR_NOT_CLAIM_KEY))
        .run();
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .returns(ExpectError(4, ERR_NOT_CLAIM_KEY))
        .run();
}

#[test]
fn stepped_and_tranche_schedules_pay_on_their_dates() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 900, stepped(T0, T0 + 3 * DAY, DAY), false);
    f.create_fox(
        BOB,
        600,
        tranches(T0, &[(T0 + DAY, 100), (T0 + 10 * DAY, 500)]),
        false,
    );
    f.set_time(T0 + DAY - 1);
    f.claim_fails(ALICE, &[1], ERR_NOTHING_TO_CLAIM);
    f.claim_fails(BOB, &[2], ERR_NOTHING_TO_CLAIM);
    f.set_time(T0 + 2 * DAY);
    f.claim(ALICE, &[1]);
    f.claim(BOB, &[2]);
    f.check_fox(ALICE, 600);
    f.check_fox(BOB, 100);
    f.set_time(T0 + 10 * DAY);
    f.claim(ALICE, &[1]);
    f.claim(BOB, &[2]);
    f.check_fox(ALICE, 900);
    f.check_fox(BOB, 600);
    f.check_invariant(Some(FOX));
}

#[test]
fn cliff_equal_to_total() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 500, linear(T0, T0 + DAY, 500, T0 + 2 * DAY), false);
    f.set_time(T0 + DAY - 1);
    f.claim_fails(ALICE, &[1], ERR_NOTHING_TO_CLAIM);
    f.set_time(T0 + DAY);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 500);
    f.check_invariant(Some(FOX));
}

#[test]
fn huge_and_tiny_amounts() {
    let mut f = Fixture::new();
    let huge = 10u128.pow(36) / 2;
    f.create_fox(ALICE, huge, linear(T0, T0, 0, T0 + 4), false);
    f.create_fox(BOB, 1, linear(T0, T0, 0, T0 + 4), false);
    f.set_time(T0 + 3);
    f.claim(ALICE, &[1]);
    f.claim_fails(BOB, &[2], ERR_NOTHING_TO_CLAIM);
    f.check_fox(ALICE, huge / 4 * 3);
    f.set_time(T0 + 4);
    f.claim(ALICE, &[1]);
    f.claim(BOB, &[2]);
    f.check_fox(ALICE, huge);
    f.check_fox(BOB, 1);
    f.check_invariant(Some(FOX));
}
