//! Red-team premise for the key-spam findings (dApp: My vestings, the
//! address page and the Token page): anyone can create vestings for anyone,
//! and the contract accepts, at zero fee, a batch of 49 vestings of 1 unit (50
//! on the audited code)
//! each, all for the same victim, with a schedule that ended before it was
//! created and a label of the creator's choosing.
//!
//! Cost to the attacker: 1 unit of any token per vesting and about 0.00027
//! EGLD of gas (MEASUREMENTS.md: 0.01349 EGLD per batch of 50 on devnet).
//! 10,000 keys in one wallet, enough to break its "My vestings" page (the
//! public API refuses `from + size > 10,000`, read on mainnet 2026-10-13),
//! cost about 2.7 EGLD. The same spam pushes a token's real vestings out of
//! the newest 2,000 the Token page reads.
//!
//! This test PASSES: it pins the premise, not a contract bug. The defence is
//! economic (the EGLD fee per vesting: the token fee of a 1-unit vesting
//! rounds to 0) and in the dApp (hide or fold dust and unknown
//! tokens, never fail the whole page).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

const PHISH: &str = "Your bonus is ready: claim at mvx-vest.io";

#[test]
fn forty_nine_dust_vestings_for_one_victim_in_one_transaction_at_zero_fee() {
    let mut f = Fixture::new();
    let mut entries = MultiValueEncoded::new();
    for _ in 0..49 {
        entries.push(
            (
                ALICE.to_managed_address(),
                big(1),
                // Ended before it was created: fully vested at once.
                linear(T0 - 10, T0 - 10, 0, T0 - 1),
            )
                .into(),
        );
    }
    let ids: MultiValueEncoded<StaticApi, u64> = f
        .world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, PHISH, entries)
        .payment(payments(&[(Some(PTS), 49)]))
        .returns(ReturnsResult)
        .run();
    assert_eq!(ids.len(), 49);

    // The victim now holds 49 keys it never asked for, each "claimable" for
    // 1 unit, each carrying the attacker's text on the victim's public page.
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, PTS.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 49, 49, PTS.as_str());
    let view = f.view(49);
    assert_eq!(view.claimable, big(1));
    assert_eq!(view.vesting.label, ManagedBuffer::from(PHISH));
    assert_eq!(view.vesting.beneficiary, ALICE.to_managed_address());
    assert_eq!(f.fees_accrued(), big(0));
    f.check_invariant(Some(PTS));
}
