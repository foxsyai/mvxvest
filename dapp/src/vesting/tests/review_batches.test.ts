// Adversarial review: batch sizing for vestings with many tranches.
//
// gasPerVesting assumes 0.42M gas per tranche (measured on 12-tranche
// vestings). The repo's own devnet measurement of ONE cancelable `create`
// with 120 tranches is 132,078,774 gas (docs/MEASUREMENTS.md; devnet tx
// cebb870624f6db6f3b2b8b4a1e5ab379a91f7d9393ecbc9621db080c46525ddb, 120
// tranches decoded from its data), not the 58.9M the formula gives: the cost
// per tranche grows with the list. maxPerBatch then puts 8 such vestings in
// one transaction, about 1,000M gas against a 600M ceiling: the batch cannot
// be signed (simulation fails), or, if the simulation reports the cost, it is
// capped at 600M by prepare() and runs out of gas on chain.

import { gasPerVesting, maxPerBatch } from '../batches';

const MAX_GAS_PER_TX = 600_000_000;
const MEASURED_CREATE_120_TRANCHES = 132_078_774;
// In a batch a vesting saves part of the transaction overhead: a cancelable
// linear `create` alone is 13.5M, one of a batch of 33 is 279.2M / 33 = 8.5M.
const IN_BATCH_120_TRANCHES = MEASURED_CREATE_120_TRANCHES - 5_000_000;

describe('review: batches of vestings with 120 tranches', () => {
  it('the gas estimate per vesting is not below what devnet measured', () => {
    expect(gasPerVesting(true, 120)).toBeGreaterThanOrEqual(
      IN_BATCH_120_TRANCHES
    );
  });

  it('a batch of them fits in one transaction', () => {
    const perBatch = maxPerBatch(true, 120);
    // Today: 8 x ~127M = ~1,017M.
    expect(perBatch * IN_BATCH_120_TRANCHES).toBeLessThanOrEqual(
      MAX_GAS_PER_TX
    );
  });
});
