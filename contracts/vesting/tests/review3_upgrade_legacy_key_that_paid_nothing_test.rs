//! Review 3 finding (info, upgrade path of finding B): the creator's rule
//! "`claimKeyUsed` unset and `claimed == 0`" (src/claim.rs:136-138) is exact
//! for vestings the new code created, but not for those the contract already
//! holds when it is upgraded from code without the flag (devnet). There, a
//! delivered key that went through a multi-key `claim` and paid nothing (the
//! original F1 case) has neither mark: if its return bounced before the
//! upgrade, or is still in flight across shards during it, the creator can
//! take it after the upgrade, also for a non-cancelable vesting.
//!
//! It only matters for a contract upgraded with live vestings; a fresh
//! mainnet deploy has none. Expected once fixed (if upgrading devnet in place
//! matters): `upgrade` records the last vesting id the first time it runs on
//! flag-aware code, and the creator may not take claim keys of vestings up to
//! it (the owner still can).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[test]
fn after_an_upgrade_the_creator_cannot_take_a_legacy_key_that_paid_nothing() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // Non-cancelable, starts in a day.
    f.create_fox(
        ALICE,
        5_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    // "Claim all": key 2 pays nothing and goes back with key 1's payout.
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1, 2]);
    // The return bounces.
    let mut back = ManagedVec::new();
    back.push(Payment::new(
        token(FOX),
        0,
        NonZeroBigUint::new_or_panic(big(500)),
    ));
    back.extend(keys(KeyKind::Claim, &[1, 2]).iter().map(|p| p.clone()));
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(back)
        .whitebox(mvxvest::contract_obj, |_| {});
    // (Originally this cleared the `claimKeyUsed` marks to mimic storage
    // from before they existed. The creator path and the marks are gone; the
    // property still holds and is kept.)
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .run();
    assert_eq!(f.view(2).claimed, big(0));

    let recovered = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(2u64, KeyKind::Claim, CREATOR)
        .returns(ReturnsHandledOrError::new())
        .run();
    if recovered.is_ok() {
        f.set_time(T0 + 2 * DAY);
        f.claim(CREATOR, &[2]);
        f.check_fox(CREATOR, 10u128.pow(36) - 1_000);
        panic!(
            "after the upgrade the creator took the delivered claim key of non-cancelable \
             vesting #2 (it paid nothing in a multi-key claim, then bounced) and collected \
             all 5000 FOX"
        );
    }
    assert_eq!(recovered.unwrap_err().message, ERR_ONLY_OWNER);
}
