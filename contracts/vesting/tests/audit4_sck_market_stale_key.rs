//! Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK: the claim key
//! on a secondary market (the outside email's claims 1 and 2).
//!
//! A claim key is an NFT. Outside the dApp a buyer sees only the NFT: its
//! name and attributes, written once at mint and never touched again
//! (`keys.rs`). The contract's state moves on (`claimed`, `cancelledAt`), but
//! nothing of it reaches the NFT.
//!
//! Protocol facts behind the possible fixes (mx-chain-vm-common-go,
//! `builtInFunctions/updateNFTAttributes.go` and `esdtMetaDataRecreate.go`,
//! read on 20 Oct 2026): `ESDTNFTUpdateAttributes` and `ESDTMetaDataUpdate`
//! read the token from the CALLER's own account (`GetESDTNFTTokenOnSender`;
//! `GetESDTNFTTokenOnDestination` with a missing or zero-balance token
//! refused) for a non-dynamic NFT, and `changeToDynamic` is refused for
//! `NonFungibleESDT` and `NonFungibleESDTv2` (the type of both key
//! collections on mainnet). So the contract can rewrite a key only while it
//! holds it: during `claim`, never at `cancel`. The mainnet contract already
//! holds `ESDTRoleNFTUpdateAttributes` on both collections (API, 20 Oct 2026).
//!
//! Finding SCK-1 (the first test fails on 322cb43): a key that has just paid
//! out everything vested goes back to its holder byte-identical to the key as
//! minted, and is sold that way. Expected once fixed: a key returned by
//! `claim` says what it has paid (for example `;claimed:<amount>` set with
//! `ESDTNFTUpdateAttributes` while the contract holds it: one built-in call
//! per returned key, the nonce unchanged, so 99 keys still fit a call). The
//! test accepts any change of the NFT: attributes, name, or a re-minted key
//! under a new nonce.
//!
//! The `safe_*` tests pass today and pin what claim 2 rests on: after a
//! cancel the claim key is untouched and only the views know; a sale and a
//! cancel in the same second leave the buyer the vested part only, in either
//! order.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

/// An NFT as the chain stores it for one holder: 0 of it when the holder
/// does not have it (burned, or moved).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Nft {
    amount: u64,
    name: Vec<u8>,
    attributes: Vec<u8>,
}

/// Reads the claim key `nonce` as `holder` has it, through the blockchain
/// API the contract itself could call.
fn claim_key_of(f: &mut Fixture, holder: TestAddress, nonce: u64) -> Nft {
    let mut found = Nft::default();
    f.world
        .query()
        .to(SC)
        .whitebox(mvxvest::contract_obj, |sc| {
            let data = sc.blockchain().get_esdt_token_data(
                &ManagedAddress::from(holder.to_address()),
                &EsdtTokenIdentifier::from(CLAIM_KEY.as_str()),
                nonce,
            );
            found = Nft {
                amount: data.amount.to_u64().unwrap_or(u64::MAX),
                name: data.name.to_boxed_bytes().into_vec(),
                attributes: data.attributes.to_boxed_bytes().into_vec(),
            };
        });
    found
}

fn vesting_of_claim_nonce(f: &mut Fixture, nonce: u64) -> u64 {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_by_claim_nonce(nonce)
        .returns(ReturnsResult)
        .run()
}

/// SCK-1 (fails on 322cb43). A project vests 1,000 FOX to itself, not even
/// cancelable: the most trustworthy kind of key. At second 999 of 1,000 it
/// claims: 999 FOX leave the contract and the key comes back. It then sells
/// the key to Bob, who receives an NFT byte-identical to the one minted
/// (same nonce, same name, same attributes) while the contract will ever pay
/// it 1 FOX more. The views say so; the NFT does not.
#[test]
#[ignore = "SCK-1 needs a contract change (version 3), which waits for the owner's decision and a multisig vote: \
            cargo test -p mvxvest --test audit4_sck_market_stale_key -- --ignored shows it failing"]
fn a_drained_claim_key_goes_back_byte_identical_to_the_key_as_minted() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(minted.amount, 1);
    assert_eq!(
        minted.attributes,
        key_attributes(id, FOX.as_str(), false).into_bytes()
    );

    f.set_time(T0 + 999);
    f.claim(CREATOR, &[1]);
    let view = f.view(id);
    assert_eq!(view.claimed, big(999));
    assert_eq!(view.claimable, big(0));
    assert_eq!(view.final_amount, big(1_000));

    // The sale, off chain; then the key moves to the buyer.
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    assert_eq!(vesting_of_claim_nonce(&mut f, 1), id);
    let sold = claim_key_of(&mut f, BOB, 1);
    assert!(
        sold.amount == 0 || sold.name != minted.name || sold.attributes != minted.attributes,
        "SCK-1: the key Bob bought is the key as minted, though 999 of its 1,000 FOX are \
         gone: name {:?}, attributes {:?}",
        String::from_utf8_lossy(&sold.name),
        String::from_utf8_lossy(&sold.attributes)
    );
    f.check_invariant(Some(FOX));
}

/// SAFE, pinned (claim 2): the cancel is the other way a key loses its
/// value without the NFT changing, and here no fix can act on the NFT: the
/// contract does not hold the claim key when `cancel` runs. The marker
/// `cancelable:1` (minted since version 2) is what warns the buyer; the
/// views tell the rest. After the cancel, the dead key is burned by its next
/// trip through `claim`.
#[test]
fn safe_a_cancelled_vestings_claim_key_is_untouched_and_only_the_views_know() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(
        minted.attributes,
        key_attributes(id, FOX.as_str(), true).into_bytes(),
        "the version 2 marker is there"
    );

    f.set_time(T0 + 100);
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    f.cancel(CREATOR, &[1]);

    // The NFT Bob holds is the NFT as minted.
    assert_eq!(claim_key_of(&mut f, BOB, 1), minted);
    // What a marketplace could ask the contract, in two calls.
    let found = vesting_of_claim_nonce(&mut f, 1);
    assert_eq!(found, id);
    let view = f.view(found);
    assert_eq!(view.cancelled_at, T0 + 100);
    assert_eq!(view.final_amount, big(100));
    assert_eq!(view.refunded, big(900));
    assert_eq!(view.claimable, big(100));
    assert!(view.vesting.cancelable);

    // The key pays its 100 once and is burned: nothing to sell on.
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    f.check_fox(BOB, 100);
    assert_eq!(claim_key_of(&mut f, BOB, 1).amount, 0);
    f.check_invariant(Some(FOX));
}

/// The rug of RT3 with the cancel placed around the sale: one second before
/// it, in the same second before the transfer, and in the same second after
/// it. Returns what Bob can ever collect.
fn rug(cancel_at: u64, cancel_before_transfer: bool) -> (u128, Nft) {
    let mut f = Fixture::new();
    f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    let sale_at = T0 + 100;
    if cancel_at < sale_at {
        f.set_time(cancel_at);
        f.cancel(CREATOR, &[1]);
        f.set_time(sale_at);
        f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    } else {
        f.set_time(sale_at);
        if cancel_before_transfer {
            f.cancel(CREATOR, &[1]);
            f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
        } else {
            f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
            f.cancel(CREATOR, &[1]);
        }
    }
    let bought = claim_key_of(&mut f, BOB, 1);
    assert_eq!(bought, minted, "the NFT bought is the NFT minted");
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    let bob: BigUint<StaticApi> = f.totals(token(FOX)).claimed;
    f.check_invariant(Some(FOX));
    (bob.to_u64().unwrap() as u128, bought)
}

/// SAFE, pinned: whichever side of the sale the cancel lands on, within the
/// same block or one second earlier, the buyer gets what had vested at the
/// cancel and nothing in the NFT told it apart.
#[test]
fn safe_a_sale_and_a_cancel_in_the_same_second_in_either_order() {
    let (before, _) = rug(T0 + 99, true);
    let (same_first, _) = rug(T0 + 100, true);
    let (same_after, _) = rug(T0 + 100, false);
    assert_eq!((before, same_first, same_after), (99, 100, 100));
}
