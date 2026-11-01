//! Fifth audit, red team (RT-1): what a cross-shard "Claim all" leaves behind
//! when its payout bounces, and what it costs the owner to repair.
//!
//! The attack is played in the dApp test
//! `dapp/src/pages/tests/audit5_redteam_bounce_claim_all.test.tsx` and in
//! the protocol source it cites: a wallet in another shard than the contract
//! claims N keys; one of them is a 1-unit dust vesting of a token whose issuer
//! froze the wallet; the single MultiESDTNFTTransfer that carries every payout
//! and every key fails at the wallet and the protocol returns it to the
//! contract, which has already booked every claim. Neither VM here crosses a
//! shard, so this test models the bounce as `admin_test` does (the tokens and
//! the keys come back to the contract with no call) and pins the aftermath:
//!
//! - the victim's real vesting reads as claimed, with nothing claimable, while
//!   the victim holds nothing: the money is surplus and the key is held by the
//!   contract;
//! - nobody but the owner can move either; the repair is one vote per key
//!   (`recoverBouncedKey` takes one key) plus one per token (`recoverSurplus`),
//!   N + 1 votes of the 2 of 3 multisig for N keys, during which the victim
//!   cannot claim what vests next (the key is in the contract);
//! - the victim's own second claim cannot happen: the key is gone.
//!
//! All of this passes on the current code: it is evidence of the blast
//! radius, not the failing test (that is the dApp's).

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;

/// The griefer's token: any token but the victim's, here the fixture's PTS.
const EVIL: TestTokenId = PTS;

#[test]
fn a_bounced_claim_all_parks_the_victims_keys_and_money_until_n_plus_one_votes() {
    let mut f = Fixture::new();
    // Two real vestings for Alice, 1,000 FOX each, linear over 1,000 s.
    let salary = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    let bonus = f.create_fox(ALICE, 1_000, linear(T0, T0, 0, T0 + 1_000), false);
    // The griefer's dust vesting: 1 EVIL, ended before it was created, so it
    // is "worth claiming" and Claim all takes it along. (Who creates it does
    // not matter: the fixture's creator holds the token.)
    let dust = f.create(
        CREATOR,
        ALICE,
        linear(T0 - 10, T0 - 10, 0, T0 - 1),
        false,
        payments(&[(Some(EVIL), 1)]),
    );
    assert_eq!((salary, bonus, dust), (1, 2, 3));

    // Alice claims all three at T0+500: the contract books 500 + 500 + 1 and
    // sends one transfer with 1,000 FOX, 1 EVIL and the two FOX keys (the EVIL
    // key is finished and burned).
    f.set_time(T0 + 500);
    f.claim(ALICE, &[1, 2, 3]);
    f.check_fox(ALICE, 1_000);
    assert_eq!(f.view(salary).claimed, big(500));
    assert_eq!(f.view(bonus).claimed, big(500));
    assert_eq!(f.view(dust).claimed, big(1));

    // The bounce: in Alice's shard the transfer fails (frozen for EVIL) and
    // everything goes back to the contract with no call.
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(payments(&[(Some(FOX), 1_000), (Some(EVIL), 1)]))
        .whitebox(mvxvest::contract_obj, |_| {});
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .payment(keys(KeyKind::Claim, &[1, 2]))
        .whitebox(mvxvest::contract_obj, |_| {});
    f.check_fox(ALICE, 0);

    // What Alice reads: both vestings claimed 500, claimable 0; the money is
    // surplus; the keys are in the contract.
    assert_eq!(f.view(salary).claimable, big(0));
    assert_eq!(f.view(bonus).claimable, big(0));
    let surplus: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_surplus(token(FOX))
        .returns(ReturnsResult)
        .run();
    assert_eq!(surplus, big(1_000));
    // Stamped "claimed:500" by the claim that paid, then returned.
    let stamped_1 = format!("{};claimed:500", key_attributes(salary, FOX.as_str(), false));
    let stamped_2 = format!("{};claimed:500", key_attributes(bonus, FOX.as_str(), false));
    f.world
        .check_account(SC)
        .esdt_nft_balance_and_attributes(CLAIM_KEY, 1, 1, stamped_1.as_bytes());
    f.world
        .check_account(SC)
        .esdt_nft_balance_and_attributes(CLAIM_KEY, 2, 1, stamped_2.as_bytes());

    // Alice cannot claim again: she holds no key. Mallory cannot touch any of
    // it. Only the owner can, one key per call and one call for the money.
    f.world
        .tx()
        .from(MALLORY)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, MALLORY)
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();
    f.world
        .tx()
        .from(ALICE)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, ALICE)
        .returns(ExpectError(4, ERR_ONLY_OWNER))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(1u64, KeyKind::Claim, ALICE)
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_bounced_key(2u64, KeyKind::Claim, ALICE)
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .recover_surplus(token(FOX), ALICE, OptionalValue::<BigUint<StaticApi>>::None)
        .run();
    f.check_fox(ALICE, 1_000);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, salary, FOX.as_str());
    f.check_holds_key(ALICE, KeyKind::Claim, 2, bonus, FOX.as_str());
    // Three votes for a wallet with two real keys; the books are exact again.
    f.check_invariant(Some(FOX));
}
