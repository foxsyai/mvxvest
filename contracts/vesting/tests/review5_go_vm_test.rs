//! Review 5 (of da3c117) on the Go VM. Like go_vm_test, needs
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

/// SAFE: the dApp's cap for "claim all" and "cancel all" is 99 keys: one burn
/// per key plus one transfer is 100 built-in calls, the network's maximum
/// (counted in review5_builtin_calls_test). On the Go VM, 99 cancel keys, 99
/// finishing plain claim keys and 99 claim keys of cancelled vestings each go
/// in one call, with exact refunds and payouts (about 133M gas each with this
/// VM's gas schedule; devnet charges more per key, so the dApp also splits by
/// simulated gas). Since version 3, 99 unfinished keys that pay and go back
/// stamped are 99 `ESDTMetaDataUpdate` calls plus the transfer, 100 again:
/// they go in one call too, for about 300M gas.
#[test]
fn safe_99_keys() {
    run_on_go_vm("review5_safe_99_keys.scen.json");
}
