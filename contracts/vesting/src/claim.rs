//! Claiming with claim keys, cancelling with cancel keys, and recovering keys
//! or funds that bounced back to the contract.

use multiversx_sc::imports::*;

use crate::{
    errors::*,
    events::{self, CancelledEvent, ClaimedEvent},
    keys::{self, add_payment},
    storage::{self, KeyKind, Vesting},
};

#[multiversx_sc::module]
pub trait ClaimModule: storage::StorageModule + events::EventsModule + keys::KeysModule {
    /// Send one or more claim keys. Pays everything vested and not yet claimed
    /// on each, in one transfer back with the keys. A key whose vesting can
    /// pay nothing more is burned instead of returned. Fails when no key paid
    /// anything or was burned.
    #[payable]
    #[endpoint(claim)]
    fn claim(&self) {
        let payments = self.call_value().all();
        require!(!payments.is_empty(), ERR_NOT_CLAIM_KEY);
        let caller = self.blockchain().get_caller();
        let now = self.now();
        let mut outgoing = ManagedVec::new();
        let mut progressed = false;
        for payment in payments.iter() {
            let id = self.vesting_of_key(KeyKind::Claim, &payment);
            if !self.claim_key_used(id).get() {
                self.claim_key_used(id).set(true);
            }
            let vesting = self.vesting(id).get();
            let cancelled_at = self.cancelled_at(id).get();
            let vested = self.vested_with_cancel(&vesting, cancelled_at, now);
            let claimed_before = self.claimed(id).get();
            let amount = &vested - &claimed_before;
            let claimed_total = &claimed_before + &amount;
            let finished = claimed_total == self.final_amount(&vesting, cancelled_at);

            if amount > 0u32 {
                self.claimed(id).set(&claimed_total);
                self.update_totals(&vesting.token, |totals| totals.claimed += &amount);
                add_payment(&mut outgoing, &vesting.token, 0, &amount);
            }
            if finished {
                self.burn_key(KeyKind::Claim, payment.token_nonce);
            } else {
                outgoing.push(payment.clone());
            }
            progressed |= amount > 0u32 || finished;
            // One event per key sent, also when it paid nothing, so the logs
            // show every key that reached a holder (`claimKeyUsed`).
            self.vesting_claimed_event(
                id,
                &caller,
                &vesting.token,
                &ClaimedEvent {
                    amount,
                    claimed_total,
                    finished,
                },
            );
        }
        require!(progressed, ERR_NOTHING_TO_CLAIM);
        self.tx()
            .to(&caller)
            .payment(outgoing)
            .transfer_if_not_empty();
    }

    /// Send one or more cancel keys. Each vesting stops now: what has vested
    /// stays claimable with its claim key, the rest is paid to the caller. The
    /// cancel keys are burned.
    #[payable]
    #[endpoint(cancel)]
    fn cancel(&self) {
        let payments = self.call_value().all();
        require!(!payments.is_empty(), ERR_NOT_CANCEL_KEY);
        let caller = self.blockchain().get_caller();
        let now = self.now();
        let mut refunds = ManagedVec::new();
        for payment in payments.iter() {
            let id = self.vesting_of_key(KeyKind::Cancel, &payment);
            require!(self.cancelled_at(id).get() == 0, ERR_ALREADY_CANCELLED);
            let vesting = self.vesting(id).get();
            let vested = vesting.schedule.vested_at(&vesting.total, now);
            let refund = &vesting.total - &vested;

            self.cancelled_at(id).set(now);
            if refund > 0u32 {
                self.update_totals(&vesting.token, |totals| totals.refunded += &refund);
                add_payment(&mut refunds, &vesting.token, 0, &refund);
            }
            self.burn_key(KeyKind::Cancel, payment.token_nonce);
            self.vesting_cancelled_event(
                id,
                &caller,
                &vesting.token,
                &CancelledEvent { refund, vested },
            );
        }
        self.tx()
            .to(&caller)
            .payment(refunds)
            .transfer_if_not_empty();
    }

    /// Sends on the keys of vesting `id` that the contract holds, which only
    /// happens when sending them bounced (a smart contract that cannot receive
    /// them). Each caller gets what it may take:
    ///
    /// - the creator: the cancel key, and the claim key only if it never
    ///   reached a holder (never sent to `claim` and nothing claimed: it
    ///   bounced at creation);
    /// - the owner: any held key.
    ///
    /// The creator's claim key rule relies on the contract being non-payable,
    /// so that a key can only be held after a bounce. While the contract is
    /// payable, only the owner may recover claim keys.
    #[endpoint(recoverBouncedKeys)]
    fn recover_bounced_keys(&self, id: u64, to: ManagedAddress) {
        require!(!self.vesting(id).is_empty(), ERR_UNKNOWN_VESTING);
        self.require_valid_recipient(&to);
        let vesting = self.vesting(id).get();
        let caller = self.blockchain().get_caller();
        let is_owner = caller == self.blockchain().get_owner_address();
        let is_creator = caller == vesting.creator;
        let mut keys = ManagedVec::new();
        let mut kinds = ManagedVec::<Self::Api, KeyKind>::new();
        let mut held = false;
        if self.holds_key(KeyKind::Claim, vesting.claim_nonce) {
            held = true;
            // Both checks: vestings created before `claimKeyUsed` existed have
            // the flag unset even when they were claimed.
            let never_delivered = !self.claim_key_used(id).get()
                && self.claimed(id).get() == 0u32
                && !self.is_payable();
            if is_owner || (is_creator && never_delivered) {
                keys.push(self.key_payment(KeyKind::Claim, vesting.claim_nonce));
                kinds.push(KeyKind::Claim);
            }
        }
        if self.holds_key(KeyKind::Cancel, vesting.cancel_nonce) {
            held = true;
            if is_owner || is_creator {
                keys.push(self.key_payment(KeyKind::Cancel, vesting.cancel_nonce));
                kinds.push(KeyKind::Cancel);
            }
        }
        require!(held, ERR_NO_HELD_KEY);
        require!(!keys.is_empty(), ERR_NOT_ALLOWED);
        for kind in kinds.iter() {
            self.key_recovered_event(id, *kind, &caller, &to);
        }
        self.tx().to(&to).payment(keys).transfer();
    }

    /// Owner only. Sends what the contract holds of `token` beyond what it
    /// owes (locked, claimable and fees). Such a surplus only appears when a
    /// payout bounced back; the events show whom it belongs to. Locked funds
    /// can never be moved this way.
    #[only_owner]
    #[endpoint(recoverSurplus)]
    fn recover_surplus(&self, token: TokenId, to: ManagedAddress) {
        self.require_valid_recipient(&to);
        let surplus = self.surplus(&token);
        require!(surplus > 0u32, ERR_NO_SURPLUS);
        self.surplus_recovered_event(&token, &to, &surplus);
        self.tx()
            .to(&to)
            .payment(Payment::new(
                token,
                0,
                NonZeroBigUint::new_or_panic(surplus),
            ))
            .transfer();
    }

    fn require_valid_recipient(&self, to: &ManagedAddress) {
        require!(
            !to.is_zero() && *to != self.blockchain().get_sc_address(),
            ERR_BAD_RECIPIENT
        );
    }

    /// The contract's balance of `token` minus everything it owes.
    fn surplus(&self, token: &TokenId) -> BigUint {
        let balance = self.blockchain().get_sc_balance(token, 0);
        let mut owed = self.totals_of(token).owed();
        if token.is_native() {
            owed += self.fees_accrued().get();
        }
        if balance > owed {
            balance - owed
        } else {
            BigUint::zero()
        }
    }

    fn now(&self) -> u64 {
        self.blockchain()
            .get_block_timestamp_seconds()
            .as_u64_seconds()
    }

    /// Vested at `t`, frozen at the moment of the cancel if there was one.
    fn vested_with_cancel(
        &self,
        vesting: &Vesting<Self::Api>,
        cancelled_at: u64,
        t: u64,
    ) -> BigUint {
        let at = if cancelled_at != 0 && cancelled_at < t {
            cancelled_at
        } else {
            t
        };
        vesting.schedule.vested_at(&vesting.total, at)
    }

    /// The most the claim key can ever collect: the total, or what had vested
    /// at the cancel.
    fn final_amount(&self, vesting: &Vesting<Self::Api>, cancelled_at: u64) -> BigUint {
        if cancelled_at != 0 {
            vesting.schedule.vested_at(&vesting.total, cancelled_at)
        } else {
            vesting.total.clone()
        }
    }
}
