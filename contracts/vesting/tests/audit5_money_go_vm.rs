//! Fifth audit (reviewer MONEY, 1 Nov 2026) on the Go VM, the one validators
//! run: what the Rust VM cannot model (frozen ESDT accounts, the protocol's
//! own transfer refusals). Like go_vm_test, needs `mx-scenario-go` and a
//! build (`sc-meta all build`).

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

/// SAFE: a token whose issuer freezes the contract and wipes its balance
/// (the state ESDTFreeze and ESDTWipe leave) harms only that token: its
/// deficit shows in `getDeficit`, its claims and cancels fail whole with the
/// keys going back, while another token's claims, cancels and books are
/// untouched, and its balance can never be moved to cover the hole.
#[test]
fn safe_a_wiped_token_harms_only_itself() {
    run_on_go_vm("audit5_money_wiped_token_isolation.scen.json");
}

/// SAFE: a mixed claim of three tokens and EGLD, some keys finishing and
/// some stamped, pays each holder exactly what vested and returns or burns
/// each key, with the protocol's own MultiESDTNFTTransfer carrying EGLD in
/// the middle of the list; then every cancel key, held by the beneficiary,
/// refunds the right amount or nothing.
#[test]
fn safe_mixed_claim_and_cancel_by_the_beneficiary() {
    run_on_go_vm("audit5_money_mixed_claim_cancel.scen.json");
}
