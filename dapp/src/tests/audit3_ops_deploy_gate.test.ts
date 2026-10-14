/**
 * @jest-environment node
 */
// Third audit, operations (14 Oct 2026): the deploy gate in dapp/deploy.sh.
//
// "What goes live on mainnet must be what is on GitHub." The gate checks that
// with `git diff --quiet HEAD --`, which only sees tracked files, and only for
// mainnet. Vite copies everything under public/ into build/, and rsync ships
// build/ whole, so an untracked file under public/ reaches mvxvest.io with a
// version.txt that claims a clean commit. deploy.sh's own guard line is run
// verbatim in a throwaway repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = readFileSync(join(__dirname, '..', '..', 'deploy.sh'), 'utf8');
const lines = script.split('\n');
const guardAt = lines.findIndex((l) =>
  l.includes('REFUSING: uncommitted changes')
);
if (guardAt < 0)
  throw new Error('deploy.sh no longer has its uncommitted-changes guard');
const guard = lines[guardAt].trim();

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'audit',
  GIT_AUTHOR_EMAIL: 'audit@example.invalid',
  GIT_COMMITTER_NAME: 'audit',
  GIT_COMMITTER_EMAIL: 'audit@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null'
};

/** A repository with one pushed commit: public/robots.txt. */
const throwawayRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), 'audit3-deploy-gate-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(join(repo, 'public'));
  writeFileSync(join(repo, 'public', 'robots.txt'), 'User-agent: *\n');
  git('add', '.');
  git('commit', '-q', '-m', 'the pushed commit');
  return repo;
};

const runGuard = (repo: string) =>
  spawnSync('bash', ['-c', guard], { cwd: repo, env, encoding: 'utf8' });

describe('deploy.sh: what goes live must be what is on GitHub', () => {
  test('a modified tracked file is refused (the guard works for what it looks at)', () => {
    const repo = throwawayRepo();
    writeFileSync(join(repo, 'public', 'robots.txt'), 'Disallow: /\n');
    const run = runGuard(repo);
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.status).toBe(1);
  });

  test('an untracked file under public/ is refused too: Vite copies public/ into build/ and rsync ships it', () => {
    const repo = throwawayRepo();
    writeFileSync(
      join(repo, 'public', 'stray.html'),
      '<h1>never pushed</h1>\n'
    );
    const run = runGuard(repo);
    // Fails at 69eb614: `git diff --quiet HEAD --` ignores untracked files,
    // so the guard prints nothing and exits 0. Proven end to end on 14 Oct
    // 2026: with dapp/public/audit3-untracked-probe.txt untracked, the guard
    // exited 0 and `pnpm build-mainnet` wrote build/audit3-untracked-probe.txt
    // next to a version.txt saying "69eb614… mainnet".
    expect(run.stdout + run.stderr).toContain('REFUSING');
    expect(run.status).toBe(1);
  });

  test('the guard is not limited to mainnet: devnet.mvxvest.io shows a commit hash in its footer and version.txt too', () => {
    // Walk up from the guard to the `if` that encloses it.
    let depth = 0;
    let enclosing = '';
    for (let i = guardAt - 1; i >= 0; i--) {
      const l = lines[i].trim();
      if (l === 'fi') depth++;
      else if (l.startsWith('if ')) {
        if (depth === 0) {
          enclosing = l;
          break;
        }
        depth--;
      }
    }
    // Fails at 69eb614: the guard (and the origin/main check) sit under
    // `if [ "$NETWORK" = mainnet ]`, so `./deploy.sh devnet` builds and ships
    // whatever is in the working tree, labelled with HEAD's hash.
    expect(enclosing).not.toMatch(/NETWORK.*=\s*mainnet/);
  });
});
