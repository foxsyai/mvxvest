//! Fourth audit (Claude Fable 5.1, 20 Oct 2026), reviewer SCK, on the Go VM:
//! what the Rust VM cannot model. Like go_vm_test, needs `mx-scenario-go`
//! and a build (`sc-meta all build`).

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

/// SAFE: a claim key sent to the non-payable contract with an unknown
/// function ("invalid function (not found)", status 1) and a cancel key sent
/// to a view ("function does not accept ESDT payment", status 10) both stay
/// with their senders. A transfer with no function at all is refused by the
/// protocol before any transaction exists: the runner itself stops with
/// "sending value to non payable contract", so it cannot be a step.
#[test]
fn safe_stray_keys_never_leave_their_senders() {
    run_on_go_vm("audit4_sck_stray_key_to_nonpayable.scen.json");
}
