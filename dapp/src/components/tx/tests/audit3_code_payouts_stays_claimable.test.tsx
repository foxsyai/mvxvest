// Third audit (the code since 532740f): after a cancel, the panel says "Stays
// claimable by the beneficiary: <amount>", the amount being
// CancelledEvent.vested. The contract puts the GROSS vested amount there,
// what the beneficiary had already claimed included (claim.rs, cancel:
// `vested = schedule.vested_at(total, now)`, `refund = total - vested`), while
// the claim key can only ever collect vested minus claimed (claim.rs, claim:
// `amount = vested - claimed_before`). In the common case, a beneficiary who
// claimed before the cancel, the line overstates what stays claimable by
// everything they already took.
//
// A real case on devnet, vesting #202 of the devnet contract (read from
// https://devnet-api.multiversx.com on 14 Oct 2026, TFOX has 18 decimals):
//   claims before the cancel:  d990712b… 1000.069444 TFOX, 40f2a0b3… 0.196759 TFOX
//   the cancel, 8198417e…:     refund 1999.675925, vested 1000.324074 (the event below)
//   the claim after it, 224f43b2…: 0.057870370370370371 TFOX, and the key was burned
// So 0.05787 TFOX stayed claimable, and the panel says 1,000.324074 TFOX does.
//
// Expected once fixed: the line gives what the claim key can still collect
// (vested minus claimed, from the vesting's state after the cancel), or does
// not state a figure it cannot know from the event.

import { act, render, screen } from '@testing-library/react';
import { Payouts } from '../Payouts';

jest.mock('config', () => jest.requireActual('config/config.devnet'));

const CANCEL_TX =
  '8198417e80b2db051ab2666884f4376d9b15dedd752c7e364cb6475ddbc1e853';
const cancelTx = {
  txHash: CANCEL_TX,
  status: 'success',
  logs: {
    events: [
      // The vestingCancelled event exactly as the API returns it: topics
      // ["vestingCancelled", 0xca = 202, the caller, "TFOX-d61b09"], data =
      // refund 1999675925925925925926 and vested 1000324074074074074074 as
      // nested BigUints.
      {
        address:
          'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
        identifier: 'cancel',
        topics: [
          'dmVzdGluZ0NhbmNlbGxlZA==',
          'yg==',
          'BI64+DrQbJg6ZAVjUe81wXHu6BDJv6npCJvauIptTrA=',
          'VEZPWC1kNjFiMDk='
        ],
        data: 'AAAACWxnFAPkeya0JgAAAAk2OkkFbSC5S9o='
      }
    ]
  },
  results: []
};

jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com',
  fresh: async (path: string) => {
    const ok = path.includes(CANCEL_TX);
    return { ok, status: ok ? 200 : 404, json: async () => cancelTx };
  },
  api: async (path: string) => {
    if (path === '/tokens/TFOX-d61b09')
      return {
        identifier: 'TFOX-d61b09',
        ticker: 'TFOX-d61b09',
        name: 'TestFox',
        decimals: 18
      };
    throw new Error(`unexpected read ${path}`);
  }
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

describe('what a cancel leaves claimable', () => {
  it('says what the claim key can still collect, not everything that had ever vested', async () => {
    render(<Payouts hashes={[CANCEL_TX]} />);
    await flush();
    expect(screen.getByText(/Returned to this wallet/).textContent).toMatch(
      /1,999\.675925\s*TFOX/
    );
    const stays = screen.queryByText(/Stays claimable/)?.textContent ?? '';
    // Today: "Stays claimable by the beneficiary: 1,000.324074 TFOX."
    expect(stays).not.toMatch(/1,000\.32/);
    if (stays) expect(stays).toMatch(/0\.05787\d*\s*TFOX/);
  });
});
