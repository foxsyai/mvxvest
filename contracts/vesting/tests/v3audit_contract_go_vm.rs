//! Audit of version 3 (V3C) on the Go VM. Like go_vm_test, needs
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

/// V3C-1: the stamp writes the display's current `metadata:` into a key
/// minted under an earlier display, next to that earlier display's pictures.
/// Fails on 7361158.
#[test]
fn v3c1_stamp_keeps_the_metadata_the_key_was_minted_with() {
    run_on_go_vm("v3audit_contract_stamp_keeps_key_metadata.scen.json");
}
