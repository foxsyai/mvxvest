//! Shared fixture for the blackbox tests: a deployed contract with both key
//! collections issued through its own endpoints, funded accounts, and helpers
//! that check the accounting invariant after every step.

#![allow(dead_code)]

use multiversx_sc_scenario::imports::*;
pub use mvxvest::proxy::{
    Curve, KeyKind, MvxvestProxy, Schedule, TokenTotals, Tranche, VestingView,
};

pub const CODE: MxscPath = MxscPath::new("output/mvxvest.mxsc.json");
pub const SC: TestSCAddress = TestSCAddress::new("mvxvest");
pub const OWNER: TestAddress = TestAddress::new("owner");
pub const CREATOR: TestAddress = TestAddress::new("creator");
pub const ALICE: TestAddress = TestAddress::new("alice");
pub const BOB: TestAddress = TestAddress::new("bob");
pub const MALLORY: TestAddress = TestAddress::new("mallory");

pub const CLAIM_KEY: TestTokenId = TestTokenId::new("VESTKEY-123456");
pub const CANCEL_KEY: TestTokenId = TestTokenId::new("VESTCANCEL-123456");
/// 18 decimals.
pub const FOX: TestTokenId = TestTokenId::new("FOX-a1b2c3");
/// 6 decimals.
pub const USDC: TestTokenId = TestTokenId::new("USDC-a1b2c3");
/// 0 decimals.
pub const PTS: TestTokenId = TestTokenId::new("PTS-a1b2c3");
/// An NFT that is not a key.
pub const OTHER_NFT: TestTokenId = TestTokenId::new("ART-a1b2c3");

pub const EGLD: u128 = 1_000_000_000_000_000_000;
pub const ISSUE_COST: u128 = EGLD / 20;
/// 2026-01-01T00:00:00Z
pub const T0: u64 = 1_767_225_600;
pub const DAY: u64 = 86_400;

pub fn big(value: u128) -> BigUint<StaticApi> {
    BigUint::from(value)
}

pub fn token(id: TestTokenId) -> TokenId<StaticApi> {
    TokenId::from(id.as_str())
}

pub fn native() -> TokenId<StaticApi> {
    TokenId::native()
}

pub fn linear(start: u64, cliff: u64, cliff_amount: u128, end: u64) -> Schedule<StaticApi> {
    Schedule {
        start,
        cliff,
        cliff_amount: big(cliff_amount),
        end,
        curve: Curve::Linear,
    }
}

pub fn stepped(start: u64, end: u64, interval: u64) -> Schedule<StaticApi> {
    Schedule {
        start,
        cliff: start,
        cliff_amount: big(0),
        end,
        curve: Curve::Stepped { interval },
    }
}

pub fn tranches(start: u64, list: &[(u64, u128)]) -> Schedule<StaticApi> {
    let mut vec = ManagedVec::new();
    for (time, amount) in list {
        vec.push(Tranche {
            time: *time,
            amount: big(*amount),
        });
    }
    Schedule {
        start,
        cliff: start,
        cliff_amount: big(0),
        end: list.last().map(|(t, _)| *t).unwrap_or(start),
        curve: Curve::Tranches(vec),
    }
}

/// Payments for a transaction: `(token, amount)`, `None` meaning EGLD.
pub fn payments(list: &[(Option<TestTokenId>, u128)]) -> ManagedVec<StaticApi, Payment<StaticApi>> {
    let mut vec = ManagedVec::new();
    for (id, amount) in list {
        let token_id = match id {
            Some(id) => token(*id),
            None => native(),
        };
        vec.push(Payment::new(
            token_id,
            0,
            NonZeroBigUint::new_or_panic(big(*amount)),
        ));
    }
    vec
}

pub fn key(kind: KeyKind, nonce: u64) -> ManagedVec<StaticApi, Payment<StaticApi>> {
    let id = match kind {
        KeyKind::Claim => CLAIM_KEY,
        KeyKind::Cancel => CANCEL_KEY,
    };
    let mut vec = ManagedVec::new();
    vec.push(Payment::new(token(id), nonce, NonZeroBigUint::one()));
    vec
}

pub fn keys(kind: KeyKind, nonces: &[u64]) -> ManagedVec<StaticApi, Payment<StaticApi>> {
    let mut vec = ManagedVec::new();
    for nonce in nonces {
        vec.extend(key(kind, *nonce).iter().map(|p| p.clone()));
    }
    vec
}

pub fn attributes(id: u64, token_id: &str) -> String {
    format!("tags:mvxvest,vesting;vesting:{id};token:{token_id}")
}

pub struct Fixture {
    pub world: ScenarioWorld,
}

impl Fixture {
    /// Deployed, both key collections issued, time at `T0`.
    pub fn new() -> Self {
        let mut fixture = Self::without_keys();
        fixture.issue_keys();
        fixture
    }

    /// Deployed, no key collection issued yet.
    pub fn without_keys() -> Self {
        let mut world = ScenarioWorld::new();
        world.set_current_dir_from_workspace("contracts/vesting");
        world.register_contract(CODE, mvxvest::ContractBuilder);

        let lots = big(10u128.pow(36));
        world.account(OWNER).nonce(1).balance(big(10 * EGLD));
        world
            .account(CREATOR)
            .nonce(1)
            .balance(big(1_000_000 * EGLD))
            .esdt_balance(FOX, lots.clone())
            .esdt_balance(USDC, lots.clone())
            .esdt_balance(PTS, lots)
            .esdt_nft_balance(OTHER_NFT, 1, 1, ());
        for account in [ALICE, BOB, MALLORY] {
            world.account(account).nonce(1).balance(big(100 * EGLD));
        }
        world
            .current_block()
            .block_timestamp_seconds(TimestampSeconds::new(T0));

        world
            .tx()
            .from(OWNER)
            .typed(MvxvestProxy)
            .init()
            .code(CODE)
            .code_metadata(CodeMetadata::UPGRADEABLE | CodeMetadata::READABLE)
            .new_address(SC)
            .run();
        Self { world }
    }

    pub fn issue_keys(&mut self) {
        self.world.set_state_step(
            SetStateStep::new()
                .new_token_identifier(CLAIM_KEY.as_str())
                .new_token_identifier(CANCEL_KEY.as_str()),
        );
        self.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .issue_claim_key("MvxVestClaimKey", "VESTKEY")
            .egld(big(ISSUE_COST))
            .run();
        self.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .issue_cancel_key("MvxVestCancelKey", "VESTCANCEL")
            .egld(big(ISSUE_COST))
            .run();
    }

    pub fn set_time(&mut self, t: u64) {
        self.world
            .current_block()
            .block_timestamp_seconds(TimestampSeconds::new(t));
    }

    /// Creates a vesting of `total` FOX for `beneficiary`.
    pub fn create_fox(
        &mut self,
        beneficiary: TestAddress,
        total: u128,
        schedule: Schedule<StaticApi>,
        cancelable: bool,
    ) -> u64 {
        self.create(
            CREATOR,
            beneficiary,
            schedule,
            cancelable,
            payments(&[(Some(FOX), total)]),
        )
    }

    /// The total a dApp would sign for this payment: the ESDT paid, or the
    /// EGLD paid minus the current fee. Tests of fee changes pass an explicit
    /// total to the contract instead.
    pub fn total_for(
        &mut self,
        payment: &ManagedVec<StaticApi, Payment<StaticApi>>,
    ) -> BigUint<StaticApi> {
        let mut esdt = BigUint::zero();
        let mut egld = BigUint::zero();
        for p in payment.iter() {
            if p.token_identifier.is_native() {
                egld += p.amount.as_big_uint();
            } else {
                esdt += p.amount.as_big_uint();
            }
        }
        if esdt > 0u32 {
            return esdt;
        }
        let fee: BigUint<StaticApi> = self
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_fee()
            .returns(ReturnsResult)
            .run();
        if egld > fee {
            egld - fee
        } else {
            BigUint::zero()
        }
    }

    pub fn create(
        &mut self,
        from: TestAddress,
        beneficiary: TestAddress,
        schedule: Schedule<StaticApi>,
        cancelable: bool,
        payment: ManagedVec<StaticApi, Payment<StaticApi>>,
    ) -> u64 {
        let total = self.total_for(&payment);
        self.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .create(beneficiary, total, schedule, cancelable, "team")
            .payment(payment)
            .returns(ReturnsResult)
            .run()
    }

    pub fn create_fails(
        &mut self,
        beneficiary: ManagedAddress<StaticApi>,
        schedule: Schedule<StaticApi>,
        cancelable: bool,
        payment: ManagedVec<StaticApi, Payment<StaticApi>>,
        error: &str,
    ) {
        let total = self.total_for(&payment);
        self.world
            .tx()
            .from(CREATOR)
            .to(SC)
            .typed(MvxvestProxy)
            .create(beneficiary, total, schedule, cancelable, "team")
            .payment(payment)
            .returns(ExpectError(4, error))
            .run();
    }

    pub fn claim(&mut self, from: TestAddress, nonces: &[u64]) {
        self.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(keys(KeyKind::Claim, nonces))
            .run();
    }

    pub fn claim_fails(&mut self, from: TestAddress, nonces: &[u64], error: &str) {
        self.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(keys(KeyKind::Claim, nonces))
            .returns(ExpectError(4, error))
            .run();
    }

    pub fn cancel(&mut self, from: TestAddress, nonces: &[u64]) {
        self.world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .cancel()
            .payment(keys(KeyKind::Cancel, nonces))
            .run();
    }

    /// Sends a key from one account to another, like a wallet would.
    pub fn send_key(&mut self, kind: KeyKind, nonce: u64, from: TestAddress, to: TestAddress) {
        let collection = match kind {
            KeyKind::Claim => CLAIM_KEY,
            KeyKind::Cancel => CANCEL_KEY,
        };
        self.world.transfer_step(
            TransferStep::new()
                .from(from.eval_to_expr().as_str())
                .to(to.eval_to_expr().as_str())
                .esdt_transfer(collection.eval_to_expr().as_str(), nonce, "1"),
        );
    }

    pub fn view(&mut self, id: u64) -> VestingView<StaticApi> {
        self.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_vesting(id)
            .returns(ReturnsResult)
            .run()
    }

    pub fn totals(&mut self, token_id: TokenId<StaticApi>) -> TokenTotals<StaticApi> {
        self.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_token_totals(token_id)
            .returns(ReturnsResult)
            .run()
    }

    pub fn fees_accrued(&mut self) -> BigUint<StaticApi> {
        self.world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_fees_accrued()
            .returns(ReturnsResult)
            .run()
    }

    /// The contract holds exactly what it owes of `id`: deposited minus
    /// claimed minus refunded (plus the unclaimed fees, for EGLD).
    pub fn check_invariant(&mut self, id: Option<TestTokenId>) {
        match id {
            Some(id) => {
                let totals = self.totals(token(id));
                let owed = totals.deposited - totals.claimed - totals.refunded;
                self.world.check_account(SC).esdt_balance(id, owed);
            }
            None => {
                let totals = self.totals(native());
                let owed = totals.deposited - totals.claimed - totals.refunded;
                let fees = self.fees_accrued();
                self.world.check_account(SC).balance(owed + fees);
            }
        }
    }

    pub fn check_fox(&mut self, account: TestAddress, expected: u128) {
        self.world
            .check_account(account)
            .esdt_balance(FOX, big(expected));
    }

    /// `account` holds the key with this nonce, minted for vesting `id`.
    pub fn check_holds_key(
        &mut self,
        account: TestAddress,
        kind: KeyKind,
        nonce: u64,
        id: u64,
        token_id: &str,
    ) {
        let collection = match kind {
            KeyKind::Claim => CLAIM_KEY,
            KeyKind::Cancel => CANCEL_KEY,
        };
        self.world
            .check_account(account)
            .esdt_nft_balance_and_attributes(
                collection,
                nonce,
                1,
                attributes(id, token_id).as_bytes(),
            );
    }
}
