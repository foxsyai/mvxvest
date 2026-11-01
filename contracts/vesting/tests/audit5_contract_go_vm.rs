//! Fifth audit, the contract's fixes on the Go VM (the validators' VM). Needs
//! `mx-scenario-go` and a build in `output/`, like `go_vm_test.rs`.

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

/// FINDING RT-1 and PROTO-1: `claim` sends each token and the returned keys
/// apart and `cancel` each token of its refunds, all as direct calls with no
/// function after them. The logs are pinned one by one. On version 3 this
/// fails with "too few logs ... Want:15. Got:11": one transfer of everything,
/// which on devnet bounced whole (tx f17518c5...).
#[test]
fn finding_claim_and_cancel_send_each_token_and_the_keys_apart() {
    run_on_go_vm("audit5_contract_separate_transfers.scen.json");
}
