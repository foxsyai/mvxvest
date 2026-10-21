//! Version 3: the owner's switch for the stamping of claim keys, and two
//! views (the fourth audit's SCK-2 and SCM-1). None of them exists in
//! version 2, so this file does not even build there.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

fn key_name(f: &mut Fixture, holder: TestAddress, nonce: u64) -> String {
    let mut name = String::new();
    f.world
        .query()
        .to(SC)
        .whitebox(mvxvest::contract_obj, |sc| {
            let data = sc.blockchain().get_esdt_token_data(
                &ManagedAddress::from(holder.to_address()),
                &EsdtTokenIdentifier::from(CLAIM_KEY.as_str()),
                nonce,
            );
            name = String::from_utf8(data.name.to_boxed_bytes().into_vec()).unwrap();
        });
    name
}

fn stamping(f: &mut Fixture) -> bool {
    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .is_key_stamping()
        .returns(ReturnsResult)
        .run()
}

fn set_stamping(f: &mut Fixture, on: bool) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_stamping(on)
        .run();
}

#[test]
fn stamping_is_on_until_the_owner_turns_it_off() {
    let mut f = Fixture::new();
    assert!(stamping(&mut f));
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);

    set_stamping(&mut f, false);
    assert!(!stamping(&mut f));
    f.set_time(T0 + 300);
    f.claim(CREATOR, &[1]);
    assert_eq!(
        key_name(&mut f, CREATOR, 1),
        format!("Vesting #{id} claim key")
    );
    assert_eq!(f.view(id).claimed, big(300), "the claim itself is the same");

    set_stamping(&mut f, true);
    f.set_time(T0 + 600);
    f.claim(CREATOR, &[1]);
    assert_eq!(
        key_name(&mut f, CREATOR, 1),
        format!("Vesting #{id} claim key, 60% claimed")
    );
    f.check_invariant(Some(FOX));
}

#[test]
fn only_the_owner_sets_the_stamping() {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_stamping(false)
        .returns(ExpectError(4, "Endpoint can only be called by owner"))
        .run();
    assert!(stamping(&mut f));
}

#[test]
fn a_claim_keys_status_is_its_vestings_view() {
    let mut f = Fixture::new();
    let id = f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), true);
    f.set_time(T0 + 400);
    f.claim(CREATOR, &[1]);
    let nonce = f.view(id).vesting.claim_nonce;
    let status: VestingView<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claim_key_status(nonce)
        .returns(ReturnsResult)
        .run();
    let view = f.view(id);
    assert_eq!(status.id, id);
    assert_eq!(status.claimed, view.claimed);
    assert_eq!(status.claimable, view.claimable);
    assert_eq!(status.final_amount, view.final_amount);
    assert_eq!(status.cancelled_at, 0);
    assert!(status.vesting.cancelable);

    f.world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claim_key_status(99u64)
        .returns(ExpectError(4, "unknown vesting"))
        .run();
}

#[test]
fn the_deficit_is_what_the_balance_lacks_of_what_is_owed() {
    let mut f = Fixture::new();
    f.create_fox(CREATOR, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let deficit = |f: &mut Fixture| -> BigUint<StaticApi> {
        f.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_deficit(token(FOX))
            .returns(ReturnsResult)
            .run()
    };
    assert_eq!(deficit(&mut f), big(0));

    // Something left without being booked (no path in the code does this):
    // 30 FOX fewer than owed.
    f.world.set_esdt_balance(SC, FOX.as_bytes(), big(970));
    assert_eq!(deficit(&mut f), big(30));
}
