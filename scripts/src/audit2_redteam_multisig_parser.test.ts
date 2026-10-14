// Audit 2 (red team): what a board member is told by scripts/src/multisig.ts
// before signing or performing an action proposed by someone else. The tool
// is run for real, as a board member would, against a stand-in network
// (audit2_redteam_multisig_mock.ts) that holds an action crafted by a
// compromised signer.
//
//   cd scripts && node --import tsx --test src/audit2_redteam_multisig_parser.test.ts
//
// The red team's tests pinned weaknesses (a blind second signature, an
// upgrade smuggled as a plain call, "tokenfee 0.1" proposing 0). They now
// assert the fixes: the tool decodes every action, says what it does and
// refuses anything that is not one of mvxvest's owner calls or an upgrade of
// mvxvest from the release's source.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
const MVXVEST = "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
const BOARD_MEMBER = "erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx";

/** Runs `multisig.ts <command> 7` as a board member on devnet, with the crafted action #7 pending. */
const run = (command: string, audit2Case: string) => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit2_redteam_multisig_mock.ts", "src/multisig.ts", command, "7"],
    {
      env: {
        ...process.env,
        MVXVEST_NETWORK: "devnet",
        MVXVEST_MULTISIG: MULTISIG,
        MVXVEST_FROM: BOARD_MEMBER,
        AUDIT2_CASE: audit2Case,
      },
      encoding: "utf8",
    },
  );
  const reads = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("AUDIT2_READ "))
    .map((line) => line.slice("AUDIT2_READ ".length));
  return { status: result.status, out: result.stdout, err: result.stderr, reads };
};

test("sign: the tool reads the action, says what it is and refuses an upgrade of the safe itself", () => {
  const { status, out, err, reads } = run("sign", "upgrade-the-safe-itself-not-upgradeable");
  assert.ok(reads.some((read) => read.includes("getActionData")), "sign must read the action");
  assert.notEqual(status, 0, "sign must refuse");
  assert.match(out, /upgrade erd1qqqqqqqqqqqqqpgqe7jmy/);
  assert.match(err, /REFUSED/);
  assert.match(err, /not the vesting contract/);
  assert.match(err, /metadata is 0000/);
});

test("perform: an upgrade of the SAFE ITSELF, never upgradeable again, is refused with the reasons", () => {
  const { status, err } = run("perform", "upgrade-the-safe-itself-not-upgradeable");
  assert.notEqual(status, 0);
  assert.match(err, /upgrades erd1qqqqqqqqqqqqqpgqe7jmy[0-9a-z]+, not the vesting contract/);
  assert.match(err, /metadata is 0000, not 0500/);
  assert.doesNotMatch(err, /data: {3}performAction/);
});

test("perform: the built-in upgradeContract carrying new code is named and refused", () => {
  const { status, out, err } = run("perform", "upgradeContract-as-a-call");
  assert.notEqual(status, 0);
  assert.match(out, /call upgradeContract\(/);
  assert.match(err, /"upgradeContract" is not one of mvxvest's owner calls/);
  assert.doesNotMatch(out, /pauseCreation \+/);
});

test("perform: unpauseCreation is named unpauseCreation", () => {
  const { status, out, err } = run("perform", "unpause");
  assert.equal(status, 0, err);
  assert.match(out, /call unpauseCreation\(\)/);
  assert.match(out, /for unpauseCreation \+/);
});

/**
 * `propose tokenfee <bps>` takes whole basis points only: "0.1" (meant as
 * 0.1%) is refused instead of proposing 0, "10" is 0.1% and says so.
 */
test("propose tokenfee: 0.1 is refused, 10 proposes 0.1%", () => {
  const abiPath = join(process.cwd(), "../contracts/vesting/output/mvxvest.abi.json");
  if (!existsSync(abiPath)) {
    assert.fail(`build the contract first (sc-meta all build): ${abiPath} is missing`);
  }
  const stateDir = join(process.cwd(), "state");
  const statePath = join(stateDir, "devnet.json");
  const created = !existsSync(statePath);
  if (created) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ contract: MVXVEST }));
  }
  try {
    const propose = (bps: string) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "--import", "./src/audit2_redteam_multisig_mock.ts", "src/multisig.ts", "propose", "tokenfee", bps],
        { env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, AUDIT2_CASE: "unpause" }, encoding: "utf8" },
      );
    const wrong = propose("0.1");
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /not a number of basis points: 10 is 0.1%/);
    const above = propose("250");
    assert.notEqual(above.status, 0);
    assert.match(above.stderr, /above the contract's cap of 2%/);
    const right = propose("10");
    assert.equal(right.status, 0, right.stderr);
    assert.match(right.stdout, /setTokenFee\(10\) = 0.1% of each vesting/);
    assert.match(right.stdout, /data: {3}proposeAsyncCall@[0-9a-f]{64}@@736574546f6b656e466565@0a\n/);
  } finally {
    if (created) rmSync(statePath);
  }
});
