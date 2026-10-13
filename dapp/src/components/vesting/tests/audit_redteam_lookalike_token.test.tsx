// Red team: a look-alike token passes for the real one on every card.
//
// Anyone can issue a fungible token named "Foxsy" with ticker FOXSY; it gets
// an identifier like FOXSY-abc123. The public API's `ticker` field is the
// FULL identifier when a token has no registered assets (observed on mainnet
// 2026-10-13: FOXSYWEGLD-2a5635 answers ticker "FOXSYWEGLD-2a5635"), and
// chain/reads.tickerOf strips the suffix, so the fake reads "FOXSY" exactly
// like FOXSY-5d5f3e. VestingCard shows the ticker only, never the identifier,
// and VestingCard is what My vestings, Created by me and the public address
// page (/a/<address>) are made of.
//
// The chain: an attacker creates a 10,000,000 "FOXSY" vesting for the FOXSY
// team wallet with label "FOXSY team allocation" (cost: dust plus gas), then
// points a buyer or the community at /a/<team wallet>, where a 10,000,000
// FOXSY vesting now shows. Or sells the claim key OTC as "a FOXSY vesting".
//
// Expected once fixed: a card shows the token's identifier (or marks a token
// without registered assets as unverified), so FOXSY-abc123 can never read as
// FOXSY-5d5f3e.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { VestingCard } from '../VestingCard';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com',
  apiUrl: 'https://api.multiversx.com',
  api: async (path: string) => {
    // The API's answer for a token with no registered assets.
    if (path === '/tokens/FOXSY-abc123')
      return {
        identifier: 'FOXSY-abc123',
        name: 'Foxsy',
        ticker: 'FOXSY-abc123',
        decimals: 18
      };
    throw new Error(`unexpected ${path}`);
  }
}));

const T = 1_767_225_600;
const TOTAL = 10_000_000n * 10n ** 18n;
const fake: Vesting = {
  id: 7,
  creator: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  beneficiary: 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd',
  token: 'FOXSY-abc123',
  total: TOTAL,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 365 * 86_400,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: T,
  claimNonce: 7,
  cancelNonce: 0,
  label: 'FOXSY team allocation',
  claimed: 0n,
  cancelledAt: 0,
  vested: TOTAL / 10n,
  claimable: TOTAL / 10n,
  finalAmount: TOTAL,
  refunded: 0n,
  timestamp: T + 36 * 86_400
};

describe('red team: a vesting of a look-alike token', () => {
  it('is never shown as the ticker alone', async () => {
    render(
      <MemoryRouter>
        <VestingCard vesting={fake} now={T + 36 * 86_400} />
      </MemoryRouter>
    );
    for (let i = 0; i < 5; i++) await act(async () => undefined);
    // The amount is shown with the ticker "FOXSY"...
    expect(screen.getAllByText('FOXSY').length).toBeGreaterThan(0);
    // ...so the identifier (or an "unverified" mark) must be there too.
    expect(
      screen.queryByText(/FOXSY-abc123|unverified|no registered assets/i)
    ).not.toBeNull();
  });
});
