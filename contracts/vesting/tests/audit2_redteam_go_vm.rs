//! Audit 2 (red team), on the Go VM validators run. Three scenarios in
//! `scenarios/audit2_redteam_*.scen.json`, each of which PASSES: it pins what
//! the chain does, as evidence for the report.
//!
//! - `upgrade_moment`: mainnet's version 1 (the committed `v1/mvxvest-v1.wasm`,
//!   code hash `fd32f4e1…`) is upgraded to version 2 while creators are
//!   working. What was built against version 1 and signed after the upgrade
//!   (a batch of 50) or after the fee votes (a payment without the fees) is
//!   refused, never reinterpreted; the old vestings keep claiming and
//!   cancelling with both fees set; no surplus is left behind.
//! - `fee_frozen_owner`: the token's issuer freezes the owner multisig for
//!   its token. The fee transfer is in `create`'s critical path, so on one
//!   shard every creation of that token fails while the fee is on (across
//!   shards, as on mainnet, the fee bounces back as surplus instead). Claims
//!   are untouched.
//! - `fee_nonpayable_owner`: an owner contract that is not payable by
//!   contracts cannot receive the fee, so no creation with a fee succeeds.
//!   The mainnet multisig is payable by contracts today; a future owner
//!   change would have to keep that.

use std::{path::PathBuf, process::Command};

fn run(name: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("scenarios")
        .join(format!("audit2_redteam_{name}.scen.json"));
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
        "the scenario {name} failed on the Go VM:\n{text}"
    );
}

#[test]
fn the_upgrade_moment_refuses_what_was_built_against_version_1() {
    run("upgrade_moment");
}

#[test]
fn a_frozen_owner_blocks_every_creation_of_that_token_while_the_fee_is_on() {
    run("fee_frozen_owner");
}

#[test]
fn an_owner_not_payable_by_contracts_blocks_every_creation_with_a_fee() {
    run("fee_nonpayable_owner");
}
