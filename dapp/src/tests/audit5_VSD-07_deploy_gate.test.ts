/**
 * @jest-environment node
 */
// Audit 5 (vest-dapp, VSD-07): three ways a build that is not what origin/main
// shows can pass dapp/deploy.sh's gate and reach mvxvest.io.
//
// The gate (third audit, O4 and O5) refuses changed or untracked files and a
// HEAD that origin/main does not contain. It does not see:
//
// 1. A file git ignores under public/. `git status --porcelain
//    --untracked-files=all` lists untracked files but never ignored ones;
//    Vite copies all of public/ into build/ and rsync ships build/ whole. The
//    repository ignores `.env*`, `*.log`, `*wallet*.json`, `*secret*`, `*.pem`:
//    exactly the files that must never be published, and a stray one under
//    dapp/public/ ships with a version.txt that names a clean commit.
// 2. A tracked file flagged skip-worktree or assume-unchanged, which git
//    status does not report, so it ships changed.
// 3. An older commit of main: `merge-base --is-ancestor HEAD origin/main`
//    accepts any ancestor, so a stale checkout silently rolls the site back.
//
// All three were found and closed in mvxsafe's deploy.sh on 21 Oct 2026
// (OPX-01, OPX-07, OPX-02). deploy.sh's own gate, from its network check up
// to the install step, runs verbatim in a throwaway repository with a bare
// origin. The control passes today; the other three fail on 26b0d4c.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = readFileSync(join(__dirname, '..', '..', 'deploy.sh'), 'utf8');
const lines = script.split('\n');
const from = lines.findIndex((l) => l.includes('case "$NETWORK" in'));
const to = lines.findIndex((l) => l.includes('pnpm install --frozen-lockfile'));
if (from < 0 || to < 0 || to <= from)
  throw new Error(
    'deploy.sh no longer has the gate between the network check and the install'
  );
/** The gate as deploy.sh runs it, with the script's own preamble. */
const gate = [
  'set -euo pipefail',
  'NETWORK="${1:-}"',
  'HERE="$PWD"',
  ...lines.slice(from, to)
].join('\n');

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'audit',
  GIT_AUTHOR_EMAIL: 'audit@example.invalid',
  GIT_COMMITTER_NAME: 'audit',
  GIT_COMMITTER_EMAIL: 'audit@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null'
};

/** A clone at the tip of main, with a bare origin that holds the same. */
const throwawayRepo = () => {
  const base = mkdtempSync(join(tmpdir(), 'audit5-deploy-gate-'));
  const origin = join(base, 'origin.git');
  const repo = join(base, 'dapp');
  execFileSync('git', ['init', '-q', '--bare', origin], { env, stdio: 'pipe' });
  mkdirSync(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' })
      .toString()
      .trim();
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(join(repo, '.gitignore'), '*.log\n.env*\n');
  mkdirSync(join(repo, 'public'));
  writeFileSync(join(repo, 'public', 'robots.txt'), 'User-agent: *\n');
  git('add', '.');
  git('commit', '-q', '-m', 'the pushed commit');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return { repo, git };
};

const runGate = (repo: string, extraEnv: Record<string, string> = {}) =>
  spawnSync('bash', ['-c', gate, 'gate', 'devnet'], {
    cwd: repo,
    env: { ...env, ...extraEnv },
    encoding: 'utf8'
  });

describe('VSD-07, control (passes today)', () => {
  test('a clean checkout at the tip of origin/main passes the gate', () => {
    const { repo } = throwawayRepo();
    const run = runGate(repo);
    expect(run.stdout + run.stderr).not.toContain('REFUSING');
    expect(run.status).toBe(0);
  });

  test('an untracked file under public/ is refused (the third audit gate works)', () => {
    const { repo } = throwawayRepo();
    writeFileSync(
      join(repo, 'public', 'stray.html'),
      '<h1>never pushed</h1>\n'
    );
    const run = runGate(repo);
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.status).not.toBe(0);
  });
});

describe('VSD-07: what the gate does not see', () => {
  test('a file git ignores under public/ ships: it must be refused', () => {
    const { repo } = throwawayRepo();
    // Ignored by the repository's own rules, copied by Vite, shipped by rsync.
    writeFileSync(
      join(repo, 'public', '.env.production'),
      'KEY=do-not-publish\n'
    );
    writeFileSync(
      join(repo, 'public', 'debug.log'),
      'a wallet address and a session\n'
    );
    const run = runGate(repo);
    // Today: git status lists nothing, the gate passes.
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.status).not.toBe(0);
  });

  test('a tracked file hidden from git status (skip-worktree) ships changed: it must be refused', () => {
    const { repo, git } = throwawayRepo();
    git('update-index', '--skip-worktree', 'public/robots.txt');
    writeFileSync(join(repo, 'public', 'robots.txt'), 'Disallow: /\n');
    const run = runGate(repo);
    // Today: git status --porcelain is silent about it, the gate passes.
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.status).not.toBe(0);
  });

  test('an older commit of main is refused unless asked for on purpose', () => {
    const { repo, git } = throwawayRepo();
    writeFileSync(
      join(repo, 'public', 'robots.txt'),
      'User-agent: *\nDisallow:\n'
    );
    git('commit', '-q', '-am', 'the newer commit on main');
    git('push', '-q', 'origin', 'main');
    git('checkout', '-q', 'HEAD~1');
    const run = runGate(repo);
    // Today: the first commit is an ancestor of origin/main, so it passes
    // and the site rolls back without a word.
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.stdout + run.stderr).toContain('behind origin/main');
    expect(run.status).not.toBe(0);

    // On purpose, for a rollback, it still passes.
    const onPurpose = runGate(repo, { OLD_COMMIT: '1' });
    expect(onPurpose.stdout + onPurpose.stderr).not.toContain('REFUSING');
    expect(onPurpose.status).toBe(0);
  });

  test('an ignored .env file beside the code, which Vite reads, must be refused too (OPZ-07)', () => {
    const { repo } = throwawayRepo();
    writeFileSync(
      join(repo, '.env.production.local'),
      'NODE_ENV=development\n'
    );
    const run = runGate(repo);
    expect(run.stdout + run.stderr).toContain('.env.production.local');
    expect(run.status).not.toBe(0);
  });

  test('what is known to be generated does not stop a deploy', () => {
    const { repo, git } = throwawayRepo();
    writeFileSync(join(repo, '.gitignore'), '/node_modules\n/build\n');
    git('commit', '-q', '-am', 'the ignore list');
    git('push', '-q', 'origin', 'main');
    mkdirSync(join(repo, 'node_modules'));
    writeFileSync(join(repo, 'node_modules', 'a.js'), '\n');
    mkdirSync(join(repo, 'build'));
    writeFileSync(join(repo, 'build', 'index.html'), '\n');
    const run = runGate(repo);
    expect(run.stdout + run.stderr).not.toContain('REFUSING');
    expect(run.status).toBe(0);
  });
});
