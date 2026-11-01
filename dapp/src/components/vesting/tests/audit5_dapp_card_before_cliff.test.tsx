// Fifth audit (DAPP, 1 Nov 2026): a vesting card before the cliff of a
// linear schedule.
//
// VestingCard.tsx prints "grows every second" under "Claimable now" whenever
// the curve is linear, the vesting is not cancelled and the end is ahead
// (the condition never looks at the cliff). Before the cliff nothing is
// claimable and nothing grows: the contract pays 0 until the cliff, then
// everything vested so far at once. So a card of a vesting with a six month
// cliff reads "Claimable now 0 FOXSY, grows every second" next to "Next
// release <the cliff date>": a holder, or a buyer of the key on an address
// page, is told the money is already flowing when it is not.
//
// The vesting page's own "Next release" fact does look at the cliff
// (Vesting.tsx: `now >= v.schedule.cliff`), so only the cards are wrong.
//
// Expected once fixed: before the cliff the card does not say the claimable
// amount grows every second.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { VestingCard } from '../VestingCard';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/vesting', () => ({
  vesting: { isKeyStamping: async () => true }
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'FOXSY',
    decimals: 18,
    verified: true
  })
}));

const T = 10n ** 18n;
const NOW = 1_792_000_000;
const DAY = 86_400;

/** Linear over a year, with a catch-up cliff in six months: nothing yet. */
const beforeCliff: Vesting = {
  id: 7,
  creator: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
  beneficiary:
    'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  token: 'FOXSY-5d5f3e',
  total: 1_000n * T,
  schedule: {
    start: NOW - 30 * DAY,
    cliff: NOW + 150 * DAY,
    cliffAmount: 0n,
    end: NOW + 335 * DAY,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: NOW - 30 * DAY,
  claimNonce: 7,
  cancelNonce: 0,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  vested: 0n,
  claimable: 0n,
  finalAmount: 1_000n * T,
  refunded: 0n,
  timestamp: NOW
};

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => undefined);
};

describe('audit5 DAPP: a linear vesting before its cliff, on a card', () => {
  it('does not say the claimable amount grows every second', async () => {
    render(
      <MemoryRouter>
        <VestingCard vesting={beforeCliff} now={NOW} />
      </MemoryRouter>
    );
    await flush();
    // The contract's truth for this moment.
    expect(screen.getByText('Claimable now').nextSibling?.textContent).toMatch(
      /^0/
    );
    // The card's next release is the cliff, 150 days away...
    expect(screen.getByText('Next release').nextSibling?.textContent).not.toMatch(
      /every second/
    );
    // ...so nothing grows every second until then.
    expect(screen.queryByText(/grows every second/)).toBeNull();
  });

  it('says so once the cliff has passed (the sentence belongs there)', async () => {
    const running: Vesting = {
      ...beforeCliff,
      schedule: { ...beforeCliff.schedule, cliff: NOW - DAY },
      vested: 100n * T,
      claimable: 100n * T
    };
    render(
      <MemoryRouter>
        <VestingCard vesting={running} now={NOW} />
      </MemoryRouter>
    );
    await flush();
    expect(screen.getByText(/grows every second/)).toBeTruthy();
  });
});
