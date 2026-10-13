//! The claim and cancel keys: one NFT each, minted once per vesting, with a
//! nonce that never changes. The contract never reads their attributes: it
//! finds the vesting from the nonce, in its own storage.

use multiversx_sc::imports::*;

use crate::{
    errors::*,
    storage::{self, KeyDisplay, KeyKind},
};

#[multiversx_sc::module]
pub trait KeysModule: storage::StorageModule {
    fn key_mapper(&self, kind: KeyKind) -> NonFungibleTokenMapper {
        match kind {
            KeyKind::Claim => self.claim_key(),
            KeyKind::Cancel => self.cancel_key(),
        }
    }

    fn require_key_issued(&self, kind: KeyKind) {
        let error = match kind {
            KeyKind::Claim => ERR_CLAIM_KEY_NOT_ISSUED,
            KeyKind::Cancel => ERR_CANCEL_KEY_NOT_ISSUED,
        };
        require!(self.key_mapper(kind).get_token_state().is_set(), error);
    }

    fn key_collection(&self, kind: KeyKind) -> TokenId {
        TokenId::from(self.key_mapper(kind).get_token_id())
    }

    fn key_display_or_default(&self, kind: KeyKind) -> KeyDisplay<Self::Api> {
        let mapper = self.key_display(kind);
        if mapper.is_empty() {
            KeyDisplay {
                uris: ManagedVec::new(),
                metadata: ManagedBuffer::new(),
            }
        } else {
            mapper.get()
        }
    }

    /// Mints one key for vesting `id` and returns its nonce. The key stays in
    /// the contract until the caller sends it on.
    ///
    /// The attributes say whether the vesting can be cancelled
    /// (`cancelable:1` or `cancelable:0`, since version 2): a claim key is
    /// sold as an NFT, and outside this dApp its attributes are all a buyer
    /// sees (red team RT3). The contract itself never reads them.
    fn mint_key(&self, kind: KeyKind, id: u64, token: &TokenId, cancelable: bool) -> u64 {
        let collection = self.key_mapper(kind).get_token_id();
        let display = self.key_display_or_default(kind);
        let name = match kind {
            KeyKind::Claim => sc_format!("Vesting #{} claim key", id),
            KeyKind::Cancel => sc_format!("Vesting #{} cancel key", id),
        };
        let mut attributes = sc_format!(
            "tags:mvxvest,vesting;vesting:{};token:{};cancelable:{}",
            id,
            token,
            if cancelable { 1u8 } else { 0u8 }
        );
        if !display.metadata.is_empty() {
            attributes.append_bytes(b";metadata:");
            attributes.append(&display.metadata);
        }
        let mut uris = display.uris;
        if uris.is_empty() {
            uris.push(ManagedBuffer::new());
        }
        self.send().esdt_nft_create(
            &collection,
            &BigUint::from(1u32),
            &name,
            &BigUint::zero(),
            &ManagedBuffer::new(),
            &attributes,
            &uris,
        )
    }

    /// The vesting opened by a received key, after checking it is a key of
    /// `kind` minted by this contract.
    fn vesting_of_key(&self, kind: KeyKind, payment: &Payment<Self::Api>) -> u64 {
        let wrong_key = match kind {
            KeyKind::Claim => ERR_NOT_CLAIM_KEY,
            KeyKind::Cancel => ERR_NOT_CANCEL_KEY,
        };
        let mapper = self.key_mapper(kind);
        require!(mapper.get_token_state().is_set(), wrong_key);
        require!(
            payment.token_nonce > 0
                && payment.token_identifier.as_managed_buffer()
                    == mapper.get_token_id().as_managed_buffer(),
            wrong_key
        );
        let id = match kind {
            KeyKind::Claim => self.claim_key_vesting(payment.token_nonce).get(),
            KeyKind::Cancel => self.cancel_key_vesting(payment.token_nonce).get(),
        };
        require!(id != 0, ERR_UNKNOWN_KEY);
        id
    }

    fn burn_key(&self, kind: KeyKind, nonce: u64) {
        self.key_mapper(kind).nft_burn(nonce, &BigUint::from(1u32));
    }

    fn key_payment(&self, kind: KeyKind, nonce: u64) -> Payment<Self::Api> {
        Payment::new(self.key_collection(kind), nonce, NonZeroBigUint::one())
    }

    /// Whether the contract itself holds this key (only after a transfer of it
    /// bounced back).
    fn holds_key(&self, kind: KeyKind, nonce: u64) -> bool {
        nonce != 0
            && self.key_mapper(kind).get_token_state().is_set()
            && self.key_mapper(kind).get_balance(nonce) > 0u32
    }
}

/// Adds `amount` of a token to a list of outgoing payments, merging with an
/// entry of the same token and nonce, and skipping zero.
pub fn add_payment<M: ManagedTypeApi>(
    payments: &mut ManagedVec<M, Payment<M>>,
    token: &TokenId<M>,
    nonce: u64,
    amount: &BigUint<M>,
) {
    if *amount == 0u32 {
        return;
    }
    for index in 0..payments.len() {
        let existing = payments.get(index).clone();
        if existing.token_identifier == *token && existing.token_nonce == nonce {
            let merged = existing.amount.as_big_uint() + amount;
            let _ = payments.set(
                index,
                Payment::new(token.clone(), nonce, NonZeroBigUint::new_or_panic(merged)),
            );
            return;
        }
    }
    payments.push(Payment::new(
        token.clone(),
        nonce,
        NonZeroBigUint::new_or_panic(amount.clone()),
    ));
}
