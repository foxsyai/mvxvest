//! Audit of version 3 (Claude Fable 5.1, 21 Oct 2026), red team (V3R), on
//! the Go VM: the real `ESDTMetaDataUpdate` (mx-chain-vm-common-go), not the
//! Rust VM's mock. Like go_vm_test, needs `mx-scenario-go` and a build
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

/// SAFE, pinned on the real builtin: a stamped key keeps its two pictures
/// (read back with `getESDTTokenData` and passed to the update) and its
/// creator, and the stamp lands before the `metadata` part. V3R-3 (Info) and
/// V3C-1 found that the stamp wrote the display's CURRENT metadata into a key
/// minted under an older display, while `setKeyDisplay` says keys already
/// minted keep theirs; fixed, the key keeps its own metadata.
#[test]
fn safe_a_stamp_keeps_the_pictures_and_the_keys_own_metadata() {
    run_on_go_vm("v3audit_redteam_stamp_keeps_display.scen.json");
}
