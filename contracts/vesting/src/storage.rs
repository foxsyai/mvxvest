//! Storage and the types kept in it.
//!
//! A vesting is written once at creation (`vesting`) and never changes. What
//! changes lives in separate entries (`claimed`, `cancelledAt`), so a claim
//! rewrites one number, and the keys keep the same nonce for their whole life.

use multiversx_sc::{derive_imports::*, imports::*};

use crate::schedule::Schedule;

/// What never changes about a vesting.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone)]
pub struct Vesting<M: ManagedTypeApi> {
    /// Who created it (the caller of `create` or `createBatch`). Gets the
    /// cancel key, and the refund if it cancels.
    pub creator: ManagedAddress<M>,
    /// The beneficiary at creation. The claim key may have moved since: only
    /// its holder can claim.
    pub beneficiary: ManagedAddress<M>,
    /// The vested token: `EGLD-000000` or a fungible ESDT.
    pub token: TokenId<M>,
    pub total: BigUint<M>,
    pub schedule: Schedule<M>,
    pub cancelable: bool,
    pub created_at: u64,
    /// Nonce of the claim key in the claim key collection.
    pub claim_nonce: u64,
    /// Nonce of the cancel key, 0 when the vesting cannot be cancelled.
    pub cancel_nonce: u64,
    pub label: ManagedBuffer<M>,
}

/// Running totals per token, so the contract can always show what it owes.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone)]
pub struct TokenTotals<M: ManagedTypeApi> {
    pub deposited: BigUint<M>,
    pub claimed: BigUint<M>,
    pub refunded: BigUint<M>,
}

impl<M: ManagedTypeApi> TokenTotals<M> {
    pub fn zero() -> Self {
        TokenTotals {
            deposited: BigUint::zero(),
            claimed: BigUint::zero(),
            refunded: BigUint::zero(),
        }
    }

    /// Still locked or claimable: deposited, minus paid out.
    pub fn owed(&self) -> BigUint<M> {
        &self.deposited - &self.claimed - &self.refunded
    }
}

/// The two kinds of key the contract mints.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone, Copy, PartialEq, Eq)]
pub enum KeyKind {
    Claim,
    Cancel,
}

/// How newly minted keys of one kind look in wallets and explorers.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone)]
pub struct KeyDisplay<M: ManagedTypeApi> {
    /// Media URIs of the NFT (the image first).
    pub uris: ManagedVec<M, ManagedBuffer<M>>,
    /// Added to the attributes as `metadata:<value>`, e.g. an IPFS CID of a
    /// JSON description. Empty for none.
    pub metadata: ManagedBuffer<M>,
}

#[multiversx_sc::module]
pub trait StorageModule {
    #[storage_mapper("lastVestingId")]
    fn last_vesting_id(&self) -> SingleValueMapper<u64>;

    #[storage_mapper("vesting")]
    fn vesting(&self, id: u64) -> SingleValueMapper<Vesting<Self::Api>>;

    #[storage_mapper("claimed")]
    fn claimed(&self, id: u64) -> SingleValueMapper<BigUint>;

    /// 0 while the vesting runs; the second it was cancelled otherwise.
    #[storage_mapper("cancelledAt")]
    fn cancelled_at(&self, id: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("claimKeyVesting")]
    fn claim_key_vesting(&self, nonce: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("cancelKeyVesting")]
    fn cancel_key_vesting(&self, nonce: u64) -> SingleValueMapper<u64>;

    #[storage_mapper("creatorVestings")]
    fn creator_vestings(&self, creator: &ManagedAddress) -> VecMapper<u64>;

    #[storage_mapper("tokenVestings")]
    fn token_vestings(&self, token: &TokenId) -> VecMapper<u64>;

    #[storage_mapper("tokenTotals")]
    fn token_totals(&self, token: &TokenId) -> SingleValueMapper<TokenTotals<Self::Api>>;

    #[storage_mapper("claimKey")]
    fn claim_key(&self) -> NonFungibleTokenMapper;

    #[storage_mapper("cancelKey")]
    fn cancel_key(&self) -> NonFungibleTokenMapper;

    #[storage_mapper("keyDisplay")]
    fn key_display(&self, kind: KeyKind) -> SingleValueMapper<KeyDisplay<Self::Api>>;

    /// EGLD charged per vesting created, on top of the deposit.
    #[storage_mapper("feePerVesting")]
    fn fee_per_vesting(&self) -> SingleValueMapper<BigUint>;

    /// EGLD fees received and not yet claimed by the owner.
    #[storage_mapper("feesAccrued")]
    fn fees_accrued(&self) -> SingleValueMapper<BigUint>;

    #[storage_mapper("creationPaused")]
    fn creation_paused(&self) -> SingleValueMapper<bool>;

    /// The totals of `token`, all zero before its first vesting. (An empty
    /// entry does not decode as a struct, so never `get` it directly.)
    fn totals_of(&self, token: &TokenId) -> TokenTotals<Self::Api> {
        let mapper = self.token_totals(token);
        if mapper.is_empty() {
            TokenTotals::zero()
        } else {
            mapper.get()
        }
    }

    fn update_totals<F: FnOnce(&mut TokenTotals<Self::Api>)>(&self, token: &TokenId, change: F) {
        let mut totals = self.totals_of(token);
        change(&mut totals);
        self.token_totals(token).set(totals);
    }
}
