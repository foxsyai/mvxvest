//! Review 3 finding (low, 25a4062): `recoverBouncedKeys` checks the code
//! metadata when the creator RECOVERS a claim key (src/claim.rs:136-138), but
//! what matters is the metadata when the key ARRIVED. While the contract is
//! payable (an upgrade with the wrong flags, the deployment mistake the fix is
//! about), a holder can put a delivered claim key in its balance without
//! calling `claim` (a wallet "send" to the contract address): `claimKeyUsed`
//! stays unset and `claimed` stays 0. The owner then repairs the metadata, as
//! the spec says to, and from the next block the creator may take that key,
//! also of a non-cancelable vesting, and collect the whole total.
//!
//! The same holds for payable-by-SC (0x0504) and a smart-contract holder (a
//! multisig "transfer" action without a call). Reproduced on the Go VM by
//! `scenarios/review3_finding_parked_key.scen.json` (review3_go_vm_test).
//!
//! Expected once fixed: a claim key that may have arrived while the contract
//! was payable is for the owner to return, never for the creator. One way:
//! `upgrade` records `lastVestingId`, and the creator may only take claim
//! keys of vestings created after the last upgrade (no vesting can be created
//! while payable, so a later repair always moves the boundary past every key
//! that could have been parked).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[test]
fn the_creator_cannot_take_a_delivered_key_parked_while_the_contract_was_payable() {
    let mut f = Fixture::new();
    // Non-cancelable: the creator gave up any say over it.
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());

    // The multisig upgrades with the payable flag by mistake.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .code_metadata(CodeMetadata::UPGRADEABLE | CodeMetadata::PAYABLE)
        .run();
    // Alice sends her key to the contract without calling `claim`. While the
    // contract is payable the protocol accepts it (the Go VM scenario does
    // this with a real ESDTNFTTransfer; at 0x0500 the same transfer fails with
    // "sending value to non payable contract").
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(key(KeyKind::Claim, 1))
        .whitebox(mvxvest::contract_obj, |_| {});
    // While payable, the creator is refused, as documented.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, CREATOR)
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();

    // The multisig repairs the metadata before it returns Alice's key.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .code_metadata(CodeMetadata::UPGRADEABLE | CodeMetadata::READABLE)
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
        f.check_fox(CREATOR, 10u128.pow(36));
        panic!(
            "after the repair the creator took Alice's claim key of non-cancelable vesting #1 \
             (delivered to her, parked in the contract while it was payable) and collected \
             all 1000 FOX"
        );
    }
    assert_eq!(recovered.unwrap_err().message, ERR_ONLY_OWNER);
}

/// The same root cause for cancel keys, and here even while the contract is
/// payable: the creator may take any held cancel key (src/claim.rs:144-146,
/// no metadata check), on the premise that a held cancel key bounced on its
/// way to the creator. A cancel key is a transferable right to the refund;
/// once the creator has passed it on, a holder's key parked during a payable
/// window is not the creator's. Reproduced on the Go VM by
/// `scenarios/review3_finding_parked_cancel_key.scen.json`.
#[test]
fn the_creator_cannot_take_a_cancel_key_it_passed_on_and_that_was_parked_while_payable() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    // The creator hands the right to cancel (and the refund) to Bob.
    f.send_key(KeyKind::Cancel, 1, CREATOR, BOB);
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .upgrade()
        .code(CODE)
        .code_metadata(CodeMetadata::UPGRADEABLE | CodeMetadata::PAYABLE)
        .run();
    // Bob sends it to the contract without calling `cancel`.
    f.world
        .tx()
        .from(BOB)
        .to(SC)
        .payment(key(KeyKind::Cancel, 1))
        .whitebox(mvxvest::contract_obj, |_| {});

    let recovered = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Cancel, CREATOR)
        .returns(ReturnsHandledOrError::new())
        .run();
    if recovered.is_ok() {
        f.cancel(CREATOR, &[1]);
        f.check_fox(CREATOR, 10u128.pow(36));
        panic!(
            "while the contract was payable the creator took back the cancel key it had given \
             to Bob (parked in the contract) and cancelled, collecting the 1000 FOX refund"
        );
    }
    assert_eq!(recovered.unwrap_err().message, ERR_ONLY_OWNER);
}
