//! Version 3: what a claim key shows outside this dApp (the fourth audit's
//! SCK-1 and SCK-2). A buyer on a marketplace sees the key's name, not the
//! contract's views, so:
//! - a cancelable vesting's claim key says so in its name, from the mint;
//! - each claim that pays and returns the key rewrites its name and
//!   attributes with what has been claimed (`ESDTMetaDataUpdate`, while the
//!   contract holds the key: the protocol lets only the holder change a
//!   non-dynamic NFT, so nothing can happen at a cancel).
//!
//! Every test here fails on version 2.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Nft {
    amount: u64,
    name: String,
    attributes: String,
    uris: Vec<String>,
}

/// The claim key `nonce` as `holder` has it (amount 0 when it has none).
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
            let text = |b: &ManagedBuffer<DebugApi>| {
                String::from_utf8(b.to_boxed_bytes().into_vec()).unwrap()
            };
            found = Nft {
                amount: data.amount.to_u64().unwrap_or(u64::MAX),
                name: text(&data.name),
                attributes: text(&data.attributes),
                uris: data.uris.iter().map(|u| text(&u)).collect(),
            };
        });
    found
}

fn stamped(id: u64, cancelable: bool, claimed: u128) -> String {
    format!(
        "{};claimed:{claimed}",
        key_attributes(id, FOX.as_str(), cancelable)
    )
}

#[test]
fn a_cancelable_vestings_claim_key_says_so_in_its_name() {
    let mut f = Fixture::new();
    let cancelable = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let fixed = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let claim_nonce = |f: &mut Fixture, id: u64| f.view(id).vesting.claim_nonce;

    let nonce = claim_nonce(&mut f, cancelable);
    let key = claim_key_of(&mut f, CREATOR, nonce);
    assert_eq!(
        key.name,
        format!("Vesting #{cancelable} claim key, cancelable")
    );
    assert_eq!(
        key.attributes,
        key_attributes(cancelable, FOX.as_str(), true)
    );

    let nonce = claim_nonce(&mut f, fixed);
    let key = claim_key_of(&mut f, CREATOR, nonce);
    assert_eq!(key.name, format!("Vesting #{fixed} claim key"));
}

#[test]
fn each_claim_that_pays_stamps_the_returned_key() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);

    f.set_time(T0 + 250);
    f.claim(CREATOR, &[1]);
    let key = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(key.amount, 1, "the key comes back");
    assert_eq!(
        key.name,
        format!("Vesting #{id} claim key, cancelable, 25% claimed")
    );
    assert_eq!(key.attributes, stamped(id, true, 250));

    // Sold after a second claim: the buyer's NFT says 999 of 1,000 are gone.
    f.set_time(T0 + 999);
    f.claim(CREATOR, &[1]);
    f.send_key(KeyKind::Claim, 1, CREATOR, BOB);
    let key = claim_key_of(&mut f, BOB, 1);
    assert_eq!(
        key.name,
        format!("Vesting #{id} claim key, cancelable, 99% claimed")
    );
    assert_eq!(key.attributes, stamped(id, true, 999));

    // The last claim burns it, as before.
    f.set_time(T0 + 1_000);
    f.claim(BOB, &[1]);
    assert_eq!(claim_key_of(&mut f, BOB, 1).amount, 0);
    f.check_invariant(Some(FOX));
}

#[test]
fn a_claim_of_under_one_percent_is_named_so() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 5);
    f.claim(CREATOR, &[1]);
    let key = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(
        key.name,
        format!("Vesting #{id} claim key, under 1% claimed")
    );
    assert_eq!(key.attributes, stamped(id, false, 5));
}

#[test]
fn a_key_that_pays_nothing_goes_back_unchanged() {
    let mut f = Fixture::new();
    let paying = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // Its cliff is later: nothing to claim yet.
    let waiting = f.create_fox(CREATOR, 1_000, linear(T0, T0 + 500, 0, T0 + 1_000), false);
    f.set_time(T0 + 100);
    f.claim(CREATOR, &[1, 2]);
    assert_eq!(
        claim_key_of(&mut f, CREATOR, 1).attributes,
        stamped(paying, false, 100)
    );
    let untouched = claim_key_of(&mut f, CREATOR, 2);
    assert_eq!(untouched.name, format!("Vesting #{waiting} claim key"));
    assert_eq!(
        untouched.attributes,
        key_attributes(waiting, FOX.as_str(), false)
    );
}

#[test]
fn the_stamp_keeps_the_keys_pictures() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(
            KeyKind::Claim,
            "",
            MultiValueEncoded::from(ManagedVec::from(vec![
                ManagedBuffer::from("https://mvxvest.io/nft/claim-key.png"),
                ManagedBuffer::from("https://mvxvest.io/nft/claim-key.svg"),
            ])),
        )
        .run();
    f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(minted.uris.len(), 2);

    f.set_time(T0 + 400);
    f.claim(CREATOR, &[1]);
    assert_eq!(claim_key_of(&mut f, CREATOR, 1).uris, minted.uris);
}

#[test]
fn a_long_minted_metadata_is_kept_whole() {
    let mut f = Fixture::new();
    // Longer than the 256 bytes the stamp searches for the metadata's start.
    let metadata = format!("ipfs://{}", "a".repeat(400));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(
            KeyKind::Claim,
            metadata.as_str(),
            MultiValueEncoded::<StaticApi, ManagedBuffer<StaticApi>>::new(),
        )
        .run();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    f.set_time(T0 + 500);
    f.claim(CREATOR, &[1]);
    assert_eq!(
        claim_key_of(&mut f, CREATOR, 1).attributes,
        format!(
            "{};claimed:500;metadata:{metadata}",
            key_attributes(id, FOX.as_str(), false)
        )
    );
}
