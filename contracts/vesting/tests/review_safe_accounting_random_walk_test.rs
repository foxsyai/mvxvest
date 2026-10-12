//! Review: a deterministic random walk over create / createBatch / claim /
//! cancel / key moves / fee changes / fee claims, for FOX and EGLD, checking
//! after every step that every account received exactly what the maths say,
//! that the contract holds exactly what it owes, and that each vesting's
//! view is consistent. Ends by claiming everything and checking the contract
//! is left with only the fees.

mod common;

use std::collections::BTreeMap;

use common::*;
use multiversx_sc_scenario::imports::*;

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

#[derive(Clone)]
struct Model {
    total: u128,
    schedule: (u64, u64, u128, u64, Shape),
    cancelled_at: u64,
    claimed: u128,
    egld: bool,
}

#[derive(Clone)]
enum Shape {
    Linear,
    Stepped(u64),
    Tranches(Vec<(u64, u128)>),
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

fn to_schedule(s: &(u64, u64, u128, u64, Shape)) -> Schedule<StaticApi> {
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

fn random_schedule(rng: &mut Rng, now: u64, total: u128) -> (u64, u64, u128, u64, Shape) {
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
    let cliff_amount = if rng.chance(30) {
        rng.below(total as u64 + 1) as u128
    } else {
        0
    };
    if kind == 1 && duration > 0 {
        let interval = 1 + rng.below(duration);
        return (start, cliff, cliff_amount, end, Shape::Stepped(interval));
    }
    (start, cliff, cliff_amount, end, Shape::Linear)
}

const HOLDERS: [TestAddress; 2] = [ALICE, BOB];
const CANCELLERS: [TestAddress; 2] = [CREATOR, MALLORY];

struct State {
    f: Fixture,
    rng: Rng,
    now: u64,
    fee: u128,
    vestings: BTreeMap<u64, Model>,
    /// claim nonce -> (holder index, vesting id)
    claim_keys: BTreeMap<u64, (usize, u64)>,
    /// cancel nonce -> (holder index, vesting id)
    cancel_keys: BTreeMap<u64, (usize, u64)>,
    /// expected balances: (account, egld?) -> amount
    balances: BTreeMap<(&'static str, bool), u128>,
}

fn name(a: TestAddress) -> &'static str {
    if a == ALICE {
        "alice"
    } else if a == BOB {
        "bob"
    } else if a == CREATOR {
        "creator"
    } else {
        "mallory"
    }
}

impl State {
    fn credit(&mut self, a: TestAddress, egld: bool, amount: u128) {
        *self.balances.get_mut(&(name(a), egld)).unwrap() += amount;
    }
    fn debit(&mut self, a: TestAddress, egld: bool, amount: u128) {
        *self.balances.get_mut(&(name(a), egld)).unwrap() -= amount;
    }

    fn check(&mut self) {
        self.f.check_invariant(Some(FOX));
        self.f.check_invariant(None);
        for a in [ALICE, BOB, CREATOR, MALLORY] {
            let fox = self.balances[&(name(a), false)];
            let egld = self.balances[&(name(a), true)];
            self.f
                .world
                .check_account(a)
                .esdt_balance(FOX, big(fox))
                .balance(big(egld));
        }
        let ids: Vec<u64> = self.vestings.keys().copied().collect();
        for id in ids {
            let m = self.vestings[&id].clone();
            let view = self.f.view(id);
            let vested_now = vested(&m, self.now);
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
        let egld = self.rng.chance(40);
        let count = if batch {
            1 + self.rng.below(4) as usize
        } else {
            1
        };
        let cancelable = self.rng.chance(60);
        let mut entries = Vec::new();
        for _ in 0..count {
            let range = if self.rng.chance(50) { 10 } else { 1_000_000 };
            let total = 1 + self.rng.below(range) as u128;
            let total = if egld { total * 1_000_000_000 } else { total };
            let schedule = random_schedule(&mut self.rng, self.now, total);
            let holder = self.rng.below(2) as usize;
            entries.push((holder, total, schedule));
        }
        let sum: u128 = entries.iter().map(|e| e.1).sum();
        let fees = self.fee * count as u128;
        let pay = if egld {
            payments(&[(None, sum + fees)])
        } else if fees > 0 {
            payments(&[(Some(FOX), sum), (None, fees)])
        } else {
            payments(&[(Some(FOX), sum)])
        };
        let ids: Vec<u64> = if batch {
            let mut list = MultiValueEncoded::new();
            for (holder, total, schedule) in &entries {
                list.push(
                    (
                        HOLDERS[*holder].to_managed_address(),
                        big(*total),
                        to_schedule(schedule),
                    )
                        .into(),
                );
            }
            let ids: MultiValueEncoded<StaticApi, u64> = self
                .f
                .world
                .tx()
                .from(CREATOR)
                .to(SC)
                .typed(MvxvestProxy)
                .create_batch(cancelable, "fuzz", list)
                .payment(pay)
                .returns(ReturnsResult)
                .run();
            ids.to_vec().into_iter().collect()
        } else {
            let (holder, _, schedule) = &entries[0];
            vec![self.f.create(
                CREATOR,
                HOLDERS[*holder],
                to_schedule(schedule),
                cancelable,
                pay,
            )]
        };
        if egld {
            self.debit(CREATOR, true, sum + fees);
        } else {
            self.debit(CREATOR, false, sum);
            self.debit(CREATOR, true, fees);
        }
        for (id, (holder, total, schedule)) in ids.into_iter().zip(entries) {
            let view = self.f.view(id);
            self.claim_keys
                .insert(view.vesting.claim_nonce, (holder, id));
            if cancelable {
                self.cancel_keys.insert(view.vesting.cancel_nonce, (0, id));
            }
            self.vestings.insert(
                id,
                Model {
                    total,
                    schedule,
                    cancelled_at: 0,
                    claimed: 0,
                    egld,
                },
            );
        }
    }

    fn claim(&mut self) {
        let holder = self.rng.below(2) as usize;
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
        let mut pay = (0u128, 0u128);
        let mut burned = Vec::new();
        for (nonce, id) in &chosen {
            let m = &self.vestings[id];
            let amount = vested(m, self.now) - m.claimed;
            let finished = m.claimed + amount == final_amount(m);
            if amount > 0 || finished {
                progressed = true;
            }
            if m.egld {
                pay.1 += amount
            } else {
                pay.0 += amount
            }
            if finished {
                burned.push(*nonce);
            }
        }
        let result = self
            .f
            .world
            .tx()
            .from(HOLDERS[holder])
            .to(SC)
            .typed(MvxvestProxy)
            .claim()
            .payment(keys(KeyKind::Claim, &nonces))
            .returns(ReturnsHandledOrError::new())
            .run();
        assert_eq!(
            result.is_ok(),
            progressed,
            "claim outcome for {nonces:?} at {}",
            self.now
        );
        if !progressed {
            return;
        }
        for (_, id) in &chosen {
            let now = self.now;
            let m = self.vestings.get_mut(id).unwrap();
            m.claimed = vested(m, now);
        }
        for nonce in burned {
            self.claim_keys.remove(&nonce);
        }
        self.credit(HOLDERS[holder], false, pay.0);
        self.credit(HOLDERS[holder], true, pay.1);
    }

    fn cancel(&mut self) {
        let holder = self.rng.below(2) as usize;
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
        self.f.cancel(CANCELLERS[holder], &nonces);
        for (nonce, id) in chosen {
            let now = self.now;
            let m = self.vestings.get_mut(&id).unwrap();
            let refund = m.total - vested(m, now);
            m.cancelled_at = now;
            let egld = m.egld;
            self.credit(CANCELLERS[holder], egld, refund);
            self.cancel_keys.remove(&nonce);
        }
    }

    fn move_key(&mut self) {
        if self.rng.chance(50) {
            let list: Vec<(u64, (usize, u64))> =
                self.claim_keys.iter().map(|(n, v)| (*n, *v)).collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = list[self.rng.below(list.len() as u64) as usize];
            let to = 1 - holder;
            self.f
                .send_key(KeyKind::Claim, nonce, HOLDERS[holder], HOLDERS[to]);
            self.claim_keys.insert(nonce, (to, id));
        } else {
            let list: Vec<(u64, (usize, u64))> =
                self.cancel_keys.iter().map(|(n, v)| (*n, *v)).collect();
            if list.is_empty() {
                return;
            }
            let (nonce, (holder, id)) = list[self.rng.below(list.len() as u64) as usize];
            let to = 1 - holder;
            self.f
                .send_key(KeyKind::Cancel, nonce, CANCELLERS[holder], CANCELLERS[to]);
            self.cancel_keys.insert(nonce, (to, id));
        }
    }

    fn set_fee(&mut self) {
        self.fee = [0u128, 1, EGLD / 100][self.rng.below(3) as usize];
        self.f
            .world
            .tx()
            .from(OWNER)
            .to(SC)
            .typed(MvxvestProxy)
            .set_fee(big(self.fee))
            .run();
    }

    fn claim_fees(&mut self) {
        let accrued = self.f.fees_accrued();
        if accrued == 0u32 {
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
    }
}

fn run(seed: u64, steps: usize) {
    let f = Fixture::new();
    let mut balances = BTreeMap::new();
    for a in [ALICE, BOB, MALLORY] {
        balances.insert((name(a), false), 0u128);
        balances.insert((name(a), true), 100 * EGLD);
    }
    balances.insert(("creator", false), 10u128.pow(36));
    balances.insert(("creator", true), 1_000_000 * EGLD);
    let mut s = State {
        f,
        rng: Rng(seed),
        now: T0,
        fee: 0,
        vestings: BTreeMap::new(),
        claim_keys: BTreeMap::new(),
        cancel_keys: BTreeMap::new(),
        balances,
    };
    for _ in 0..steps {
        match s.rng.below(100) {
            0..=19 => s.create(false),
            20..=27 => s.create(true),
            28..=47 => {
                s.now += s.rng.below(700);
                let now = s.now;
                s.f.set_time(now);
            }
            48..=69 => s.claim(),
            70..=79 => s.cancel(),
            80..=89 => s.move_key(),
            90..=94 => s.set_fee(),
            _ => s.claim_fees(),
        }
        s.check();
    }
    // Everything ends: claim with every remaining key.
    s.now += 20_000;
    let now = s.now;
    s.f.set_time(now);
    for (holder, address) in HOLDERS.iter().enumerate() {
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
            let before = s.claim_keys.len();
            // Claim one at a time so the expected outcome is simple.
            let nonce = mine[0];
            let id = s.claim_keys[&nonce].1;
            let m = s.vestings[&id].clone();
            let amount = vested(&m, now) - m.claimed;
            s.f.claim(*address, &[nonce]);
            s.vestings.get_mut(&id).unwrap().claimed += amount;
            s.credit(*address, m.egld, amount);
            s.claim_keys.remove(&nonce);
            assert!(s.claim_keys.len() < before);
        }
    }
    s.check();
    let fees = s.f.fees_accrued();
    s.f.world
        .check_account(SC)
        .esdt_balance(FOX, big(0))
        .balance(fees);
}

#[test]
fn random_walks_keep_every_balance_exact() {
    for seed in 1..=12u64 {
        run(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15), 150);
    }
}
