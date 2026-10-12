//! Review 2 finding (low, F1 fix, upgrade path): the fix replaced the check
//! "nothing claimed" with "claimKeyUsed" instead of adding to it
//! (src/claim.rs:131). The code before the fix never wrote `claimKeyUsed`, so
//! after an UPGRADE of a contract that already holds vestings, every one of
//! them reads "never delivered", even a vesting whose key was delivered and
//! claimed from. A claim key held by the contract at that point (a return
//! that bounced, or a bounce still in flight across shards) can then be taken
//! by the creator, which the pre-fix code itself refused (`claimed > 0`).
//!
//! An upgrade is the realistic path: devnet runs the pre-fix code, and the
//! fixed `init` cannot be deployed on the Go VM at all
//! (review2_payable_guard_go_vm_test), so the fixed code reaches the chain
//! only by upgrading.
//!
//! Expected once fixed: the creator may take a held claim key only if it was
//! never seen AND nothing was claimed from it (`claimed == 0`), which costs
//! nothing and is exact for every vesting the new code created.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[test]
fn after_an_upgrade_the_creator_cannot_take_a_key_its_holder_claimed_with() {
    let mut f = Fixture::new();
    // Non-cancelable: the creator gave up any say over it.
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    assert_eq!(f.view(1).claimed, big(100));

    // The return of payout and key bounced (Alice's address is a contract
    // that cannot receive): the contract holds the claimed-from key.
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

    // (Originally this cleared a `claimKeyUsed` mark to mimic storage from
    // before the mark existed. The creator path and the mark are gone; the
    // property still holds and is kept.)
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .run();

    let recovered = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, CREATOR)
        .returns(ReturnsHandledOrError::new())
        .run();
    if recovered.is_ok() {
        f.set_time(T0 + 1_000);
        f.claim(CREATOR, &[1]);
        f.check_fox(CREATOR, 10u128.pow(36) - 1_000 + 900);
        panic!(
            "after the upgrade the creator took the claim key of non-cancelable vesting #1, \
             from which its holder had already claimed 100, and collected the other 900 FOX \
             (the pre-fix code refused this: claimed > 0)"
        );
    }
    assert_eq!(recovered.unwrap_err().message, ERR_ONLY_OWNER);
}
