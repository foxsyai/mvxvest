//! Fifth audit, review of the fixes (FIXR), on the Go VM: what the contract's
//! argument decoder takes, against what scripts/src/multisig.ts lets a signer
//! sign. Like go_vm_test, needs `mx-scenario-go` and a build (`sc-meta all
//! build`). The scenario passes: the tool and the VM agree (the reviewer's
//! suspicion that a number on more than 8 bytes would be refused by the
//! contract was wrong: ManagedBuffer::parse_as_u64 is not an argument's path).

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

/// PINNED: a KeyKind of two bytes (0001) is Cancel, as the fix says, and so
/// is one of nine zero-led bytes; a bps of 10 on ten bytes is 10. The VM
/// decodes an endpoint argument by its value, whatever its length, so
/// multisig.ts's measure by value (scripts/src/audit5review_fixr_arg_lengths.test.ts)
/// is the contract's.
#[test]
fn pinned_a_number_on_more_than_8_bytes_is_taken_at_its_value() {
    run_on_go_vm("audit5review_fixr_arg_lengths.scen.json");
}
