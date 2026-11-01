//! Fifth audit (Claude Fable 5.1, 1 Nov 2026), reviewer PROTO: what the
//! protocol does with the contract, on the Go VM (the one validators run).
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

/// SAFE: payment shapes at `claim` and `cancel`. EGLD-000000 mixed among
/// the keys, plain EGLD value next to a key (the VM folds it into the multi
/// transfer as EGLD-000000), a stray argument, a claim key sent to `cancel`
/// and a cancel key sent to `claim` all fail with nothing booked and every
/// key back with its holder. The same key twice in one transfer is refused
/// by the protocol before any transaction exists (the runner stops with
/// "new NFT data on sender"), so it cannot be a step.
#[test]
fn safe_payment_shapes_at_claim_and_cancel() {
    run_on_go_vm("audit5_proto_payment_shapes.scen.json");
}

/// SAFE: a smart contract calling `claim` through an async call gets the
/// payout and the key back whether or not it is payable by contracts: a
/// transfer with no function to the calling contract is a back transfer,
/// delivered without a payable check and without running any of its code
/// (mx-chain-vm-go `isBackTransferWithoutExecution`). So no payout to a
/// caller bounces in the caller's own transaction, and no code of the caller
/// runs inside `claim`.
#[test]
fn safe_contract_caller_gets_its_payout_back() {
    run_on_go_vm("audit5_proto_sc_caller.scen.json");
}
