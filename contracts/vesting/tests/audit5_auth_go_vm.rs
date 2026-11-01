//! Fifth audit (Claude Fable 5.1, 1 Nov 2026), reviewer AUTH, on the Go VM
//! (the one validators run). Like go_vm_test, needs `mx-scenario-go` and a
//! build (`sc-meta all build`). Everything here depends on the protocol, so
//! the Rust VM would prove nothing: direct calls of `init`, `upgrade` and
//! `callBack`, the upgrade itself, ESDT roles on the key collections, NFT
//! quantities, transfers to contracts, what a holder's account keeps of a
//! key.
//!
//! Two shapes the runner refuses before any transaction exists, so they
//! cannot be steps (seen on 26b0d4c, 1 Nov 2026, by running the step alone):
//! the same key twice in one multi-transfer stops the runner with `new NFT
//! data on sender for token VESTKEY-123456`, and a quantity of 2 of a key
//! with `invalid NFT quantity`. Both come from the protocol's
//! `MultiESDTNFTTransfer`, which runs before the contract: the call never
//! reaches `claim`.

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

/// SAFE: `init`, `upgrade` and `callBack` cannot be called as endpoints by
/// anyone, the owner included (`calling init() directly is forbidden`,
/// `calling callBack() directly is forbidden`); a stranger's
/// `upgradeContract` is refused (`upgrade not allowed`); the owner's upgrade
/// with a stray argument is refused (`wrong number of arguments`) and the
/// vesting count is unchanged. The collection at nonce 0, a key next to
/// EGLD-000000 or FOX, a claim key sent to `cancel`, a cancel key sent to
/// `claim` or to `create` all fail whole with the contract's own message.
/// The owner cannot recover a key its holder has, nor the locked FOX; after
/// the pause, both fee caps, a new display and the stamping switched off, a
/// claim pays what vested and a cancel refunds the rest. A vesting for a
/// non-payable contract in the same shard is refused whole
/// (`sending value to non payable contract`).
#[test]
fn safe_protocol_side_authorization() {
    run_on_go_vm("audit5_auth_protocol.scen.json");
}

/// SAFE: a payable contract as beneficiary gets its key like a wallet and
/// claims like one (transfer and execute); holding the key gives it no right
/// to `ESDTNFTUpdateAttributes`, `ESDTNFTAddURI`, `ESDTNFTBurn` or
/// `ESDTNFTCreate` on the collection (`action is not allowed`). A
/// non-payable contract that holds a key is paid too when it is the caller:
/// the payout is a back transfer to the caller with no execution, which the
/// VM exempts from the payable check (mx-chain-vm-go v1.5.21,
/// vmhost/contexts/output.go, `isBackTransferWithoutExecution`); in the
/// same shard nothing bounces and nothing is parked. The holder contracts
/// are the Go VM's own test forwarder, copied to
/// `scenarios/audit5/forwarder.wasm` (mx-chain-vm-go v1.5.21,
/// test/features/composability/forwarder/output).
#[test]
fn safe_contract_as_beneficiary_and_caller() {
    run_on_go_vm("audit5_auth_contract_holder.scen.json");
}

/// SAFE: a key stamped while a later holder had it shows the stamp when it
/// comes back to an earlier holder, whose account kept no stale copy (the
/// protocol deletes an NFT entry at zero balance, mx-chain-vm-common-go
/// v1.6.0 builtInFunctions/esdtDataStorage.go `SaveESDTNFTToken`), and the
/// earlier holder's claim pays only what the later holder left.
#[test]
fn safe_a_key_back_to_an_earlier_holder_shows_the_stamp() {
    run_on_go_vm("audit5_auth_key_back_to_earlier_holder.scen.json");
}
