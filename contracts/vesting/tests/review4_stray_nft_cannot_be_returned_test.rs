//! Review 4 (info, docs): an NFT, SFT or Meta ESDT that is not a key and
//! reaches the contract outside an endpoint (possible only if the contract was
//! mistakenly deployed payable) cannot be returned by anyone: `recoverSurplus`
//! reads the balance at nonce 0 only. The spec said otherwise; it now states
//! this limitation, and this test pins it. Deploying non-payable prevents it.
//!
//! The arrival is simulated like the other bounce tests: a whitebox call that
//! carries the token and runs nothing.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::ERR_NO_SURPLUS;

#[test]
fn a_stray_nft_that_is_not_a_key_cannot_be_returned() {
    let mut f = Fixture::new();
    let mut nft = ManagedVec::<StaticApi, Payment<StaticApi>>::new();
    nft.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .payment(nft)
        .whitebox(mvxvest::contract_obj, |_| {});
    f.world.check_account(SC).esdt_nft_balance_and_attributes(
        OTHER_NFT,
        1,
        1,
        ManagedBuffer::<StaticApi>::new(),
    );
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(OTHER_NFT), CREATOR)
        .returns(ExpectError(4, ERR_NO_SURPLUS))
        .run();
}
