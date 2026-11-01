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

/// SAFE: the most keys of one token that fit the network's 100 built-in calls
/// (counted in review5_builtin_calls_test; the dApp sends at most 50). One
/// burn per key plus the token's transfer: on the Go VM, 99 cancel keys, 99
/// finishing plain claim keys and 99 claim keys of cancelled vestings each go
/// in one call, with exact refunds and payouts (about 133M gas each with this
/// VM's gas schedule; devnet charges more per key, so the dApp also splits by
/// simulated gas). Unfinished keys that pay and go back stamped need one more
/// transfer since version 4, the one of the keys: 98 `ESDTMetaDataUpdate`
/// calls, the token's transfer and the keys' transfer, 100 again, for about
/// 300M gas.
#[test]
fn safe_99_keys() {
    run_on_go_vm("review5_safe_99_keys.scen.json");
}
