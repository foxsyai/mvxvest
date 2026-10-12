//! Review 2, verified safe (F5 and the collection views): the stepped
//! interval rule at its edges, with no underflow, and the collection views
//! empty until the collections are issued.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::{
    errors::*,
    schedule::{Curve, Schedule as Sched},
};

fn stepped_raw(start: u64, cliff: u64, end: u64, interval: u64) -> Sched<StaticApi> {
    Sched {
        start,
        cliff,
        cliff_amount: BigUint::zero(),
        end,
        curve: Curve::Stepped { interval },
    }
}

#[test]
fn stepped_interval_rule_at_its_edges() {
    let total = BigUint::<StaticApi>::from(100u32);
    // Empty duration: no interval fits.
    for interval in [1, 86_400, u64::MAX] {
        assert_eq!(
            stepped_raw(500, 500, 500, interval).validate(&total),
            Err(ERR_INTERVAL_TOO_LONG)
        );
    }
    assert_eq!(
        stepped_raw(500, 500, 500, 0).validate(&total),
        Err(ERR_ZERO_INTERVAL)
    );
    // Times out of order are reported first, so `end - start` never underflows.
    assert_eq!(
        stepped_raw(500, 500, 400, 1).validate(&total),
        Err(ERR_TIME_ORDER)
    );
    assert_eq!(
        stepped_raw(500, 400, 400, 1).validate(&total),
        Err(ERR_TIME_ORDER)
    );
    // Shortest and longest durations; interval equal to the duration.
    assert_eq!(stepped_raw(500, 500, 501, 1).validate(&total), Ok(()));
    assert_eq!(stepped_raw(500, 501, 501, 1).validate(&total), Ok(()));
    assert_eq!(
        stepped_raw(0, 0, u64::MAX, u64::MAX).validate(&total),
        Ok(())
    );
    assert_eq!(
        stepped_raw(1, 1, u64::MAX, u64::MAX).validate(&total),
        Err(ERR_INTERVAL_TOO_LONG)
    );
    // Real-world shapes stay valid: 4 years monthly, 1 year quarterly with a
    // 1-year cliff, a single step over the whole duration.
    let month = 30 * DAY;
    assert_eq!(
        stepped_raw(T0, T0, T0 + 48 * month, month).validate(&total),
        Ok(())
    );
    assert_eq!(
        stepped_raw(T0, T0 + 365 * DAY, T0 + 730 * DAY, 91 * DAY).validate(&total),
        Ok(())
    );
    assert_eq!(stepped_raw(T0, T0, T0 + DAY, DAY).validate(&total), Ok(()));
    // A time lock is still possible, as linear.
    let lock = Sched::<StaticApi> {
        start: T0,
        cliff: T0,
        cliff_amount: BigUint::zero(),
        end: T0,
        curve: Curve::Linear,
    };
    assert_eq!(lock.validate(&total), Ok(()));
}

#[test]
fn stepped_edges_through_create() {
    let mut f = Fixture::new();
    f.create_fails(
        ALICE.to_managed_address(),
        stepped(T0 + DAY, T0 + DAY, DAY),
        false,
        payments(&[(Some(FOX), 100)]),
        ERR_INTERVAL_TOO_LONG,
    );
    let id = f.create_fox(ALICE, 100, stepped(T0, T0 + 1, 1), false);
    f.set_time(T0 + 1);
    f.claim(ALICE, &[id]);
    f.check_fox(ALICE, 100);
}

#[test]
fn collection_views_are_empty_until_issued() {
    let mut f = Fixture::without_keys();
    for claim in [true, false] {
        let query = f.world.query().to(SC).typed(MvxvestProxy);
        let value: ManagedBuffer<StaticApi> = if claim {
            query
                .get_claim_key_collection()
                .returns(ReturnsResult)
                .run()
        } else {
            query
                .get_cancel_key_collection()
                .returns(ReturnsResult)
                .run()
        };
        assert!(value.is_empty());
    }
    f.issue_keys();
    let claim: ManagedBuffer<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_claim_key_collection()
        .returns(ReturnsResult)
        .run();
    let cancel: ManagedBuffer<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_cancel_key_collection()
        .returns(ReturnsResult)
        .run();
    assert_eq!(claim, ManagedBuffer::from(CLAIM_KEY.as_str()));
    assert_eq!(cancel, ManagedBuffer::from(CANCEL_KEY.as_str()));
}
