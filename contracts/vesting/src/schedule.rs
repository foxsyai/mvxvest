//! The vesting maths: how much of a total has vested at a given second.
//!
//! Pure functions of the schedule and a timestamp: no storage, no blockchain
//! calls. The contract, its views and the dApp's preview all use the same
//! rules, documented in docs/CONTRACT_SPEC.md.
//!
//! One formula covers every schedule:
//!
//! - before `cliff`: nothing;
//! - from `end` on: the whole total;
//! - in between: `cliff_amount`, plus the share of the rest
//!   (`total - cliff_amount`) that the curve has released, measured from
//!   `start`.
//!
//! All arithmetic is on integers and rounds down, so vested(t) never exceeds
//! the total, never decreases, and reaches the total exactly at `end`.

use multiversx_sc::{derive_imports::*, imports::*};

use crate::errors::*;

/// Most tranches an explicit schedule may list (10 years of monthly releases).
pub const MAX_TRANCHES: usize = 120;

/// One release of an explicit schedule: `amount` unlocks at `time`.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, ManagedVecItem, Clone)]
pub struct Tranche<M: ManagedTypeApi> {
    pub time: u64,
    pub amount: BigUint<M>,
}

/// How the rest (the total minus the cliff amount) is released.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone)]
pub enum Curve<M: ManagedTypeApi> {
    /// Every second, in proportion to the time elapsed since `start`.
    Linear,
    /// In equal steps every `interval` seconds from `start`; the last step
    /// falls on `end`, even when the interval does not divide the duration.
    Stepped { interval: u64 },
    /// An explicit list of releases, in strictly increasing time, the last one
    /// at `end`. Their amounts add up to the rest.
    Tranches(ManagedVec<M, Tranche<M>>),
}

/// When and how a vesting releases its total. Timestamps are in seconds.
#[type_abi]
#[derive(TopEncode, TopDecode, NestedEncode, NestedDecode, Clone)]
pub struct Schedule<M: ManagedTypeApi> {
    /// The origin of the curve. May be in the past.
    pub start: u64,
    /// Nothing can be claimed before this moment. `start <= cliff <= end`.
    pub cliff: u64,
    /// Unlocks at the cliff, on top of what the curve has released by then.
    pub cliff_amount: BigUint<M>,
    /// From this moment the whole total has vested.
    pub end: u64,
    pub curve: Curve<M>,
}

impl<M: ManagedTypeApi> Schedule<M> {
    /// Checks that the schedule is well formed for `total`. Returns the error
    /// message to show when it is not.
    pub fn validate(&self, total: &BigUint<M>) -> Result<(), &'static str> {
        if *total == 0u32 {
            return Err(ERR_ZERO_TOTAL);
        }
        if self.start > self.cliff || self.cliff > self.end {
            return Err(ERR_TIME_ORDER);
        }
        if self.cliff_amount > *total {
            return Err(ERR_CLIFF_ABOVE_TOTAL);
        }
        match &self.curve {
            Curve::Linear => Ok(()),
            Curve::Stepped { interval } => {
                if *interval == 0 {
                    return Err(ERR_ZERO_INTERVAL);
                }
                if self.end > self.start && *interval > self.end - self.start {
                    return Err(ERR_INTERVAL_TOO_LONG);
                }
                Ok(())
            }
            Curve::Tranches(tranches) => {
                if tranches.is_empty() || tranches.len() > MAX_TRANCHES {
                    return Err(ERR_TRANCHE_COUNT);
                }
                let mut previous: Option<u64> = None;
                let mut sum = BigUint::zero();
                for tranche in tranches.iter() {
                    if tranche.amount == 0u32 {
                        return Err(ERR_ZERO_TRANCHE);
                    }
                    if tranche.time < self.start {
                        return Err(ERR_TRANCHE_BEFORE_START);
                    }
                    if previous.is_some_and(|previous| tranche.time <= previous) {
                        return Err(ERR_TRANCHE_ORDER);
                    }
                    previous = Some(tranche.time);
                    sum += &tranche.amount;
                }
                if previous != Some(self.end) {
                    return Err(ERR_LAST_TRANCHE_NOT_END);
                }
                if sum + &self.cliff_amount != *total {
                    return Err(ERR_TRANCHE_SUM);
                }
                Ok(())
            }
        }
    }

    /// The amount of `total` vested at second `t`. Assumes `validate` passed.
    pub fn vested_at(&self, total: &BigUint<M>, t: u64) -> BigUint<M> {
        if t < self.cliff {
            return BigUint::zero();
        }
        if t >= self.end {
            return total.clone();
        }
        // From here start <= cliff <= t < end, so end - start > 0.
        &self.cliff_amount + &self.rest_released(total, t)
    }

    /// The part of the rest the curve has released at `t`, for
    /// `cliff <= t < end`.
    fn rest_released(&self, total: &BigUint<M>, t: u64) -> BigUint<M> {
        let rest = total - &self.cliff_amount;
        match &self.curve {
            Curve::Linear => rest * (t - self.start) / (self.end - self.start),
            Curve::Stepped { interval } => {
                let steps = self.step_count(*interval);
                let done = (t - self.start) / interval;
                rest * done / steps
            }
            Curve::Tranches(tranches) => {
                let mut released = BigUint::zero();
                for tranche in tranches.iter() {
                    if tranche.time > t {
                        break;
                    }
                    released += &tranche.amount;
                }
                released
            }
        }
    }

    /// Number of steps of a stepped curve: the duration divided by the
    /// interval, rounded up, so the last (possibly shorter) step ends at `end`.
    fn step_count(&self, interval: u64) -> u64 {
        (self.end - self.start).div_ceil(interval)
    }

    /// The next moment after `now` at which the vested amount grows, and by
    /// how much. `None` when everything has vested, or when the rest vests
    /// continuously (a linear curve past its cliff).
    pub fn next_release(&self, total: &BigUint<M>, now: u64) -> Option<(u64, BigUint<M>)> {
        if now >= self.end {
            return None;
        }
        if now < self.cliff {
            let at_cliff = self.vested_at(total, self.cliff);
            if at_cliff > 0u32 {
                return Some((self.cliff, at_cliff));
            }
            // Nothing unlocks at the cliff itself: look past it.
            return self.release_after(total, self.cliff);
        }
        self.release_after(total, now)
    }

    /// The first release strictly after `t`, for `cliff <= t < end`.
    fn release_after(&self, total: &BigUint<M>, t: u64) -> Option<(u64, BigUint<M>)> {
        if t >= self.end {
            return None;
        }
        let at = match &self.curve {
            Curve::Linear => return None,
            Curve::Stepped { interval } => {
                let rest = total - &self.cliff_amount;
                if rest == 0u32 {
                    return None;
                }
                let steps = self.step_count(*interval);
                let done = (t - self.start) / interval;
                // The released rest is floor(rest * k / steps). It next grows at
                // the smallest step k with rest * k >= (released + 1) * steps.
                let released = rest.clone() * done / steps;
                let next_step = ((released + 1u32) * steps + &rest - 1u32) / &rest;
                let next_step = next_step.to_u64().unwrap_or(steps);
                let at = self
                    .start
                    .saturating_add(next_step.saturating_mul(*interval));
                core::cmp::min(at, self.end)
            }
            Curve::Tranches(tranches) => {
                let mut found = self.end;
                for tranche in tranches.iter() {
                    if tranche.time > t {
                        found = tranche.time;
                        break;
                    }
                }
                found
            }
        };
        let amount = self.vested_at(total, at) - self.vested_at(total, t);
        Some((at, amount))
    }
}
