//! Fourth audit (contract money paths, 20 Oct 2026): the sales email's claim
//! 4, "token_fee_of() rounds down per vesting, so a batch of small vestings
//! can pay zero token fee".
//!
//! True, and already written down (CONTRACT_SPEC.md section 3, DECISIONS.md
//! #10, the second audit's L3): the token fee is `floor(total * bps /
//! 10,000)` per vesting, so at 10 bps a vesting under 1,000 smallest units
//! pays none. These tests measure what that is worth to a creator who splits
//! on purpose, with both fees at mainnet's values (10 bps and 0.1 EGLD):
//!
//! - splitting never dodges more than one smallest unit of the token per
//!   extra vesting, whatever the amounts and the rate (second test, random
//!   splits at 1, 10 and 200 bps, every payment checked by the contract);
//! - every extra vesting costs the full EGLD fee, so the dodge costs 0.1 EGLD
//!   per smallest unit saved (first test: 49 vestings of 999 PTS, a token
//!   with 0 decimals, pay 0 PTS of token fee and 4.9 EGLD; the same 48,951
//!   PTS in one vesting pay 48 PTS and 0.1 EGLD).
//!
//! For a token with 18 decimals a smallest unit is 10^-18 of a token, so
//! the dodge is worth nothing; only a token with few decimals whose unit is
//! worth more than 0.1 EGLD could make it pay. Not a finding: the design
//! names the EGLD fee as the brake, and the beneficiary always receives the
//! full total either way. Both tests pass on 322cb43.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

fn set_fees(f: &mut Fixture, bps: u32, egld_fee: u128) {
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(bps)
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(egld_fee))
        .run();
}

/// The spec's fee, computed here: `floor(total * bps / 10,000)`.
fn fee_of(total: u128, bps: u32) -> u128 {
    total * bps as u128 / 10_000
}

/// One vesting of `total` of `id` for Alice, paying `token_fee` of it and
/// `egld` of EGLD fee.
fn create_one(f: &mut Fixture, id: TestTokenId, total: u128, token_fee: u128, egld: u128) {
    let pay = if egld > 0 {
        payments(&[(Some(id), total + token_fee), (None, egld)])
    } else {
        payments(&[(Some(id), total + token_fee)])
    };
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create(ALICE, big(total), linear(T0, T0, 0, T0 + DAY), false, "fee")
        .payment(pay)
        .run();
}

/// A batch of `parts` for Alice, paying `token_fee` of `id` in all and `egld`
/// of EGLD fee in all.
fn create_batch(f: &mut Fixture, id: TestTokenId, parts: &[u128], token_fee: u128, egld: u128) {
    let sum: u128 = parts.iter().sum();
    let pay = if egld > 0 {
        payments(&[(Some(id), sum + token_fee), (None, egld)])
    } else {
        payments(&[(Some(id), sum + token_fee)])
    };
    let mut list = MultiValueEncoded::new();
    for part in parts {
        list.push(
            (
                ALICE.to_managed_address(),
                big(*part),
                linear(T0, T0, 0, T0 + DAY),
            )
                .into(),
        );
    }
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "fee", list)
        .payment(pay)
        .run();
}

#[test]
fn safe_at_mainnet_fees_49_vestings_of_999_pts_dodge_48_pts_of_fee_for_4_point_8_egld() {
    let mut f = Fixture::new();
    set_fees(&mut f, 10, EGLD / 10);
    let owner_egld_before = 10 * EGLD - 2 * ISSUE_COST;

    // 49 vestings of 999 PTS: no token fee at all, 4.9 EGLD of EGLD fees.
    let parts = [999u128; 49];
    let sum: u128 = parts.iter().sum();
    assert_eq!(sum, 48_951);
    assert_eq!(parts.iter().map(|p| fee_of(*p, 10)).sum::<u128>(), 0);
    create_batch(&mut f, PTS, &parts, 0, 49 * EGLD / 10);
    f.world.check_account(OWNER).esdt_balance(PTS, big(0));
    assert_eq!(f.fees_accrued(), big(49 * EGLD / 10));
    // And a payment that includes a token fee anyway is refused: the fee
    // is exact, not a minimum.
    let mut list = MultiValueEncoded::new();
    list.push(
        (
            ALICE.to_managed_address(),
            big(999u128),
            linear(T0, T0, 0, T0 + DAY),
        )
            .into(),
    );
    f.world
        .tx()
        .from(CREATOR)
        .to(SC)
        .typed(MvxvestProxy)
        .create_batch(false, "fee", list)
        .payment(payments(&[(Some(PTS), 1_000), (None, EGLD / 10)]))
        .returns(ExpectError(4, mvxvest::errors::ERR_WRONG_DEPOSIT))
        .run();

    // The same 48,951 PTS as one vesting: 48 PTS of token fee, 0.1 EGLD.
    assert_eq!(fee_of(sum, 10), 48);
    create_one(&mut f, PTS, sum, 48, EGLD / 10);
    f.world.check_account(OWNER).esdt_balance(PTS, big(48));
    assert_eq!(f.fees_accrued(), big(50 * EGLD / 10));

    // The creator paid 48 PTS less and 4.8 EGLD more for the split.
    f.world
        .check_account(CREATOR)
        .esdt_balance(PTS, big(10u128.pow(36) - 2 * sum - 48))
        .balance(big(1_000_000 * EGLD - 50 * EGLD / 10));
    // Alice holds 50 claim keys worth 2 x 48,951 PTS; the books are exact.
    let totals = f.totals(token(PTS));
    assert_eq!(totals.deposited, big(2 * sum));
    f.check_invariant(Some(PTS));
    f.check_invariant(None);
    // The owner collects the 5 EGLD.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim_fees()
        .run();
    f.world
        .check_account(OWNER)
        .balance(big(owner_egld_before + 50 * EGLD / 10));
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
}

#[test]
fn safe_splitting_a_vesting_never_dodges_more_than_one_unit_of_fee_per_extra_vesting() {
    let mut rng = Rng(0x5EED_0000_AAAA_0001);
    let mut owner_fox = 0u128;
    for bps in [1u32, 10, 200] {
        let mut f = Fixture::new();
        set_fees(&mut f, bps, 0);
        owner_fox = 0;
        for _ in 0..8 {
            // A total up to 10^7 units, split into 2 to 12 random parts.
            let total = 1 + rng.below(10_000_000) as u128;
            let count = (2 + rng.below(11)) as usize;
            if total < count as u128 {
                continue;
            }
            let mut parts = Vec::new();
            let mut left = total;
            for i in 0..count {
                let remaining = (count - i - 1) as u128;
                let part = if remaining == 0 {
                    left
                } else {
                    1 + rng.below((left - remaining - 1) as u64 + 1) as u128
                };
                left -= part;
                parts.push(part);
            }
            assert_eq!(parts.iter().sum::<u128>(), total);

            let single_fee = fee_of(total, bps);
            let split_fee: u128 = parts.iter().map(|p| fee_of(*p, bps)).sum();
            assert!(split_fee <= single_fee, "a split never pays more");
            let dodged = single_fee - split_fee;
            assert!(
                dodged < parts.len() as u128,
                "{bps} bps: {total} in {} parts dodges {dodged} units",
                parts.len()
            );

            // The contract charges exactly these amounts.
            create_one(&mut f, FOX, total, single_fee, 0);
            owner_fox += single_fee;
            f.check_fox(OWNER, owner_fox);
            create_batch(&mut f, FOX, &parts, split_fee, 0);
            owner_fox += split_fee;
            f.check_fox(OWNER, owner_fox);
            f.check_invariant(Some(FOX));
        }
    }
    assert!(owner_fox > 0);
}
