// Red team: the pages that sell "non-cancelable, nobody can stop it" never
// mention that the token's issuer can.
//
// FOXSY-5d5f3e (mainnet, 2026-10-13): canPause true, canAddSpecialRoles true,
// canUpgrade true, owner erd1m767j…rezef. Its issuer can pause every transfer
// (every claim and cancel fails until unpaused), give itself a transfer role
// (then the contract can never pay anyone), or change those properties. Any
// token can be issued with canFreeze and canWipe on top: freeze the contract,
// wipe its balance, and every vesting of that token is gone.
//
// The dApp reads /tokens/{id}, which carries all of these flags, and shows
// none of them. Step 4 of Create says a non-cancelable vesting is "the
// strongest promise to a community", and the spec (CONTRACT_SPEC.md 5) says
// "the dApp warns before creating such a vesting": no code reads canPause,
// canFreeze, canWipe or the transfer role (grep, 2026-10-13). A scam token
// with a big "team vesting, cannot be cancelled" is the obvious use.
//
// Expected once fixed: the vesting page (and the token page, and the Create
// review) says what the issuer can still do to this token.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const HOLDER = 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  // What /tokens/FOXSY-5d5f3e answers, as far as it matters here.
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'Foxsy',
    decimals: 18,
    owner: 'erd1m767j3xs0e53kxr797rwl4pchydatcyqu3v09tl8202samrz6cys8rezef',
    isPaused: false,
    canPause: true,
    canFreeze: false,
    canWipe: false,
    canAddSpecialRoles: true,
    canUpgrade: true
  }),
  historyOf: async () => [],
  keyHolder: async () => HOLDER,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => ({
      id: 5,
      creator: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
      beneficiary: HOLDER,
      token: 'FOXSY-5d5f3e',
      total: 1_000_000n * 10n ** 18n,
      schedule: {
        start: T,
        cliff: T,
        cliffAmount: 0n,
        end: T + 730 * 86_400,
        curve: { kind: 'linear' }
      },
      cancelable: false,
      createdAt: T,
      claimNonce: 5,
      cancelNonce: 0,
      label: 'Team, cannot be cancelled',
      claimed: 0n,
      cancelledAt: 0,
      vested: 1_000n * 10n ** 18n,
      claimable: 1_000n * 10n ** 18n,
      finalAmount: 1_000_000n * 10n ** 18n,
      refunded: 0n,
      timestamp: T + 86_400
    }),
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    })
  }
}));

describe('red team: a non-cancelable vesting of a token its issuer can pause', () => {
  it('tells the reader what the issuer can still do', async () => {
    render(
      <MemoryRouter initialEntries={['/v/5']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    for (let i = 0; i < 6; i++) await act(async () => undefined);
    expect(screen.getByText(/can never be cancelled/)).toBeTruthy();
    expect(
      screen.queryByText(/issuer.*(pause|freeze|wipe|transfer role)/i)
    ).not.toBeNull();
  });
});
