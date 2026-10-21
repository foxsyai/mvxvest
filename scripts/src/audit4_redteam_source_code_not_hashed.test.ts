// Fourth audit (red team, RT2): scripts/src/multisig.ts checks an upgrade's
// source by the `codeHash` FIELD the API returns for the account, never by
// hashing the code the same answer carries. The tool already downloads the
// code (to budget the upgrade's gas from its size), and a code hash on
// MultiversX is blake2b-256 of the bytes (version 1's wasm hashes to
// fd32f4e1…, exactly MAINNET.md's figure), so the check costs one call to a
// library that sdk-core already ships (@noble/hashes). Without it, a signer
// who runs `propose-upgrade`, `sign` or `perform` with the right
// MVXVEST_EXPECT_HASH is told the source is the release whenever the API's
// label says so, whatever bytes the source holds: a wrong or tampered API
// answer, a stale index, a proxy in the way. The same single field is what
// the second signer's card reads. The upgrade is the one action that can
// move every locked token, so the source's bytes deserve their own check.
//
//   cd scripts && node --import tsx --test src/audit4_redteam_source_code_not_hashed.test.ts
//
// The stand-in network (audit4_redteam_multisig_mock.ts) serves a source whose
// code is version 1's bytes and whose codeHash field is the release's hash.
// Expected once fixed: the tool refuses to propose, sign or perform, naming
// the hash the bytes really have. Today it prints the transaction to send.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
const MVXVEST = "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
const BOARD_MEMBER = "erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx";
const SOURCE = "erd1qqqqqqqqqqqqqpgqzywreqymt6j00wta43v7zvmrk4yz5xal6qls2j5m2c";
/** Version 2's release hash (MAINNET.md): what the signer expects. */
const RELEASE = "a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a";

/** blake2b-256, through the copy sdk-core depends on (pnpm keeps it out of our own node_modules). */
const blake2b256 = (bytes: Buffer): string => {
  const fromSdk = createRequire(createRequire(import.meta.url).resolve("@multiversx/sdk-core"));
  const { blake2b } = fromSdk("@noble/hashes/blake2b") as { blake2b: (data: Uint8Array, options: { dkLen: number }) => Uint8Array };
  return Buffer.from(blake2b(bytes, { dkLen: 32 })).toString("hex");
};

/**
 * Runs the tool as a board member. `perform` budgets its gas from measurements
 * and never simulates; `propose-upgrade` would simulate through sdk-core's own
 * HTTP client (not fetch, so not the stand-in) when MVXVEST_FROM is set, and
 * that must never reach a real network from a test, so it runs without it.
 */
const run = (args: string[], { simulate = true } = {}) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit4_redteam_multisig_mock.ts", "src/multisig.ts", ...args],
    {
      env: {
        ...process.env,
        MVXVEST_NETWORK: "devnet",
        MVXVEST_MULTISIG: MULTISIG,
        ...(simulate ? { MVXVEST_FROM: BOARD_MEMBER } : {}),
        MVXVEST_EXPECT_HASH: RELEASE,
        AUDIT4_LABEL_HASH: RELEASE,
      },
      encoding: "utf8",
    },
  );

/** The tool needs the contract's address and ABI, as the audit 2 test sets them up. */
const withState = (body: () => void) => {
  const abiPath = join(process.cwd(), "../contracts/vesting/output/mvxvest.abi.json");
  if (!existsSync(abiPath)) assert.fail(`build the contract first (sc-meta all build): ${abiPath} is missing`);
  const stateDir = join(process.cwd(), "state");
  const statePath = join(stateDir, "devnet.json");
  const created = !existsSync(statePath);
  if (created) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ contract: MVXVEST }));
  }
  try {
    body();
  } finally {
    if (created) rmSync(statePath);
  }
};

test("the stand-in's source holds version 1's bytes under version 2's label", () => {
  const bytes = readFileSync(join(process.cwd(), "../contracts/vesting/scenarios/v1/mvxvest-v1.wasm"));
  const real = blake2b256(bytes);
  assert.equal(real, "fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32", "MAINNET.md's hash of version 1");
  assert.notEqual(real, RELEASE);
});

test("perform: an upgrade from a source whose bytes are not the release is refused, whatever the API's label says", () => {
  withState(() => {
    const { status, stdout, stderr } = run(["perform", "7"]);
    // Today: status 0 and "performAction@07" printed to send, after
    // "the source's code hash a7acbf22… " was read from the label alone.
    assert.notEqual(status, 0, `the tool accepted the upgrade:\n${stdout}`);
    assert.match(stderr, /REFUSED/);
    assert.match(stderr, /fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32/);
    assert.doesNotMatch(stdout, /performAction@/);
  });
});

test("propose-upgrade: the same source is not proposed", () => {
  withState(() => {
    const { status, stdout, stderr } = run(["propose-upgrade", SOURCE], { simulate: false });
    assert.notEqual(status, 0, `the tool proposed the upgrade:\n${stdout}`);
    assert.match(stderr, /Not proposed/);
    assert.match(stderr, /fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32/);
    assert.doesNotMatch(stdout, /proposeSCUpgradeFromSource@/);
  });
});
