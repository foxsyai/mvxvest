//! Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK: the label and
//! the paged views. All pass on 322cb43 (`safe_*`).

mod common;

use common::*;
use multiversx_sc::codec::TopDecode;
use multiversx_sc_scenario::{imports::*, scenario_model::Log};
use mvxvest::errors::*;
use mvxvest::events::CreatedEvent;

/// 64 bytes: a NUL, control characters, a line break, an escape, a bidi
/// override, quote and separator characters, a formula start, a tag, invalid
/// UTF-8 and an emoji.
fn binary_label() -> Vec<u8> {
    let mut label: Vec<u8> = vec![0x00, 0x01, 0x07, 0x08, 0x09, 0x0a, 0x0d, 0x1b, 0x7f];
    label.extend_from_slice("\u{202e}".as_bytes());
    label.extend_from_slice(b"\";,=+@<b>");
    label.extend_from_slice(&[0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80]);
    while label.len() < 60 {
        label.extend_from_slice("\u{1F600}".as_bytes());
    }
    label.truncate(60);
    label.extend_from_slice(b"\0end");
    assert_eq!(label.len(), 64);
    label
}

fn created_labels(logs: &[Log]) -> Vec<Vec<u8>> {
    logs.iter()
        .filter(|log| log.topics.first().map(|t| t.as_slice()) == Some(b"vestingCreated"))
        .map(|log| {
            CreatedEvent::<StaticApi>::top_decode(log.data[0].as_slice())
                .unwrap()
                .label
                .to_boxed_bytes()
                .into_vec()
        })
        .collect()
}

fn batch_entries(who: TestAddress, count: usize) -> MultiValueEncoded<StaticApi, BatchEntry> {
    let mut entries = MultiValueEncoded::new();
    for _ in 0..count {
        entries.push(
            (
                who.to_managed_address(),
                big(10),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    entries
}

type BatchEntry = MultiValue3<ManagedAddress<StaticApi>, BigUint<StaticApi>, Schedule<StaticApi>>;

/// SAFE: a label of 64 arbitrary bytes is stored, returned by the views and
/// logged in the event byte for byte; 65 bytes are refused in a batch too.
#[test]
fn safe_a_64_byte_binary_label_is_stored_and_returned_verbatim() {
    let mut f = Fixture::new();
    let label = binary_label();
    let (id, logs) = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(
            ALICE,
            big(10),
            linear(T0, T0, 0, T0 + DAY),
            false,
            ManagedBuffer::<StaticApi>::from(label.as_slice()),
        )
        .payment(payments(&[(Some(FOX), 10)]))
        .returns(ReturnsResult)
        .returns(ReturnsLogs)
        .run();
    assert_eq!(created_labels(&logs), vec![label.clone()]);
    let (ids, logs) = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(
            true,
            ManagedBuffer::<StaticApi>::from(label.as_slice()),
            batch_entries(BOB, 2),
        )
        .payment(payments(&[(Some(FOX), 20)]))
        .returns(ReturnsResult)
        .returns(ReturnsLogs)
        .run();
    assert_eq!(created_labels(&logs), vec![label.clone(), label.clone()]);
    for id in std::iter::once(id).chain(ids.to_vec()) {
        assert_eq!(
            f.view(id).vesting.label.to_boxed_bytes().as_slice(),
            label.as_slice()
        );
    }
    let mut long = label.clone();
    long.push(b'!');
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(
            false,
            ManagedBuffer::<StaticApi>::from(long.as_slice()),
            batch_entries(BOB, 1),
        )
        .payment(payments(&[(Some(FOX), 10)]))
        .returns(ExpectError(4, ERR_LABEL_TOO_LONG))
        .run();
    f.check_invariant(Some(FOX));
}

fn by_creator(
    f: &mut Fixture,
    creator: TestAddress,
    from: u64,
    count: u64,
) -> Result<Vec<u64>, String> {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_creator(creator, from, count)
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map(|ids: MultiValueEncoded<StaticApi, u64>| ids.to_vec().into_iter().collect())
        .map_err(|e| e.message)
}

fn by_token(f: &mut Fixture, token_id: TokenId<StaticApi>, from: u64, count: u64) -> Vec<u64> {
    let ids: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_token(token_id, from, count)
        .returns(ReturnsResult)
        .run();
    ids.to_vec().into_iter().collect()
}

fn count_by_creator(f: &mut Fixture, creator: TestAddress) -> u64 {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count_by_creator(creator)
        .returns(ReturnsResult)
        .run()
}

fn views_of(f: &mut Fixture, ids: &[u64]) -> Result<Vec<u64>, String> {
    let mut asked = MultiValueEncoded::new();
    for id in ids {
        asked.push(*id);
    }
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings(asked)
        .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
        .run()
        .map(
            |views: MultiValueEncoded<StaticApi, VestingView<StaticApi>>| {
                views.into_iter().map(|view| view.id).collect()
            },
        )
        .map_err(|e| e.message)
}

/// SAFE: 155 vestings by two creators. Pages are at most 100, exact, in
/// creation order, per creator and per token; a page starting past the end
/// (even at `u64::MAX`) is empty rather than failing; `getVestings` takes at
/// most 100 ids and fails as a whole on an unknown one, so a reader must ask
/// only ids up to `getVestingCount`.
#[test]
fn safe_pages_are_bounded_exact_and_per_creator() {
    let mut f = Fixture::new();
    for size in [49, 49, 49, 3] {
        f.world
            .tx()
            .from(CREATOR)
            .to(SC)
            .typed(MvxvestProxy)
            .create_batch(false, "batch", batch_entries(ALICE, size))
            .payment(payments(&[(Some(FOX), 10 * size as u128)]))
            .run();
    }
    f.world.transfer_step(
        TransferStep::new()
            .from("address:creator")
            .to("address:bob")
            .esdt_transfer("str:FOX-a1b2c3", 0, "50"),
    );
    for _ in 0..5 {
        f.create(
            BOB,
            ALICE,
            linear(T0, T0, 0, T0 + DAY),
            false,
            payments(&[(Some(FOX), 10)]),
        );
    }
    let count: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count()
        .returns(ReturnsResult)
        .run();
    assert_eq!(count, 155);
    assert_eq!(count_by_creator(&mut f, CREATOR), 150);
    assert_eq!(count_by_creator(&mut f, BOB), 5);
    assert_eq!(count_by_creator(&mut f, MALLORY), 0);

    let first: Vec<u64> = (1..=100).collect();
    let second: Vec<u64> = (101..=150).collect();
    assert_eq!(by_creator(&mut f, CREATOR, 0, 100), Ok(first.clone()));
    assert_eq!(by_creator(&mut f, CREATOR, 100, 100), Ok(second));
    assert_eq!(by_creator(&mut f, CREATOR, 149, 100), Ok(vec![150]));
    assert_eq!(by_creator(&mut f, CREATOR, 150, 100), Ok(vec![]));
    assert_eq!(by_creator(&mut f, CREATOR, u64::MAX, 100), Ok(vec![]));
    assert_eq!(by_creator(&mut f, CREATOR, 0, 0), Ok(vec![]));
    assert_eq!(
        by_creator(&mut f, CREATOR, 0, 101),
        Err(ERR_PAGE_TOO_LARGE.to_string())
    );
    assert_eq!(by_creator(&mut f, BOB, 0, 100), Ok((151..=155).collect()));
    assert_eq!(by_creator(&mut f, MALLORY, 0, 100), Ok(vec![]));

    assert_eq!(by_token(&mut f, token(FOX), 0, 100), first.clone());
    assert_eq!(
        by_token(&mut f, token(FOX), 100, 100),
        (101..=155).collect::<Vec<u64>>()
    );
    assert_eq!(by_token(&mut f, token(USDC), 0, 100), Vec::<u64>::new());
    assert_eq!(by_token(&mut f, native(), 0, 100), Vec::<u64>::new());

    assert_eq!(views_of(&mut f, &first), Ok(first.clone()));
    let too_many: Vec<u64> = (1..=101).collect();
    assert_eq!(
        views_of(&mut f, &too_many),
        Err(ERR_PAGE_TOO_LARGE.to_string())
    );
    assert_eq!(
        views_of(&mut f, &[1, 156]),
        Err(ERR_UNKNOWN_VESTING.to_string())
    );
    assert_eq!(views_of(&mut f, &[155, 1, 155]), Ok(vec![155, 1, 155]));
    f.check_invariant(Some(FOX));
}
