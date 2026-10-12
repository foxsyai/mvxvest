//! Review 2 finding (low/info, F1 fix): `claimKeyUsed` decides who may
//! recover a held claim key (the creator or only the owner), but nothing
//! outside storage shows it. There is no view, and a key that pays nothing in
//! a multi-key claim is marked (src/claim.rs:29-31) without any event: the
//! claim loop logs `vestingClaimed` only when the key paid or was burned. So
//! an indexer or the dApp, following spec section 6 ("together [the events]
//! are enough to rebuild the full history without reading storage"), sees a
//! held key of a vesting that never had a `vestingClaimed` event, concludes
//! it bounced at creation, and offers the creator a recovery the contract
//! refuses.
//!
//! Expected once fixed: the claim that marks a key leaves an event naming its
//! vesting (or a view exposes the flag, and the spec stops promising that
//! events alone suffice).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

#[test]
fn the_mark_on_a_key_that_paid_nothing_is_visible_in_the_events() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.create_fox(
        ALICE,
        5_000,
        linear(T0 + DAY, T0 + DAY, 0, T0 + 2 * DAY),
        false,
    );
    f.set_time(T0 + 500);
    let logs = f
        .world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(keys(KeyKind::Claim, &[1, 2]))
        .returns(ReturnsLogs)
        .run();

    // The return bounces; the contract holds the key of vesting #2.
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
    // The contract treats key #2 as delivered: the creator is refused.
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_keys(2u64, CREATOR)
        .returns(ExpectError(4, ERR_NOT_ALLOWED))
        .run();

    // What an indexer saw of vesting #2 in that claim.
    let id_topic = 2u64
        .to_be_bytes()
        .iter()
        .skip_while(|b| **b == 0)
        .copied()
        .collect::<Vec<u8>>();
    let names: Vec<String> = logs
        .iter()
        .map(|log| String::from_utf8_lossy(&log.topics[0]).into_owned())
        .collect();
    // Only the contract's own events (`vesting*`, `key*`), whose first
    // indexed topic is the vesting id; not the VM's transfer logs.
    let mentions_2 = logs.iter().any(|log| {
        let own = log.topics[0].starts_with(b"vesting") || log.topics[0].starts_with(b"key");
        own && log.topics.len() > 1 && log.topics[1] == id_topic
    });
    assert!(
        mentions_2,
        "the claim marked vesting #2's key as delivered (the creator may no longer recover \
         it) but logged nothing about vesting #2; events of that claim: {names:?}"
    );
}
