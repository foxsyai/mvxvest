//! Review 2, verified safe (F4): `recoverBouncedKeys` gives each caller what
//! it may take, checks in a fixed order, and logs one `keyRecovered` per key.

mod common;

use common::*;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};
use mvxvest::errors::*;

fn bounce(f: &mut Fixture, from: TestAddress, list: ManagedVec<StaticApi, Payment<StaticApi>>) {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .payment(list)
        .whitebox(mvxvest::contract_obj, |_| {});
}

fn recover_logs(f: &mut Fixture, caller: TestAddress, id: u64, to: TestAddress) -> Vec<Log> {
    f.world
        .tx()
        .from(caller)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(id, to)
        .returns(ReturnsLogs)
        .run()
}

fn recover_fails(
    f: &mut Fixture,
    caller: TestAddress,
    id: u64,
    to: ManagedAddress<StaticApi>,
    error: &str,
) {
    f.world
        .tx()
        .from(caller)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(id, to)
        .returns(ExpectError(4, error))
        .run();
}

/// The `kind` topic of each `keyRecovered` log, in order.
fn recovered_kinds(logs: &[Log]) -> Vec<Vec<u8>> {
    logs.iter()
        .filter(|log| log.topics.first().map(|t| t.as_slice()) == Some(b"keyRecovered"))
        .map(|log| log.topics[2].clone())
        .collect()
}

#[test]
fn the_owner_who_is_also_the_creator_takes_both_keys_with_one_event_each() {
    let mut f = Fixture::new();
    // The owner creates a cancelable EGLD vesting for Alice.
    f.create(
        OWNER,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        true,
        payments(&[(None, EGLD)]),
    );
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    // Both keys come back: Alice's return and the owner's cancel key.
    let mut claim_back = ManagedVec::new();
    claim_back.push(Payment::new(
        native(),
        0,
        NonZeroBigUint::new_or_panic(big(EGLD / 10)),
    ));
    claim_back.extend(key(KeyKind::Claim, 1).iter().map(|p| p.clone()));
    bounce(&mut f, ALICE, claim_back);
    bounce(&mut f, OWNER, key(KeyKind::Cancel, 1));
    let logs = recover_logs(&mut f, OWNER, 1, BOB);
    let kinds = recovered_kinds(&logs);
    assert_eq!(kinds.len(), 2, "one keyRecovered per key: {logs:?}");
    assert_ne!(kinds[0], kinds[1], "the two events name different kinds");
    f.check_holds_key(BOB, KeyKind::Claim, 1, 1, "EGLD-000000");
    f.check_holds_key(BOB, KeyKind::Cancel, 1, 1, "EGLD-000000");
}

#[test]
fn the_creator_takes_only_the_cancel_key_and_the_owner_the_rest() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    let mut back = ManagedVec::new();
    back.push(Payment::new(
        token(FOX),
        0,
        NonZeroBigUint::new_or_panic(big(100)),
    ));
    back.extend(key(KeyKind::Claim, 1).iter().map(|p| p.clone()));
    bounce(&mut f, ALICE, back);
    // Only the seen claim key is held: the creator may take nothing.
    recover_fails(
        &mut f,
        CREATOR,
        1,
        CREATOR.to_managed_address(),
        ERR_NOT_ALLOWED,
    );
    bounce(&mut f, CREATOR, key(KeyKind::Cancel, 1));
    let logs = recover_logs(&mut f, CREATOR, 1, CREATOR);
    assert_eq!(recovered_kinds(&logs).len(), 1);
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
    // The claim key is still held, for the owner to return.
    recover_fails(
        &mut f,
        CREATOR,
        1,
        CREATOR.to_managed_address(),
        ERR_NOT_ALLOWED,
    );
    let logs = recover_logs(&mut f, OWNER, 1, ALICE);
    assert_eq!(recovered_kinds(&logs).len(), 1);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    recover_fails(
        &mut f,
        OWNER,
        1,
        ALICE.to_managed_address(),
        ERR_NO_HELD_KEY,
    );
}

#[test]
fn errors_come_in_a_fixed_order() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    // Unknown vesting first, even with a bad recipient.
    recover_fails(
        &mut f,
        MALLORY,
        9,
        ManagedAddress::zero(),
        ERR_UNKNOWN_VESTING,
    );
    // Then the recipient, even when nothing is held.
    recover_fails(
        &mut f,
        MALLORY,
        1,
        ManagedAddress::zero(),
        ERR_BAD_RECIPIENT,
    );
    // Nothing held: the same answer for everyone.
    recover_fails(
        &mut f,
        MALLORY,
        1,
        MALLORY.to_managed_address(),
        ERR_NO_HELD_KEY,
    );
    // Something held that the caller may not take.
    bounce(&mut f, ALICE, key(KeyKind::Claim, 1));
    recover_fails(
        &mut f,
        MALLORY,
        1,
        MALLORY.to_managed_address(),
        ERR_NOT_ALLOWED,
    );
    recover_fails(
        &mut f,
        ALICE,
        1,
        ALICE.to_managed_address(),
        ERR_NOT_ALLOWED,
    );
}
