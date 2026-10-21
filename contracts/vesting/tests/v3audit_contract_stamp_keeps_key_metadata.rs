//! Audit of version 3 (V3C-1). `setKeyDisplay` says "Keys already minted
//! keep theirs", and the stamp keeps the key's own URIs (its pictures), but it
//! writes the `metadata:` part from the display as it is at the claim, not as
//! it was at the mint. A key minted under design A and claimed after the
//! owner switched to design B comes back with A's pictures and B's metadata
//! (an IPFS CID of a JSON description, for instance): the two no longer
//! describe the same key, and the holder's claim pays for however long the
//! owner's new metadata is. Fails on 7361158; passes once the stamp keeps the
//! metadata the key was minted with (or drops the part it cannot keep).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Nft {
    attributes: String,
    uris: Vec<String>,
}

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
                attributes: text(&data.attributes),
                uris: data.uris.iter().map(|u| text(&u)).collect(),
            };
        });
    found
}

fn set_display(f: &mut Fixture, metadata: &str, uri: &str) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(
            KeyKind::Claim,
            metadata,
            MultiValueEncoded::from(ManagedVec::from(vec![ManagedBuffer::from(uri)])),
        )
        .run();
}

#[test]
fn the_stamp_keeps_the_metadata_the_key_was_minted_with() {
    let mut f = Fixture::new();
    set_display(
        &mut f,
        "ipfs://design-A",
        "https://mvxvest.io/nft/claim-key-A.png",
    );
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let minted = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(
        minted.attributes,
        format!(
            "{};metadata:ipfs://design-A",
            key_attributes(id, FOX.as_str(), false)
        )
    );

    // The owner moves to a new design: keys minted from now on get it.
    set_display(
        &mut f,
        "ipfs://design-B",
        "https://mvxvest.io/nft/claim-key-B.png",
    );

    f.set_time(T0 + 250);
    f.claim(CREATOR, &[1]);
    let stamped = claim_key_of(&mut f, CREATOR, 1);
    assert_eq!(stamped.uris, minted.uris, "the key keeps its pictures");
    assert_eq!(
        stamped.attributes,
        format!(
            "{};claimed:250;metadata:ipfs://design-A",
            key_attributes(id, FOX.as_str(), false)
        ),
        "the key keeps the metadata it was minted with, as setKeyDisplay promises"
    );
}
