// Audit 5 (vest-dapp, VSD-08): what the owner's tool tells a second signer
// about a recoverSurplus, and what it refuses.
//
// recoverSurplus(token, to, [amount]) sends what the contract holds of a
// token beyond what it owes: a bounced payout or fee, which belongs to a
// claimer, a creator or the multisig, or a stray transfer. The tool
// describes the action as "recoverSurplus(FOXSY-5d5f3e, erd1…, all of it)"
// without reading getSurplus: the signer cannot tell whether "all of it" is
// dust or a treasury, and cannot see that an amount above the surplus would
// be refused by the contract ("above surplus") only at perform time, after
// two signatures, using the action up (the class of the fourth audit's
// OPS-2; the fourth audit's OPS-1 made the tool read the vesting behind a
// recoverBouncedKey for the same reason). The tool is run for real against a
// stand-in network (audit5_multisig_mock.ts) that holds the crafted action
// #7 and answers getSurplus with 1,234,567 units.
//
//   cd scripts && node --import tsx --test src/audit5_VSD-08_recover_surplus.test.ts
//
// The first test (control) passes on 26b0d4c; the other three fail and pass
// once `sign` and `perform` read getSurplus, say the amount, and refuse an
// amount above it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { RECIPIENT, SURPLUS, TOKEN } from "./audit5_multisig_mock.js";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";

/** Runs `multisig.ts <command> 7` on devnet with the crafted action #7 pending. */
const run = (command: string, audit5Case: string) => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit5_multisig_mock.ts", "src/multisig.ts", command, "7"],
    {
      env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, AUDIT5_CASE: audit5Case },
      encoding: "utf8",
    },
  );
  const reads = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("AUDIT5_READ "))
    .map((line) => line.slice("AUDIT5_READ ".length));
  return { status: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr, reads };
};

/** 1,234,567 as the tool may print it: plain, grouped, or as a decimal of an 18-decimal token. */
const SURPLUS_SHOWN = /1[,. ]?234[,. ]?567|0\.000000000001234567/;

test("control: sign recoverSurplus(token, to, 1,000,000) names the token, the recipient and the amount", () => {
  const { status, out, err } = run("sign", "recover-surplus-within");
  assert.equal(status, 0, err);
  assert.match(out, new RegExp(`recoverSurplus\\(${TOKEN}, ${RECIPIENT}, 1000000 units\\)`));
  assert.match(out, /data: {3}sign@07/);
});

test("sign recoverSurplus(token, to) 'all of it': the tool reads getSurplus and says how much that is", () => {
  const { status, all, reads } = run("sign", "recover-surplus-all");
  assert.equal(status, 0, all);
  assert.ok(
    reads.some((read) => read.includes("getSurplus")),
    `the tool must read the surplus before describing the recovery; reads: ${JSON.stringify(reads)}`,
  );
  assert.match(all, SURPLUS_SHOWN, `the surplus (${SURPLUS} units) is named next to "all of it"`);
});

test("sign recoverSurplus(token, to, 1,000,000): the surplus it comes out of is named", () => {
  const { all, reads } = run("sign", "recover-surplus-within");
  assert.ok(reads.some((read) => read.includes("getSurplus")), `reads: ${JSON.stringify(reads)}`);
  assert.match(all, SURPLUS_SHOWN);
});

test("sign recoverSurplus(token, to, 2,000,000): above the surplus, refused before two signatures are spent", () => {
  const { status, all } = run("sign", "recover-surplus-over");
  assert.match(all, /recoverSurplus\(/, "the action is described");
  // The contract refuses an amount above the surplus (claim.rs, ERR_ABOVE_SURPLUS): the perform would
  // fail and use the action up.
  assert.notEqual(status, 0, "an amount above the surplus must be refused at sign time");
  assert.match(all, /above|surplus|refuse/i);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});
