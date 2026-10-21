// Fourth audit (WEB-3, WEB-7, OPS-11): what the sites send besides the app.
// The nginx file in the repo is the source of truth for the droplet.
//
//  - WEB-3: no Cross-Origin-Opener-Policy, so a page that opened mvxvest.io
//    with window.open kept a handle on its tab and could later send it to a
//    copy (reverse tabnabbing). same-origin-allow-popups keeps the web
//    wallet's popup working.
//  - WEB-7: the CSP allowed two hosts the bundle never calls and
//    WalletConnect's telemetry (pulse), which posts the project id and the
//    site's domain; its failures are caught.
//  - OPS-11: unknown paths answer with the app, so /.well-known/security.txt
//    was index.html: a researcher found no contact there.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const nginx = readFileSync(
  join(root, 'scripts/server/nginx-mvxvest.io.conf'),
  'utf8'
);

/** The server blocks that serve the app (they have a root). */
const appBlocks = nginx
  .split(/^server \{$/m)
  .filter((block) => /^\s*root \/var\/www\//m.test(block));

it('serves the app from two hosts', () => {
  expect(appBlocks.map((b) => /server_name (\S+);/.exec(b)?.[1])).toEqual([
    'mvxvest.io',
    'devnet.mvxvest.io'
  ]);
});

it.each(['mvxvest.io', 'devnet.mvxvest.io'])(
  '%s keeps its tab from the page that opened it (WEB-3)',
  (host) => {
    const block = appBlocks.find((b) => b.includes(`server_name ${host};`))!;
    expect(block).toContain(
      'add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;'
    );
  }
);

it.each([
  'https://api.web3modal.org',
  'https://explorer-api.walletconnect.com',
  'https://pulse.walletconnect.org'
])('no CSP allows %s (WEB-7)', (host) => {
  expect(nginx).not.toContain(host);
});

it('publishes security.txt with a contact that does not expire yet (OPS-11)', () => {
  const file = join(root, 'dapp/public/.well-known/security.txt');
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, 'utf8');
  expect(text).toMatch(
    /^Contact: https:\/\/github\.com\/foxsyai\/mvxvest\/security\/advisories\/new$/m
  );
  const expires = /^Expires: (\S+)$/m.exec(text)?.[1];
  expect(new Date(expires ?? '').getTime()).toBeGreaterThan(Date.now());
});
