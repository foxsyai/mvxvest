//! Red-team finding: a claim key says nothing about the cancel key that can
//! empty it.
//!
//! Keys are transferable NFTs, so claim keys will be sold (OTC, marketplaces).
//! Outside this dApp a buyer only sees the NFT: name `Vesting #N claim key`,
//! attributes `tags:mvxvest,vesting;vesting:N;token:T`. Those are IDENTICAL
//! for a cancelable and a non-cancelable vesting, and identical between the
//! claim key and the cancel key of the same vesting. Mainnet
//! `VESTKEY-f56bea-01` and `VESTCANCEL-ae94f5-01` carry exactly
//! `tags:mvxvest,vesting;vesting:1;token:FOXSY-5d5f3e` (API, 2026-10-13).
//!
//! The rug: whoever holds the cancel key (the creator, or anyone who bought
//! it) sells the claim key of a cancelable vesting, then cancels. The buyer
//! keeps only what had vested at that moment; the seller keeps the price and
//! gets the rest back. Everything is "by the rules", which is why the rule
//! has to be visible where the key is sold.
//!
//! Expected once fixed (the first test): the claim key of a cancelable
//! vesting carries a marker in its attributes (here `;cancelable:1`), so
//! wallets, explorers and marketplaces can show it and the Guide can tell
//! buyers to look for it. `cancelable` never changes, and the contract never
//! reads attributes, so this costs nothing at claim time. New keys only: an
//! upgrade cannot rewrite the ones already minted without the update role.
//!
//! The second test passes today: it is the sequence itself, kept as a
//! regression test of what the marker warns about.

mod common;

use common::*;

/// Failed on the audited code (no `cancelable` marker); fixed in version 2.
#[test]
fn a_cancelable_claim_key_says_so_in_its_attributes() {
    let mut f = Fixture::new();
    let id = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let expected = format!("{};cancelable:1", attributes(id, FOX.as_str()));
    f.world
        .check_account(ALICE)
        .esdt_nft_balance_and_attributes(CLAIM_KEY, 1, 1, expected.as_bytes());
}

/// Passes: the rug sequence. A project vests 1,000 FOX to itself (cancelable),
/// sells the claim key to Bob when 100 have vested, then cancels. Bob can
/// collect 100; 900 go back to the seller, who also keeps Bob's money.
#[test]
fn the_seller_cancels_right_after_the_sale_and_keeps_the_unvested_rest() {
    let mut f = Fixture::new();
    let start = big(10u128.pow(36));
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.check_holds_key(CREATOR, KeyKind::Claim, 1, id, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, id, FOX.as_str());

    // The sale, off chain, then the key moves to the buyer.
    f.set_time(T0 + 100);
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    f.check_holds_key(BOB, KeyKind::Claim, 1, id, FOX.as_str());

    // The seller still holds the cancel key: it cancels in the same minute.
    f.cancel(CREATOR, &[1]);
    let view = f.view(id);
    assert_eq!(view.final_amount, big(100));
    assert_eq!(view.refunded, big(900));

    // The buyer collects only what had vested at the cancel, ever.
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 100);
    f.world
        .check_account(CREATOR)
        .esdt_balance(FOX, start - 100u32);
    f.check_invariant(Some(FOX));
}
