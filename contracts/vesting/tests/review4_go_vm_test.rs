//! Review 4 (of a3d7b68) on the Go VM. Like go_vm_test, needs
//! `mx-scenario-go` and a build (`sc-meta all build`).

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

/// SAFE: cancel keys are now pushed without `add_payment`. A batch of 33
/// cancelable vestings sends 33 distinct cancel keys (amount 1, one
/// collection) to the creator in one multi-transfer, each claim key to its
/// beneficiary, and keeps none; then all 33 cancel in one call. Key nonces
/// start at 101 because mx-scenario-go's state check mis-reads a nonce byte
/// 0x2d ("-"), i.e. nonce 45.
#[test]
fn safe_batch_cancel_keys() {
    run_on_go_vm("review4_safe_batch_cancel_keys.scen.json");
}
