// Fifth audit, review of the fixes (FIXR), PINNED: multisig.ts's refusals of
// what the contract would refuse (OPS-1 to OPS-3, VSD-08) measure a KeyKind by
// its value ("a number of any length, so 00 and 0001 pass") and a setTokenFee
// only against the cap of 200. The reviewer's suspicion was that a number on
// more than 8 bytes would be let through and then refused by the contract
// (ManagedBuffer::parse_as_u64 answers None past 8 bytes). It is not so: an
// endpoint argument is decoded by the VM's smallIntGetUnsignedArgument, which
// takes any length whose value fits, as the Go VM scenario
// contracts/vesting/scenarios/audit5review_fixr_arg_lengths.scen.json pins. So
// the tool's measure by value is the contract's, and these pass on both; a kind
// worth 2 is refused.
//
// Run: cd scripts && node --import tsx --test src/audit5review_fixr_arg_lengths.test.ts
// No key, no network: the stand-in answers every read.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { MULTISIG } from "./audit5review_fixr_multisig_mock.js";

/** Runs `multisig.ts <command> 7` on mainnet (no state file is seen) with the crafted action #7 pending. */
const run = (command: string, reviewCase: string) => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./src/audit5review_fixr_multisig_mock.ts",
      "src/multisig.ts",
      command,
      "7",
    ],
    {
      env: {
        ...process.env,
        MVXVEST_NETWORK: "mainnet",
        MVXVEST_MULTISIG: MULTISIG,
        AUDIT5REVIEW_CASE: reviewCase,
      },
      encoding: "latin1",
    },
  );
  return {
    status: result.status,
    out: result.stdout,
    err: result.stderr,
    all: result.stdout + result.stderr,
  };
};

test("pinned: a KeyKind of 1 on two or nine bytes and a bps of 10 on one or ten bytes may be signed, as the VM takes them", () => {
  for (const name of [
    "display-kind-two-bytes",
    "display-kind-nine-bytes",
    "tokenfee-one-byte",
    "tokenfee-ten-bytes",
  ]) {
    const { status, out, err } = run("sign", name);
    assert.equal(status, 0, `${name}: ${err}`);
    assert.match(out, /data: {3}sign@07/);
  }
});

test("pinned: a KeyKind worth 2 is refused, whatever its length", () => {
  const { status, all } = run("sign", "display-kind-two");
  assert.notEqual(status, 0, `the tool let it through:\n${all}`);
  assert.match(all, /neither Claim \(0\) nor Cancel \(1\)/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});
