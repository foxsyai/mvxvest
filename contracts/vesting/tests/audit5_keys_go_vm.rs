//! Fifth audit (KEYS) on the Go VM, the one validators run: the stamp of
//! version 3 against the real `ESDTMetaDataUpdate` built-in, and the gas of
//! the largest page a view returns. Like go_vm_test, needs `mx-scenario-go`
//! and a build (`sc-meta all build`). Every scenario here passes: they pin
//! what holds (and the numbers measured).

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

/// SAFE, pinned: without `ESDTRoleNFTUpdate` on the claim key collection
/// (the owner could drop it, or a protocol change could rename it), a claim
/// that pays and returns the key fails on the real built-in ("action is not
/// allowed"): the key and the tokens stay where they were. The owner's
/// `setKeyStamping(false)` is the backstop: the same claim then pays, and a
/// finishing claim (a burn) never needed the role.
#[test]
fn safe_without_the_update_role_the_stamping_switch_restores_claims() {
    run_on_go_vm("audit5_keys_stamp_without_update_role.scen.json");
}

/// SAFE, pinned: the stamp rewrites only the name and the attributes. A key
/// of version 1's layout (no `cancelable` marker, one empty URI, no hash, no
/// royalties) and a key with royalties, a hash and two URIs, claimed in the
/// same call, keep what they had and gain `cancelable:<flag>;claimed:<units>`.
#[test]
fn safe_the_stamp_keeps_royalties_hash_and_uris_of_any_key_layout() {
    run_on_go_vm("audit5_keys_stamp_odd_keys.scen.json");
}

/// SAFE, measured: `getVestings` of the largest page the site asks for (100
/// ids) of the heaviest vesting (120 tranches) uses about 9.06 billion gas on
/// this VM (one such vesting 94.6M; 100 linear vestings 105M). The public API
/// gives a query 300 billion (`MaxGasLimitPerQuery`; api.multiversx.com
/// answers `getVestingCount` with gasRemaining 299,995,967,310), so the page
/// loads there; a node left on the default `ShardMaxGasPerVmQuery` of 1.5
/// billion would refuse it past about 16 such vestings in one page.
#[test]
fn safe_a_page_of_100_vestings_of_120_tranches_fits_the_apis_query_gas() {
    run_on_go_vm("audit5_keys_views_gas.scen.json");
}
