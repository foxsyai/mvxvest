//! Fifth audit (reviewer MONEY, 1 Nov 2026): a deterministic random walk over
//! every path that moves or books value in version 3, checked after every
//! step against an independent model. It goes where the fourth audit's walk
//! (`audit4_contract_money_random_walk`) did not:
//!
//! - four vested tokens: FOX (18 decimals, up to 1e30 units in one vesting),
//!   USDC (6), PTS (0, amounts down to one unit) and EGLD;
//! - claim keys held by anyone, the creator and the owner included; cancel
//!   keys held by the beneficiary too (a cancel by whoever holds the key);
//! - time that jumps exactly onto a boundary (a cliff, a tranche, a step, the
//!   end, or one second before), so claims and cancels land on every edge;
//! - the stamp of version 3 checked on every returned key (name, attributes
//!   and URIs), with `setKeyStamping` and `setKeyDisplay` toggled at random:
//!   a key keeps the display it was minted with and, with stamping off, the
//!   last stamp it got;
//! - bounced keys (a key that came back to the contract) and their recovery
//!   by the owner, with every refusal (stranger, unknown vesting, a key the
//!   contract does not hold, a bad recipient);
//! - keys sent to the wrong endpoint, a foreign NFT, tokens next to a key,
//!   the same key twice, a stale fee after a fee change: every one refused
//!   with nothing changed;
//! - the largest batches (49 plain, 32 cancelable) with both fees on;
//! - `getDeficit` is 0 and `getClaimKeyStatus` agrees with `getVesting`
//!   after every step.
//!
//! The invariant after every step, for each token: the contract's balance
//! equals `deposited - claimed - refunded` (what it owes), plus the accrued
//! EGLD fees, plus the bounced amounts not yet recovered; `getSurplus` is
//! exactly the bounced amounts and `getDeficit` is 0. Every account's balance
//! of every token is exact. At the end everything is claimed, recovered and
//! collected, and the contract holds nothing.
//!
//! It passes on 26b0d4c: no sequence found pays more than owed in total or to
//! one key, or leaves owed funds short.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use common::*;
use multiversx_sc_scenario::imports::*;
use mvxvest::errors::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn pick<T: Copy>(&mut self, list: &[T]) -> T {
        list[self.below(list.len() as u64) as usize]
    }
}

#[derive(Default, Debug)]
struct Counts {
    create_ok: usize,
    create_batch_ok: usize,
    create_max_batch_ok: usize,
    create_refused: usize,
    create_stale_fee_refused: usize,
    claim_paid_or_burned: usize,
    claim_nothing: usize,
    claim_burned_keys: usize,
    claim_boundary: usize,
    cancels: usize,
    cancel_boundary: usize,
    key_moves: usize,
    key_bounces: usize,
    key_recoveries: usize,
    key_recoveries_refused: usize,
    wrong_payments_refused: usize,
    fee_sets: usize,
    token_fee_sets: usize,
    fees_claimed: usize,
    pause_toggles: usize,
    stamping_toggles: usize,
    display_sets: usize,
    bounces: usize,
    recoveries: usize,
    recoveries_refused: usize,
    stranger_refused: usize,
    keys_checked: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Tok {
    Fox,
    Usdc,
    Pts,
    Egld,
}
const TOKENS: [Tok; 4] = [Tok::Fox, Tok::Usdc, Tok::Pts, Tok::Egld];

impl Tok {
    fn id(self) -> TokenId<StaticApi> {
        match self {
            Tok::Fox => token(FOX),
            Tok::Usdc => token(USDC),
            Tok::Pts => token(PTS),
            Tok::Egld => native(),
        }
    }
    fn test_id(self) -> Option<TestTokenId<'static>> {
        match self {
            Tok::Fox => Some(FOX),
            Tok::Usdc => Some(USDC),
            Tok::Pts => Some(PTS),
            Tok::Egld => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Tok::Fox => FOX.as_str(),
            Tok::Usdc => USDC.as_str(),
            Tok::Pts => PTS.as_str(),
            Tok::Egld => "EGLD-000000",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Acct {
    Creator,
    Alice,
    Bob,
    Mallory,
    Owner,
    /// The contract itself: a key that bounced back sits there.
    Contract,
}
const ACCTS: [Acct; 5] = [
    Acct::Creator,
    Acct::Alice,
    Acct::Bob,
    Acct::Mallory,
    Acct::Owner,
];
/// Who may hold a claim key: the creator buys keys back, the owner gets
/// vestings too.
const HOLDERS: [Acct; 5] = [
    Acct::Alice,
    Acct::Bob,
    Acct::Creator,
    Acct::Mallory,
    Acct::Owner,
];

impl Acct {
    fn addr(self) -> TestAddress<'static> {
        match self {
            Acct::Creator => CREATOR,
            Acct::Alice => ALICE,
            Acct::Bob => BOB,
            Acct::Mallory => MALLORY,
            Acct::Owner => OWNER,
            Acct::Contract => panic!("the contract has no wallet"),
        }
    }
    fn managed(self) -> ManagedAddress<StaticApi> {
        match self {
            Acct::Contract => SC.to_managed_address(),
            other => other.addr().to_managed_address(),
        }
    }
}

#[derive(Clone, Debug)]
enum Shape {
    Linear,
    Stepped(u64),
    Tranches(Vec<(u64, u128)>),
}

/// (start, cliff, cliff_amount, end, shape)
type Sched = (u64, u64, u128, u64, Shape);

#[derive(Clone, Debug)]
struct Model {
    tok: Tok,
    total: u128,
    schedule: Sched,
    cancelable: bool,
    cancelled_at: u64,
    claimed: u128,
    claim_nonce: u64,
    cancel_nonce: u64,
    /// The display (metadata, uris) the keys were minted with.
    minted_metadata: String,
    minted_uris: Vec<String>,
    /// What the claim key's last stamp says, if it was ever stamped.
    stamped: Option<u128>,
}

fn vested(m: &Model, t: u64) -> u128 {
    let (start, cliff, cliff_amount, end, shape) = &m.schedule;
    let t = if m.cancelled_at != 0 && m.cancelled_at < t {
        m.cancelled_at
    } else {
        t
    };
    if t < *cliff {
        return 0;
    }
    if t >= *end {
        return m.total;
    }
    let rest = m.total - cliff_amount;
    let released = match shape {
        Shape::Linear => rest * (t - start) as u128 / (end - start) as u128,
        Shape::Stepped(interval) => {
            let steps = (end - start).div_ceil(*interval) as u128;
            let done = ((t - start) / interval) as u128;
            rest * done / steps
        }
        Shape::Tranches(list) => list
            .iter()
            .filter(|(time, _)| *time <= t)
            .map(|(_, a)| a)
            .sum(),
    };
    cliff_amount + released
}

fn final_amount(m: &Model) -> u128 {
    if m.cancelled_at != 0 {
        vested(m, m.cancelled_at)
    } else {
        m.total
    }
}

/// Every moment the vested amount can change, and the second before each.
fn boundaries(m: &Model) -> Vec<u64> {
    let (start, cliff, _, end, shape) = &m.schedule;
    let mut out = vec![*start, *cliff, *end];
    match shape {
        Shape::Linear => {}
        Shape::Stepped(interval) => {
            let mut t = *start;
            while t < *end {
                t += interval;
                out.push(t.min(*end));
            }
        }
        Shape::Tranches(list) => out.extend(list.iter().map(|(t, _)| *t)),
    }
    let before: Vec<u64> = out.iter().map(|t| t.saturating_sub(1)).collect();
    out.extend(before);
    out
}

fn to_schedule(s: &Sched) -> Schedule<StaticApi> {
    let curve = match &s.4 {
        Shape::Linear => Curve::Linear,
        Shape::Stepped(interval) => Curve::Stepped {
            interval: *interval,
        },
        Shape::Tranches(list) => {
            let mut vec = ManagedVec::new();
            for (time, amount) in list {
                vec.push(Tranche {
                    time: *time,
                    amount: big(*amount),
                });
            }
            Curve::Tranches(vec)
        }
    };
    Schedule {
        start: s.0,
        cliff: s.1,
        cliff_amount: big(s.2),
        end: s.3,
        curve,
    }
}

fn random_schedule(rng: &mut Rng, now: u64, total: u128) -> Sched {
    let start = now - 2_000 + rng.below(4_000);
    let duration = if rng.chance(10) {
        0
    } else if rng.chance(30) {
        1 + rng.below(50)
    } else {
        1 + rng.below(5_000)
    };
    let end = start + duration;
    let cliff = if rng.chance(50) {
        start
    } else {
        start + rng.below(duration + 1)
    };
    let kind = rng.below(3);
    if kind == 2 && duration > 0 && total >= 2 {
        let max_count = std::cmp::min(8, duration).min((total - 1).min(u64::MAX as u128) as u64);
        let count = 1 + rng.below(max_count) as usize;
        let mut times = BTreeSet::new();
        while times.len() < count - 1 {
            times.insert(start + rng.below(duration));
        }
        let mut times: Vec<u64> = times.into_iter().collect();
        times.push(end);
        let cliff_amount = below_u128(rng, total - count as u128 + 1);
        let mut left = total - cliff_amount;
        let mut list = Vec::new();
        for (i, time) in times.iter().enumerate() {
            let remaining = (times.len() - i - 1) as u128;
            let amount = if remaining == 0 {
                left
            } else {
                1 + below_u128(rng, left - remaining)
            };
            left -= amount;
            list.push((*time, amount));
        }
        return (start, cliff, cliff_amount, end, Shape::Tranches(list));
    }
    let cliff_amount = if rng.chance(10) {
        total
    } else if rng.chance(30) {
        below_u128(rng, total + 1)
    } else {
        0
    };
    if kind == 1 && duration > 0 {
        let interval = 1 + rng.below(duration);
        return (start, cliff, cliff_amount, end, Shape::Stepped(interval));
    }
    (start, cliff, cliff_amount, end, Shape::Linear)
}

/// A number below `n`, for `n` up to 2^128.
fn below_u128(rng: &mut Rng, n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let wide = ((rng.next() as u128) << 64) | rng.next() as u128;
    wide % n
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Nft {
    amount: u64,
    name: String,
    attributes: String,
    uris: Vec<String>,
}

struct State {
    f: Fixture,
    rng: Rng,
    now: u64,
    fee: u128,
    previous_fee: u128,
    bps: u32,
    previous_bps: u32,
    paused: bool,
    stamping: bool,
    /// The current display of each kind of key: (metadata, uris).
    display_claim: (String, Vec<String>),
    display_cancel: (String, Vec<String>),
    /// The cancel display each cancelable vesting's cancel key was minted with.
    cancel_display: BTreeMap<u64, (String, Vec<String>)>,
    accrued: u128,
    vestings: BTreeMap<u64, Model>,
    /// claim nonce -> (holder, vesting id)
    claim_keys: BTreeMap<u64, (Acct, u64)>,
    /// cancel nonce -> (holder, vesting id)
    cancel_keys: BTreeMap<u64, (Acct, u64)>,
    balances: BTreeMap<(Acct, Tok), u128>,
    deposited: BTreeMap<Tok, u128>,
    claimed: BTreeMap<Tok, u128>,
    refunded: BTreeMap<Tok, u128>,
    surplus: BTreeMap<Tok, u128>,
    counts: Counts,
}

impl State {
    fn credit(&mut self, a: Acct, tok: Tok, amount: u128) {
        *self.balances.get_mut(&(a, tok)).unwrap() += amount;
    }
    fn debit(&mut self, a: Acct, tok: Tok, amount: u128) {
        *self.balances.get_mut(&(a, tok)).unwrap() -= amount;
    }
    fn token_fee_of(&self, total: u128) -> u128 {
        total * self.bps as u128 / 10_000
    }

    fn surplus_view(&mut self, tok: Tok) -> BigUint<StaticApi> {
        self.f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_surplus(tok.id())
            .returns(ReturnsResult)
            .run()
    }

    fn deficit_view(&mut self, tok: Tok) -> BigUint<StaticApi> {
        self.f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .get_deficit(tok.id())
            .returns(ReturnsResult)
            .run()
    }

    /// A key as `holder` has it (amount 0 when it has none).
    fn key_of(&mut self, kind: KeyKind, holder: Acct, nonce: u64) -> Nft {
        let collection = match kind {
            KeyKind::Claim => CLAIM_KEY,
            KeyKind::Cancel => CANCEL_KEY,
        };
        let address = holder.managed();
        let mut found = Nft::default();
        self.f
            .world
            .query()
            .to(SC)
            .whitebox(mvxvest::contract_obj, |sc| {
                let data = sc.blockchain().get_esdt_token_data(
                    &ManagedAddress::from(address.to_address()),
                    &EsdtTokenIdentifier::from(collection.as_str()),
                    nonce,
                );
                let text = |b: &ManagedBuffer<DebugApi>| {
                    String::from_utf8(b.to_boxed_bytes().into_vec()).unwrap()
                };
                found = Nft {
                    amount: data.amount.to_u64().unwrap_or(u64::MAX),
                    name: text(&data.name),
                    attributes: text(&data.attributes),
                    uris: data.uris.iter().map(|u| text(&u)).collect(),
                };
            });
        found
    }

    fn expected_claim_key(&self, id: u64) -> Nft {
        let m = &self.vestings[&id];
        let mut name = if m.cancelable {
            format!("Vesting #{id} claim key, cancelable")
        } else {
            format!("Vesting #{id} claim key")
        };
        let mut attributes = format!(
            "tags:mvxvest,vesting;vesting:{id};token:{};cancelable:{}",
            m.tok.name(),
            u8::from(m.cancelable)
        );
        if let Some(claimed) = m.stamped {
            let percent = claimed * 100 / m.total;
            if percent == 0 {
                name.push_str(", under 1% claimed");
            } else {
                name.push_str(&format!(", {percent}% claimed"));
            }
            attributes.push_str(&format!(";claimed:{claimed}"));
        }
        if !m.minted_metadata.is_empty() {
            attributes.push_str(&format!(";metadata:{}", m.minted_metadata));
        }
        let uris = if m.minted_uris.is_empty() {
            vec![String::new()]
        } else {
            m.minted_uris.clone()
        };
        Nft {
            amount: 1,
            name,
            attributes,
            uris,
        }
    }

    fn expected_cancel_key(&self, id: u64) -> Nft {
        let m = &self.vestings[&id];
        let mut attributes = format!(
            "tags:mvxvest,vesting;vesting:{id};token:{};cancelable:1",
            m.tok.name()
        );
        let (metadata, uris) = self.cancel_display[&id].clone();
        if !metadata.is_empty() {
            attributes.push_str(&format!(";metadata:{metadata}"));
        }
        let uris = if uris.is_empty() {
            vec![String::new()]
        } else {
            uris
        };
        Nft {
            amount: 1,
            name: format!("Vesting #{id} cancel key"),
            attributes,
            uris,
        }
    }

    /// Every live key is where the model says, byte for byte.
    fn check_keys(&mut self) {
        let claim: Vec<(u64, Acct, u64)> = self
            .claim_keys
            .iter()
            .map(|(n, (h, id))| (*n, *h, *id))
            .collect();
        for (nonce, holder, id) in claim {
            let expected = self.expected_claim_key(id);
            let found = self.key_of(KeyKind::Claim, holder, nonce);
            assert_eq!(found, expected, "claim key {nonce} of #{id} at {holder:?}");
            self.counts.keys_checked += 1;
        }
        let cancel: Vec<(u64, Acct, u64)> = self
            .cancel_keys
            .iter()
            .map(|(n, (h, id))| (*n, *h, *id))
            .collect();
        for (nonce, holder, id) in cancel {
            let expected = self.expected_cancel_key(id);
            let found = self.key_of(KeyKind::Cancel, holder, nonce);
            assert_eq!(found, expected, "cancel key {nonce} of #{id} at {holder:?}");
            self.counts.keys_checked += 1;
        }
    }

    fn check(&mut self) {
        for tok in TOKENS {
            let totals = self.f.totals(tok.id());
            assert_eq!(
                totals.deposited,
                big(self.deposited[&tok]),
                "deposited {tok:?}"
            );
            assert_eq!(totals.claimed, big(self.claimed[&tok]), "claimed {tok:?}");
            assert_eq!(
                totals.refunded,
                big(self.refunded[&tok]),
                "refunded {tok:?}"
            );
            let owed = self.deposited[&tok] - self.claimed[&tok] - self.refunded[&tok];
            let fees = if tok == Tok::Egld { self.accrued } else { 0 };
            let expected = owed + fees + self.surplus[&tok];
            match tok.test_id() {
                Some(id) => {
                    self.f
                        .world
                        .check_account(SC)
                        .esdt_balance(id, big(expected));
                }
                None => {
                    self.f.world.check_account(SC).balance(big(expected));
                }
            }
            let surplus = self.surplus_view(tok);
            assert_eq!(surplus, big(self.surplus[&tok]), "surplus {tok:?}");
            let deficit = self.deficit_view(tok);
            assert_eq!(deficit, big(0), "deficit {tok:?}");
        }
        assert_eq!(self.f.fees_accrued(), big(self.accrued), "fees accrued");
        for a in ACCTS {
            let fox = self.balances[&(a, Tok::Fox)];
            let usdc = self.balances[&(a, Tok::Usdc)];
            let pts = self.balances[&(a, Tok::Pts)];
            let egld = self.balances[&(a, Tok::Egld)];
            self.f
                .world
                .check_account(a.addr())
                .esdt_balance(FOX, big(fox))
                .esdt_balance(USDC, big(usdc))
                .esdt_balance(PTS, big(pts))
                .balance(big(egld));
        }
        let ids: Vec<u64> = self.vestings.keys().copied().collect();
        for id in ids {
            let m = self.vestings[&id].clone();
            let view = self.f.view(id);
            let vested_now = vested(&m, self.now);
            assert_eq!(view.vesting.total, big(m.total), "total of #{id}");
            assert_eq!(view.vesting.token, m.tok.id(), "token of #{id}");
            assert_eq!(view.vested, big(vested_now), "vested of #{id}");
            assert_eq!(view.claimed, big(m.claimed), "claimed of #{id}");
            assert_eq!(
                view.claimable,
                big(vested_now - m.claimed),
                "claimable of #{id}"
            );
            assert_eq!(view.final_amount, big(final_amount(&m)), "final of #{id}");
            assert_eq!(
                view.refunded,
                big(m.total - final_amount(&m)),
                "refunded of #{id}"
            );
            assert_eq!(view.cancelled_at, m.cancelled_at, "cancelled_at of #{id}");
            assert!(
                m.claimed <= final_amount(&m),
                "#{id} paid beyond its final amount"
            );
        }
        // The key status view agrees with the vesting view for one random key.
        let nonces: Vec<u64> = self.claim_keys.keys().copied().collect();
        if !nonces.is_empty() {
            let nonce = self.rng.pick(&nonces);
            let id = self.claim_keys[&nonce].1;
            let status: VestingView<StaticApi> = self
                .f
                .world
                .query()
                .to(SC)
                .typed(MvxvestProxy)
                .get_claim_key_status(nonce)
                .returns(ReturnsResult)
                .run();
            let view = self.f.view(id);
            assert_eq!(status.id, id);
            assert_eq!(status.claimed, view.claimed);
            assert_eq!(status.claimable, view.claimable);
            assert_eq!(status.final_amount, view.final_amount);
            assert_eq!(status.cancelled_at, view.cancelled_at);
        }
    }

    fn total_for(&mut self, tok: Tok) -> u128 {
        match tok {
            Tok::Fox => match self.rng.below(3) {
                0 => 1 + self.rng.below(10) as u128,
                1 => 1 + self.rng.below(u64::MAX) as u128,
                // A 1e30 supply in one vesting.
                _ => 10u128.pow(30) + below_u128(&mut self.rng, 10u128.pow(18)),
            },
            Tok::Usdc => 1 + self.rng.below(100_000_000_000) as u128,
            Tok::Pts => 1 + self.rng.below(5_000) as u128,
            Tok::Egld => {
                if self.rng.chance(20) {
                    1 + self.rng.below(1_000) as u128
                } else {
                    (1 + self.rng.below(1_000_000) as u128) * 1_000_000_000
                }
            }
        }
    }

    fn create(&mut self, batch: bool) {
        let tok = self.rng.pick(&TOKENS);
        let cancelable = self.rng.chance(60);
        let count = if !batch {
            1
        } else if self.rng.chance(8) {
            if cancelable {
                32
            } else {
                49
            }
        } else {
            1 + self.rng.below(6) as usize
        };
        let mut entries = Vec::new();
        for _ in 0..count {
            let total = self.total_for(tok);
            let schedule = random_schedule(&mut self.rng, self.now, total);
            let holder = self.rng.pick(&HOLDERS);
            entries.push((holder, total, schedule));
        }
        let sum: u128 = entries.iter().map(|e| e.1).sum();
        let token_fee: u128 = entries.iter().map(|e| self.token_fee_of(e.1)).sum();
        let fees = self.fee * count as u128;

        // Sometimes a payment that is wrong: one unit off, the fee of before
        // the last change, or the token fee of before the last change.
        let mut wrong: Option<&str> = None;
        let mut stale = false;
        let mut pay_sum = sum;
        let mut pay_token_fee = token_fee;
        let mut pay_fees = fees;
        if self.rng.chance(12) {
            match self.rng.below(5) {
                0 => {
                    wrong = Some(ERR_WRONG_DEPOSIT);
                    pay_sum += 1;
                }
                1 => {
                    if pay_sum > 1 {
                        wrong = Some(ERR_WRONG_DEPOSIT);
                        pay_sum -= 1;
                    }
                }
                2 => {
                    if self.previous_fee != self.fee {
                        stale = true;
                        pay_fees = self.previous_fee * count as u128;
                        wrong = Some(if tok == Tok::Egld {
                            ERR_WRONG_DEPOSIT
                        } else {
                            ERR_WRONG_FEE
                        });
                    }
                }
                3 => {
                    let old: u128 = entries
                        .iter()
                        .map(|e| e.1 * self.previous_bps as u128 / 10_000)
                        .sum();
                    if old != token_fee {
                        stale = true;
                        pay_token_fee = old;
                        wrong = Some(ERR_WRONG_DEPOSIT);
                    }
                }
                _ => {
                    if fees > 0 {
                        wrong = Some(if tok == Tok::Egld {
                            ERR_WRONG_DEPOSIT
                        } else {
                            ERR_WRONG_FEE
                        });
                        pay_fees = 0;
                    }
                }
            }
        }
        let pay = if tok == Tok::Egld {
            payments(&[(None, pay_sum + pay_token_fee + pay_fees)])
        } else {
            let id = tok.test_id().unwrap();
            if pay_fees > 0 {
                payments(&[(Some(id), pay_sum + pay_token_fee), (None, pay_fees)])
            } else {
                payments(&[(Some(id), pay_sum + pay_token_fee)])
            }
        };
        let expected_err = if self.paused {
            Some(ERR_CREATION_PAUSED)
        } else {
            wrong
        };

        let result: Result<Vec<u64>, String> = if batch {
            let mut list = MultiValueEncoded::new();
            for (holder, total, schedule) in &entries {
                list.push(
                    (
                        holder.addr().to_managed_address(),
                        big(*total),
                        to_schedule(schedule),
                    )
                        .into(),
                );
            }
            self.f
                .world
                .tx()
                .from(CREATOR)
                .to(SC)
                .typed(MvxvestProxy)
                .create_batch(cancelable, "audit5", list)
                .payment(pay)
                .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
                .run()
                .map(|ids: MultiValueEncoded<StaticApi, u64>| ids.to_vec().into_iter().collect())
                .map_err(|e| e.message)
        } else {
            let (holder, total, schedule) = &entries[0];
            self.f
                .world
                .tx()
                .from(CREATOR)
                .to(SC)
                .typed(MvxvestProxy)
                .create(
                    holder.addr(),
                    big(*total),
                    to_schedule(schedule),
                    cancelable,
                    "audit5",
                )
                .payment(pay)
                .returns(ReturnsHandledOrError::new().returns(ReturnsResult))
                .run()
                .map(|id: u64| vec![id])
                .map_err(|e| e.message)
        };
        match expected_err {
            Some(error) => {
                assert_eq!(result, Err(error.to_string()), "creation at {}", self.now);
                self.counts.create_refused += 1;
                if stale {
                    self.counts.create_stale_fee_refused += 1;
                }
                return;
            }
            None => assert!(result.is_ok(), "creation failed: {result:?} {entries:?}"),
        }
        let ids = result.unwrap();
        assert_eq!(ids.len(), count);
        self.counts.create_ok += 1;
        if batch {
            self.counts.create_batch_ok += 1;
        }
        if count >= 32 {
            self.counts.create_max_batch_ok += 1;
        }

        if tok == Tok::Egld {
            self.debit(Acct::Creator, Tok::Egld, sum + token_fee + fees);
            self.credit(Acct::Owner, Tok::Egld, token_fee);
        } else {
            self.debit(Acct::Creator, tok, sum + token_fee);
            self.debit(Acct::Creator, Tok::Egld, fees);
            self.credit(Acct::Owner, tok, token_fee);
        }
        self.accrued += fees;
        *self.deposited.get_mut(&tok).unwrap() += sum;
        let (claim_meta, claim_uris) = self.display_claim.clone();
        let cancel_display = self.display_cancel.clone();
        for (id, (holder, total, schedule)) in ids.into_iter().zip(entries) {
            let view = self.f.view(id);
            self.claim_keys
                .insert(view.vesting.claim_nonce, (holder, id));
            if cancelable {
                self.cancel_keys
                    .insert(view.vesting.cancel_nonce, (Acct::Creator, id));
                self.cancel_display.insert(id, cancel_display.clone());
            }
            self.vestings.insert(
                id,
                Model {
                    tok,
                    total,
                    schedule,
                    cancelable,
                    cancelled_at: 0,
                    claimed: 0,
                    claim_nonce: view.vesting.claim_nonce,
                    cancel_nonce: view.vesting.cancel_nonce,
                    minted_metadata: claim_meta.clone(),
                    minted_uris: claim_uris.clone(),
                    stamped: None,
                },
            );
        }
    }

    fn claim_with(
        &mut self,
        holder: Acct,
        pay: ManagedVec<StaticApi, Payment<StaticApi>>,
    ) -> Result<(), String> {
        self.f
            .world
            .tx()
            .from(holder.addr())
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(pay)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    }

    fn cancel_with(
        &mut self,
        holder: Acct,
        pay: ManagedVec<StaticApi, Payment<StaticApi>>,
    ) -> Result<(), String> {
        self.f
            .world
            .tx()
            .from(holder.addr())
            .to(SC)
            .typed(MvxvestProxy)
            .cancel()
            .payment(pay)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    }

    fn claim(&mut self) {
        let holder = self.rng.pick(&HOLDERS);
        let mine: Vec<(u64, u64)> = self
            .claim_keys
            .iter()
            .filter(|(_, (h, _))| *h == holder)
            .map(|(n, (_, id))| (*n, *id))
            .collect();
        if mine.is_empty() {
            return;
        }
        let mut chosen = Vec::new();
        for (nonce, id) in &mine {
            if chosen.is_empty() || self.rng.chance(40) {
                chosen.push((*nonce, *id));
            }
            if chosen.len() == 8 {
                break;
            }
        }
        self.claim_chosen(holder, chosen);
    }

    /// `holder` sends these claim keys in one call.
    fn claim_chosen(&mut self, holder: Acct, chosen: Vec<(u64, u64)>) {
        let nonces: Vec<u64> = chosen.iter().map(|c| c.0).collect();
        let mut progressed = false;
        let mut pay: BTreeMap<Tok, u128> = BTreeMap::new();
        let mut burned = Vec::new();
        let mut on_boundary = false;
        for (nonce, id) in &chosen {
            let m = &self.vestings[id];
            let amount = vested(m, self.now) - m.claimed;
            let finished = m.claimed + amount == final_amount(m);
            if amount > 0 || finished {
                progressed = true;
            }
            *pay.entry(m.tok).or_insert(0) += amount;
            if finished {
                burned.push(*nonce);
            }
            if boundaries(m).contains(&self.now) {
                on_boundary = true;
            }
        }
        let result = self.claim_with(holder, keys(KeyKind::Claim, &nonces));
        match &result {
            Ok(_) => {
                assert!(
                    progressed,
                    "claim of {nonces:?} at {} should have failed",
                    self.now
                );
                self.counts.claim_paid_or_burned += 1;
                if on_boundary {
                    self.counts.claim_boundary += 1;
                }
            }
            Err(e) => {
                assert!(
                    !progressed,
                    "claim of {nonces:?} at {} failed: {e}",
                    self.now
                );
                assert_eq!(*e, ERR_NOTHING_TO_CLAIM);
                self.counts.claim_nothing += 1;
                return;
            }
        }
        let stamping = self.stamping;
        for (nonce, id) in &chosen {
            let now = self.now;
            let m = self.vestings.get_mut(id).unwrap();
            let v = vested(m, now);
            let paid = v - m.claimed;
            m.claimed = v;
            let finished = burned.contains(nonce);
            if stamping && paid > 0 && !finished {
                m.stamped = Some(v);
            }
            *self.claimed.get_mut(&m.tok).unwrap() += paid;
        }
        for nonce in &burned {
            self.claim_keys.remove(nonce);
            // The key is gone from everyone, the contract included.
            let gone = self.key_of(KeyKind::Claim, holder, *nonce);
            assert_eq!(gone.amount, 0, "burned key {nonce} still with {holder:?}");
            let held = self.key_of(KeyKind::Claim, Acct::Contract, *nonce);
            assert_eq!(held.amount, 0, "burned key {nonce} still in the contract");
            self.counts.claim_burned_keys += 1;
        }
        for (tok, amount) in pay {
            self.credit(holder, tok, amount);
        }
        // The returned keys, as the holder now has them.
        for (nonce, id) in &chosen {
            if burned.contains(nonce) {
                continue;
            }
            let expected = self.expected_claim_key(*id);
            let found = self.key_of(KeyKind::Claim, holder, *nonce);
            assert_eq!(found, expected, "returned key {nonce} of #{id}");
        }
    }

    fn cancel(&mut self) {
        let holder = self.rng.pick(&HOLDERS);
        let mine: Vec<(u64, u64)> = self
            .cancel_keys
            .iter()
            .filter(|(_, (h, _))| *h == holder)
            .map(|(n, (_, id))| (*n, *id))
            .collect();
        if mine.is_empty() {
            return;
        }
        let chosen: Vec<(u64, u64)> = mine
            .into_iter()
            .filter(|_| self.rng.chance(50))
            .take(4)
            .collect();
        if chosen.is_empty() {
            return;
        }
        self.cancel_chosen(holder, chosen);
    }

    /// `holder` sends these cancel keys in one call.
    fn cancel_chosen(&mut self, holder: Acct, chosen: Vec<(u64, u64)>) {
        let nonces: Vec<u64> = chosen.iter().map(|c| c.0).collect();
        self.cancel_with(holder, keys(KeyKind::Cancel, &nonces))
            .unwrap_or_else(|e| panic!("cancel of {nonces:?} at {}: {e}", self.now));
        self.counts.cancels += chosen.len();
        for (nonce, id) in chosen {
            let now = self.now;
            let m = self.vestings.get_mut(&id).unwrap();
            if boundaries(m).contains(&now) {
                self.counts.cancel_boundary += 1;
            }
            let refund = m.total - vested(m, now);
            m.cancelled_at = now;
            let tok = m.tok;
            *self.refunded.get_mut(&tok).unwrap() += refund;
            self.credit(holder, tok, refund);
            self.cancel_keys.remove(&nonce);
            let gone = self.key_of(KeyKind::Cancel, holder, nonce);
            assert_eq!(
                gone.amount, 0,
                "burned cancel key {nonce} still with {holder:?}"
            );
        }
        // A second cancel of the same vesting cannot happen: the key is
        // burned. The model's second key would be unknown.
    }

    /// Keys sent to the wrong place, foreign NFTs, tokens next to keys, the
    /// same key twice: all refused as a whole, nothing moves.
    fn wrong_payment(&mut self) {
        let claim: Vec<(u64, (Acct, u64))> = self
            .claim_keys
            .iter()
            .filter(|(_, (h, _))| *h != Acct::Contract)
            .map(|(n, v)| (*n, *v))
            .collect();
        let cancel: Vec<(u64, (Acct, u64))> = self
            .cancel_keys
            .iter()
            .filter(|(_, (h, _))| *h != Acct::Contract)
            .map(|(n, v)| (*n, *v))
            .collect();
        let result = match self.rng.below(7) {
            0 => {
                // A claim key sent to cancel.
                let Some(&(nonce, (holder, _))) = claim.first() else {
                    return;
                };
                let r = self.cancel_with(holder, key(KeyKind::Claim, nonce));
                assert_eq!(r, Err(ERR_NOT_CANCEL_KEY.to_string()));
                r
            }
            1 => {
                // A cancel key sent to claim.
                let Some(&(nonce, (holder, _))) = cancel.first() else {
                    return;
                };
                let r = self.claim_with(holder, key(KeyKind::Cancel, nonce));
                assert_eq!(r, Err(ERR_NOT_CLAIM_KEY.to_string()));
                r
            }
            2 => {
                // A foreign NFT to claim, alone or next to a real key.
                let mut pay = ManagedVec::new();
                pay.push(Payment::new(token(OTHER_NFT), 1, NonZeroBigUint::one()));
                let r = self.claim_with(Acct::Creator, pay);
                assert_eq!(r, Err(ERR_NOT_CLAIM_KEY.to_string()));
                r
            }
            3 => {
                // The same key twice in one claim.
                let Some(&(nonce, (holder, _))) = claim.first() else {
                    return;
                };
                let r = self.claim_with(holder, keys(KeyKind::Claim, &[nonce, nonce]));
                assert!(r.is_err(), "the same key twice: {r:?}");
                r
            }
            4 => {
                // A key among the payments of create.
                let Some(&(nonce, (holder, _))) = claim.first() else {
                    return;
                };
                let fee = self.fee;
                if self.balances[&(holder, Tok::Fox)] < 10
                    || self.balances[&(holder, Tok::Egld)] < fee
                {
                    return;
                }
                let mut pay = payments(&[(Some(FOX), 10)]);
                pay.push(key(KeyKind::Claim, nonce).get(0).clone());
                let schedule = linear(self.now, self.now, 0, self.now + 10);
                if fee > 0 {
                    pay.push(payments(&[(None, fee)]).get(0).clone());
                }
                let r = self
                    .f
                    .world
                    .tx()
                    .from(holder.addr())
                    .to(SC)
                    .typed(MvxvestProxy)
                    .create(ALICE, big(10), schedule, false, "x")
                    .payment(pay)
                    .returns(ReturnsHandledOrError::new())
                    .run()
                    .map(|_| ())
                    .map_err(|e| e.message);
                let expected = if self.paused {
                    ERR_CREATION_PAUSED
                } else {
                    ERR_NOT_FUNGIBLE
                };
                assert_eq!(r, Err(expected.to_string()));
                r
            }
            5 => {
                // Tokens next to a key in claim: refused, nothing kept.
                let Some(&(nonce, (holder, _))) = claim.first() else {
                    return;
                };
                if self.balances[&(holder, Tok::Fox)] == 0 {
                    return;
                }
                let mut pay = key(KeyKind::Claim, nonce);
                pay.push(payments(&[(Some(FOX), 1)]).get(0).clone());
                let r = self.claim_with(holder, pay);
                assert_eq!(r, Err(ERR_NOT_CLAIM_KEY.to_string()));
                r
            }
            _ => {
                // The owner tries to recover a "surplus" of the key
                // collection: there is none, keys are not fungible.
                let r = self.recover(OWNER, token(CLAIM_KEY), OWNER.to_managed_address(), None);
                assert_eq!(r, Err(ERR_NO_SURPLUS.to_string()));
                r
            }
        };
        assert!(result.is_err());
        self.counts.wrong_payments_refused += 1;
    }

    fn move_key(&mut self) {
        if self.rng.chance(50) {
            let list: Vec<(u64, (Acct, u64))> = self
                .claim_keys
                .iter()
                .filter(|(_, (h, _))| *h != Acct::Contract)
                .map(|(n, v)| (*n, *v))
                .collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = self.rng.pick(&list);
            let mut to = self.rng.pick(&HOLDERS);
            if to == holder {
                to = if holder == Acct::Alice {
                    Acct::Bob
                } else {
                    Acct::Alice
                };
            }
            self.f
                .send_key(KeyKind::Claim, nonce, holder.addr(), to.addr());
            self.claim_keys.insert(nonce, (to, id));
            self.counts.key_moves += 1;
        } else {
            let list: Vec<(u64, (Acct, u64))> = self
                .cancel_keys
                .iter()
                .filter(|(_, (h, _))| *h != Acct::Contract)
                .map(|(n, v)| (*n, *v))
                .collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = self.rng.pick(&list);
            let mut to = self.rng.pick(&HOLDERS);
            if to == holder {
                to = if holder == Acct::Creator {
                    Acct::Mallory
                } else {
                    Acct::Creator
                };
            }
            self.f
                .send_key(KeyKind::Cancel, nonce, holder.addr(), to.addr());
            self.cancel_keys.insert(nonce, (to, id));
            self.counts.key_moves += 1;
        }
    }

    /// A key comes back to the contract with no call (a delivery or a return
    /// that bounced). It sits there until the owner moves it.
    fn bounce_key(&mut self) {
        let kind = if self.rng.chance(60) {
            KeyKind::Claim
        } else {
            KeyKind::Cancel
        };
        let map = match kind {
            KeyKind::Claim => &self.claim_keys,
            KeyKind::Cancel => &self.cancel_keys,
        };
        let list: Vec<(u64, (Acct, u64))> = map
            .iter()
            .filter(|(_, (h, _))| *h != Acct::Contract)
            .map(|(n, v)| (*n, *v))
            .collect();
        if list.is_empty() {
            return;
        }
        let (nonce, (holder, id)) = self.rng.pick(&list);
        self.f
            .world
            .tx()
            .from(holder.addr())
            .to(SC)
            .payment(key(kind, nonce))
            .whitebox(mvxvest::contract_obj, |_| {});
        match kind {
            KeyKind::Claim => self.claim_keys.insert(nonce, (Acct::Contract, id)),
            KeyKind::Cancel => self.cancel_keys.insert(nonce, (Acct::Contract, id)),
        };
        self.counts.key_bounces += 1;
    }

    fn recover_key(
        &mut self,
        from: TestAddress,
        id: u64,
        kind: KeyKind,
        to: ManagedAddress<StaticApi>,
    ) -> Result<(), String> {
        self.f
            .world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_bounced_key(id, kind, to)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    }

    fn recover_bounced_key(&mut self) {
        let kind = if self.rng.chance(60) {
            KeyKind::Claim
        } else {
            KeyKind::Cancel
        };
        let held: Vec<(u64, u64)> = match kind {
            KeyKind::Claim => &self.claim_keys,
            KeyKind::Cancel => &self.cancel_keys,
        }
        .iter()
        .filter(|(_, (h, _))| *h == Acct::Contract)
        .map(|(n, (_, id))| (*n, *id))
        .collect();
        let to = self.rng.pick(&HOLDERS);
        // Refusals first.
        if self.rng.chance(15) {
            let id = if held.is_empty() { 1 } else { held[0].1 };
            if !self.vestings.contains_key(&id) {
                return;
            }
            let r = self.recover_key(MALLORY, id, kind, to.managed());
            assert_eq!(r, Err(ERR_ONLY_OWNER.to_string()));
            self.counts.stranger_refused += 1;
            return;
        }
        if self.rng.chance(15) {
            let unknown = self.vestings.keys().max().copied().unwrap_or(0) + 1;
            let r = self.recover_key(OWNER, unknown, kind, to.managed());
            assert_eq!(r, Err(ERR_UNKNOWN_VESTING.to_string()));
            self.counts.key_recoveries_refused += 1;
            return;
        }
        if self.rng.chance(20) {
            // A key the contract does not hold: with its holder, burned, or
            // never minted (a plain vesting's cancel key).
            let not_held: Vec<u64> = self
                .vestings
                .iter()
                .filter(|(id, m)| {
                    let map = match kind {
                        KeyKind::Claim => &self.claim_keys,
                        KeyKind::Cancel => &self.cancel_keys,
                    };
                    let nonce = match kind {
                        KeyKind::Claim => m.claim_nonce,
                        KeyKind::Cancel => m.cancel_nonce,
                    };
                    map.get(&nonce)
                        .map(|(h, _)| *h != Acct::Contract)
                        .unwrap_or(true)
                        && self.vestings.contains_key(id)
                })
                .map(|(id, _)| *id)
                .collect();
            if not_held.is_empty() {
                return;
            }
            let id = self.rng.pick(&not_held);
            let r = self.recover_key(OWNER, id, kind, to.managed());
            assert_eq!(r, Err(ERR_NO_HELD_KEY.to_string()), "#{id}");
            self.counts.key_recoveries_refused += 1;
            return;
        }
        if held.is_empty() {
            return;
        }
        let (nonce, id) = self.rng.pick(&held);
        if self.rng.chance(15) {
            let bad = if self.rng.chance(50) {
                ManagedAddress::zero()
            } else {
                SC.to_managed_address()
            };
            let r = self.recover_key(OWNER, id, kind, bad);
            assert_eq!(r, Err(ERR_BAD_RECIPIENT.to_string()));
            self.counts.key_recoveries_refused += 1;
            return;
        }
        self.recover_key(OWNER, id, kind, to.managed())
            .unwrap_or_else(|e| panic!("recover key of #{id}: {e}"));
        match kind {
            KeyKind::Claim => self.claim_keys.insert(nonce, (to, id)),
            KeyKind::Cancel => self.cancel_keys.insert(nonce, (to, id)),
        };
        // A second recovery of the same key: no longer held.
        let r = self.recover_key(OWNER, id, kind, to.managed());
        assert_eq!(r, Err(ERR_NO_HELD_KEY.to_string()));
        self.counts.key_recoveries += 1;
    }

    fn set_fee(&mut self) {
        if self.rng.chance(15) {
            self.f
                .world
                .tx()
                .from(MALLORY)
                .to(SC)
                .typed(MvxvestProxy)
                .set_fee(big(1))
                .returns(ExpectError(4, ERR_ONLY_OWNER))
                .run();
            self.counts.stranger_refused += 1;
            return;
        }
        if self.rng.chance(15) {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .set_fee(big(EGLD + 1))
                .returns(ExpectError(4, ERR_FEE_ABOVE_CAP))
                .run();
            return;
        }
        let fee = self.rng.pick(&[0u128, 1, 999, EGLD / 10, EGLD]);
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_fee(big(fee))
            .run();
        self.previous_fee = self.fee;
        self.fee = fee;
        self.counts.fee_sets += 1;
    }

    fn set_token_fee(&mut self) {
        if self.rng.chance(15) {
            self.f
                .world
                .tx()
                .from(MALLORY)
                .to(SC)
                .typed(MvxvestProxy)
                .set_token_fee(1u32)
                .returns(ExpectError(4, ERR_ONLY_OWNER))
                .run();
            self.counts.stranger_refused += 1;
            return;
        }
        if self.rng.chance(15) {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .set_token_fee(201u32)
                .returns(ExpectError(4, ERR_TOKEN_FEE_ABOVE_CAP))
                .run();
            return;
        }
        let bps = self.rng.pick(&[0u32, 1, 10, 33, 200]);
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_token_fee(bps)
            .run();
        self.previous_bps = self.bps;
        self.bps = bps;
        self.counts.token_fee_sets += 1;
    }

    fn claim_fees(&mut self) {
        if self.rng.chance(20) {
            self.f
                .world
                .tx()
                .from(MALLORY)
                .to(SC)
                .typed(MvxvestProxy)
                .claim_fees()
                .returns(ExpectError(4, ERR_ONLY_OWNER))
                .run();
            self.counts.stranger_refused += 1;
            return;
        }
        if self.accrued == 0 {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .claim_fees()
                .returns(ExpectError(4, ERR_NO_FEES))
                .run();
            return;
        }
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .claim_fees()
            .run();
        let fees = self.accrued;
        self.accrued = 0;
        self.credit(Acct::Owner, Tok::Egld, fees);
        self.counts.fees_claimed += 1;
    }

    fn toggle_pause(&mut self) {
        if self.paused {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .unpause_creation()
                .run();
        } else {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .pause_creation()
                .run();
        }
        self.paused = !self.paused;
        self.counts.pause_toggles += 1;
    }

    fn toggle_stamping(&mut self) {
        if self.rng.chance(20) {
            self.f
                .world
                .tx()
                .from(MALLORY)
                .to(SC)
                .typed(MvxvestProxy)
                .set_key_stamping(false)
                .returns(ExpectError(4, ERR_ONLY_OWNER))
                .run();
            self.counts.stranger_refused += 1;
            return;
        }
        let on = !self.stamping;
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_key_stamping(on)
            .run();
        self.stamping = on;
        let view: bool = self
            .f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .is_key_stamping()
            .returns(ReturnsResult)
            .run();
        assert_eq!(view, on);
        self.counts.stamping_toggles += 1;
    }

    fn set_display(&mut self) {
        let kind = if self.rng.chance(50) {
            KeyKind::Claim
        } else {
            KeyKind::Cancel
        };
        let n = self.rng.below(1_000);
        let (metadata, uris): (String, Vec<String>) = match self.rng.below(3) {
            0 => (String::new(), vec![]),
            1 => (
                format!("ipfs://meta{n}"),
                vec![format!("https://x/{n}.png")],
            ),
            _ => (
                format!("cid{n}"),
                vec![format!("https://x/{n}.png"), format!("https://x/{n}.json")],
            ),
        };
        let mut list = MultiValueEncoded::new();
        for uri in &uris {
            list.push(ManagedBuffer::from(uri.as_bytes()));
        }
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_key_display(kind, ManagedBuffer::from(metadata.as_bytes()), list)
            .run();
        match kind {
            KeyKind::Claim => self.display_claim = (metadata, uris),
            KeyKind::Cancel => self.display_cancel = (metadata, uris),
        }
        self.counts.display_sets += 1;
    }

    /// A payout that bounced: tokens come back to the contract with no call.
    fn bounce(&mut self) {
        let tok = self.rng.pick(&TOKENS);
        let amount = match tok {
            Tok::Fox => 1 + below_u128(&mut self.rng, 10u128.pow(20)),
            Tok::Usdc => 1 + self.rng.below(1_000_000) as u128,
            Tok::Pts => 1 + self.rng.below(100) as u128,
            Tok::Egld => 1 + self.rng.below(1_000_000_000) as u128,
        };
        match tok.test_id() {
            Some(id) => {
                self.f
                    .world
                    .tx()
                    .from(CREATOR)
                    .to(SC)
                    .payment(payments(&[(Some(id), amount)]))
                    .whitebox(mvxvest::contract_obj, |_| {});
            }
            None => {
                self.f
                    .world
                    .tx()
                    .from(CREATOR)
                    .to(SC)
                    .egld(big(amount))
                    .whitebox(mvxvest::contract_obj, |_| {});
            }
        }
        self.debit(Acct::Creator, tok, amount);
        *self.surplus.get_mut(&tok).unwrap() += amount;
        self.counts.bounces += 1;
    }

    fn recover(
        &mut self,
        from: TestAddress,
        tok: TokenId<StaticApi>,
        to: ManagedAddress<StaticApi>,
        amount: Option<u128>,
    ) -> Result<(), String> {
        let amount = match amount {
            Some(amount) => OptionalValue::Some(big(amount)),
            None => OptionalValue::None,
        };
        self.f
            .world
            .tx()
            .from(from)
            .to(SC)
            .typed(MvxvestProxy)
            .recover_surplus(tok, to, amount)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    }

    fn recover_surplus(&mut self) {
        let tok = self.rng.pick(&TOKENS);
        let surplus = self.surplus[&tok];
        let to = self.rng.pick(&ACCTS);
        if self.rng.chance(15) {
            let r = self.recover(MALLORY, tok.id(), to.managed(), None);
            assert_eq!(r, Err(ERR_ONLY_OWNER.to_string()));
            self.counts.stranger_refused += 1;
            return;
        }
        if self.rng.chance(10) {
            let bad = if self.rng.chance(50) {
                ManagedAddress::zero()
            } else {
                SC.to_managed_address()
            };
            let r = self.recover(OWNER, tok.id(), bad, None);
            assert_eq!(r, Err(ERR_BAD_RECIPIENT.to_string()));
            self.counts.recoveries_refused += 1;
            return;
        }
        if surplus == 0 {
            let amount = if self.rng.chance(50) { None } else { Some(1) };
            let r = self.recover(OWNER, tok.id(), to.managed(), amount);
            assert_eq!(
                r,
                Err(ERR_NO_SURPLUS.to_string()),
                "{tok:?} with no surplus"
            );
            self.counts.recoveries_refused += 1;
            return;
        }
        if self.rng.chance(30) {
            let r = self.recover(OWNER, tok.id(), to.managed(), Some(surplus + 1));
            assert_eq!(
                r,
                Err(ERR_ABOVE_SURPLUS.to_string()),
                "{tok:?} beyond surplus"
            );
            self.counts.recoveries_refused += 1;
            return;
        }
        if self.rng.chance(15) {
            let r = self.recover(OWNER, tok.id(), to.managed(), Some(0));
            assert_eq!(r, Err(ERR_ZERO_AMOUNT.to_string()));
            self.counts.recoveries_refused += 1;
            return;
        }
        let amount = if self.rng.chance(60) {
            Some(1 + below_u128(&mut self.rng, surplus))
        } else {
            None
        };
        self.recover(OWNER, tok.id(), to.managed(), amount)
            .unwrap_or_else(|e| panic!("recover {tok:?} {amount:?}: {e}"));
        self.counts.recoveries += 1;
        let moved = amount.unwrap_or(surplus);
        *self.surplus.get_mut(&tok).unwrap() -= moved;
        self.credit(to, tok, moved);
    }

    /// Time moves: at random, or exactly onto a boundary of a live vesting.
    fn advance_time(&mut self) {
        let live: Vec<u64> = self
            .vestings
            .iter()
            .filter(|(_, m)| m.cancelled_at == 0 && m.claimed < m.total)
            .map(|(id, _)| *id)
            .collect();
        let mut next = self.now + self.rng.below(700);
        if !live.is_empty() && self.rng.chance(50) {
            let id = self.rng.pick(&live);
            let edges: Vec<u64> = boundaries(&self.vestings[&id])
                .into_iter()
                .filter(|t| *t >= self.now)
                .collect();
            if !edges.is_empty() {
                next = self.rng.pick(&edges);
                self.now = next;
                self.f.set_time(next);
                // On the edge: the keys of this vesting act at once, so a
                // claim or a cancel lands exactly on it.
                let m = self.vestings[&id].clone();
                if self.rng.chance(70) {
                    if let Some(&(holder, _)) = self.claim_keys.get(&m.claim_nonce) {
                        if holder != Acct::Contract {
                            self.claim_chosen(holder, vec![(m.claim_nonce, id)]);
                        }
                    }
                }
                if m.cancelable && self.rng.chance(40) {
                    if let Some(&(holder, _)) = self.cancel_keys.get(&m.cancel_nonce) {
                        if holder != Acct::Contract {
                            self.cancel_chosen(holder, vec![(m.cancel_nonce, id)]);
                        }
                    }
                }
                return;
            }
        }
        self.now = next;
        self.f.set_time(next);
    }
}

fn run(seed: u64, steps: usize) -> Counts {
    let f = Fixture::new();
    let mut balances = BTreeMap::new();
    for a in ACCTS {
        for tok in TOKENS {
            balances.insert((a, tok), 0u128);
        }
    }
    for a in [Acct::Alice, Acct::Bob, Acct::Mallory] {
        balances.insert((a, Tok::Egld), 100 * EGLD);
    }
    balances.insert((Acct::Creator, Tok::Fox), 10u128.pow(36));
    balances.insert((Acct::Creator, Tok::Usdc), 10u128.pow(36));
    balances.insert((Acct::Creator, Tok::Pts), 10u128.pow(36));
    balances.insert((Acct::Creator, Tok::Egld), 1_000_000 * EGLD);
    balances.insert((Acct::Owner, Tok::Egld), 10 * EGLD - 2 * ISSUE_COST);
    let zero = TOKENS
        .iter()
        .map(|t| (*t, 0u128))
        .collect::<BTreeMap<_, _>>();
    let mut s = State {
        f,
        rng: Rng(seed),
        now: T0,
        fee: 0,
        previous_fee: 0,
        bps: 0,
        previous_bps: 0,
        paused: false,
        stamping: true,
        display_claim: (String::new(), vec![]),
        display_cancel: (String::new(), vec![]),
        cancel_display: BTreeMap::new(),
        accrued: 0,
        vestings: BTreeMap::new(),
        claim_keys: BTreeMap::new(),
        cancel_keys: BTreeMap::new(),
        balances,
        deposited: zero.clone(),
        claimed: zero.clone(),
        refunded: zero.clone(),
        surplus: zero,
        counts: Counts::default(),
    };
    s.check();
    for step in 0..steps {
        match s.rng.below(100) {
            0..=13 => s.create(false),
            14..=22 => s.create(true),
            23..=38 => s.advance_time(),
            39..=56 => s.claim(),
            57..=64 => s.cancel(),
            65..=70 => s.move_key(),
            71..=74 => s.wrong_payment(),
            75..=77 => s.set_fee(),
            78..=80 => s.set_token_fee(),
            81..=82 => s.claim_fees(),
            83 => s.toggle_pause(),
            84..=85 => s.toggle_stamping(),
            86..=87 => s.set_display(),
            88..=90 => s.bounce(),
            91..=93 => s.recover_surplus(),
            94..=96 => s.bounce_key(),
            _ => s.recover_bounced_key(),
        }
        s.check();
        if step % 20 == 19 {
            s.check_keys();
        }
    }
    s.check_keys();

    // Everything ends. The owner first returns every bounced key to Alice.
    let held_claim: Vec<(u64, u64)> = s
        .claim_keys
        .iter()
        .filter(|(_, (h, _))| *h == Acct::Contract)
        .map(|(n, (_, id))| (*n, *id))
        .collect();
    for (nonce, id) in held_claim {
        s.recover_key(OWNER, id, KeyKind::Claim, ALICE.to_managed_address())
            .unwrap();
        s.claim_keys.insert(nonce, (Acct::Alice, id));
    }
    let held_cancel: Vec<(u64, u64)> = s
        .cancel_keys
        .iter()
        .filter(|(_, (h, _))| *h == Acct::Contract)
        .map(|(n, (_, id))| (*n, *id))
        .collect();
    for (nonce, id) in held_cancel {
        s.recover_key(OWNER, id, KeyKind::Cancel, ALICE.to_managed_address())
            .unwrap();
        s.cancel_keys.insert(nonce, (Acct::Alice, id));
    }
    s.check();
    s.check_keys();
    s.now += 20_000;
    let now = s.now;
    s.f.set_time(now);
    for holder in HOLDERS {
        loop {
            let mine: Vec<u64> = s
                .claim_keys
                .iter()
                .filter(|(_, (h, _))| *h == holder)
                .map(|(n, _)| *n)
                .collect();
            if mine.is_empty() {
                break;
            }
            let nonce = mine[0];
            let id = s.claim_keys[&nonce].1;
            let m = s.vestings[&id].clone();
            let amount = vested(&m, now) - m.claimed;
            s.f.claim(holder.addr(), &[nonce]);
            s.vestings.get_mut(&id).unwrap().claimed += amount;
            *s.claimed.get_mut(&m.tok).unwrap() += amount;
            s.credit(holder, m.tok, amount);
            s.claim_keys.remove(&nonce);
        }
    }
    s.check();
    // Nothing is owed any more: the owner collects the fees and the bounced
    // amounts, and the contract is left with nothing at all.
    for tok in TOKENS {
        assert_eq!(
            s.deposited[&tok] - s.claimed[&tok] - s.refunded[&tok],
            0,
            "{tok:?} still owed"
        );
        let surplus = s.surplus[&tok];
        if surplus > 0 {
            s.recover(OWNER, tok.id(), OWNER.to_managed_address(), None)
                .unwrap();
            *s.surplus.get_mut(&tok).unwrap() = 0;
            s.credit(Acct::Owner, tok, surplus);
        }
    }
    if s.accrued > 0 {
        s.f.world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .claim_fees()
            .run();
        let fees = s.accrued;
        s.accrued = 0;
        s.credit(Acct::Owner, Tok::Egld, fees);
    }
    s.check();
    s.f.world
        .check_account(SC)
        .esdt_balance(FOX, big(0))
        .esdt_balance(USDC, big(0))
        .esdt_balance(PTS, big(0))
        .balance(big(0));
    // The cancel keys of vestings that ended uncancelled are still out there:
    // a cancel now moves nothing and burns them.
    let left: Vec<(u64, Acct, u64)> = s
        .cancel_keys
        .iter()
        .map(|(n, (h, id))| (*n, *h, *id))
        .collect();
    for (nonce, holder, id) in left {
        s.cancel_with(holder, key(KeyKind::Cancel, nonce)).unwrap();
        s.cancel_keys.remove(&nonce);
        let m = s.vestings.get_mut(&id).unwrap();
        assert_eq!(vested(m, now), m.total, "#{id} ended");
        m.cancelled_at = now;
    }
    s.check();
    s.f.world
        .check_account(SC)
        .esdt_balance(FOX, big(0))
        .esdt_balance(USDC, big(0))
        .esdt_balance(PTS, big(0))
        .balance(big(0));
    s.counts
}

#[test]
fn safe_random_walks_with_stamps_bounced_keys_and_every_token_keep_the_books_exact() {
    let mut total = Counts::default();
    for seed in 1..=10u64 {
        let c = run(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xA5A5, 200);
        total.create_ok += c.create_ok;
        total.create_batch_ok += c.create_batch_ok;
        total.create_max_batch_ok += c.create_max_batch_ok;
        total.create_refused += c.create_refused;
        total.create_stale_fee_refused += c.create_stale_fee_refused;
        total.claim_paid_or_burned += c.claim_paid_or_burned;
        total.claim_nothing += c.claim_nothing;
        total.claim_burned_keys += c.claim_burned_keys;
        total.claim_boundary += c.claim_boundary;
        total.cancels += c.cancels;
        total.cancel_boundary += c.cancel_boundary;
        total.key_moves += c.key_moves;
        total.key_bounces += c.key_bounces;
        total.key_recoveries += c.key_recoveries;
        total.key_recoveries_refused += c.key_recoveries_refused;
        total.wrong_payments_refused += c.wrong_payments_refused;
        total.fee_sets += c.fee_sets;
        total.token_fee_sets += c.token_fee_sets;
        total.fees_claimed += c.fees_claimed;
        total.pause_toggles += c.pause_toggles;
        total.stamping_toggles += c.stamping_toggles;
        total.display_sets += c.display_sets;
        total.bounces += c.bounces;
        total.recoveries += c.recoveries;
        total.recoveries_refused += c.recoveries_refused;
        total.stranger_refused += c.stranger_refused;
        total.keys_checked += c.keys_checked;
    }
    println!("{total:#?}");
    // The walk really went down every path it describes.
    assert!(total.create_ok >= 200 && total.create_batch_ok >= 60);
    assert!(total.create_max_batch_ok >= 3);
    assert!(total.create_refused >= 20 && total.create_stale_fee_refused >= 3);
    assert!(total.claim_paid_or_burned >= 150 && total.claim_nothing >= 30);
    assert!(total.claim_burned_keys >= 100 && total.claim_boundary >= 20);
    assert!(total.cancels >= 80 && total.cancel_boundary >= 10);
    assert!(total.key_moves >= 50);
    assert!(total.key_bounces >= 20 && total.key_recoveries >= 10);
    assert!(total.key_recoveries_refused >= 10);
    assert!(total.wrong_payments_refused >= 30);
    assert!(total.fee_sets >= 20 && total.token_fee_sets >= 20);
    assert!(total.fees_claimed >= 10);
    assert!(total.pause_toggles >= 10);
    assert!(total.stamping_toggles >= 10 && total.display_sets >= 10);
    assert!(total.bounces >= 30);
    assert!(total.recoveries >= 15 && total.recoveries_refused >= 15);
    assert!(total.stranger_refused >= 20);
    assert!(total.keys_checked >= 1_000);
}
