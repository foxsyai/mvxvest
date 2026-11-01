// Audit 5 (operations): what scripts/src/multisig.ts tells a board member and
// what it refuses before `sign` or `perform` of an action proposed by a
// compromised or careless signer. The tool is run for real, as a board member
// would, against a stand-in network (audit5_ops_multisig_mock.ts) that holds
// the crafted action #7. No MVXVEST_FROM, so nothing is simulated and no
// network is reached: the tool decodes, describes, checks and prints.
//
//   cd scripts && node --import tsx --test src/audit5_ops_multisig_signer.test.ts
//
// The tests marked FAILS fail on main at 26b0d4c:
//   - OPS-1: a recoverSurplus or recoverBouncedKey whose recipient is the zero
//     address or the vesting contract itself is accepted at sign time; the
//     contract refuses it (ERR_BAD_RECIPIENT, claim.rs) at perform time and
//     the action is used up (the class of the fourth audit's OPS-2);
//   - OPS-2: a recoverSurplus whose token argument is not an identifier is
//     accepted, and its raw bytes are printed into the description, so a
//     carriage return or a terminal escape in it forges the line the second
//     signer reads; the contract would refuse it anyway (no surplus of a
//     token that does not exist), using the action up;
//   - OPS-3: a recoverBouncedKey of a key the vesting contract does not hold
//     is accepted; the contract refuses it (ERR_NO_HELD_KEY) and the action
//     is used up;
//   - OPS-4: on mainnet the tool's notion of "the vesting contract" is
//     scripts/state/mainnet.json, a file git ignores and each signer writes
//     by hand (no runbook says how): with a look-alike address in it, every
//     check that says "not the vesting contract" measures against the
//     look-alike, and a call on the look-alike is accepted as a call on
//     mvxvest. The mainnet address belongs in the tool's source, like
//     config.mainnet.ts pins it for the site.
// The others pin what held: a transfer-and-execute hiding a call, a call to
// the multisig itself, a quorum change, an endpoint named after an
// Object.prototype property, an upgrade with an argument, and an upgrade
// whose metadata would make the contract payable or not readable.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { CLAIM_KEY_1, LOOKALIKE, MAINNET_CONTRACT, MULTISIG, RELEASE_HASH, STEPPED_CANCEL_KEY, TRANCHES_CLAIM_KEY } from "./audit5_ops_multisig_mock.js";

/** Runs `multisig.ts <command> 7` with the crafted action #7 pending. */
const run = (command: string, audit5Case: string, extra: Record<string, string> = {}) => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit5_ops_multisig_mock.ts", "src/multisig.ts", command, "7"],
    {
      env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, AUDIT5_CASE: audit5Case, ...extra },
      encoding: "latin1",
    },
  );
  const reads = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("AUDIT5_READ "))
    .map((line) => line.slice("AUDIT5_READ ".length));
  return { status: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr, reads };
};

test("baseline: an unpauseCreation is described and may be signed (the stand-in works)", () => {
  const { status, out, err, reads } = run("sign", "unpause");
  assert.ok(reads.some((read) => read.includes("getActionData")), "sign must read the action");
  assert.equal(status, 0, err);
  assert.match(out, /call unpauseCreation\(\) on/);
  assert.match(out, /data: {3}sign@07/);
});

// ---------------------------------------------------------------- OPS-1

test("FAILS (OPS-1): sign recoverSurplus(FOXSY, zero address): the contract refuses the recipient, so refuse before two signatures are spent", () => {
  const { status, all } = run("sign", "surplus-to-zero-address");
  assert.match(all, /recoverSurplus\(FOXSY-5d5f3e, erd1q{52}6gq4hu/);
  assert.notEqual(status, 0, "recoverSurplus to the zero address: ERR_BAD_RECIPIENT at perform time, action used up");
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("FAILS (OPS-1): perform recoverSurplus(FOXSY, the vesting contract itself): refused", () => {
  const { status, all } = run("perform", "surplus-to-the-contract");
  assert.notEqual(status, 0, "recoverSurplus to the contract itself: ERR_BAD_RECIPIENT at perform time, action used up");
  assert.doesNotMatch(all, /data: {3}performAction@07/);
});

// ---------------------------------------------------------------- OPS-2

test("FAILS (OPS-2): sign recoverSurplus with a token argument that is not an identifier (terminal escapes in it): refused, and never printed raw", () => {
  const { status, out, all } = run("sign", "surplus-forged-token");
  // What the second signer's terminal gets: a line that reads as an honest recoverSurplus to the
  // multisig, then a carriage return and SGR 8 (conceal) before the real recipient 0x11…11.
  assert.doesNotMatch(out, /[\x00-\x08\x0b-\x1f\x7f]/, "control bytes from the action must not reach the terminal");
  assert.notEqual(status, 0, "a token that is not an identifier has no surplus: the perform fails and the action is used up");
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

// ---------------------------------------------------------------- OPS-3

test("FAILS (OPS-3): sign recoverBouncedKey(1, Claim, beneficiary) when the contract holds no such key: refused", () => {
  const { status, all, reads } = run("sign", "bounced-key-not-held");
  assert.ok(reads.some((read) => read.includes("getVesting")), `the tool reads the vesting; reads: ${JSON.stringify(reads)}`);
  assert.ok(
    reads.some((read) => /\/accounts\/erd1[0-9a-z]+\/nfts/.test(read)),
    `the tool must read what the contract holds before describing a recovery; reads: ${JSON.stringify(reads)}`,
  );
  assert.notEqual(status, 0, "the contract holds no claim key of vesting 1: ERR_NO_HELD_KEY at perform time, action used up");
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

// ---------------------------------------------------------------- OPS-4

test("FAILS (OPS-4): on mainnet, with a look-alike contract in scripts/state/mainnet.json, a call on the look-alike is refused as not mvxvest", () => {
  const { status, all, reads } = run("sign", "pause-the-state-files-contract", { MVXVEST_NETWORK: "mainnet" });
  assert.notEqual(LOOKALIKE, MAINNET_CONTRACT);
  assert.ok(reads.some((read) => read.includes("getActionData")), "sign must read the action");
  assert.match(all, new RegExp(`call pauseCreation\\(\\) on ${LOOKALIKE}`), "the tool describes a call on the look-alike");
  assert.notEqual(status, 0, `the mainnet vesting contract is ${MAINNET_CONTRACT}; a local state file must not redefine it`);
  assert.match(all, new RegExp(MAINNET_CONTRACT), "the refusal names the real contract");
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

// ---------------------------------------------------------- checked sound

test("on mainnet MVXVEST_SEND never signs: refused by lib.ts signer() before anything is read or built", () => {
  // signer() throws for any name but "deployer" on mainnet (and "deployer" needs MVXVEST_MAINNET_GO=yes);
  // multisig.ts refuses to send on any network but devnet even then. No key file is read: the refusal
  // comes before the PEM path is built, so this runs on a machine with no ~/.config/mvxvest at all.
  const { status, all, reads } = run("sign", "unpause", { MVXVEST_NETWORK: "mainnet", MVXVEST_SEND: "owner" });
  assert.notEqual(status, 0);
  assert.match(all, /On mainnet only the deployer key signs/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
  assert.ok(!reads.some((read) => read.includes("withGuardianInfo")), "no sender account is read");
});

test("sign a SendTransferExecute (kind 5) that hides a pauseCreation call: refused", () => {
  const { status, all } = run("sign", "transfer-execute-hiding-a-call");
  assert.notEqual(status, 0);
  assert.match(all, /kind 5 is not what this tool signs/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("perform an async call to the multisig itself (changeQuorum): refused", () => {
  const { status, all } = run("perform", "call-to-the-multisig-itself");
  assert.notEqual(status, 0);
  assert.match(all, /not the vesting contract/);
  assert.match(all, /"changeQuorum" is not one of mvxvest's owner calls/);
  assert.doesNotMatch(all, /data: {3}performAction@07/);
});

test("sign a ChangeQuorum (kind 4): refused", () => {
  const { status, all } = run("sign", "change-quorum");
  assert.notEqual(status, 0);
  assert.match(all, /kind 4 is not what this tool signs/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("sign a call to an endpoint named toString or __proto__ (an Object.prototype key, which `in` finds): refused", () => {
  for (const name of ["endpoint-toString", "endpoint-proto"]) {
    const { status, all } = run("sign", name);
    assert.notEqual(status, 0, `${name}: ${all}`);
    assert.doesNotMatch(all, /data: {3}sign@07/);
  }
});

test("sign an upgrade of mvxvest from the release's source with one argument: refused", () => {
  const { status, all } = run("sign", "upgrade-with-an-argument", { MVXVEST_EXPECT_HASH: RELEASE_HASH });
  assert.notEqual(status, 0);
  assert.match(all, /passes 1 argument/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("sign an upgrade whose metadata makes mvxvest payable (0502), payable by contracts (0504) or not readable (0100): refused", () => {
  for (const [name, metadata] of [
    ["upgrade-payable", "0502"],
    ["upgrade-payable-by-sc", "0504"],
    ["upgrade-not-readable", "0100"],
  ]) {
    const { status, all } = run("sign", name, { MVXVEST_EXPECT_HASH: RELEASE_HASH });
    assert.notEqual(status, 0, `${name}: ${all}`);
    assert.match(all, new RegExp(`metadata is ${metadata}, not 0500`));
    assert.doesNotMatch(all, /data: {3}sign@07/);
  }
});

// ------------------------------------- what the fix added, failing first

test("OPS-1: sign recoverBouncedKey to the zero address or to the contract: refused like a surplus", () => {
  for (const name of ["bounced-key-to-zero-address", "bounced-key-to-the-contract"]) {
    const { status, all } = run("sign", name);
    assert.notEqual(status, 0, `${name}: ${all}`);
    assert.match(all, /the recipient is/);
    assert.doesNotMatch(all, /data: {3}sign@07/);
  }
});

test("OPS-2: EGLD-000000 is an identifier, a lower case ticker is not", () => {
  const egld = run("sign", "surplus-egld");
  assert.equal(egld.status, 0, egld.err);
  assert.match(egld.out, /data: {3}sign@07/);
  const lower = run("sign", "surplus-lower-case-token");
  assert.notEqual(lower.status, 0);
  assert.match(lower.all, /not a token identifier/);
});

test("OPS-2: an endpoint name and a display URI print no raw control byte, on either stream", () => {
  for (const name of ["endpoint-with-escapes", "display-uri-with-escapes"]) {
    const { all } = run("sign", name);
    assert.doesNotMatch(all, /[\x00-\x08\x0b-\x1f\x7f-\x9f]/, `${name}: control bytes reached the terminal`);
  }
  const { status, all } = run("sign", "endpoint-with-escapes");
  assert.notEqual(status, 0);
  assert.doesNotMatch(all, new RegExp(`call pauseCreation\\(\\) on ${MAINNET_CONTRACT}$`, "m"), "no forged line");
});

test("OPS-3: a key the contract holds may be signed, and the read names exactly that key", () => {
  const { status, out, err, reads } = run("sign", "bounced-key-held");
  assert.equal(status, 0, err);
  assert.ok(reads.some((read) => read.endsWith(`/nfts?identifiers=${CLAIM_KEY_1}`)), JSON.stringify(reads));
  assert.match(out, /data: {3}sign@07/);
});

test("OPS-3: the key's nonce is found behind every curve (tranches and stepped)", () => {
  for (const [name, key] of [
    ["bounced-claim-key-tranches", TRANCHES_CLAIM_KEY],
    ["bounced-cancel-key-stepped", STEPPED_CANCEL_KEY],
  ]) {
    const { status, err, reads } = run("sign", name);
    assert.equal(status, 0, `${name}: ${err}`);
    assert.ok(reads.some((read) => read.endsWith(`/nfts?identifiers=${key}`)), `${name}: ${JSON.stringify(reads)}`);
  }
});

test("OPS-3: a vesting that cannot be cancelled has no cancel key: refused", () => {
  const { status, all } = run("sign", "bounced-cancel-key-none");
  assert.notEqual(status, 0, all);
  assert.match(all, /has no cancel key/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("OPS-3: a read that fails refuses, it never passes", () => {
  for (const name of ["bounced-key-collection-unread", "bounced-key-nfts-unread", "bounced-key-nfts-not-a-list", "bounced-key-view-truncated"]) {
    const { status, all } = run("sign", name);
    assert.notEqual(status, 0, `${name}: ${all}`);
    assert.match(all, /could not be read/, name);
    assert.doesNotMatch(all, /data: {3}sign@07/, name);
  }
});

test("OPS-3: an answer that lists some other key is not this key", () => {
  const { status, all } = run("sign", "bounced-key-another-key-listed");
  assert.notEqual(status, 0, all);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("the Go VM takes a byte 00 as Claim or false (argument decode of KeyKind and bool, 1 Nov 2026): such an action may be signed", () => {
  for (const name of ["bounced-key-kind-byte-00", "display-kind-byte-00", "stamping-byte-00"]) {
    const { status, err, out } = run("sign", name);
    assert.equal(status, 0, `${name}: ${err}`);
    assert.match(out, /data: {3}sign@07/, name);
  }
  assert.match(run("sign", "stamping-byte-00").out, /setKeyStamping\(off\)/);
  assert.match(run("sign", "display-kind-byte-00").out, /setKeyDisplay\(Claim,/);
});

test("the Go VM refuses a bool of two bytes (input too long) and a kind of 2 (invalid value): still refused", () => {
  for (const name of ["stamping-two-zero-bytes", "display-kind-two"]) {
    const { status, all } = run("sign", name);
    assert.notEqual(status, 0, `${name}: ${all}`);
    assert.doesNotMatch(all, /data: {3}sign@07/, name);
  }
});

test("OPS-4: on mainnet the refusal names the look-alike as what the action calls, and the state file that disagrees", () => {
  const { all } = run("sign", "pause-the-state-files-contract", { MVXVEST_NETWORK: "mainnet" });
  assert.match(all, new RegExp(`it calls ${LOOKALIKE}, not the vesting contract ${MAINNET_CONTRACT}`));
  assert.match(all, new RegExp(`state/mainnet\\.json names ${LOOKALIKE}`));
});
