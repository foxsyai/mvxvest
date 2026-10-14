// Third audit (the code since 532740f): the panel names a token by its ticker
// alone (`payout.info?.ticker ?? payout.token.split('-')[0]`). Everywhere else
// the site shows the identifier and marks a token without registered assets
// "unverified" (red team RT2, components/vesting/TokenTrust.tsx), because
// anyone can issue a "FOXSY-abc123" whose ticker reads exactly like the real
// FOXSY's. On My vestings, Claim all takes every claimable key, a dust vesting
// of a look-alike included (it is marked unverified on its card), and the
// panel then sums both under the same name: "Received in this wallet: 100
// FOXSY and 1,000 FOXSY." A reader who trusts the figure believes 1,100 FOXSY
// arrived.
//
// Expected once fixed: the look-alike is shown with its identifier or marked
// unverified, as on the cards.

import { act, render, screen } from '@testing-library/react';
import { Payouts } from '../Payouts';

const T = 10n ** 18n;

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/reads', () => ({
  payoutsOf: async () => [
    {
      token: 'FOXSY-5d5f3e',
      claimed: 100n * T,
      refunded: 0n,
      staysClaimable: 0n
    },
    {
      token: 'FOXSY-abc123',
      claimed: 1000n * T,
      refunded: 0n,
      staysClaimable: 0n
    }
  ],
  // What chain/reads' tokenInfo returns for each: the real FOXSY has assets,
  // the look-alike has none (its API ticker is the whole identifier).
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: 'FOXSY',
    name: 'FOXSY',
    decimals: 18,
    verified: identifier === 'FOXSY-5d5f3e'
  })
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

describe('a look-alike token in what was received', () => {
  it('is told apart from the real token, as on every other page', async () => {
    render(<Payouts hashes={['h1']} />);
    await flush();
    const text = screen.getByText(/Received in this wallet/).textContent ?? '';
    // Today: "Received in this wallet: 100 FOXSY and 1,000 FOXSY."
    expect(text).toMatch(/FOXSY-abc123|unverified/);
  });
});
