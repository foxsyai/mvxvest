//! Review finding (low): spec section 3 says "The creator may recover the
//! cancel key, and the claim key while nothing has been claimed". When the
//! contract holds BOTH keys of a vesting and the claim key has `claimed > 0`
//! (its return after a claim bounced), `recoverBouncedKeys` reverts as a
//! whole (src/claim.rs:121), so the creator cannot recover its own cancel key
//! either and depends on the owner. Meanwhile the vesting keeps running and
//! the creator cannot stop it.
//!
//! Expected once fixed: the creator gets the cancel key back; the claim key
//! stays in the contract for the owner to return.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[test]
fn the_creators_cancel_key_goes_back_even_when_a_claimed_claim_key_is_also_held() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    // The cancel key bounced at creation (the creator is a contract that
    // could not receive it).
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(key(KeyKind::Cancel, 1))
        .whitebox(mvxvest::contract_obj, |_| {});
    // The beneficiary claims; the return of payout and key bounces.
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    let mut bounced = ManagedVec::new();
    bounced.push(Payment::new(
        token(FOX),
        0,
        NonZeroBigUint::new_or_panic(big(100)),
    ));
    bounced.push(Payment::new(token(CLAIM_KEY), 1, NonZeroBigUint::one()));
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(bounced)
        .whitebox(mvxvest::contract_obj, |_| {});

    // Since the redesign only the owner recovers keys, one at a time: the
    // cancel key to the creator, whatever else the contract holds.
    let result = f
        .world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Cancel, CREATOR)
        .returns(ReturnsHandledOrError::new())
        .run();
    assert!(
        result.is_ok(),
        "the creator's cancel key cannot be returned: {:?}",
        result.err().map(|e| e.message)
    );
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
}
