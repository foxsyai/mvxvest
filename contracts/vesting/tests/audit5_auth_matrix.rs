//! Fifth audit (Claude Fable 5.1, 1 Nov 2026), reviewer AUTH: who may call
//! what, on the Rust VM. The contract exports 45 functions (the live code,
//! hash 65c689b9..., 1 Nov 2026): `init`, `upgrade`, `callBack`, 12 owner
//! endpoints, 4 open endpoints (`create`, `createBatch`, `claim`, `cancel`)
//! and 26 views. This file pins the owner endpoints against every other
//! caller, the open endpoints against every caller and payment that is not
//! the right key from its holder, and the limits of the owner's own powers on
//! a running vesting. What needs the real protocol (direct `init`,
//! `upgrade` and `callBack` calls, ESDT roles, NFT quantities, contracts as
//! holders) is in `audit5_auth_go_vm` and its scenarios.
//!
//! All `safe_*`: every test passes on 26b0d4c.

mod common;

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

/// Holds a key of a collection the contract never issued (the real suffix
/// is random: a look-alike has another one).
const FAKER: TestAddress = TestAddress::new("faker");
const FAKE_CLAIM: TestTokenId = TestTokenId::new("VESTKEY-999999");
/// Holds, in this VM only, a claim key nonce that was never minted and a
/// quantity of the collection at nonce 0: states the protocol never
/// produces, so the contract's own checks are what is pinned.
const FORGER: TestAddress = TestAddress::new("forger");

type Outcome = Result<(), String>;

fn message(
    result: Result<(), multiversx_sc_scenario::scenario_model::TxResponseStatus>,
) -> Outcome {
    result.map_err(|e| e.message)
}

fn claim_with(
    f: &mut Fixture,
    from: TestAddress,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Outcome {
    message(
        f.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(payment)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    )
}

fn cancel_with(
    f: &mut Fixture,
    from: TestAddress,
    payment: ManagedVec<StaticApi, Payment<StaticApi>>,
) -> Outcome {
    message(
        f.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .cancel()
            .payment(payment)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    )
}

fn one(
    token_id: TestTokenId,
    nonce: u64,
    amount: u128,
) -> ManagedVec<StaticApi, Payment<StaticApi>> {
    let mut vec = ManagedVec::new();
    vec.push(Payment::new(
        token(token_id),
        nonce,
        NonZeroBigUint::new_or_panic(big(amount)),
    ));
    vec
}

fn none() -> ManagedVec<StaticApi, Payment<StaticApi>> {
    ManagedVec::new()
}

/// Every owner endpoint, as `caller` would call it, with the result.
fn owner_endpoints(f: &mut Fixture, caller: TestAddress) -> Vec<(&'static str, Outcome)> {
    let mut results = Vec::new();
    results.push((
        "issueClaimKey",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .issue_claim_key("Mine", "MINE")
                .egld(big(ISSUE_COST))
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "issueCancelKey",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .issue_cancel_key("Mine", "MINE")
                .egld(big(ISSUE_COST))
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "disableKeyBurnByHolders",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .disable_key_burn_by_holders(KeyKind::Claim)
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    let mut uris = MultiValueEncoded::new();
    uris.push(ManagedBuffer::from("https://evil.example/key.svg"));
    results.push((
        "setKeyDisplay",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .set_key_display(KeyKind::Claim, "ipfs://evil", uris)
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "setFee",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .set_fee(big(0))
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "setTokenFee",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .set_token_fee(0u32)
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "pauseCreation",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .pause_creation()
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "unpauseCreation",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .unpause_creation()
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "setKeyStamping",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .set_key_stamping(false)
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "claimFees",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .claim_fees()
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "recoverBouncedKey",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .recover_bounced_key(1u64, KeyKind::Claim, caller)
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results.push((
        "recoverSurplus",
        message(
            f.world
                .tx()
                .from(caller)
                .to(SC)
                .typed(MvxvestProxy)
                .recover_surplus(
                    token(FOX),
                    caller,
                    OptionalValue::<BigUint<StaticApi>>::None,
                )
                .returns(ReturnsHandledOrError::new())
                .run()
                .map(|_| ()),
        ),
    ));
    results
}

fn recover_key(
    f: &mut Fixture,
    caller: TestAddress,
    id: u64,
    kind: KeyKind,
    to: ManagedAddress<StaticApi>,
) -> Outcome {
    message(
        f.world
            .tx()
            .from(caller)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, kind, to)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    )
}

fn recover_surplus(
    f: &mut Fixture,
    caller: TestAddress,
    token_id: TokenId<StaticApi>,
    to: ManagedAddress<StaticApi>,
    amount: Option<u128>,
) -> Outcome {
    let amount = match amount {
        Some(amount) => OptionalValue::Some(big(amount)),
        None => OptionalValue::None,
    };
    message(
        f.world
            .tx()
            .from(caller)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_surplus(token_id, to, amount)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    )
}

/// A payout of `amount` FOX bounced back to the contract with no call.
fn bounce_fox(f: &mut Fixture, from: TestAddress, amount: u128) {
    f.world
        .tx()
        .from(from)
        .to(SC)
        .payment(payments(&[(Some(FOX), amount)]))
        .whitebox(mvxvest::contract_obj, |_| {});
}

/// A world with one cancelable vesting of 1000 FOX for Alice (claim key 1)
/// made by the creator (cancel key 1), with a 0.1 EGLD fee accrued, and the
/// extra holders of fake and forged keys.
fn world() -> Fixture {
    let mut f = Fixture::new();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD / 10))
        .run();
    f.create(
        CREATOR,
        ALICE,
        linear(T0, T0, 0, T0 + 1_000),
        true,
        payments(&[(Some(FOX), 1_000), (None, EGLD / 10)]),
    );
    let attributes = key_attributes(1, FOX.as_str(), true);
    f.world
        .account(FAKER)
        .nonce(1)
        .balance(big(EGLD))
        .esdt_nft_balance(
            FAKE_CLAIM,
            1,
            1,
            ManagedBuffer::<StaticApi>::from(attributes.as_bytes()),
        );
    f.world
        .account(FORGER)
        .nonce(1)
        .balance(big(EGLD))
        .esdt_balance(CLAIM_KEY, big(5))
        .esdt_nft_balance(
            CLAIM_KEY,
            77,
            1,
            ManagedBuffer::<StaticApi>::from(attributes.as_bytes()),
        );
    f
}

/// Everything is where the creation left it: Alice has claim key 1, the
/// creator cancel key 1, nothing was claimed or cancelled, the contract
/// holds exactly the 1000 FOX and the fee.
fn check_untouched(f: &mut Fixture) {
    let view = f.view(1);
    assert_eq!(view.claimed, big(0));
    assert_eq!(view.cancelled_at, 0);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
    f.check_invariant(Some(FOX));
    f.check_invariant(None);
    assert_eq!(f.fees_accrued(), big(EGLD / 10));
}

/// SAFE: the 12 owner endpoints refuse the creator, the beneficiary, a key
/// holder, a stranger (a multisig board member acting alone is one: only the
/// multisig's own address is the owner) and the holders of fake and forged
/// keys, each with `Endpoint can only be called by owner`, and change
/// nothing.
#[test]
fn safe_every_owner_endpoint_refuses_every_other_caller() {
    let mut f = world();
    for caller in [CREATOR, ALICE, BOB, MALLORY, FAKER, FORGER] {
        for (endpoint, outcome) in owner_endpoints(&mut f, caller) {
            assert_eq!(
                outcome,
                Err(ERR_ONLY_OWNER.to_string()),
                "{endpoint} called by {}",
                caller.eval_to_expr()
            );
        }
    }
    check_untouched(&mut f);
    let fee: BigUint<StaticApi> = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .get_fee()
        .returns(ReturnsResult)
        .run();
    assert_eq!(fee, big(EGLD / 10));
    let stamping: bool = f
        .world
        .query()
        .to(SC)
        .typed(MvxvestProxy)
        .is_key_stamping()
        .returns(ReturnsResult)
        .run();
    assert!(stamping);
}

/// SAFE: `claim` and `cancel` move nothing for anyone who does not send the
/// right key: no payment, EGLD, a fungible token, another NFT, a look-alike
/// collection, a never minted nonce, the collection at nonce 0, the wrong
/// kind of key, a key next to EGLD or FOX; and the creator, the original
/// beneficiary and the owner have no standing without the key. After a
/// sale, the ex-holder cannot claim and the buyer can; the creator cannot
/// cancel once its cancel key is sold, and the buyer can.
#[test]
fn safe_only_the_current_key_holder_moves_value() {
    let mut f = world();
    f.set_time(T0 + 500);
    let claim_cases: Vec<(
        &str,
        TestAddress,
        ManagedVec<StaticApi, Payment<StaticApi>>,
        &str,
    )> = vec![
        ("creator, no payment", CREATOR, none(), ERR_NOT_CLAIM_KEY),
        ("owner, no payment", OWNER, none(), ERR_NOT_CLAIM_KEY),
        (
            "beneficiary without her key, no payment",
            ALICE,
            none(),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "stranger, EGLD",
            MALLORY,
            payments(&[(None, EGLD)]),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "creator, FOX",
            CREATOR,
            payments(&[(Some(FOX), 1_000)]),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "creator, another NFT",
            CREATOR,
            one(OTHER_NFT, 1, 1),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "creator, the cancel key",
            CREATOR,
            key(KeyKind::Cancel, 1),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "faker, a look-alike key",
            FAKER,
            one(FAKE_CLAIM, 1, 1),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "forger, the collection at nonce 0",
            FORGER,
            one(CLAIM_KEY, 0, 1),
            ERR_NOT_CLAIM_KEY,
        ),
        (
            "forger, a never minted nonce",
            FORGER,
            one(CLAIM_KEY, 77, 1),
            ERR_UNKNOWN_KEY,
        ),
    ];
    for (case, from, payment, error) in claim_cases {
        assert_eq!(
            claim_with(&mut f, from, payment),
            Err(error.to_string()),
            "claim: {case}"
        );
    }
    let mut key_and_egld = key(KeyKind::Claim, 1);
    key_and_egld.push(Payment::new(
        native(),
        0,
        NonZeroBigUint::new_or_panic(big(1)),
    ));
    assert_eq!(
        claim_with(&mut f, ALICE, key_and_egld),
        Err(ERR_NOT_CLAIM_KEY.to_string()),
        "claim: the key next to EGLD"
    );
    let mut fox_and_key = payments(&[(Some(FOX), 1)]);
    f.world
        .set_esdt_balance(ALICE, FOX.as_str().as_bytes(), big(1));
    fox_and_key.push(Payment::new(token(CLAIM_KEY), 1, NonZeroBigUint::one()));
    assert_eq!(
        claim_with(&mut f, ALICE, fox_and_key),
        Err(ERR_NOT_CLAIM_KEY.to_string()),
        "claim: FOX next to the key"
    );
    let cancel_cases: Vec<(
        &str,
        TestAddress,
        ManagedVec<StaticApi, Payment<StaticApi>>,
        &str,
    )> = vec![
        ("creator, no payment", CREATOR, none(), ERR_NOT_CANCEL_KEY),
        ("owner, no payment", OWNER, none(), ERR_NOT_CANCEL_KEY),
        (
            "creator, FOX",
            CREATOR,
            payments(&[(Some(FOX), 1)]),
            ERR_NOT_CANCEL_KEY,
        ),
        (
            "creator, another NFT",
            CREATOR,
            one(OTHER_NFT, 1, 1),
            ERR_NOT_CANCEL_KEY,
        ),
        (
            "beneficiary, her claim key",
            ALICE,
            key(KeyKind::Claim, 1),
            ERR_NOT_CANCEL_KEY,
        ),
        (
            "forger, the collection at nonce 0",
            FORGER,
            one(CLAIM_KEY, 0, 1),
            ERR_NOT_CANCEL_KEY,
        ),
    ];
    for (case, from, payment, error) in cancel_cases {
        assert_eq!(
            cancel_with(&mut f, from, payment),
            Err(error.to_string()),
            "cancel: {case}"
        );
    }
    f.check_fox(ALICE, 1);
    check_untouched(&mut f);

    // The keys are sold: the claim key to Bob, the cancel key to Mallory.
    f.send_key(KeyKind::Claim, 1, ALICE, BOB);
    f.send_key(KeyKind::Cancel, 1, CREATOR, MALLORY);
    let ex_holder = claim_with(&mut f, ALICE, key(KeyKind::Claim, 1));
    println!("the ex-holder's claim with the key she sold: {ex_holder:?}");
    assert!(ex_holder.is_err(), "the ex-holder claimed");
    let ex_creator = cancel_with(&mut f, CREATOR, key(KeyKind::Cancel, 1));
    println!("the creator's cancel with the key it sold: {ex_creator:?}");
    assert!(ex_creator.is_err(), "the creator cancelled without its key");
    assert_eq!(f.view(1).claimed, big(0));
    assert_eq!(f.view(1).cancelled_at, 0);

    assert_eq!(claim_with(&mut f, BOB, key(KeyKind::Claim, 1)), Ok(()));
    f.check_fox(BOB, 500);
    f.check_holds_key(BOB, KeyKind::Claim, 1, 1, FOX.as_str());
    assert_eq!(
        cancel_with(&mut f, MALLORY, key(KeyKind::Cancel, 1)),
        Ok(())
    );
    f.check_fox(MALLORY, 500);
    f.check_fox(CREATOR, 10u128.pow(36) - 1_000);
    f.check_invariant(Some(FOX));
}

/// SAFE: what the owner can and cannot do to a running vesting without an
/// upgrade. Cannot: claim or cancel without the key; take a key its holder
/// has (`recoverBouncedKey` needs the contract to hold it); take locked
/// funds (`recoverSurplus` needs a surplus, then at most the surplus, never
/// the key collection, never to itself or the zero address); issue a second
/// key collection (`Token ID already set`). Can, and it changes no running
/// vesting: pause creation, set both fees to their caps, change the display
/// of future keys, switch the stamping off. After all of it, the holder's
/// claim pays what vested and the creator's cancel refunds the rest. A
/// bounced payout is the one thing it can move, and only up to the bounce.
#[test]
fn safe_the_owner_cannot_disturb_a_running_vesting_without_an_upgrade() {
    let mut f = world();
    assert_eq!(
        claim_with(&mut f, OWNER, none()),
        Err(ERR_NOT_CLAIM_KEY.to_string())
    );
    assert_eq!(
        cancel_with(&mut f, OWNER, none()),
        Err(ERR_NOT_CANCEL_KEY.to_string())
    );
    for kind in [KeyKind::Claim, KeyKind::Cancel] {
        assert_eq!(
            recover_key(&mut f, OWNER, 1, kind, OWNER.to_managed_address()),
            Err(ERR_NO_HELD_KEY.to_string())
        );
        assert_eq!(
            recover_key(&mut f, OWNER, 1, kind, CREATOR.to_managed_address()),
            Err(ERR_NO_HELD_KEY.to_string())
        );
    }
    assert_eq!(
        recover_key(&mut f, OWNER, 2, KeyKind::Claim, OWNER.to_managed_address()),
        Err(ERR_UNKNOWN_VESTING.to_string())
    );
    assert_eq!(
        recover_key(&mut f, OWNER, 1, KeyKind::Claim, SC.to_managed_address()),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    assert_eq!(
        recover_key(&mut f, OWNER, 1, KeyKind::Claim, ManagedAddress::zero()),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    for amount in [None, Some(1), Some(1_000)] {
        assert_eq!(
            recover_surplus(
                &mut f,
                OWNER,
                token(FOX),
                OWNER.to_managed_address(),
                amount
            ),
            Err(ERR_NO_SURPLUS.to_string()),
            "surplus of FOX, amount {amount:?}"
        );
        assert_eq!(
            recover_surplus(&mut f, OWNER, native(), OWNER.to_managed_address(), amount),
            Err(ERR_NO_SURPLUS.to_string()),
            "surplus of EGLD (the fee is owed to the owner through claimFees, not here), amount {amount:?}"
        );
    }
    assert_eq!(
        recover_surplus(
            &mut f,
            OWNER,
            token(CLAIM_KEY),
            OWNER.to_managed_address(),
            None
        ),
        Err(ERR_NO_SURPLUS.to_string()),
        "the key collection is not a surplus"
    );
    assert_eq!(
        recover_surplus(&mut f, OWNER, token(FOX), SC.to_managed_address(), None),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    assert_eq!(
        recover_surplus(&mut f, OWNER, token(FOX), ManagedAddress::zero(), None),
        Err(ERR_BAD_RECIPIENT.to_string())
    );
    let reissue = message(
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .issue_claim_key("Second", "VESTKEY")
            .egld(big(ISSUE_COST))
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    );
    assert_eq!(reissue, Err("Token ID already set".to_string()));
    let reissue = message(
        f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .issue_cancel_key("Second", "VESTCANCEL")
            .egld(big(ISSUE_COST))
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ()),
    );
    assert_eq!(reissue, Err("Token ID already set".to_string()));
    check_untouched(&mut f);

    // Everything the owner can switch, switched.
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .pause_creation()
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_fee(big(EGLD))
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_token_fee(200u32)
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_stamping(false)
        .run();
    let mut uris = MultiValueEncoded::new();
    uris.push(ManagedBuffer::from("https://mvxvest.io/nft/new.svg"));
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .set_key_display(KeyKind::Claim, "ipfs://new", uris)
        .run();
    f.world
        .tx()
        .from(OWNER)
        .to(SC)
        .typed(MvxvestProxy)
        .claim_fees()
        .run();
    check_untouched_but_fees(&mut f);

    f.set_time(T0 + 500);
    assert_eq!(f.view(1).claimable, big(500));
    assert_eq!(claim_with(&mut f, ALICE, key(KeyKind::Claim, 1)), Ok(()));
    f.check_fox(ALICE, 500);
    // Stamping off: the key goes back as minted.
    f.world
        .check_account(ALICE)
        .esdt_nft_balance_and_attributes(
            CLAIM_KEY,
            1,
            1,
            key_attributes(1, FOX.as_str(), true).as_bytes(),
        );
    assert_eq!(
        cancel_with(&mut f, CREATOR, key(KeyKind::Cancel, 1)),
        Ok(())
    );
    f.check_fox(CREATOR, 10u128.pow(36) - 500);
    f.check_invariant(Some(FOX));

    // A payout bounced back: the owner can move that, and no more.
    bounce_fox(&mut f, CREATOR, 40);
    assert_eq!(
        recover_surplus(&mut f, OWNER, token(FOX), BOB.to_managed_address(), Some(0)),
        Err(ERR_ZERO_AMOUNT.to_string())
    );
    assert_eq!(
        recover_surplus(
            &mut f,
            OWNER,
            token(FOX),
            BOB.to_managed_address(),
            Some(41)
        ),
        Err(ERR_ABOVE_SURPLUS.to_string())
    );
    assert_eq!(
        recover_surplus(
            &mut f,
            MALLORY,
            token(FOX),
            MALLORY.to_managed_address(),
            Some(40)
        ),
        Err(ERR_ONLY_OWNER.to_string())
    );
    assert_eq!(
        recover_surplus(
            &mut f,
            OWNER,
            token(FOX),
            BOB.to_managed_address(),
            Some(40)
        ),
        Ok(())
    );
    f.check_fox(BOB, 40);
    f.check_invariant(Some(FOX));
}

/// Like `check_untouched`, after the owner collected the fee.
fn check_untouched_but_fees(f: &mut Fixture) {
    let view = f.view(1);
    assert_eq!(view.claimed, big(0));
    assert_eq!(view.cancelled_at, 0);
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
    f.check_invariant(Some(FOX));
    f.check_invariant(None);
    assert_eq!(f.fees_accrued(), big(0));
}

/// SAFE: `create` and `createBatch` are open to anyone, but a key or another
/// NFT cannot be vested (`only fungible tokens can be vested`), the contract
/// itself and the zero address cannot be beneficiaries, and a stranger's
/// creation pays its own deposit: it gives the stranger a cancel key for
/// its own vesting only, never a key of someone else's.
#[test]
fn safe_create_takes_only_fungible_deposits_and_names_only_real_beneficiaries() {
    let mut f = world();
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        one(OTHER_NFT, 1, 1),
        ERR_NOT_FUNGIBLE,
    );
    let mut key_and_fee = key(KeyKind::Cancel, 1);
    key_and_fee.push(Payment::new(
        native(),
        0,
        NonZeroBigUint::new_or_panic(big(EGLD / 10)),
    ));
    f.create_fails(
        ALICE.to_managed_address(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        key_and_fee,
        ERR_NOT_FUNGIBLE,
    );
    f.create_fails(
        SC.to_managed_address(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 10), (None, EGLD / 10)]),
        ERR_BAD_BENEFICIARY,
    );
    f.create_fails(
        ManagedAddress::zero(),
        linear(T0, T0, 0, T0 + DAY),
        false,
        payments(&[(Some(FOX), 10), (None, EGLD / 10)]),
        ERR_BAD_BENEFICIARY,
    );
    check_untouched(&mut f);
    // Mallory creates a vesting of her own EGLD for Alice: she gets cancel
    // key 2, Alice claim key 2, and vesting 1 is as it was.
    let id = f.create(
        MALLORY,
        ALICE,
        linear(T0, T0, 0, T0 + DAY),
        true,
        payments(&[(None, EGLD + EGLD / 10)]),
    );
    assert_eq!(id, 2);
    f.check_holds_key(MALLORY, KeyKind::Cancel, 2, 2, "EGLD-000000");
    f.check_holds_key(ALICE, KeyKind::Claim, 2, 2, "EGLD-000000");
    f.check_holds_key(ALICE, KeyKind::Claim, 1, 1, FOX.as_str());
    f.check_holds_key(CREATOR, KeyKind::Cancel, 1, 1, FOX.as_str());
    assert_eq!(f.view(1).vesting.creator, CREATOR.to_managed_address());
    f.check_invariant(None);
    f.check_invariant(Some(FOX));
}
