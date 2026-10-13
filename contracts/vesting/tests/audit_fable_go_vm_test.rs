//! Audit of 2026-10-13 (Claude Fable 5.1) on the Go VM, the one validators
//! run. Like go_vm_test, needs `mx-scenario-go` and a build
//! (`sc-meta all build`).

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

/// SAFE: the heaviest single vesting (120 tranches) creates, claims midway,
/// cancels, is read 100 times in one query, and finishes with an exact last
/// claim, all well within one transaction's gas (figures in the audit report).
#[test]
fn safe_120_tranche_vesting_within_gas() {
    run_on_go_vm("audit_fable_tranches_gas.scen.json");
}
