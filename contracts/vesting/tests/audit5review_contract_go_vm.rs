//! Fifth audit, review of the contract fixes (V4C), on the Go VM (the
//! validators' VM). Needs `mx-scenario-go` and a build in `output/`, like
//! `go_vm_test.rs`.
//!
//! The upgrade from the real version 3 code (scenarios/v3/mvxvest-v3.wasm,
//! whose blake2b-256 is mainnet's code hash 65c689b9..., checked by the
//! reviewer against the mainnet account's code) to this build, with the
//! contract's whole storage and every holding pinned to the byte before and
//! after the upgrade, vestings in every state, a version 1 layout key, an
//! EGLD vesting, a key the contract holds after a bounce, a surplus and fees
//! accrued. Each state then moves on under version 4 with the transfers
//! pinned one by one, and `upgrade` cannot be called by anyone else.

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

/// SAFE: the storage, holdings and balances of a version 3 contract with
/// vestings in every state are the same bytes after the upgrade to version
/// 4; every state then claims, cancels, finishes or is recovered under
/// version 4, each token and the keys in their own transfer.
#[test]
fn safe_upgrade_from_the_real_version_3_keeps_every_byte_and_every_state_moves_on() {
    run_on_go_vm("audit5review_contract_upgrade_states.scen.json");
}
