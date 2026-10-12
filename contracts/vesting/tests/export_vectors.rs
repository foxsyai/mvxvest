//! Writes golden vectors of the vesting maths for the dApp, which ports it to
//! TypeScript: `dapp/src/vesting/tests/vectors.json`. Run when the maths
//! changes:
//!
//!     cargo test -p mvxvest --test export_vectors -- --ignored
//!
//! The dApp's tests then check its port against every vector.

use multiversx_sc::types::{BigUint, ManagedVec};
use multiversx_sc_scenario::api::StaticApi;
use mvxvest::schedule::{Curve, MAX_TRANCHES, Schedule, Tranche};
use std::fmt::Write;

/// xorshift64*: deterministic, so the file only changes with the maths.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn amount(&mut self) -> u128 {
        match self.below(4) {
            0 => 1 + self.below(1_000) as u128,
            1 => 1 + self.below(u64::MAX) as u128,
            2 => (1 + self.below(1_000_000_000) as u128) * 10u128.pow(18),
            _ => ((self.next() as u128) << 40 | self.next() as u128) % 10u128.pow(30) + 1,
        }
    }
}

fn big(value: u128) -> BigUint<StaticApi> {
    BigUint::from(value)
}

fn text(value: &BigUint<StaticApi>) -> String {
    let bytes = value.to_bytes_be();
    let mut n: u128 = 0;
    for byte in bytes.as_slice() {
        n = (n << 8) | u128::from(*byte);
    }
    n.to_string()
}

#[test]
#[ignore]
fn export_vectors() {
    let mut rng = Rng(0x6d76_7876_6573_7431);
    let mut out = String::from("[\n");
    for case in 0..400 {
        let start = 1_600_000_000 + rng.below(400_000_000);
        let span = match rng.below(3) {
            0 => 1_000,
            1 => 86_400 * 30,
            _ => 86_400 * 365 * 8,
        };
        let duration = 1 + rng.below(span);
        let end = start + duration;
        let total = rng.amount();
        let cliff = start + rng.below(duration + 1);
        let kind = rng.below(3);
        let cliff_amount = if rng.below(3) == 0 {
            0
        } else {
            total / (1 + rng.below(10) as u128)
        };
        let (curve, curve_json, cliff_amount) = match kind {
            0 => (
                Curve::Linear,
                "{\"kind\":\"linear\"}".to_string(),
                cliff_amount,
            ),
            1 => {
                let interval = 1 + rng.below(duration);
                (
                    Curve::Stepped { interval },
                    format!("{{\"kind\":\"stepped\",\"interval\":{interval}}}"),
                    cliff_amount,
                )
            }
            _ => {
                let rest_target = total - cliff_amount;
                let count = (1 + rng.below(MAX_TRANCHES as u64)).min(duration) as usize;
                let count = count
                    .min(rest_target.min(MAX_TRANCHES as u128) as usize)
                    .max(1);
                // Distinct times in (start, end], the last at end.
                let mut times: Vec<u64> = (0..count - 1)
                    .map(|_| start + rng.below(duration))
                    .collect();
                times.sort();
                times.dedup();
                times.push(end);
                let n = times.len() as u128;
                let (cliff_amount, rest) = if rest_target >= n {
                    (cliff_amount, rest_target)
                } else {
                    (0, total)
                };
                let mut tranches = ManagedVec::new();
                let mut json = String::from("{\"kind\":\"tranches\",\"tranches\":[");
                let mut given = 0u128;
                for (i, time) in times.iter().enumerate() {
                    let amount = if i + 1 == times.len() {
                        rest - given
                    } else {
                        rest / n
                    };
                    given += amount;
                    tranches.push(Tranche {
                        time: *time,
                        amount: big(amount),
                    });
                    if i > 0 {
                        json.push(',');
                    }
                    write!(json, "{{\"time\":{time},\"amount\":\"{amount}\"}}").unwrap();
                }
                json.push_str("]}");
                (Curve::Tranches(tranches), json, cliff_amount)
            }
        };
        let schedule = Schedule::<StaticApi> {
            start,
            cliff,
            cliff_amount: big(cliff_amount),
            end,
            curve,
        };
        assert_eq!(schedule.validate(&big(total)), Ok(()), "case {case}");

        let mut times = vec![
            start.saturating_sub(1),
            start,
            cliff.saturating_sub(1),
            cliff,
            end - 1,
            end,
            end + 1,
        ];
        for _ in 0..10 {
            times.push(start.saturating_sub(10) + rng.below(duration + 20));
        }
        let mut samples = String::new();
        for (i, t) in times.iter().enumerate() {
            let vested = text(&schedule.vested_at(&big(total), *t));
            let next = match schedule.next_release(&big(total), *t) {
                Some((at, amount)) => format!("[{at},\"{}\"]", text(&amount)),
                None => "null".into(),
            };
            if i > 0 {
                samples.push(',');
            }
            write!(
                samples,
                "{{\"t\":{t},\"vested\":\"{vested}\",\"next\":{next}}}"
            )
            .unwrap();
        }
        if case > 0 {
            out.push_str(",\n");
        }
        write!(
            out,
            "{{\"total\":\"{total}\",\"schedule\":{{\"start\":{start},\"cliff\":{cliff},\"cliffAmount\":\"{cliff_amount}\",\"end\":{end},\"curve\":{curve_json}}},\"samples\":[{samples}]}}"
        )
        .unwrap();
    }
    out.push_str("\n]\n");
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../dapp/src/vesting/tests/vectors.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, out).unwrap();
}
