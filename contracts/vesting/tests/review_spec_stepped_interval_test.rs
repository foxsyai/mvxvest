//! Review finding (info, spec conformance): CONTRACT_SPEC.md section 1 lists
//! for the stepped curve the extra rule `0 < interval <= end - start`. With
//! `start == end` (a time lock) that rule admits no interval at all, but
//! `Schedule::validate` (src/schedule.rs:81) only checks the upper bound when
//! `end > start`, so a stepped "time lock" with any interval is accepted and
//! stored. Harmless in effect (it behaves like a linear time lock), but the
//! code and the spec disagree; one of them should change.

use multiversx_sc::types::BigUint;
use multiversx_sc_scenario::api::StaticApi;
use mvxvest::{
    errors::*,
    schedule::{Curve, Schedule},
};

#[test]
fn stepped_time_lock_follows_the_spec_interval_rule() {
    let schedule = Schedule::<StaticApi> {
        start: 1_000,
        cliff: 1_000,
        cliff_amount: BigUint::zero(),
        end: 1_000,
        curve: Curve::Stepped { interval: 86_400 },
    };
    // Spec: 0 < interval <= end - start = 0, impossible.
    assert_eq!(
        schedule.validate(&BigUint::from(100u32)),
        Err(ERR_INTERVAL_TOO_LONG),
        "a stepped schedule with start == end and interval 86400 is accepted"
    );
}
