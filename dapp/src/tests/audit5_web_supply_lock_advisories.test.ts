// Fifth audit, WEB: advisories published since the fourth audit sit in the
// locked production dependencies.
//
// `pnpm audit --prod` on 1 November 2026 lists, among the packages that reach
// the shipped bundle or the tool that signs:
//
//  - follow-redirects 1.16.1 under axios 1.20.0: GHSA-mrwp-f3q8-3g9p (high),
//    fixed in 1.16.2. The fourth audit's override (WEB-5) pinned 1.16.1, which
//    was the fix then; the new advisory starts at 1.16.0 and ends at 1.16.1.
//    Node only: the browser bundle has no trace of it (checked again in the
//    1 Nov build of 26b0d4c), so it reaches Jest and the owner's tool, not
//    visitors. The same version is locked in scripts/pnpm-lock.yaml.
//  - qs 6.16.0 under @multiversx/sdk-web-wallet-cross-window-provider:
//    GHSA-6pq8-jhm2-2vcw (moderate), fixed in 6.16.1. The workspace override
//    `qs@<6.16.0: 6.16.0` was the fix for the 8 Oct advisory and now holds
//    the lock on the version this one names. It is in the browser bundle
//    (the web wallet provider), but the bug needs `arrayFormat: 'comma'`,
//    which the built bundle never passes, so no visitor is exposed either.
//
// Both are small patch releases. Expected once fixed: the two overrides in
// dapp/pnpm-workspace.yaml raised to `follow-redirects@>=1.16.0 <1.16.2:
// 1.16.2` and `qs@<6.16.1: 6.16.1`, `pnpm install`, and the same for
// scripts/ (which has no override list yet, see the scripts test).

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

const unpatched = (name: string, min: number[]) => {
  const versions = versionsOf(name);
  expect(versions.length).toBeGreaterThan(0);
  return versions
    .filter((version) => !atLeast(version, min))
    .map((version) => version.join('.'));
};

describe('audit 5, WEB: advisories in the locked dependencies', () => {
  it('follow-redirects is at least 1.16.2 (GHSA-mrwp-f3q8-3g9p)', () => {
    expect(unpatched('follow-redirects', [1, 16, 2])).toEqual([]);
  });

  it('qs is at least 6.16.1 (GHSA-6pq8-jhm2-2vcw)', () => {
    expect(unpatched('qs', [6, 16, 1])).toEqual([]);
  });
});
