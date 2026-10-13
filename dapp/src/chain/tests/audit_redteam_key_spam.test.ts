// Red team: 10,000 unsolicited dust keys break a wallet's "My vestings" page.
//
// Anyone can create a vesting for anyone (1 unit of any token, zero fee,
// about 0.00027 EGLD of gas each in batches of 50: MEASUREMENTS.md). keysHeld
// pages through /accounts/{address}/nfts 100 at a time until a short page,
// and the public API refuses any page past 10,000 items:
//   GET /accounts/.../nfts?from=10000&size=100 -> 400 "Result window is too
//   large, from + size must be less than or equal to: [10000]"
// (read on mainnet, 2026-10-13). A 400 is not retried, so keysHeld rejects,
// claimableVestings rejects, and the page shows "Could not read your
// vestings right now: the network did not answer" for ever, for about
// 2.7 EGLD spent once by a stranger. The same list is the public address page
// (/a/<address>) that a community uses to check a team wallet.
//
// Expected once fixed: the read degrades (the keys the API will give, with a
// note that there are more) instead of failing the whole page.

import { claimableVestings } from 'chain/mine';
import { keysHeld } from 'chain/reads';

const VICTIM = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const HELD = 10_050;

jest.mock('chain/network', () => ({
  apiUrl: 'https://api.multiversx.com',
  api: jest.fn(async (path: string) => {
    const url = new URL(`https://api.multiversx.com${path}`);
    if (!url.pathname.endsWith('/nfts')) throw new Error(`unexpected ${path}`);
    const from = Number(url.searchParams.get('from') ?? 0);
    const size = Number(url.searchParams.get('size') ?? 25);
    if (from + size > 10_000) {
      // chain/network.api throws an ApiError(status 400, not retryable).
      const failure: any = new Error(`${path} answered 400`);
      failure.status = 400;
      failure.retryable = false;
      throw failure;
    }
    return Array.from(
      { length: Math.max(0, Math.min(size, HELD - from)) },
      (_, i) => ({ nonce: from + i + 1 })
    );
  })
}));

jest.mock('chain/vesting', () => ({
  vesting: {
    vestingCount: async () => HELD,
    vestings: async (ids: number[]) =>
      ids.map((id) => ({ id, claimNonce: id, claimable: 1n })),
    vestingByClaimNonce: async () => 0,
    vesting: async () => {
      throw new Error('unused');
    }
  }
}));

describe('red team: a wallet spammed with 10,000 dust claim keys', () => {
  it('keysHeld still answers with the keys the API will give', async () => {
    await expect(keysHeld(VICTIM, 'VESTKEY-f56bea')).resolves.toBeDefined();
  });

  it('My vestings still lists something instead of failing as a whole', async () => {
    const list = await claimableVestings(VICTIM, 'VESTKEY-f56bea');
    expect(list.length).toBeGreaterThan(0);
  });
});
