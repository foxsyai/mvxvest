// Fourth audit, WEB: the package manager that installs and builds the site is
// not pinned by the repository.
//
// dapp/package.json has no `packageManager` and no `engines`. deploy.sh runs
// whatever pnpm and node the machine has; ci.yml pins pnpm 10.28.2 by hand,
// in its own file. The two settings the supply chain rests on exist in pnpm
// 10.17 and later only: `allowBuilds` (no dependency runs an install script)
// and `minimumReleaseAge` (a version must be a day old). An older pnpm does
// not know them: pnpm 9 runs every dependency's install script (keccak,
// esbuild, @swc/core, protobufjs and unrs-resolver, listed as false, would
// all run on `pnpm install`), and nothing refuses the deploy. A pnpm that
// differs from CI's may also lay out node_modules differently, so the bundle
// shipped is not the one CI tested, while every gate in deploy.sh passes.
//
// Expected once fixed: `"packageManager": "pnpm@10.28.2+sha512-…"` in
// dapp/package.json (pnpm 10 then runs exactly that version by itself, and
// corepack can enforce it) and an `engines.node` range.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8')
);

describe('audit 4, WEB: the package manager is pinned', () => {
  it('names pnpm 10.17 or later, with its integrity hash', () => {
    expect(pkg.packageManager).toMatch(
      // Corepack's and pnpm's own format: the algorithm, a dot, the hex digest
      // (corrected from the audit's base64 form, which neither tool reads).
      /^pnpm@10\.(1[7-9]|[2-9]\d)\.\d+\+sha512\.[0-9a-f]{128}$/
    );
  });
});
