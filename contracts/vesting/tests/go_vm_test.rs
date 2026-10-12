//! Runs every scenario in `scenarios/` on the Go VM, the one validators run.
//!
//! The Rust test VM differs from it in places that matter: it writes a new
//! contract's account and code metadata before running `init`, the Go VM after.
//! A deploy-time check that passed every Rust test failed every real deploy
//! (second review of 2026-10-12), so the essentials run here too.
//!
//! Needs `mx-scenario-go` (`sc-meta install mx-scenario-go`) and a build
//! (`sc-meta all build`): the scenarios load `output/mvxvest.mxsc.json`.

use std::{path::PathBuf, process::Command};

fn run_on_go_vm(scenario: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scenarios")
        .join(scenario);
    let output = Command::new("mx-scenario-go")
        .arg("run")
        .arg(&path)
        .output()
        .unwrap_or_else(|error| {
            panic!(
                "these tests need the Go VM runner `mx-scenario-go` ({error}): \
                 install it with `sc-meta install mx-scenario-go`"
            )
        });
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success() && text.contains("SUCCESS"),
        "{scenario} failed on the Go VM:\n{text}"
    );
}

/// Deploys non-payable, as `scripts/src/deploy.ts` does.
#[test]
fn deploy() {
    run_on_go_vm("deploy.scen.json");
}

/// Create (ESDT and EGLD), claim, move the key, claim as the new holder,
/// cancel, final claim: every balance and key holding checked.
#[test]
fn lifecycle() {
    run_on_go_vm("lifecycle.scen.json");
}

/// The largest batch allowed (75 cancelable vestings) fits in the 600M gas a
/// transaction may carry.
#[test]
fn batch_max() {
    run_on_go_vm("batch_max.scen.json");
}
