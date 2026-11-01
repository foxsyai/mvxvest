//! Fifth audit, red team: Go VM scenarios (the validators' VM). Needs
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

/// CHECKED SOUND (griefer, views): a wallet or a token given 100 vestings of
/// 120 tranches each (10 EGLD in fees) is still read in one `getVestings` of
/// 100 ids, the page My vestings and the Token page ask for. One such view
/// costs about 96M gas on this VM (15 fit in 1.5B, 16 do not: the node's
/// default `ShardMaxGasPerVmQuery`), but the public API answers queries with
/// the 300B of `MaxGasLimitPerQuery` (gasRemaining about 299.99B on mainnet
/// and devnet, 1 Nov 2026; 100 twelve-tranche views on devnet used 248M), so
/// the scenario runs the view with 300B.
#[test]
fn views_of_100_vestings_of_120_tranches_fit_the_api_query_budget() {
    run_on_go_vm("audit5_redteam_views_gas.scen.json");
}
