//! The claim and cancel keys: one NFT each, minted once per vesting, with a
//! nonce that never changes. The contract never reads their attributes: it
//! finds the vesting from the nonce, in its own storage. Since version 3 a
//! claim key's name and attributes also say what its claims have paid.

use multiversx_sc::imports::*;

use crate::{
    errors::*,
    storage::{self, KeyDisplay, KeyKind, Vesting},
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

    /// A claim key's name: its vesting, and whether it can be cancelled.
    /// Marketplaces show the name, not the attributes (fourth audit, SCK-2;
    /// version 3).
    fn claim_key_name(&self, id: u64, cancelable: bool) -> ManagedBuffer {
        if cancelable {
            sc_format!("Vesting #{} claim key, cancelable", id)
        } else {
            sc_format!("Vesting #{} claim key", id)
        }
    }

    /// A key's attributes. They say whether the vesting can be cancelled
    /// (`cancelable:1` or `cancelable:0`, since version 2): a claim key is
    /// sold as an NFT, and outside this dApp its attributes are all a buyer
    /// sees (red team RT3). A claim key returned by `claim` also says what
    /// its claims have paid (`claimed:<units>`, since version 3). `metadata`
    /// is the display's, for a key of its kind. The contract itself never
    /// reads them.
    fn key_attributes(
        &self,
        id: u64,
        token: &TokenId,
        cancelable: bool,
        claimed: Option<&BigUint>,
        metadata: &ManagedBuffer,
    ) -> ManagedBuffer {
        let mut attributes = sc_format!(
            "tags:mvxvest,vesting;vesting:{};token:{};cancelable:{}",
            id,
            token,
            if cancelable { 1u8 } else { 0u8 }
        );
        if let Some(claimed) = claimed {
            attributes.append(&sc_format!(";claimed:{}", claimed));
        }
        if !metadata.is_empty() {
            attributes.append_bytes(b";metadata:");
            attributes.append(metadata);
        }
        attributes
    }

    /// Mints one key for vesting `id` and returns its nonce. The key stays in
    /// the contract until the caller sends it on.
    fn mint_key(&self, kind: KeyKind, id: u64, token: &TokenId, cancelable: bool) -> u64 {
        let collection = self.key_mapper(kind).get_token_id();
        let display = self.key_display_or_default(kind);
        let name = match kind {
            KeyKind::Claim => self.claim_key_name(id, cancelable),
            KeyKind::Cancel => sc_format!("Vesting #{} cancel key", id),
        };
        let attributes = self.key_attributes(id, token, cancelable, None, &display.metadata);
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

    /// Rewrites the claim key `nonce` of vesting `id` while `claim` holds it,
    /// before it goes back: its name and attributes say what has been claimed
    /// so far (fourth audit, SCK-1; version 3). A key sold afterwards shows
    /// it wherever the NFT is shown. The protocol lets only the holder change
    /// a non-dynamic NFT, so a cancel cannot be written here; a claim after a
    /// cancel always finishes and burns the key.
    ///
    /// `ESDTMetaDataUpdate` changes the name and the attributes and keeps
    /// what it is given empty; it takes at least one URI, so the key's own
    /// URIs are passed back unchanged. The key keeps the `metadata` part it
    /// was minted with, like its URIs: `setKeyDisplay` changes only keys
    /// minted afterwards (version 3's audit, V3C-1).
    fn stamp_claim_key(
        &self,
        nonce: u64,
        id: u64,
        vesting: &Vesting<Self::Api>,
        claimed: &BigUint,
    ) {
        let collection = self.claim_key().get_token_id();
        let mut name = self.claim_key_name(id, vesting.cancelable);
        let percent = (claimed * 100u32 / &vesting.total).to_u64().unwrap_or(0);
        if percent == 0 {
            name.append_bytes(b", under 1% claimed");
        } else {
            name.append(&sc_format!(", {}% claimed", percent));
        }
        let key = self.blockchain().get_esdt_token_data(
            &self.blockchain().get_sc_address(),
            &collection,
            nonce,
        );
        let attributes = self.key_attributes(
            id,
            &vesting.token,
            vesting.cancelable,
            Some(claimed),
            &minted_metadata(&key.attributes),
        );
        let mut uris = key.uris;
        if uris.is_empty() {
            uris.push(ManagedBuffer::new());
        }
        self.send().esdt_metadata_update(
            collection,
            nonce,
            name,
            0,
            ManagedBuffer::new(),
            &attributes,
            uris,
        );
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

/// The `metadata` part of a key's attributes, empty when it has none. The
/// contract writes it last, after `tags`, `vesting`, `token`, `cancelable`
/// and `claimed`, none of which can contain `;metadata:` (numbers and a
/// token identifier), so its first occurrence starts it; that prefix is at
/// most about 180 bytes, so only the first 256 are searched.
pub fn minted_metadata<M: ManagedTypeApi>(attributes: &ManagedBuffer<M>) -> ManagedBuffer<M> {
    const MARK: &[u8] = b";metadata:";
    let mut head = [0u8; 256];
    let searched = attributes.len().min(head.len());
    attributes.load_slice(0, &mut head[..searched]);
    match head[..searched]
        .windows(MARK.len())
        .position(|window| window == MARK)
    {
        Some(at) => {
            let start = at + MARK.len();
            attributes
                .copy_slice(start, attributes.len() - start)
                .unwrap_or_default()
        }
        None => ManagedBuffer::new(),
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
