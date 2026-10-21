//! Fourth audit, red team: the sale of a claim key, end to end, as it plays
//! out on a marketplace (a listing in escrow, or an offer the seller accepts).
//!
//! Both tests are evidence for the outside email's claims 1 and 2, not
//! contract bugs. Everything below is "by the rules" of the contract, which
//! is why the buyer's protection is what the key itself and mvxvest's own
//! pages tell them (the dApp finding RT1 of this audit).
//!
//! What a marketplace buyer sees of a claim key is its name and attributes.
//! Up to version 2 they were written once at mint, so the same bytes
//! described a fresh key and a key whose vested part was just claimed. Since
//! version 3 the name says the vesting is cancelable from the mint, and each
//! claim that pays rewrites the name and attributes with what has been
//! claimed (`claimed:<units>`; SCK-1). A cancel still cannot be written: on a
//! NonFungibleESDTv2 collection only the holder of the NFT can update its
//! metadata (mx-chain-vm-common-go, `getEsdtInfo` in esdtMetaDataRecreate.go),
//! and the cancel key's sender does not hold the claim key.
//!
//! The rug (claim 2): the attacker creates a cancelable vesting for a wallet
//! of its own (the seller), parks the cancel key in a third wallet (so the
//! vesting page shows neither the seller as creator nor the seller as the
//! cancel key's holder), claims what has vested, lists the claim key, and
//! cancels the moment the sale settles. The buyer keeps what had vested at
//! the cancel minus what the seller claimed before the sale.
//!
//! The spent key (claim 1): with the cancel timed at the claim, the key the
//! buyer receives pays nothing, ever. Since version 3 it says it is
//! cancelable and what was claimed; that it was cancelled, only the
//! contract's views and mvxvest's pages say, until `claim` burns it.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

/// The marketplace's escrow: holds the key between the listing and the sale.
const ESCROW: TestAddress = TestAddress::new("escrow");
const TOTAL: u128 = 10_000;

fn with_escrow() -> Fixture {
    let mut f = Fixture::new();
    f.world.account(ESCROW).nonce(1).balance(big(100 * EGLD));
    f
}

/// The rug: 10,000 FOX vest linearly over 1,000 seconds. The seller claims
/// the 1,000 vested at T0+100, lists the key, and the sale settles at T0+200
/// when the page shows "claimed 1,000, claimable 1,000, not vested yet
/// 8,000". The cold wallet cancels in the same second: 8,000 go back to it;
/// the buyer's key is worth 1,000, ever. The key said "cancelable, 10%
/// claimed" (version 3) and nothing about the cancel.
#[test]
fn the_seller_parks_the_cancel_key_claims_sells_through_escrow_and_cancels_on_settlement() {
    let mut f = with_escrow();
    let id = f.create_fox(ALICE, TOTAL, linear(T0, T0, 0, T0 + 1_000), true);
    let claimed_1000 = format!("{};claimed:1000", key_attributes(id, FOX.as_str(), true));
    f.check_holds_key(ALICE, KeyKind::Claim, 1, id, FOX.as_str());

    // The cancel key goes to a cold wallet: the vesting page will show the
    // creator and a third address as the cancel key's holder, not the seller.
    f.send_key(KeyKind::Cancel, 1, CREATOR, MALLORY);
    f.check_holds_key(MALLORY, KeyKind::Cancel, 1, id, FOX.as_str());

    // Claim 1: the seller takes everything vested before listing. Since
    // version 3 the key comes back saying so.
    f.set_time(T0 + 100);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 1_000);
    f.world
        .check_account(ALICE)
        .esdt_nft_balance_and_attributes(CLAIM_KEY, 1, 1, claimed_1000.as_bytes());

    // Listed: the key sits in the marketplace's escrow, showing the claim.
    f.send_key(KeyKind::Claim, 1, ALICE, ESCROW);
    f.world
        .check_account(ESCROW)
        .esdt_nft_balance_and_attributes(CLAIM_KEY, 1, 1, claimed_1000.as_bytes());

    // The sale settles at T0+200. A careful buyer who read mvxvest.io at
    // this moment saw: total 10,000, claimed 1,000, claimable 1,000, not
    // vested yet 8,000, cancelable, cancel key held by a third wallet.
    f.set_time(T0 + 200);
    let before = f.view(id);
    assert_eq!(before.claimed, big(1_000));
    assert_eq!(before.claimable, big(1_000));
    assert_eq!(before.final_amount, big(TOTAL));
    assert_eq!(before.cancelled_at, 0);
    f.send_key(KeyKind::Claim, 1, ESCROW, BOB);
    f.world.check_account(BOB).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        1,
        1,
        claimed_1000.as_bytes(),
    );

    // Claim 2: the same second, the cold wallet cancels. The unvested 8,000
    // go to whoever sent the cancel key.
    f.cancel(MALLORY, &[1]);
    f.check_fox(MALLORY, 8_000);
    let after = f.view(id);
    assert_eq!(after.final_amount, big(2_000));
    assert_eq!(after.refunded, big(8_000));
    assert_eq!(after.claimable, big(1_000));

    // The buyer can collect 1,000 of the "10,000 FOX vesting" it paid for,
    // and nothing more, ever. The key cannot show the cancel: the contract
    // did not hold it.
    f.world.check_account(BOB).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        1,
        1,
        claimed_1000.as_bytes(),
    );
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 1_000);
    f.check_invariant(Some(FOX));
}

/// The spent key: the seller claims at T0+200 and the cold wallet cancels in
/// the same second, so what had vested (2,000) is exactly what was claimed.
/// The key the buyer receives can pay nothing, ever. Since version 3 it says
/// "cancelable, 20% claimed"; the cancel shows only in the contract's views
/// until the buyer sends it to `claim`, which burns it and pays nothing.
#[test]
fn a_spent_key_shows_the_claim_but_not_the_cancel() {
    let mut f = with_escrow();
    let id = f.create_fox(ALICE, TOTAL, linear(T0, T0, 0, T0 + 1_000), true);
    let claimed_2000 = format!("{};claimed:2000", key_attributes(id, FOX.as_str(), true));
    f.send_key(KeyKind::Cancel, 1, CREATOR, MALLORY);

    f.set_time(T0 + 200);
    f.claim(ALICE, &[1]);
    f.check_fox(ALICE, 2_000);
    f.cancel(MALLORY, &[1]);
    f.check_fox(MALLORY, 8_000);

    // Listed and sold: the key moves through escrow to the buyer.
    f.send_key(KeyKind::Claim, 1, ALICE, ESCROW);
    f.send_key(KeyKind::Claim, 1, ESCROW, BOB);
    f.world.check_account(BOB).esdt_nft_balance_and_attributes(
        CLAIM_KEY,
        1,
        1,
        claimed_2000.as_bytes(),
    );

    // On chain the key says what was claimed, not that nothing more will
    // come; only the contract's view says it is worth nothing.
    let view = f.view(id);
    assert_eq!(view.claimable, big(0));
    assert_eq!(view.final_amount, view.claimed);
    assert_ne!(view.cancelled_at, 0);

    // Sending it to claim burns it and pays nothing: afterwards the buyer
    // cannot send it any more (the transfer itself fails, status 10).
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 0);
    f.world
        .tx()
        .from(BOB)
        .to(SC)
        .typed(MvxvestProxy)
        .claim()
        .payment(key(KeyKind::Claim, 1))
        .returns(ExpectStatus(10))
        .run();
    f.check_invariant(Some(FOX));
}
