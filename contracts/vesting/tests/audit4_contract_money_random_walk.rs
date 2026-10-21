//! Fourth audit (contract money paths, 20 Oct 2026): a deterministic random
//! walk over every path that moves or books value in version 2, checked
//! after every step against an independent model.
//!
//! Beyond the first review's walk (`review_safe_accounting_random_walk_test`,
//! which knows no token fee, one token and no bounces), this one covers:
//! - three vested tokens at once: FOX (18 decimals), PTS (0 decimals) and
//!   EGLD, in single creations and batches;
//! - both fees at every rate the owner may set (0, 1, 10 and 200 bps; 0,
//!   1 wei, 0.1 and 1 EGLD), changed at random moments, with the owner's
//!   balances tracked (token fees arrive at once, EGLD fees on `claimFees`);
//! - payments one unit off, which must be refused without any change;
//! - pauses (creation refused, claims and cancels untouched);
//! - bounced payouts (tokens coming back with no call) and their recovery
//!   by amount, in parts, to any account, never beyond the surplus;
//! - every owner endpoint tried by a stranger, and every cap.
//!
//! The invariant checked after every step, for each token: the contract's
//! balance equals `deposited - claimed - refunded` (what it owes), plus the
//! accrued EGLD fees, plus the bounced amounts not yet recovered; and
//! `getSurplus` reports exactly those bounced amounts. Every account's
//! balance of every token is exact. At the end, everything is claimed,
//! recovered and collected, and the contract holds nothing.
//!
//! It passes on 322cb43: no sequence found breaks the books.

mod common;

use std::collections::BTreeMap;

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
        if n == 0 { 0 } else { self.next() % n }
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

/// How often each path was exercised, summed over every seed, so the test
/// can show it walked the paths it claims to.
#[derive(Default, Debug)]
struct Counts {
    create_ok: usize,
    create_batch_ok: usize,
    create_wrong_payment_refused: usize,
    create_paused_refused: usize,
    claim_paid_or_burned: usize,
    claim_nothing: usize,
    cancels: usize,
    key_moves: usize,
    fee_sets: usize,
    token_fee_sets: usize,
    fees_claimed: usize,
    pause_toggles: usize,
    bounces: usize,
    recoveries: usize,
    recoveries_refused: usize,
    stranger_refused: usize,
    cap_refused: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Tok {
    Fox,
    Pts,
    Egld,
}
const TOKENS: [Tok; 3] = [Tok::Fox, Tok::Pts, Tok::Egld];

impl Tok {
    fn id(self) -> TokenId<StaticApi> {
        match self {
            Tok::Fox => token(FOX),
            Tok::Pts => token(PTS),
            Tok::Egld => native(),
        }
    }
    fn test_id(self) -> Option<TestTokenId<'static>> {
        match self {
            Tok::Fox => Some(FOX),
            Tok::Pts => Some(PTS),
            Tok::Egld => None,
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
}
const ACCTS: [Acct; 5] = [
    Acct::Creator,
    Acct::Alice,
    Acct::Bob,
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
        }
    }
}

#[derive(Clone)]
enum Shape {
    Linear,
    Stepped(u64),
    Tranches(Vec<(u64, u128)>),
}

/// (start, cliff, cliff_amount, end, shape)
type Sched = (u64, u64, u128, u64, Shape);

#[derive(Clone)]
struct Model {
    tok: Tok,
    total: u128,
    schedule: Sched,
    cancelled_at: u64,
    claimed: u128,
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
    } else {
        1 + rng.below(5_000)
    };
    let end = start + duration;
    let cliff = start + rng.below(duration + 1);
    let kind = rng.below(3);
    if kind == 2 && duration > 0 && total >= 2 {
        let count = 1 + rng.below(std::cmp::min(6, duration).min((total - 1) as u64)) as usize;
        let mut times = std::collections::BTreeSet::new();
        while times.len() < count - 1 {
            times.insert(start + rng.below(duration));
        }
        let mut times: Vec<u64> = times.into_iter().collect();
        times.push(end);
        let cliff_amount = rng.below((total - count as u128) as u64 + 1) as u128;
        let mut left = total - cliff_amount;
        let mut list = Vec::new();
        for (i, time) in times.iter().enumerate() {
            let remaining = (times.len() - i - 1) as u128;
            let amount = if remaining == 0 {
                left
            } else {
                1 + rng.below((left - remaining - 1) as u64 + 1) as u128
            };
            left -= amount;
            list.push((*time, amount));
        }
        return (start, cliff, cliff_amount, end, Shape::Tranches(list));
    }
    let cliff_amount = if rng.chance(10) {
        total
    } else if rng.chance(30) {
        rng.below(total.min(u64::MAX as u128) as u64 + 1) as u128
    } else {
        0
    };
    if kind == 1 && duration > 0 {
        let interval = 1 + rng.below(duration);
        return (start, cliff, cliff_amount, end, Shape::Stepped(interval));
    }
    (start, cliff, cliff_amount, end, Shape::Linear)
}

const HOLDERS: [Acct; 2] = [Acct::Alice, Acct::Bob];
const CANCELLERS: [Acct; 2] = [Acct::Creator, Acct::Mallory];

struct State {
    f: Fixture,
    rng: Rng,
    now: u64,
    fee: u128,
    bps: u32,
    paused: bool,
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
    /// Bounced amounts the owner has not recovered yet.
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
        }
        assert_eq!(self.f.fees_accrued(), big(self.accrued), "fees accrued");
        let paused: bool = self
            .f
            .world
            .query()
            .to(SC)
            .typed(MvxvestProxy)
            .is_creation_paused()
            .returns(ReturnsResult)
            .run();
        assert_eq!(paused, self.paused);
        for a in ACCTS {
            let fox = self.balances[&(a, Tok::Fox)];
            let pts = self.balances[&(a, Tok::Pts)];
            let egld = self.balances[&(a, Tok::Egld)];
            self.f
                .world
                .check_account(a.addr())
                .esdt_balance(FOX, big(fox))
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
        }
    }

    fn create(&mut self, batch: bool) {
        let tok = TOKENS[self.rng.below(3) as usize];
        let count = if batch {
            1 + self.rng.below(5) as usize
        } else {
            1
        };
        let cancelable = self.rng.chance(60);
        let mut entries = Vec::new();
        for _ in 0..count {
            let total = match tok {
                Tok::Fox => {
                    if self.rng.chance(50) {
                        1 + self.rng.below(10) as u128
                    } else {
                        1 + self.rng.below(1_000_000_000) as u128
                    }
                }
                Tok::Pts => 1 + self.rng.below(5_000) as u128,
                Tok::Egld => (1 + self.rng.below(1_000_000) as u128) * 1_000_000_000,
            };
            let schedule = random_schedule(&mut self.rng, self.now, total);
            let holder = HOLDERS[self.rng.below(2) as usize];
            entries.push((holder, total, schedule));
        }
        let sum: u128 = entries.iter().map(|e| e.1).sum();
        let token_fee: u128 = entries.iter().map(|e| self.token_fee_of(e.1)).sum();
        let fees = self.fee * count as u128;

        // A payment one unit off, one time in ten: refused, nothing changes.
        let mut wrong: Option<&str> = None;
        let pay = if tok == Tok::Egld {
            let mut amount = sum + token_fee + fees;
            if self.rng.chance(10) {
                wrong = Some(ERR_WRONG_DEPOSIT);
                amount = if self.rng.chance(50) {
                    amount + 1
                } else {
                    amount - 1
                };
            }
            payments(&[(None, amount)])
        } else {
            let id = tok.test_id().unwrap();
            let mut amount = sum + token_fee;
            let mut egld = fees;
            if self.rng.chance(10) {
                match self.rng.below(3) {
                    0 => {
                        wrong = Some(ERR_WRONG_DEPOSIT);
                        amount += 1;
                    }
                    1 => {
                        wrong = Some(ERR_WRONG_FEE);
                        egld += 1;
                    }
                    _ => {
                        if fees > 0 {
                            wrong = Some(ERR_WRONG_FEE);
                            egld = 0;
                        }
                    }
                }
            }
            if egld > 0 {
                payments(&[(Some(id), amount), (None, egld)])
            } else {
                payments(&[(Some(id), amount)])
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
                .create_batch(cancelable, "audit4", list)
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
                    "audit4",
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
                if self.paused {
                    self.counts.create_paused_refused += 1;
                } else {
                    self.counts.create_wrong_payment_refused += 1;
                }
                return;
            }
            None => assert!(result.is_ok(), "creation failed: {result:?}"),
        }
        let ids = result.unwrap();
        assert_eq!(ids.len(), count);
        self.counts.create_ok += 1;
        if batch {
            self.counts.create_batch_ok += 1;
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
        for (id, (holder, total, schedule)) in ids.into_iter().zip(entries) {
            let view = self.f.view(id);
            self.claim_keys
                .insert(view.vesting.claim_nonce, (holder, id));
            if cancelable {
                self.cancel_keys
                    .insert(view.vesting.cancel_nonce, (Acct::Creator, id));
            }
            self.vestings.insert(
                id,
                Model {
                    tok,
                    total,
                    schedule,
                    cancelled_at: 0,
                    claimed: 0,
                },
            );
        }
    }

    fn claim(&mut self) {
        let holder = HOLDERS[self.rng.below(2) as usize];
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
            if chosen.len() == 4 {
                break;
            }
        }
        let nonces: Vec<u64> = chosen.iter().map(|c| c.0).collect();
        let mut progressed = false;
        let mut pay: BTreeMap<Tok, u128> = BTreeMap::new();
        let mut burned = Vec::new();
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
        }
        let result = self
            .f
            .world
            .tx()
            .from(holder.addr())
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(keys(KeyKind::Claim, &nonces))
            .returns(ReturnsHandledOrError::new())
            .run();
        match &result {
            Ok(_) => {
                assert!(
                    progressed,
                    "claim of {nonces:?} at {} should have failed",
                    self.now
                );
                self.counts.claim_paid_or_burned += 1;
            }
            Err(e) => {
                assert!(
                    !progressed,
                    "claim of {nonces:?} at {} failed: {}",
                    self.now, e.message
                );
                assert_eq!(e.message, ERR_NOTHING_TO_CLAIM);
                self.counts.claim_nothing += 1;
                return;
            }
        }
        for (_, id) in &chosen {
            let now = self.now;
            let m = self.vestings.get_mut(id).unwrap();
            let v = vested(m, now);
            let paid = v - m.claimed;
            m.claimed = v;
            *self.claimed.get_mut(&m.tok).unwrap() += paid;
        }
        for nonce in burned {
            self.claim_keys.remove(&nonce);
        }
        for (tok, amount) in pay {
            self.credit(holder, tok, amount);
        }
    }

    fn cancel(&mut self) {
        let holder = CANCELLERS[self.rng.below(2) as usize];
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
            .take(3)
            .collect();
        if chosen.is_empty() {
            return;
        }
        let nonces: Vec<u64> = chosen.iter().map(|c| c.0).collect();
        self.f.cancel(holder.addr(), &nonces);
        self.counts.cancels += chosen.len();
        for (nonce, id) in chosen {
            let now = self.now;
            let m = self.vestings.get_mut(&id).unwrap();
            let refund = m.total - vested(m, now);
            m.cancelled_at = now;
            let tok = m.tok;
            *self.refunded.get_mut(&tok).unwrap() += refund;
            self.credit(holder, tok, refund);
            self.cancel_keys.remove(&nonce);
        }
    }

    fn move_key(&mut self) {
        if self.rng.chance(50) {
            let list: Vec<(u64, (Acct, u64))> =
                self.claim_keys.iter().map(|(n, v)| (*n, *v)).collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = list[self.rng.below(list.len() as u64) as usize];
            let to = if holder == Acct::Alice {
                Acct::Bob
            } else {
                Acct::Alice
            };
            self.f
                .send_key(KeyKind::Claim, nonce, holder.addr(), to.addr());
            self.claim_keys.insert(nonce, (to, id));
            self.counts.key_moves += 1;
        } else {
            let list: Vec<(u64, (Acct, u64))> =
                self.cancel_keys.iter().map(|(n, v)| (*n, *v)).collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = list[self.rng.below(list.len() as u64) as usize];
            let to = if holder == Acct::Creator {
                Acct::Mallory
            } else {
                Acct::Creator
            };
            self.f
                .send_key(KeyKind::Cancel, nonce, holder.addr(), to.addr());
            self.cancel_keys.insert(nonce, (to, id));
            self.counts.key_moves += 1;
        }
    }

    fn set_fee(&mut self) {
        // A stranger, or a fee above the cap: refused, nothing changes.
        if self.rng.chance(20) {
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
        if self.rng.chance(20) {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .set_fee(big(EGLD + 1))
                .returns(ExpectError(4, ERR_FEE_ABOVE_CAP))
                .run();
            self.counts.cap_refused += 1;
            return;
        }
        self.fee = [0u128, 1, EGLD / 10, EGLD][self.rng.below(4) as usize];
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_fee(big(self.fee))
            .run();
        self.counts.fee_sets += 1;
    }

    fn set_token_fee(&mut self) {
        if self.rng.chance(20) {
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
        if self.rng.chance(20) {
            self.f
                .world
                .tx()
                .from(OWNER)
                .to(SC)
                .typed(MvxvestProxy)
                .set_token_fee(201u32)
                .returns(ExpectError(4, ERR_TOKEN_FEE_ABOVE_CAP))
                .run();
            self.counts.cap_refused += 1;
            return;
        }
        self.bps = [0u32, 1, 10, 200][self.rng.below(4) as usize];
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_token_fee(self.bps)
            .run();
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
        if self.rng.chance(20) {
            self.f
                .world
                .tx()
                .from(MALLORY)
                .to(SC)
                .typed(MvxvestProxy)
                .pause_creation()
                .returns(ExpectError(4, ERR_ONLY_OWNER))
                .run();
            self.counts.stranger_refused += 1;
            return;
        }
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

    /// A payout that bounced: tokens come back to the contract with no call
    /// (the protocol credits a refund SCR whether or not the contract is
    /// payable).
    fn bounce(&mut self) {
        let tok = TOKENS[self.rng.below(3) as usize];
        let amount = match tok {
            Tok::Fox => 1 + self.rng.below(1_000) as u128,
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
        tok: Tok,
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
            .recover_surplus(tok.id(), to, amount)
            .returns(ReturnsHandledOrError::new())
            .run()
            .map(|_| ())
            .map_err(|e| e.message)
    }

    fn recover_surplus(&mut self) {
        let tok = TOKENS[self.rng.below(3) as usize];
        let surplus = self.surplus[&tok];
        let to = ACCTS[self.rng.below(5) as usize];
        // Strangers and bad recipients first: always refused.
        if self.rng.chance(15) {
            let r = self.recover(MALLORY, tok, to.addr().to_managed_address(), None);
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
            let r = self.recover(OWNER, tok, bad, None);
            assert_eq!(r, Err(ERR_BAD_RECIPIENT.to_string()));
            self.counts.recoveries_refused += 1;
            return;
        }
        if surplus == 0 {
            let amount = if self.rng.chance(50) { None } else { Some(1) };
            let r = self.recover(OWNER, tok, to.addr().to_managed_address(), amount);
            assert_eq!(
                r,
                Err(ERR_NO_SURPLUS.to_string()),
                "{tok:?} with no surplus"
            );
            self.counts.recoveries_refused += 1;
            return;
        }
        // One unit beyond the surplus, or zero: refused.
        if self.rng.chance(30) {
            let r = self.recover(
                OWNER,
                tok,
                to.addr().to_managed_address(),
                Some(surplus + 1),
            );
            assert_eq!(
                r,
                Err(ERR_ABOVE_SURPLUS.to_string()),
                "{tok:?} beyond surplus"
            );
            self.counts.recoveries_refused += 1;
            return;
        }
        if self.rng.chance(15) {
            let r = self.recover(OWNER, tok, to.addr().to_managed_address(), Some(0));
            assert_eq!(r, Err(ERR_ZERO_AMOUNT.to_string()));
            self.counts.recoveries_refused += 1;
            return;
        }
        let amount = if self.rng.chance(60) {
            Some(1 + self.rng.below(surplus.min(u64::MAX as u128) as u64) as u128)
        } else {
            None
        };
        self.recover(OWNER, tok, to.addr().to_managed_address(), amount)
            .unwrap_or_else(|e| panic!("recover {tok:?} {amount:?}: {e}"));
        self.counts.recoveries += 1;
        let moved = amount.unwrap_or(surplus);
        *self.surplus.get_mut(&tok).unwrap() -= moved;
        self.credit(to, tok, moved);
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
        bps: 0,
        paused: false,
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
    for _ in 0..steps {
        match s.rng.below(100) {
            0..=15 => s.create(false),
            16..=25 => s.create(true),
            26..=42 => {
                s.now += s.rng.below(700);
                let now = s.now;
                s.f.set_time(now);
            }
            43..=60 => s.claim(),
            61..=69 => s.cancel(),
            70..=77 => s.move_key(),
            78..=81 => s.set_fee(),
            82..=85 => s.set_token_fee(),
            86..=88 => s.claim_fees(),
            89..=90 => s.toggle_pause(),
            91..=95 => s.bounce(),
            _ => s.recover_surplus(),
        }
        s.check();
    }

    // Everything ends: claim with every remaining key, one at a time.
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
            s.recover(OWNER, tok, OWNER.to_managed_address(), None)
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
        .esdt_balance(PTS, big(0))
        .balance(big(0));
    s.counts
}

#[test]
fn safe_random_walks_over_every_money_path_keep_the_books_exact() {
    let mut total = Counts::default();
    for seed in 1..=12u64 {
        let c = run(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15), 160);
        total.create_ok += c.create_ok;
        total.create_batch_ok += c.create_batch_ok;
        total.create_wrong_payment_refused += c.create_wrong_payment_refused;
        total.create_paused_refused += c.create_paused_refused;
        total.claim_paid_or_burned += c.claim_paid_or_burned;
        total.claim_nothing += c.claim_nothing;
        total.cancels += c.cancels;
        total.key_moves += c.key_moves;
        total.fee_sets += c.fee_sets;
        total.token_fee_sets += c.token_fee_sets;
        total.fees_claimed += c.fees_claimed;
        total.pause_toggles += c.pause_toggles;
        total.bounces += c.bounces;
        total.recoveries += c.recoveries;
        total.recoveries_refused += c.recoveries_refused;
        total.stranger_refused += c.stranger_refused;
        total.cap_refused += c.cap_refused;
    }
    println!("{total:#?}");
    // The walk really went down every path it describes.
    assert!(total.create_ok >= 200 && total.create_batch_ok >= 60);
    assert!(total.create_wrong_payment_refused >= 20);
    assert!(total.create_paused_refused >= 20);
    assert!(total.claim_paid_or_burned >= 150 && total.claim_nothing >= 30);
    assert!(total.cancels >= 80);
    assert!(total.key_moves >= 50);
    assert!(total.fee_sets >= 20 && total.token_fee_sets >= 20);
    assert!(total.fees_claimed >= 10);
    assert!(total.pause_toggles >= 20);
    assert!(total.bounces >= 40);
    assert!(total.recoveries >= 20 && total.recoveries_refused >= 20);
    assert!(total.stranger_refused >= 20 && total.cap_refused >= 10);
}
