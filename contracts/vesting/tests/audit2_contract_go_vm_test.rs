//! Second audit (Claude Fable 5.1, max effort, 14 October 2026) on the Go VM,
//! the one validators run. Like go_vm_test, needs `mx-scenario-go` and a
//! build (`sc-meta all build`): the scenarios load `output/mvxvest.mxsc.json`
//! and the live version 1 code `scenarios/v1/mvxvest-v1.wasm`.

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

/// SAFE, the upgrade: every kind of version 1 state the mainnet contract can
/// hold (a fee and its accrued EGLD, the paused flag, a key display, an EGLD
/// vesting stored under `EGLD-000000`, a cancelled and fully claimed vesting
/// with both keys burned, a surplus) is read back field by field by version
/// 2, which then collects the old fees, keeps refusing creations while
/// paused, mints a key with the marker and the old display, returns the old
/// surplus in two parts and pays out the old vestings to the unit.
#[test]
fn safe_upgrade_keeps_every_piece_of_v1_state() {
    run_on_go_vm("audit2_contract_safe_upgrade_keeps_v1_state.scen.json");
}

/// SAFE, the fee's destination: with the owner a contract that is payable by
/// smart contracts (the mainnet multisig has these flags), the token fee and
/// the collected EGLD fees land in it. With an owner contract that is not,
/// a creation whose fee is not zero fails in the owner's shard (across
/// shards the fee would bounce back as surplus instead); a creation whose
/// fee rounds to zero is unaffected.
#[test]
fn safe_fees_reach_a_contract_owner_that_is_payable_by_sc() {
    run_on_go_vm("audit2_contract_safe_fee_to_contract_owner.scen.json");
}
