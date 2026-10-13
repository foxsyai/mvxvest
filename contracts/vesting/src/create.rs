//! Creating vestings: one (`create`) or many in one transaction
//! (`createBatch`). The creator pays the totals plus the fees; each
//! beneficiary receives a claim key; a cancelable vesting also gives the
//! creator a cancel key.
//!
//! Two fees, both set by the owner under hard caps, both 0 until set:
//! - the EGLD fee, a flat amount per vesting (`setFee`), collected with
//!   `claimFees`;
//! - the token fee, a share of each vesting's total in its own token
//!   (`setTokenFee`), paid on top of the total and sent to the owner at once.
//!
//! The beneficiary always receives exactly the total.

use multiversx_sc::{derive_imports::*, imports::*};

use crate::{
    admin::BPS,
    errors::*,
    events::{self, CreatedEvent},
    keys,
    schedule::Schedule,
    storage::{self, KeyKind, Vesting},
};

/// Most vestings one `createBatch` may create. The network allows 100
/// built-in calls (NFT mints and transfers) per transaction: a vesting needs
/// two (mint and send its claim key), and the token fee one transfer, so 49
/// fit (50 did before the token fee; measured on devnet, docs/MEASUREMENTS.md).
/// The dApp reads this from `getLimits` and splits a CSV into several
/// transactions.
pub const MAX_BATCH: usize = 49;
/// The same for cancelable vestings, which also mint a cancel key: three
/// calls each, plus one transfer of all cancel keys and one of the token fee,
/// so 32 fit.
pub const MAX_BATCH_CANCELABLE: usize = 32;
/// Longest label, in bytes.
pub const MAX_LABEL_LEN: usize = 64;
/// A schedule must end within this many seconds of its creation (30 years),
/// so a typo cannot lock funds for centuries.
pub const MAX_HORIZON: u64 = 30 * 365 * 24 * 60 * 60;

/// One line of a batch: beneficiary, total, schedule.
pub type BatchEntry<M> = MultiValue3<ManagedAddress<M>, BigUint<M>, Schedule<M>>;

/// A claim key minted and waiting to be sent to its beneficiary.
#[derive(ManagedVecItem, Clone)]
pub struct KeyDelivery<M: ManagedTypeApi> {
    pub to: ManagedAddress<M>,
    pub nonce: u64,
}

#[multiversx_sc::module]
pub trait CreateModule: storage::StorageModule + events::EventsModule + keys::KeysModule {
    /// Creates one vesting of `total` for `beneficiary`, and returns its id.
    ///
    /// Pay exactly `total` plus the token fee (`getTokenFee`) of the vested
    /// token, and the EGLD fee (`getFee`) in EGLD. For an EGLD vesting, pay
    /// all three in EGLD. The total is explicit so that a fee change between
    /// preview and signing makes the transaction fail instead of changing the
    /// vesting.
    #[payable]
    #[endpoint(create)]
    fn create(
        &self,
        beneficiary: ManagedAddress,
        total: BigUint,
        schedule: Schedule<Self::Api>,
        cancelable: bool,
        label: ManagedBuffer,
    ) -> u64 {
        let (token, token_amount, egld_amount) = self.received_payments();
        let mut claim_keys = ManagedVec::new();
        let mut cancel_keys = ManagedVec::new();
        let id = self.create_one(
            &token,
            beneficiary,
            total.clone(),
            schedule,
            cancelable,
            &label,
            &mut claim_keys,
            &mut cancel_keys,
        );
        let token_fee = self.token_fee_of(&total);
        self.settle_payment(&token, &token_amount, &egld_amount, 1, &total, &token_fee);
        self.deliver_keys(claim_keys, cancel_keys);
        self.pay_token_fee(&token, token_fee);
        id
    }

    /// Creates one vesting per entry, all of the same token, the same
    /// cancelability and the same label. Pay the sum of the totals plus the
    /// token fee of each vesting, and the EGLD fee for each vesting. Returns
    /// the ids, in the order of the entries.
    #[payable]
    #[endpoint(createBatch)]
    fn create_batch(
        &self,
        cancelable: bool,
        label: ManagedBuffer,
        entries: MultiValueEncoded<BatchEntry<Self::Api>>,
    ) -> MultiValueEncoded<u64> {
        let count = entries.len();
        let max = if cancelable {
            MAX_BATCH_CANCELABLE
        } else {
            MAX_BATCH
        };
        require!((1..=max).contains(&count), ERR_BATCH_SIZE);
        let (token, token_amount, egld_amount) = self.received_payments();
        let mut ids = MultiValueEncoded::new();
        let mut sum = BigUint::zero();
        let mut token_fee = BigUint::zero();
        let mut claim_keys = ManagedVec::new();
        let mut cancel_keys = ManagedVec::new();
        for entry in entries.into_iter() {
            let (beneficiary, total, schedule) = entry.into_tuple();
            sum += &total;
            // Per vesting, so a batch pays what the same vestings created
            // one by one would.
            token_fee += self.token_fee_of(&total);
            ids.push(self.create_one(
                &token,
                beneficiary,
                total,
                schedule,
                cancelable,
                &label,
                &mut claim_keys,
                &mut cancel_keys,
            ));
        }
        self.settle_payment(&token, &token_amount, &egld_amount, count, &sum, &token_fee);
        self.deliver_keys(claim_keys, cancel_keys);
        self.pay_token_fee(&token, token_fee);
        ids
    }

    /// The token fee of one vesting of `total`, rounded down.
    fn token_fee_of(&self, total: &BigUint) -> BigUint {
        let bps = self.token_fee_bps().get();
        if bps == 0 {
            return BigUint::zero();
        }
        total * bps / BPS
    }

    /// Sends the token fee of this creation to the owner, with an event.
    /// Nothing is booked: the fee never belongs to a vesting.
    fn pay_token_fee(&self, token: &TokenId, fee: BigUint) {
        if fee == 0u32 {
            return;
        }
        let owner = self.blockchain().get_owner_address();
        self.token_fee_paid_event(token, &owner, &fee);
        self.tx()
            .to(&owner)
            .payment(Payment::new(
                token.clone(),
                0,
                NonZeroBigUint::new_or_panic(fee),
            ))
            .transfer();
    }

    /// Sums what the call carries: the one vested token (EGLD when no ESDT
    /// was sent) and the EGLD that came with it.
    fn received_payments(&self) -> (TokenId, BigUint, BigUint) {
        require!(!self.creation_paused().get(), ERR_CREATION_PAUSED);
        self.require_key_issued(KeyKind::Claim);
        let payments = self.call_value().all();
        require!(!payments.is_empty(), ERR_NO_PAYMENT);
        let mut esdt: Option<TokenId> = None;
        let mut token_amount = BigUint::zero();
        let mut egld_amount = BigUint::zero();
        for payment in payments.iter() {
            require!(payment.token_nonce == 0, ERR_NOT_FUNGIBLE);
            if payment.token_identifier.is_native() {
                egld_amount += payment.amount.as_big_uint();
                continue;
            }
            match &esdt {
                None => esdt = Some(payment.token_identifier.clone()),
                Some(token) => require!(*token == payment.token_identifier, ERR_ONE_TOKEN),
            }
            token_amount += payment.amount.as_big_uint();
        }
        match esdt {
            Some(token) => (token, token_amount, egld_amount),
            None => (TokenId::native(), BigUint::zero(), egld_amount),
        }
    }

    /// Checks the payment covers exactly `sum` plus `token_fee` and the EGLD
    /// fee for `count` vestings, then books the deposit and the EGLD fee.
    fn settle_payment(
        &self,
        token: &TokenId,
        token_amount: &BigUint,
        egld_amount: &BigUint,
        count: usize,
        sum: &BigUint,
        token_fee: &BigUint,
    ) {
        let fees = self.fee_per_vesting().get() * count as u64;
        if token.is_native() {
            require!(*egld_amount == sum + token_fee + &fees, ERR_WRONG_DEPOSIT);
        } else {
            require!(*token_amount == sum + token_fee, ERR_WRONG_DEPOSIT);
            require!(*egld_amount == fees, ERR_WRONG_FEE);
        }
        if fees > 0u32 {
            self.fees_accrued().update(|accrued| *accrued += &fees);
        }
        self.update_totals(token, |totals| totals.deposited += sum);
    }

    /// Validates and stores one vesting, mints its keys and queues them: the
    /// claim key for the beneficiary, the cancel key for the creator.
    #[allow(clippy::too_many_arguments)]
    fn create_one(
        &self,
        token: &TokenId,
        beneficiary: ManagedAddress,
        total: BigUint,
        schedule: Schedule<Self::Api>,
        cancelable: bool,
        label: &ManagedBuffer,
        claim_keys: &mut ManagedVec<KeyDelivery<Self::Api>>,
        cancel_keys: &mut ManagedVec<Payment<Self::Api>>,
    ) -> u64 {
        let creator = self.blockchain().get_caller();
        let now = self
            .blockchain()
            .get_block_timestamp_seconds()
            .as_u64_seconds();
        require!(
            !beneficiary.is_zero() && beneficiary != self.blockchain().get_sc_address(),
            ERR_BAD_BENEFICIARY
        );
        require!(label.len() <= MAX_LABEL_LEN, ERR_LABEL_TOO_LONG);
        if let Err(error) = schedule.validate(&total) {
            sc_panic!(error);
        }
        require!(schedule.end <= now.saturating_add(MAX_HORIZON), ERR_TOO_FAR);
        if cancelable {
            self.require_key_issued(KeyKind::Cancel);
        }

        let id = self.last_vesting_id().update(|last| {
            *last += 1;
            *last
        });
        let claim_nonce = self.mint_key(KeyKind::Claim, id, token, cancelable);
        let cancel_nonce = if cancelable {
            self.mint_key(KeyKind::Cancel, id, token, true)
        } else {
            0
        };

        self.claim_key_vesting(claim_nonce).set(id);
        if cancelable {
            self.cancel_key_vesting(cancel_nonce).set(id);
        }
        self.creator_vestings(&creator).push(&id);
        self.token_vestings(token).push(&id);
        self.vesting_created_event(
            id,
            &creator,
            &beneficiary,
            token,
            &CreatedEvent {
                total: total.clone(),
                schedule: schedule.clone(),
                cancelable,
                claim_nonce,
                cancel_nonce,
                label: label.clone(),
            },
        );
        self.vesting(id).set(Vesting {
            creator,
            beneficiary: beneficiary.clone(),
            token: token.clone(),
            total,
            schedule,
            cancelable,
            created_at: now,
            claim_nonce,
            cancel_nonce,
            label: label.clone(),
        });

        claim_keys.push(KeyDelivery {
            to: beneficiary,
            nonce: claim_nonce,
        });
        if cancelable {
            // Every cancel nonce is new: push, no merge needed.
            cancel_keys.push(self.key_payment(KeyKind::Cancel, cancel_nonce));
        }
        id
    }

    /// Sends the minted keys, once all storage is written. The transfers
    /// carry no function call, so no code runs on the receiving side.
    fn deliver_keys(
        &self,
        claim_keys: ManagedVec<KeyDelivery<Self::Api>>,
        cancel_keys: ManagedVec<Payment<Self::Api>>,
    ) {
        for delivery in claim_keys.iter() {
            self.tx()
                .to(&delivery.to)
                .payment(self.key_payment(KeyKind::Claim, delivery.nonce))
                .transfer();
        }
        let creator = self.blockchain().get_caller();
        self.tx()
            .to(&creator)
            .payment(cancel_keys)
            .transfer_if_not_empty();
    }
}
