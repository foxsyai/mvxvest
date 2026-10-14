// Third audit (Fable 5.1, 14 Oct 2026), words: README.md's "The contract in
// one page" was reworded today (e0eb3d7, 95cb09e) and its status says
// "Version 2 since 14 Oct 2026", but the page itself still describes
// version 1:
//
// - "`createBatch` (up to 50 per transaction, 33 when cancelable)": version 2
//   allows 49 and 32 (CONTRACT_SPEC.md section 3, DEFAULT_LIMITS, and
//   mainnet's getLimits on 14 Oct 2026). The second audit's L1 was about a
//   batch split by the old 50 failing on version 2.
// - The owner's powers list "a flat EGLD fee per vesting (capped at 1 EGLD in
//   code)" and never the token fee version 2 added: 0.1% of each vesting in
//   its own token today, up to 2% (MAX_TOKEN_FEE_BPS), sent to the multisig.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_LIMITS } from '../batches';

const readme = readFileSync(
  resolve(__dirname, '../../../../README.md'),
  'utf8'
);
const onePage = readme.slice(readme.indexOf('## The contract in one page'));

describe('audit 3, words: README.md describes the live contract', () => {
  it('states version 2 batch limits', () => {
    const line = onePage
      .split('\n')
      .find((text) => text.includes('`createBatch`'))!;
    expect(line).toMatch(
      new RegExp(
        `up to ${DEFAULT_LIMITS.maxBatch} per transaction, ${DEFAULT_LIMITS.maxBatchCancelable} when cancelable`
      )
    );
  });

  it('names the token fee among the owner powers', () => {
    const owner = onePage.slice(onePage.indexOf('**Owner (a multisig):**'));
    expect(owner).toMatch(
      /token fee|share of each vesting|in its own token|2%/i
    );
  });
});
