//! Review 3: more of the money paths on the Go VM, where the Rust test VM
//! could differ: EGLD-000000 in multi-transfers (in and out), `createBatch`,
//! merged multi-token payouts and refunds, fees, surplus, and the owner-only
//! recovery of keys parked in the contract.
//!
//! Like go_vm_test, needs `mx-scenario-go` and a build (`sc-meta all build`).

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

/// createBatch with the fee as EGLD-000000 in the multi-transfer; an EGLD
/// vesting paid as two EGLD-000000 entries; an ESDT create with the fee
/// first; a five-key claim of three tokens (payouts merged per token, EGLD as
/// EGLD-000000 next to the keys, one `vestingClaimed` per key that paid or
/// burned, none for the key that paid nothing); cancels refunding FOX + EGLD and FOX + USDC;
/// claimFees; recoverSurplus of EGLD and FOX. Every balance and key checked.
#[test]
fn money_paths() {
    run_on_go_vm("review3_money_paths.scen.json");
}

/// FINDING (fails on 25a4062): a delivered claim key parked in the contract
/// while it was payable becomes the creator's once the metadata is repaired.
#[test]
fn finding_parked_key_after_repair() {
    run_on_go_vm("review3_finding_parked_key.scen.json");
}

/// FINDING (fails on 25a4062): a cancel key the creator passed on, parked
/// while the contract is payable, is the creator's to take.
#[test]
fn finding_parked_cancel_key() {
    run_on_go_vm("review3_finding_parked_cancel_key.scen.json");
}
