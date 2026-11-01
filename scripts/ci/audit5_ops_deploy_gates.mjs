#!/usr/bin/env node
// audit5 (ops, 1 Nov 2026): what dapp/deploy.sh refuses, run for real. From mvxsafe's report
// (audit-2026-11-01/ops, OPZ-01 and OPZ-07), with this repository's OPS-6 and VSD-07 added. It ships, or used to:
//   (a) a file git ignores under dapp/public/ (*.pem, *.key, *wallet*.json, *mnemonic*, *secret*,
//       .env* are all ignored at any depth), which Vite copies into the build;
//   (b) a commit that is BEHIND origin/main (any ancestor passes `merge-base --is-ancestor`), so a
//       laptop that did not pull after a merge rolls the site back;
//   (c) a tracked file flagged skip-worktree, changed on the laptop, which git status hides;
//   (d) with a plain `rsync --delete` (the old bundle is deleted while the old index.html still names it);
//   (e) with no `pnpm audit`;
//   (f) a site whose contractCodeHashes do not list the hash its network runs (OPS-6);
//   (g) a development build under the commit's name, from an ignored .env.production.local or NODE_ENV (OPZ-07).
//
// This runs the real dapp/deploy.sh of one commit in a throwaway clone: a local bare copy stands in
// for GitHub, with its main moved to that commit, node_modules is linked (the locked tree), `pnpm
// install` and `pnpm exec jest` are skipped, `pnpm audit` is recorded and answers what the case says
// (the advisories of the day are not under test), every other pnpm call is real (the build really
// typechecks and bundles), and rsync, ssh and curl only record: curl answers the chain's hash from
// the case. Nothing leaves the machine. Exit 1 while any gap reproduces, 0 when every refusal comes
// for its own reason and a clean tree ships on both networks: a script that refused everything would
// not pass.
//
//   node scripts/ci/audit5_ops_deploy_gates.mjs                     # the commit this checkout is at
//   MVXVEST_COMMIT=<sha> node scripts/ci/audit5_ops_deploy_gates.mjs
//   (only what is committed is tested; the checkout is never written to, and needs dapp/node_modules)
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.MVXVEST || fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const COMMIT = git(REPO, 'rev-parse', '--verify', `${process.env.MVXVEST_COMMIT || 'HEAD'}^{commit}`);
const hashesOf = (config) =>
  /contractCodeHashes = \[([^\]]*)\]/.exec(config)[1].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').match(/[0-9a-f]{64}/g);

function makeRepo({ aheadOfOrigin = 0, changeOnMain } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'mvxvest-audit5-'));
  const origin = join(tmp, 'origin.git');
  const work = join(tmp, 'work');
  execFileSync('git', ['clone', '-q', '--bare', '--no-hardlinks', REPO, origin]);
  // The commit under test is what GitHub's main holds in this run.
  git(origin, 'update-ref', 'refs/heads/main', COMMIT);
  execFileSync('git', ['clone', '-q', origin, work]);
  git(work, 'config', 'user.email', 'proof@example.invalid');
  git(work, 'config', 'user.name', 'proof');
  git(work, 'checkout', '-q', '--detach', 'origin/main');
  if (git(work, 'rev-parse', 'HEAD') !== COMMIT) throw new Error('the clone is not at the commit under test');
  symlinkSync(join(REPO, 'dapp', 'node_modules'), join(work, 'dapp', 'node_modules'));
  const head = git(work, 'rev-parse', 'HEAD');
  for (let i = 1; i <= aheadOfOrigin; i++) {
    writeFileSync(join(work, 'dapp', `later-${i}.txt`), `a later commit, ${i}\n`);
    git(work, 'add', `dapp/later-${i}.txt`);
    git(work, 'commit', '-q', '-m', `a later commit on main, ${i}`);
  }
  if (aheadOfOrigin) {
    git(work, 'push', '-q', 'origin', 'HEAD:main');
    git(work, 'checkout', '-q', '--detach', head);
  }
  if (changeOnMain) {
    changeOnMain(work);
    git(work, 'commit', '-q', '-am', 'a change on main');
    git(work, 'push', '-q', 'origin', 'HEAD:main');
  }
  git(work, 'fetch', '-q', 'origin', 'main');
  return { tmp, work, head, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

function runDeploy(work, { network = 'devnet', audit = 0, live, env = {} } = {}) {
  const shim = join(work, '..', 'shim');
  const log = join(work, '..', 'calls.log');
  mkdirSync(shim, { recursive: true });
  const realPnpm = execFileSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).trim();
  const config = readFileSync(join(work, 'dapp/src/config', `config.${network}.ts`), 'utf8');
  // What the chain answers: by default the hash the commit's config lists first.
  const hash = live === undefined ? hashesOf(config)[0] : live;
  const answer = hash ? JSON.stringify({ codeHash: Buffer.from(hash, 'hex').toString('base64') }) : '';
  const shimOf = (name, body) => {
    writeFileSync(join(shim, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(shim, name), 0o755);
  };
  shimOf(
    'pnpm',
    `case "$1 $2 $3" in "install"*) echo "(shim) pnpm install skipped: node_modules is the linked, locked tree"; exit 0;; "-s exec jest"*) echo "(shim) jest skipped"; exit 0;; "audit"*) echo "(shim) pnpm audit answers ${audit}"; exit ${audit};; esac\n` +
      `exec "${realPnpm}" "$@"`
  );
  shimOf('rsync', 'exit 0');
  shimOf('ssh', 'exit 0');
  shimOf(
    'curl',
    `case "$*" in *accounts/*codeHash*) ${answer ? `printf '%s' '${answer}'; exit 0` : 'exit 22'};; *http_code*) printf 200;; *version.txt) cat "${join(work, 'dapp', 'build', 'version.txt')}";; esac\nexit 0`
  );
  const run = spawnSync('bash', ['deploy.sh', network], {
    cwd: join(work, 'dapp'),
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  const rsync = calls.find((c) => c.startsWith('rsync ')) || '';
  const said = (run.stdout + run.stderr)
    .split('\n')
    .filter((l) => /^(REFUSING|Building|build\/|Shipping|Live:|The |\(shim\))/.test(l));
  return {
    status: run.status,
    said,
    calls,
    rsync,
    refusal: said.filter((l) => l.startsWith('REFUSING')).join(' '),
    shipped: /^rsync .*build\/ .*web@.*\/var\/www\//.test(rsync),
    audited: calls.some((c) => /^pnpm audit --prod --audit-level=high/.test(c)),
    readHash: calls.some((c) => /^curl .*accounts\/erd1.*codeHash/.test(c))
  };
}

const bugs = [];
const say = (r) => console.log(`deploy.sh exit ${r.status}\n` + r.said.map((l) => '  ' + l).join('\n'));

/** The case must be refused, for its own reason, with nothing uploaded. */
const mustRefuse = (id, what, r, reason) => {
  say(r);
  if (r.shipped) bugs.push(`(${id}) ${what} shipped`);
  else if (r.status === 0 || !reason.test(r.refusal)) bugs.push(`(${id}) ${what}: not refused for its own reason: ${r.refusal || `exit ${r.status}`}`);
};
const withRepo = (title, options, body) => {
  console.log(`\n${title}`);
  const repo = makeRepo(options);
  try {
    body(repo);
  } finally {
    repo.cleanup();
  }
};
/** A clean tree ships, audited and atomically, after reading the chain. */
const mustShip = (id, r) => {
  say(r);
  if (!r.shipped) return bugs.push(`(${id}) a clean tree did not ship: ${r.refusal || `exit ${r.status}`}`);
  if (!/--delay-updates/.test(r.rsync) || !/--delete-delay/.test(r.rsync)) bugs.push('(d) the upload is a plain rsync --delete, not --delay-updates --delete-delay');
  if (!r.audited) bugs.push('(e) no pnpm audit --prod --audit-level=high ran before the upload');
  else if (r.calls.findIndex((c) => c.startsWith('pnpm audit')) > r.calls.findIndex((c) => c.startsWith('rsync '))) bugs.push('(e) the audit ran after the upload');
  if (!r.readHash) bugs.push("(f) the chain's code hash was not read before the upload");
  else if (r.calls.findIndex((c) => /accounts\/erd1/.test(c)) > r.calls.findIndex((c) => c.startsWith('rsync '))) bugs.push("(f) the chain's code hash was read after the upload");
};

// A clean tree, on both networks: mainnet while its config lists two hashes, as during an upgrade.
withRepo('(control) a clean checkout at the tip of origin/main, devnet', {}, (repo) => {
  mustShip('control', runDeploy(repo.work));
});
const NEXT = '11'.repeat(32);
const secondHash = (work) => {
  const file = join(work, 'dapp/src/config/config.mainnet.ts');
  const text = readFileSync(file, 'utf8');
  const first = hashesOf(text)[0];
  writeFileSync(file, text.replace(`'${first}'`, `'${NEXT}',\n  '${first}'`));
};
withRepo('(control) mainnet, the config listing the next hash and the one live, as during an upgrade', { changeOnMain: secondHash }, (repo) => {
  const live = hashesOf(readFileSync(join(repo.work, 'dapp/src/config/config.mainnet.ts'), 'utf8'))[1];
  mustShip('control mainnet', runDeploy(repo.work, { network: 'mainnet', live }));
});

withRepo('(a) dapp/public/owner.pem, ignored by .gitignore', {}, (repo) => {
  writeFileSync(join(repo.work, 'dapp/public/owner.pem'), 'not a key: a placeholder that must never reach the site\n');
  const status = git(repo.work, 'status', '--porcelain', '--untracked-files=all', '--', 'dapp');
  console.log(`git status -> ${status ? JSON.stringify(status) : '(nothing)'}`);
  mustRefuse('a', "an ignored owner.pem under dapp/public/, under the commit's name,", runDeploy(repo.work), /git ignores/);
});

withRepo('(b) HEAD one commit behind origin/main; the tree is clean', { aheadOfOrigin: 1 }, (repo) => {
  mustRefuse('b', `a commit behind origin/main (${repo.head.slice(0, 7)})`, runDeploy(repo.work), /behind origin\/main/);
  console.log('with OLD_COMMIT=1, on purpose:');
  const r = runDeploy(repo.work, { env: { OLD_COMMIT: '1' } });
  say(r);
  if (!r.shipped) bugs.push(`(b) OLD_COMMIT=1 did not ship an older commit of main: ${r.refusal || `exit ${r.status}`}`);
});

withRepo('(c) dapp/public/robots.txt changed and flagged skip-worktree', {}, (repo) => {
  const robots = join(repo.work, 'dapp/public/robots.txt');
  writeFileSync(robots, readFileSync(robots, 'utf8') + '# changed on the laptop, hidden from git status\n');
  git(repo.work, 'update-index', '--skip-worktree', 'dapp/public/robots.txt');
  const status = git(repo.work, 'status', '--porcelain', '--untracked-files=all', '--', 'dapp');
  console.log(`git status -> ${status ? JSON.stringify(status) : '(nothing)'}`);
  mustRefuse('c', "a skip-worktree file changed, under the commit's name,", runDeploy(repo.work), /hidden from git status/);
});

withRepo('(e) pnpm audit finds a high advisory', {}, (repo) => {
  mustRefuse('e', 'a tree with a high advisory', runDeploy(repo.work, { audit: 1 }), /advisor/);
});

withRepo('(f) the chain runs a hash the config does not list', {}, (repo) => {
  mustRefuse('f', 'a site that does not know the live hash', runDeploy(repo.work, { live: '22'.repeat(32) }), /not in contractCodeHashes/);
});
withRepo("(f) the chain's hash cannot be read", {}, (repo) => {
  mustRefuse('f', "a site when the chain's hash cannot be read", runDeploy(repo.work, { live: '' }), /could not read/);
});
const commentedOut = (work) => {
  const file = join(work, 'dapp/src/config/config.devnet.ts');
  const text = readFileSync(file, 'utf8');
  const first = hashesOf(text)[0];
  writeFileSync(file, text.replace(`'${first}'`, `'${NEXT}'\n  // '${first}'`));
};
withRepo('(f) the live hash is in the array, but commented out', { changeOnMain: commentedOut }, (repo) => {
  const live = /\/\/ '([0-9a-f]{64})'/.exec(readFileSync(join(repo.work, 'dapp/src/config/config.devnet.ts'), 'utf8'))[1];
  mustRefuse('f', 'a site listing the live hash only in a comment', runDeploy(repo.work, { live }), /not in contractCodeHashes/);
});

const developmentBuild = (work) => {
  const assets = join(work, 'dapp/build/assets');
  if (!existsSync(assets)) return false;
  const js = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('');
  return !js.includes('Minified React error');
};
withRepo('(g) an ignored dapp/.env.production.local says NODE_ENV=development (OPZ-07)', {}, (repo) => {
  writeFileSync(join(repo.work, 'dapp/.env.production.local'), 'NODE_ENV=development\n');
  const r = runDeploy(repo.work, { network: 'mainnet' });
  console.log(`  development build in build/: ${developmentBuild(repo.work)}`);
  mustRefuse('g', 'a development build from an ignored .env file', r, /git ignores/);
});
withRepo('(g) NODE_ENV=development in the shell: no file to see, the bundle must say so', {}, (repo) => {
  const r = runDeploy(repo.work, { network: 'mainnet', env: { NODE_ENV: 'development' } });
  console.log(`  development build in build/: ${developmentBuild(repo.work)}`);
  mustRefuse('g', 'a development build from the shell', r, /development build/);
});

if (bugs.length) {
  console.log('\nBUG (audit5 ops, deploy gates): dapp/deploy.sh lacks these:');
  for (const b of bugs) console.log('  - ' + b);
  process.exit(1);
}
console.log('\nOK: dapp/deploy.sh refused each case for its own reason, audited, read the chain and uploads atomically');
