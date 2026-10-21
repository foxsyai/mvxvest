// Audit 4 (operations): what scripts/src/multisig.ts tells a board member, and
// what it refuses, before `sign` or `perform` of an action proposed by a
// compromised or careless signer. The tool is run for real, as a board member
// would, against a stand-in network (audit4_ops_multisig_mock.ts) that holds
// the crafted action #7. No MVXVEST_FROM, so the tool simulates nothing and
// reaches no network: it decodes, describes, checks and prints.
//
//   cd scripts && node --import tsx --test src/audit4_ops_multisig_signer.test.ts
//
// Each test but the first FAILS on main at 322cb43 and passes once the tool:
//   - names whom a bounced key belongs to (the vesting's beneficiary for a
//     claim key, its creator for a cancel key) when it describes a
//     recoverBouncedKey, so a second signer sees a stranger as the recipient;
//   - refuses at sign time what the contract would refuse at perform time
//     (a fee above its cap, an argument an endpoint does not take), since a
//     failed perform uses the action up (DEPLOY.md);
//   - refuses an upgrade source whose code metadata it could not read, instead
//     of reading a missing `isUpgradeable` as "not upgradeable".

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { STRANGER, VESTING_1_BENEFICIARY, VESTING_1_CREATOR } from "./audit4_ops_multisig_mock.js";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
const RELEASE_HASH = "a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a";

/** Runs `multisig.ts <command> 7` on devnet with the crafted action #7 pending. */
const run = (command: string, audit4Case: string, extra: Record<string, string> = {}) => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit4_ops_multisig_mock.ts", "src/multisig.ts", command, "7"],
    {
      env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, AUDIT4_CASE: audit4Case, ...extra },
      encoding: "utf8",
    },
  );
  const reads = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("AUDIT4_READ "))
    .map((line) => line.slice("AUDIT4_READ ".length));
  return { status: result.status, out: result.stdout, err: result.stderr, all: result.stdout + result.stderr, reads };
};

test("baseline: an unpauseCreation is described and may be signed (the stand-in works)", () => {
  const { status, out, err, reads } = run("sign", "unpause");
  assert.ok(reads.some((read) => read.includes("getActionData")), "sign must read the action");
  assert.equal(status, 0, err);
  assert.match(out, /call unpauseCreation\(\) on/);
  assert.match(out, /data: {3}sign@07/);
});

test("sign recoverBouncedKey(1, Claim, stranger): the tool says whom the claim key belongs to", () => {
  const { all, reads } = run("sign", "recover-bounced-claim-key-to-stranger");
  assert.match(all, new RegExp(STRANGER), "the recipient is named");
  // The key the contract holds belongs to vesting 1's beneficiary. A second signer must see that the
  // proposed recipient is someone else, without looking the vesting up by hand.
  assert.ok(
    reads.some((read) => read.includes("getVesting")),
    `the tool must read vesting 1 before describing the recovery; reads: ${JSON.stringify(reads)}`,
  );
  assert.match(all, new RegExp(VESTING_1_BENEFICIARY), "the vesting's beneficiary is named next to the recipient");
});

test("sign recoverBouncedKey(1, Cancel, stranger): the tool says whom the cancel key belongs to", () => {
  const { all, reads } = run("sign", "recover-bounced-cancel-key-to-stranger");
  assert.match(all, new RegExp(STRANGER));
  assert.ok(reads.some((read) => read.includes("getVesting")), `reads: ${JSON.stringify(reads)}`);
  assert.match(all, new RegExp(VESTING_1_CREATOR), "the vesting's creator is named next to the recipient");
});

test("sign setTokenFee(300): above the 2% cap, refused before two signatures are spent", () => {
  const { status, all } = run("sign", "token-fee-above-cap");
  assert.match(all, /setTokenFee\(300 = 3% of each vesting\)/, "the rate is described");
  assert.notEqual(status, 0, "the contract refuses 300 basis points (cap 200): the perform would fail and use the action up");
  assert.match(all, /cap|200/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("sign setFee(2 EGLD): above the 1 EGLD cap, refused", () => {
  const { status, all } = run("sign", "fee-above-cap");
  assert.match(all, /setFee\(2 EGLD\)/);
  assert.notEqual(status, 0, "the contract refuses a fee above 1 EGLD: the perform would fail and use the action up");
  assert.match(all, /cap|1 EGLD/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("perform pauseCreation(0x01): an argument the endpoint does not take, refused", () => {
  const { status, all } = run("perform", "pause-with-an-argument");
  assert.notEqual(status, 0, "pauseCreation takes no argument: the contract refuses the call and the action is used up");
  assert.match(all, /argument/);
  assert.doesNotMatch(all, /data: {3}performAction@07/);
});

test("perform an upgrade whose source answer has no code metadata: refused, not read as 'not upgradeable'", () => {
  const { status, all } = run("perform", "upgrade-source-metadata-unknown", { MVXVEST_EXPECT_HASH: RELEASE_HASH });
  assert.match(all, /upgrade .* with the code of/);
  assert.notEqual(status, 0, "the API answer carries no isUpgradeable: the tool cannot know the source is frozen");
  // Its own reason, not another check's: "not upgradeable" (the old reading) also matches /upgradeable/.
  assert.match(all, /did not say whether the source is upgradeable/);
  assert.doesNotMatch(all, /data: {3}performAction@07/);
});
