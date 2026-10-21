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
    /// pay nothing more is burned instead of returned. A key that paid and
    /// goes back says what has been claimed in its name and attributes
    /// (version 3, unless the owner turned it off). Fails when no key paid
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
        let stamp = self.key_stamping_off().is_empty();
        for payment in payments.iter() {
            let id = self.vesting_of_key(KeyKind::Claim, &payment);
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
                if stamp && amount > 0u32 {
                    self.stamp_claim_key(payment.token_nonce, id, &vesting, &claimed_total);
                }
                outgoing.push(payment.clone());
            }
            // A key that paid nothing and is not finished changed nothing: it
            // just goes back, with no event.
            if amount > 0u32 || finished {
                progressed = true;
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

    /// Owner only. Sends on the `kind` key of vesting `id`, which the contract
    /// holds only after sending it bounced: to a beneficiary, creator or
    /// holder that is a smart contract that cannot receive it (a wallet never
    /// bounces). The transaction that sent it shows whom it belongs to. Nobody
    /// else can move a
    /// key the contract holds: earlier designs let the creator recover some
    /// keys, and every review found a way to abuse that
    /// (docs/reviews/2026-10-12-contract.md).
    #[only_owner]
    #[endpoint(recoverBouncedKey)]
    fn recover_bounced_key(&self, id: u64, kind: KeyKind, to: ManagedAddress) {
        require!(!self.vesting(id).is_empty(), ERR_UNKNOWN_VESTING);
        self.require_valid_recipient(&to);
        let vesting = self.vesting(id).get();
        let nonce = match kind {
            KeyKind::Claim => vesting.claim_nonce,
            KeyKind::Cancel => vesting.cancel_nonce,
        };
        require!(self.holds_key(kind, nonce), ERR_NO_HELD_KEY);
        let caller = self.blockchain().get_caller();
        self.key_recovered_event(id, kind, &caller, &to);
        self.tx()
            .to(&to)
            .payment(self.key_payment(kind, nonce))
            .transfer();
    }

    /// Owner only. Sends what the contract holds of `token` beyond what it
    /// owes (locked, claimable and fees): `amount` of it, or all of it when no
    /// amount is given. Such a surplus only appears when a payout bounced
    /// back; the events show whom it belongs to, and the amount lets two
    /// bounced payouts go back to their two owners (audit C1). Locked funds
    /// can never be moved this way.
    #[only_owner]
    #[endpoint(recoverSurplus)]
    fn recover_surplus(&self, token: TokenId, to: ManagedAddress, amount: OptionalValue<BigUint>) {
        self.require_valid_recipient(&to);
        let surplus = self.surplus(&token);
        require!(surplus > 0u32, ERR_NO_SURPLUS);
        let amount = match amount {
            OptionalValue::Some(amount) => {
                require!(amount > 0u32, ERR_ZERO_AMOUNT);
                require!(amount <= surplus, ERR_ABOVE_SURPLUS);
                amount
            }
            OptionalValue::None => surplus,
        };
        self.surplus_recovered_event(&token, &to, &amount);
        self.tx()
            .to(&to)
            .payment(Payment::new(token, 0, NonZeroBigUint::new_or_panic(amount)))
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

    /// What the contract lacks of `token` to pay everything it owes: the
    /// other side of `surplus`, 0 normally (version 3).
    fn deficit(&self, token: &TokenId) -> BigUint {
        let balance = self.blockchain().get_sc_balance(token, 0);
        let mut owed = self.totals_of(token).owed();
        if token.is_native() {
            owed += self.fees_accrued().get();
        }
        if owed > balance {
            owed - balance
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
