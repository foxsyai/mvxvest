// Fourth audit, WEB: a known advisory sits in the locked dependencies.
//
// `pnpm audit --prod` on 21 Oct 2026 lists follow-redirects 1.16.0, pulled by
// axios 1.20.0, with two high advisories fixed in 1.16.1 (GHSA-q3jh-wrc6-jgq8
// and GHSA-8r9p-f939-6h3c: credential headers leaking across redirects). It
// is axios's Node adapter: the browser bundle never contains it (the live
// bundle was checked for it), so no visitor is exposed. It runs under Node:
// Jest, and any script that uses axios. pnpm-workspace.yaml keeps an overrides
// list for exactly this (ops audit OPS-07), and 1.16.0 to 1.16.1 is a patch
// release. (uuid 8.3.2 under sdk-core and braces 3.0.3 are listed too: the
// first needs the v3/v5/v6 `buf` argument the app never uses, the second has
// no fixed release, as the workspace file says.)
//
// Expected once fixed: an override `follow-redirects@>=1.16.0 <1.16.1: 1.16.1`
// in pnpm-workspace.yaml and `pnpm install`, so the lock holds no 1.16.0.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lock = readFileSync(join(__dirname, '../../pnpm-lock.yaml'), 'utf8');

/** Every locked version of a package, as [major, minor, patch]. */
const versionsOf = (name: string): number[][] =>
  [
    ...lock.matchAll(new RegExp(`^  ${name}@(\\d+)\\.(\\d+)\\.(\\d+):`, 'gm'))
  ].map((match) => match.slice(1, 4).map(Number));

const atLeast = (version: number[], min: number[]) =>
  version[0] !== min[0]
    ? version[0] > min[0]
    : version[1] !== min[1]
      ? version[1] > min[1]
      : version[2] >= min[2];

describe('audit 4, WEB: advisories in the locked dependencies', () => {
  it('follow-redirects is at least 1.16.1 (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c)', () => {
    const versions = versionsOf('follow-redirects');
    expect(versions.length).toBeGreaterThan(0);
    const unpatched = versions
      .filter((version) => !atLeast(version, [1, 16, 1]))
      .map((version) => version.join('.'));
    expect(unpatched).toEqual([]);
  });
});
