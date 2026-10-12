//! Read-only views. The dApp reads everything through them; no indexer is
//! needed.

use multiversx_sc::{derive_imports::*, imports::*};

use crate::{
    admin::MAX_FEE_PER_VESTING,
    claim,
    create::{MAX_BATCH, MAX_HORIZON, MAX_LABEL_LEN},
    errors::*,
    events, keys,
    schedule::MAX_TRANCHES,
    storage::{self, KeyKind, TokenTotals, Vesting},
};

/// Most ids or vestings one paged view returns.
pub const MAX_PAGE: u64 = 100;

/// A vesting with its live state, as of `timestamp`.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode)]
pub struct VestingView<M: ManagedTypeApi> {
    pub id: u64,
    pub vesting: Vesting<M>,
    pub claimed: BigUint<M>,
    /// 0 unless cancelled.
    pub cancelled_at: u64,
    /// Vested at `timestamp` (frozen at the cancel, if any).
    pub vested: BigUint<M>,
    /// Claimable now: vested minus claimed.
    pub claimable: BigUint<M>,
    /// The most the claim key can ever collect: the total, or what had vested
    /// at the cancel.
    pub final_amount: BigUint<M>,
    /// Paid back to whoever cancelled (0 unless cancelled).
    pub refunded: BigUint<M>,
    /// The block timestamp these figures are computed at.
    pub timestamp: u64,
}

/// The contract's fixed limits, so the dApp never hard-codes them.
#[type_abi]
#[derive(TopEncode, TopDecode)]
pub struct Limits {
    pub max_tranches: u64,
    pub max_batch: u64,
    pub max_label_len: u64,
    pub max_horizon: u64,
    pub max_page: u64,
}

#[multiversx_sc::module]
pub trait ViewsModule:
    storage::StorageModule + events::EventsModule + keys::KeysModule + claim::ClaimModule
{
    #[view(getVesting)]
    fn get_vesting(&self, id: u64) -> VestingView<Self::Api> {
        self.vesting_view(id)
    }

    /// Several vestings in one call, in the order asked.
    #[view(getVestings)]
    fn get_vestings(
        &self,
        ids: MultiValueEncoded<u64>,
    ) -> MultiValueEncoded<VestingView<Self::Api>> {
        require!(ids.len() as u64 <= MAX_PAGE, ERR_PAGE_TOO_LARGE);
        let mut views = MultiValueEncoded::new();
        for id in ids.into_iter() {
            views.push(self.vesting_view(id));
        }
        views
    }

    #[view(getClaimable)]
    fn get_claimable(&self, id: u64) -> BigUint {
        self.vesting_view(id).claimable
    }

    /// Vested at any second, past or future, taking a cancel into account.
    #[view(getVestedAt)]
    fn get_vested_at(&self, id: u64, timestamp: u64) -> BigUint {
        let vesting = self.existing_vesting(id);
        self.vested_with_cancel(&vesting, self.cancelled_at(id).get(), timestamp)
    }

    /// The next moment the vested amount grows, and by how much. Empty when
    /// nothing more will vest: everything has vested, or it was cancelled.
    #[view(getNextRelease)]
    fn get_next_release(&self, id: u64) -> OptionalValue<MultiValue2<u64, BigUint>> {
        let vesting = self.existing_vesting(id);
        if self.cancelled_at(id).get() != 0 {
            return OptionalValue::None;
        }
        match vesting.schedule.next_release(&vesting.total, self.now()) {
            Some((at, amount)) => OptionalValue::Some((at, amount).into()),
            None => OptionalValue::None,
        }
    }

    /// The vesting a claim key opens; 0 if no key with this nonce was ever
    /// minted. The answer stays after the key is burned, for history.
    #[view(getVestingByClaimNonce)]
    fn get_vesting_by_claim_nonce(&self, nonce: u64) -> u64 {
        self.claim_key_vesting(nonce).get()
    }

    /// The vesting a cancel key stops; 0 if no key with this nonce was ever
    /// minted. The answer stays after the key is burned.
    #[view(getVestingByCancelNonce)]
    fn get_vesting_by_cancel_nonce(&self, nonce: u64) -> u64 {
        self.cancel_key_vesting(nonce).get()
    }

    #[view(getVestingCountByCreator)]
    fn get_vesting_count_by_creator(&self, creator: ManagedAddress) -> u64 {
        self.creator_vestings(&creator).len() as u64
    }

    /// Ids of the vestings `creator` created, oldest first, `count` of them
    /// from position `from` (0-based).
    #[view(getVestingsByCreator)]
    fn get_vestings_by_creator(
        &self,
        creator: ManagedAddress,
        from: u64,
        count: u64,
    ) -> MultiValueEncoded<u64> {
        self.page(&self.creator_vestings(&creator), from, count)
    }

    #[view(getVestingCountByToken)]
    fn get_vesting_count_by_token(&self, token: TokenId) -> u64 {
        self.token_vestings(&token).len() as u64
    }

    /// Ids of the vestings of `token`, oldest first, paged like
    /// `getVestingsByCreator`.
    #[view(getVestingsByToken)]
    fn get_vestings_by_token(
        &self,
        token: TokenId,
        from: u64,
        count: u64,
    ) -> MultiValueEncoded<u64> {
        self.page(&self.token_vestings(&token), from, count)
    }

    /// Deposited, claimed and refunded so far for `token`.
    #[view(getTokenTotals)]
    fn get_token_totals(&self, token: TokenId) -> TokenTotals<Self::Api> {
        self.totals_of(&token)
    }

    /// How many vestings exist; ids run from 1 to this number.
    #[view(getVestingCount)]
    fn get_vesting_count(&self) -> u64 {
        self.last_vesting_id().get()
    }

    #[view(getFee)]
    fn get_fee(&self) -> BigUint {
        self.fee_per_vesting().get()
    }

    #[view(getMaxFee)]
    fn get_max_fee(&self) -> BigUint {
        BigUint::from(MAX_FEE_PER_VESTING)
    }

    #[view(getFeesAccrued)]
    fn get_fees_accrued(&self) -> BigUint {
        self.fees_accrued().get()
    }

    #[view(isCreationPaused)]
    fn is_creation_paused(&self) -> bool {
        self.creation_paused().get()
    }

    /// The claim key collection, empty until issued.
    #[view(getClaimKeyCollection)]
    fn get_claim_key_collection(&self) -> ManagedBuffer {
        self.collection_or_empty(KeyKind::Claim)
    }

    /// The cancel key collection, empty until issued.
    #[view(getCancelKeyCollection)]
    fn get_cancel_key_collection(&self) -> ManagedBuffer {
        self.collection_or_empty(KeyKind::Cancel)
    }

    fn collection_or_empty(&self, kind: KeyKind) -> ManagedBuffer {
        let mapper = self.key_mapper(kind);
        if mapper.get_token_state().is_set() {
            mapper.get_token_id().into_managed_buffer()
        } else {
            ManagedBuffer::new()
        }
    }

    /// What the contract holds of `token` beyond what it owes; 0 normally.
    #[view(getSurplus)]
    fn get_surplus(&self, token: TokenId) -> BigUint {
        self.surplus(&token)
    }

    #[view(getLimits)]
    fn get_limits(&self) -> Limits {
        Limits {
            max_tranches: MAX_TRANCHES as u64,
            max_batch: MAX_BATCH as u64,
            max_label_len: MAX_LABEL_LEN as u64,
            max_horizon: MAX_HORIZON,
            max_page: MAX_PAGE,
        }
    }

    fn existing_vesting(&self, id: u64) -> Vesting<Self::Api> {
        let mapper = self.vesting(id);
        require!(!mapper.is_empty(), ERR_UNKNOWN_VESTING);
        mapper.get()
    }

    fn vesting_view(&self, id: u64) -> VestingView<Self::Api> {
        let vesting = self.existing_vesting(id);
        let now = self.now();
        let cancelled_at = self.cancelled_at(id).get();
        let claimed = self.claimed(id).get();
        let vested = self.vested_with_cancel(&vesting, cancelled_at, now);
        let claimable = &vested - &claimed;
        let final_amount = self.final_amount(&vesting, cancelled_at);
        let refunded = &vesting.total - &final_amount;
        VestingView {
            id,
            vesting,
            claimed,
            cancelled_at,
            vested,
            claimable,
            final_amount,
            refunded,
            timestamp: now,
        }
    }

    fn page(&self, list: &VecMapper<u64>, from: u64, count: u64) -> MultiValueEncoded<u64> {
        require!(count <= MAX_PAGE, ERR_PAGE_TOO_LARGE);
        let mut ids = MultiValueEncoded::new();
        let len = list.len() as u64;
        let end = core::cmp::min(len, from.saturating_add(count));
        let mut position = from;
        while position < end {
            // VecMapper is 1-based.
            ids.push(list.get((position + 1) as usize));
            position += 1;
        }
        ids
    }
}
