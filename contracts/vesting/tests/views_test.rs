//! Views: everything the dApp reads.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

fn ids(values: MultiValueEncoded<StaticApi, u64>) -> Vec<u64> {
    values.to_vec().into_iter().collect()
}

#[test]
fn vestings_by_creator_and_by_token_are_paged() {
    let mut f = Fixture::new();
    for _ in 0..5 {
        f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    }
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(USDC), 10)]),
    );
    f.create(
        ALICE,
        BOB,
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(None, EGLD)]),
    );

    let count: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count_by_creator(CREATOR)
        .returns(ReturnsResult)
        .run();
    assert_eq!(count, 6);
    let page: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_creator(CREATOR, 2u64, 3u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!(ids(page), vec![3, 4, 5]);
    let tail: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_creator(CREATOR, 4u64, 100u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!(ids(tail), vec![5, 6]);
    let beyond: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_creator(CREATOR, 50u64, 10u64)
        .returns(ReturnsResult)
        .run();
    assert!(ids(beyond).is_empty());

    let fox: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_token(token(FOX), 0u64, 100u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!(ids(fox), vec![1, 2, 3, 4, 5]);
    let egld: MultiValueEncoded<StaticApi, u64> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_token(native(), 0u64, 100u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!(ids(egld), vec![7]);
    let total: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_count()
        .returns(ReturnsResult)
        .run();
    assert_eq!(total, 7);

    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings_by_token(token(FOX), 0u64, 101u64)
        .returns(ExpectError(4, ERR_PAGE_TOO_LARGE))
        .run();
}

#[test]
fn keys_lead_back_to_their_vesting() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    f.create_fox(BOB, 10, linear(T0, T0, 0, T0 + DAY), true);
    let by_claim: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_by_claim_nonce(2u64)
        .returns(ReturnsResult)
        .run();
    let by_cancel: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_by_cancel_nonce(1u64)
        .returns(ReturnsResult)
        .run();
    let unknown: u64 = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting_by_claim_nonce(99u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!((by_claim, by_cancel, unknown), (2, 2, 0));
}

#[test]
fn vested_at_respects_a_cancel() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    let vested_at = |f: &mut Fixture, t: u64| -> BigUint<StaticApi> {
        f.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_vested_at(1u64, t)
            .returns(ReturnsResult)
            .run()
    };
    assert_eq!(vested_at(&mut f, T0 + 700), big(700));
    f.set_time(T0 + 300);
    f.cancel(CREATOR, &[1]);
    assert_eq!(vested_at(&mut f, T0 + 200), big(200));
    assert_eq!(vested_at(&mut f, T0 + 700), big(300));
    let view = f.view(1);
    assert_eq!(view.final_amount, big(300));
    assert_eq!(view.refunded, big(700));
    assert_eq!(view.claimable, big(300));
}

#[test]
fn next_release_and_claimable() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 900, stepped(T0, T0 + 3 * DAY, DAY), true);
    let next = |f: &mut Fixture| -> Option<(u64, BigUint<StaticApi>)> {
        let result: OptionalValue<MultiValue2<u64, BigUint<StaticApi>>> = f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_next_release(1u64)
            .returns(ReturnsResult)
            .run();
        result.into_option().map(|value| value.into_tuple())
    };
    assert_eq!(next(&mut f), Some((T0 + DAY, big(300))));
    f.set_time(T0 + DAY + 5);
    assert_eq!(next(&mut f), Some((T0 + 2 * DAY, big(300))));
    let claimable: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claimable(1u64)
        .returns(ReturnsResult)
        .run();
    assert_eq!(claimable, big(300));
    f.cancel(CREATOR, &[1]);
    assert_eq!(next(&mut f), None);
}

#[test]
fn several_vestings_in_one_call_and_unknown_ids() {
    let mut f = Fixture::new();
    f.create_fox(ALICE, 10, linear(T0, T0, 0, T0 + DAY), false);
    f.create_fox(BOB, 20, linear(T0, T0, 0, T0 + DAY), false);
    let mut asked = MultiValueEncoded::new();
    asked.push(2u64);
    asked.push(1u64);
    let views: MultiValueEncoded<StaticApi, VestingView<StaticApi>> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vestings(asked)
        .returns(ReturnsResult)
        .run();
    let totals: Vec<u64> = views
        .into_iter()
        .map(|view| view.vesting.total.to_u64().unwrap())
        .collect();
    assert_eq!(totals, vec![20, 10]);
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_vesting(3u64)
        .returns(ExpectError(4, ERR_UNKNOWN_VESTING))
        .run();
}

#[test]
fn fee_and_limits_are_readable() {
    let mut f = Fixture::new();
    let max_fee: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_max_fee()
        .returns(ReturnsResult)
        .run();
    assert_eq!(max_fee, big(EGLD));
    let limits: proxy_limits::Limits = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_limits()
        .returns(ReturnsResult)
        .run();
    assert_eq!(limits.max_tranches, 120);
    assert_eq!(limits.max_batch, 100);
    assert_eq!(limits.max_label_len, 64);
    assert_eq!(limits.max_page, 100);
}

mod proxy_limits {
    pub use mvxvest::proxy::Limits;
}
