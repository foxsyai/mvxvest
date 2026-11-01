// Fifth audit, WEB: the owner's tool (scripts/, the one that proposes, signs
// and performs multisig actions, the upgrade among them) has none of the
// supply chain policy the dApp got in the fourth audit (WEB-6) and the ops
// audit (OPS-07):
//
//  - scripts/package.json has no `packageManager`: whatever pnpm the signer's
//    machine has runs. dapp/package.json pins pnpm 10.28.2 with its hash.
//  - scripts/ has no pnpm-workspace.yaml, so no `minimumReleaseAge` (the
//    dApp refuses a version younger than a day, which catches most hijacked
//    releases), no `allowBuilds` list (pnpm 10 ignores install scripts by
//    default, an older pnpm runs esbuild's, keccak's and protobufjs's; the
//    1 Nov 2026 install printed "Ignored build scripts: esbuild@0.28.2,
//    keccak@3.0.2, protobufjs@7.6.6") and no `overrides` for known
//    advisories: `pnpm audit` in scripts/ on 1 Nov 2026 lists
//    follow-redirects 1.16.1 (GHSA-mrwp-f3q8-3g9p, high) under
//    @multiversx/sdk-core > axios, and uuid 8.3.2.
//  - ci.yml installs, lints, types, tests and builds dapp/ only; scripts/ is
//    never installed in CI, so nothing but the signer's own machine ever
//    runs `pnpm install --frozen-lockfile` there.
//
// Who attacks: whoever gets a bad release into a package the tool pulls
// (axios, protobufjs, @noble/hashes, tsx and their trees). What they get: code
// running on the machine that holds the signer's key, at `pnpm install` or
// `pnpm update` time, with no day of delay for the registry to pull it. The
// backstop is the frozen lockfile: a plain install cannot take a new version
// until someone updates the lock.
//
//   cd scripts && node --import tsx --test src/audit5_web_supply_scripts_policy.test.ts
//
// Expected once fixed: `packageManager` and `engines` in scripts/package.json
// as in dapp/package.json, and a scripts/pnpm-workspace.yaml with
// `minimumReleaseAge: 1440` and an `allowBuilds` list, with overrides for the
// advisories; then `pnpm install` to refresh the lock.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const here = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

test("scripts/package.json pins pnpm 10.17 or later with its hash", () => {
  assert.match(
    String(pkg.packageManager ?? ""),
    /^pnpm@10\.(1[7-9]|[2-9]\d)\.\d+\+sha512\.[0-9a-f]{128}$/,
    "no packageManager in scripts/package.json",
  );
});

test("scripts/pnpm-workspace.yaml holds minimumReleaseAge and allowBuilds", () => {
  const file = join(here, "pnpm-workspace.yaml");
  assert.ok(existsSync(file), "scripts/pnpm-workspace.yaml does not exist");
  const text = readFileSync(file, "utf8");
  const age = /^minimumReleaseAge:\s*(\d+)/m.exec(text);
  assert.ok(age && Number(age[1]) >= 1440, "minimumReleaseAge is missing or under a day");
  assert.match(text, /^allowBuilds:/m, "no allowBuilds list");
});

test("the locked follow-redirects is at least 1.16.2 (GHSA-mrwp-f3q8-3g9p)", () => {
  const lock = readFileSync(join(here, "pnpm-lock.yaml"), "utf8");
  const versions = [...lock.matchAll(/^  follow-redirects@(\d+)\.(\d+)\.(\d+):/gm)].map((m) =>
    m.slice(1, 4).map(Number),
  );
  assert.ok(versions.length > 0, "follow-redirects is not in the lock");
  const old = versions.filter(([a, b, c]) => a < 1 || (a === 1 && (b < 16 || (b === 16 && c < 2))));
  assert.deepEqual(
    old.map((v) => v.join(".")),
    [],
    "follow-redirects under 1.16.2 in scripts/pnpm-lock.yaml",
  );
});
