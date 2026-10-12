//! Events for every change of state, so an indexer can rebuild the full
//! history from logs alone.

use multiversx_sc::{derive_imports::*, imports::*};

use crate::schedule::Schedule;

#[type_abi]
#[derive(TopEncode, TopDecode)]
pub struct CreatedEvent<M: ManagedTypeApi> {
    pub total: BigUint<M>,
    pub schedule: Schedule<M>,
    pub cancelable: bool,
    pub claim_nonce: u64,
    pub cancel_nonce: u64,
    pub label: ManagedBuffer<M>,
}

#[type_abi]
#[derive(TopEncode, TopDecode)]
pub struct ClaimedEvent<M: ManagedTypeApi> {
    /// Paid by this claim.
    pub amount: BigUint<M>,
    /// Paid by every claim so far, this one included.
    pub claimed_total: BigUint<M>,
    /// The claim key was burned: nothing more can ever be claimed.
    pub finished: bool,
}

#[type_abi]
#[derive(TopEncode, TopDecode)]
pub struct CancelledEvent<M: ManagedTypeApi> {
    /// Paid back to the caller: the part not vested at the cancel.
    pub refund: BigUint<M>,
    /// Vested at the cancel; stays claimable with the claim key.
    pub vested: BigUint<M>,
}

#[multiversx_sc::module]
pub trait EventsModule {
    #[event("vestingCreated")]
    fn vesting_created_event(
        &self,
        #[indexed] id: u64,
        #[indexed] creator: &ManagedAddress,
        #[indexed] beneficiary: &ManagedAddress,
        #[indexed] token: &TokenId,
        data: &CreatedEvent<Self::Api>,
    );

    #[event("vestingClaimed")]
    fn vesting_claimed_event(
        &self,
        #[indexed] id: u64,
        #[indexed] caller: &ManagedAddress,
        #[indexed] token: &TokenId,
        data: &ClaimedEvent<Self::Api>,
    );

    #[event("vestingCancelled")]
    fn vesting_cancelled_event(
        &self,
        #[indexed] id: u64,
        #[indexed] caller: &ManagedAddress,
        #[indexed] token: &TokenId,
        data: &CancelledEvent<Self::Api>,
    );

    #[event("feeSet")]
    fn fee_set_event(&self, #[indexed] fee_per_vesting: &BigUint);

    #[event("creationPaused")]
    fn creation_paused_event(&self, #[indexed] paused: bool);

    #[event("feesClaimed")]
    fn fees_claimed_event(&self, #[indexed] to: &ManagedAddress, amount: &BigUint);

    #[event("keysRecovered")]
    fn keys_recovered_event(
        &self,
        #[indexed] id: u64,
        #[indexed] caller: &ManagedAddress,
        #[indexed] to: &ManagedAddress,
    );

    #[event("surplusRecovered")]
    fn surplus_recovered_event(
        &self,
        #[indexed] token: &TokenId,
        #[indexed] to: &ManagedAddress,
        amount: &BigUint,
    );
}
