// Audit of version 3 (Claude Fable 5.1, 21 Oct 2026), red team (V3R): the
// upgrade to version 3 as an attack surface, seen through the owner's tool.
// Every test here passes on 7361158: they pin what the tool does with a
// source of version 3's size (29,195 bytes, the local build) and what it
// refuses when MVXVEST_EXPECT_HASH is wrong or missing. Runs the tool for
// real against a stand-in network (v3audit_redteam_multisig_mock.ts).
//
//   cd scripts && node --import tsx --test src/v3audit_redteam_upgrade_gate.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { SOURCE_HASH } from "./v3audit_redteam_multisig_mock.js";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** Version 2's hash, live on mainnet: what a signer copies from MAINNET.md by mistake. */
const V2_HASH = "a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a";
const BOARD = "erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx";

const run = (command: string, extra: Record<string, string> = {}) => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/v3audit_redteam_multisig_mock.ts", "src/multisig.ts", command, "7"],
    {
      env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, MVXVEST_EXPECT_HASH: "", ...extra },
      encoding: "utf8",
    },
  );
  return { status: result.status, out: result.stdout, all: result.stdout + result.stderr };
};

test("perform the version 3 upgrade with the right hash: accepted, gas budgeted from the 29,195 bytes", () => {
  const { status, out, all } = run("perform", { MVXVEST_EXPECT_HASH: SOURCE_HASH, MVXVEST_FROM: BOARD });
  assert.equal(status, 0, all);
  assert.match(out, /upgrade .* with the code of erd1qqqqqqqqqqqqqpgq3p9mg88g2dth097vrwcasr4n7eutztf0erksnkk738, metadata 0500/);
  assert.match(out, new RegExp(`code hash ${SOURCE_HASH}, 29195 bytes, shard 1, not upgradeable`));
  const gas = /gas: (\d+) performAction \+ (\d+) for upgrade/.exec(out);
  assert.ok(gas, `the perform's gas line: ${out}`);
  const forUpgrade = Number(gas![2]);
  // (300 x 29,195 + 1M) x 1.2 = 11,710,200: at least a fifth above what the
  // measured 283 gas a byte (8.50M for 26,540 bytes on mainnet) predicts.
  assert.equal(forUpgrade, 11_710_200);
  assert.ok(forUpgrade >= ((283 * 29_195 + 1_000_000) * 12) / 10, "margin over the measured need");
  assert.match(out, /data: {3}performAction@07/);
});

test("sign the version 3 upgrade with version 2's hash pasted by mistake: refused", () => {
  const { status, all } = run("sign", { MVXVEST_EXPECT_HASH: V2_HASH });
  assert.notEqual(status, 0);
  assert.match(all, /is not the release's a7acbf22/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("sign the version 3 upgrade with no expected hash: refused, never signed blind", () => {
  const { status, all } = run("sign");
  assert.notEqual(status, 0);
  assert.match(all, /MVXVEST_EXPECT_HASH is not set/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});

test("sign with the hash in upper case or with stray spaces: upper case is fine, spaces are refused", () => {
  const upper = run("sign", { MVXVEST_EXPECT_HASH: SOURCE_HASH.toUpperCase() });
  assert.equal(upper.status, 0, upper.all);
  const spaced = run("sign", { MVXVEST_EXPECT_HASH: ` ${SOURCE_HASH}\n` });
  assert.notEqual(spaced.status, 0);
  assert.doesNotMatch(spaced.all, /data: {3}sign@07/);
});
