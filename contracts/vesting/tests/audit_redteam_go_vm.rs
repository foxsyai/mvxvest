//! Red-team evidence on the Go VM (the one validators run): one hostile dust
//! key makes a multi-key claim fail as a whole.
//!
//! An attacker who issued a token with `canFreeze` creates a 1-unit vesting of
//! it for the victim (any address, no consent needed), then freezes the
//! victim's account for that token (the issuer may freeze any holder). From
//! then on every `claim` that includes that key fails: the payout is one
//! MultiESDTNFTTransfer, and the frozen token makes the whole transfer, so the
//! whole transaction, fail. The dApp's "Claim all" puts every claimable key
//! of the wallet in one transaction, so the simulation refuses it and the
//! page cannot say which key is the cause
//! (dapp/src/pages/tests/audit_redteam_claim_all.test.tsx). A token with a
//! transfer role (limited transfer) does the same with no freeze at all, and
//! such a key can never be burned: it stays in the wallet until sent away.
//!
//! The scenario PASSES: it is evidence of the chain's behaviour, which the
//! contract cannot change; the fix is in the dApp (simulate per key when the
//! batch fails, and offer the rest).

use std::{path::PathBuf, process::Command};

#[test]
fn one_frozen_dust_key_fails_the_whole_claim_on_the_go_vm() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scenarios")
        .join("audit_redteam_frozen_claim_all.scen.json");
    let output = Command::new("mx-scenario-go")
        .arg("run")
        .arg(&path)
        .output()
        .unwrap_or_else(|error| {
            panic!(
                "this test needs the Go VM runner `mx-scenario-go` ({error}): \
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
        "the scenario failed on the Go VM:\n{text}"
    );
}
