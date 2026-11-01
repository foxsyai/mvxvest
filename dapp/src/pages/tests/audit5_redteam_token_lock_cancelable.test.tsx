// Fifth audit, red team (RT-2): a token project fakes a lock. The Token page
// is where a community reads a team's lock ("This is how a community checks a
// team", the guide). It sums every vesting of the token into "Still in the
// contract" and an unlock calendar, and lists them with a status badge.
//
// A team creates its own 1,000,000 FOXSY "team lock" as a CANCELABLE vesting
// and keeps the cancel key (or parks it in another wallet). The Token page
// then reads: 1,000,000 still in the contract, unlocking month by month over
// two years, status "Vesting". Nothing on this page says that whoever holds
// the cancel key can pull the unvested part back at any moment: the word
// appears only on the vesting's own page and on the cards of My vestings and
// Created (fourth audit, DT-5 and RT1), which an investor reading the token's
// page never opens. The calendar counts the cancelable amount as unlocking in
// the future as if it were committed; `committed` (Token.tsx) counts a
// cancelable vesting's whole total.
//
// Played end to end: the team creates it (0.1 EGLD plus 0.1%), announces the
// token's page as proof of the lock, and cancels when it wants the tokens:
// the page then says "Cancelled" and "refunded on cancel", after the fact.
//
// Expected once fixed: the Token page says how much of "still in the
// contract" is cancelable and marks each cancelable vesting in the list, so
// that a lock that can be undone never reads as one that cannot.

import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Token } from '../Token';

const T = 1_767_225_600;
const TEAM = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const ONE = 10n ** 18n;

const teamLock = {
  id: 9,
  creator: TEAM,
  beneficiary: TEAM,
  token: 'FOXSY-5d5f3e',
  total: 1_000_000n * ONE,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 730 * 86_400,
    curve: { kind: 'stepped', interval: 30 * 86_400 }
  },
  cancelable: true,
  createdAt: T,
  claimNonce: 9,
  cancelNonce: 4,
  label: 'Team lock, 24 months',
  claimed: 0n,
  cancelledAt: 0,
  vested: 0n,
  claimable: 0n,
  finalAmount: 1_000_000n * ONE,
  refunded: 0n,
  timestamp: T + 86_400
};

jest.mock('config', () => ({
  get contractAddress() {
    return 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
  },
  get keyCollections() {
    return { claim: 'VESTKEY-f56bea', cancel: 'VESTCANCEL-ae94f5' };
  }
}));
jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
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
    name: 'Foxsy',
    decimals: 18,
    verified: true,
    owner: TEAM,
    isPaused: false,
    canPause: false,
    canFreeze: false,
    canWipe: false,
    canAddSpecialRoles: false,
    canUpgrade: false
  })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    tokenTotals: async () => ({
      deposited: 1_000_000n * 10n ** 18n,
      claimed: 0n,
      refunded: 0n
    })
  }
}));
jest.mock('chain/mine', () => ({
  tokenVestings: async () => ({ list: [teamLock], count: 1 })
}));

describe('red team: a cancelable "team lock" on the Token page', () => {
  it('says that the amount can be pulled back by the holder of a cancel key', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/t/FOXSY-5d5f3e']}>
        <Routes>
          <Route path='/t/:token' element={<Token />} />
        </Routes>
      </MemoryRouter>
    );
    for (let i = 0; i < 8; i++) await act(async () => undefined);
    const text = container.textContent ?? '';
    // The lock is shown as held.
    expect(text).toMatch(/Still in the contract/);
    // "refunded on cancel" is a column heading about the past; the page must
    // say, of this running vesting, that it is cancelable.
    expect(text).toMatch(/cancelable|can be cancelled|cancel key/i);
  });
});
