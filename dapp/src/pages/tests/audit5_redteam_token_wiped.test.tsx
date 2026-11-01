// Fifth audit, red team (RT-3): a token project "locks" tokens, then takes
// them out from under the contract, and the site keeps showing the lock.
//
// The issuer of a token with canFreeze and canWipe (the team itself, for a
// team lock) can freeze the vesting contract's balance of it and wipe it:
// two built-in calls, no vote, nothing mvxvest can prevent (the first audit's
// RT4 names the powers). After the wipe the contract holds nothing of the
// token. The contract knows: version 3 added `getDeficit` for exactly this
// (fourth audit, SCM-1: "a deficit would read like balanced books"). The dApp
// never reads it (grep deficit dapp/src: nothing outside tests).
//
// So the Token page still says "Still in the contract: 1,000,000 FOXSY" (it
// shows deposited - claimed - refunded, the contract's books, not its
// balance) with a full unlock calendar, and the vesting's page still says
// "Claimable now: 400,000 FOXSY" to a holder or a buyer of its claim key,
// whose claim then fails ("insufficient funds"). An investor reading the
// token's page concludes the team's tokens are locked; they are gone. A buyer
// pays for a key that pays nothing.
//
// Expected once fixed: both pages read getDeficit for the token and, when it
// is not 0, say that the contract no longer holds what it owes (and by how
// much), instead of the lock and the claimable figures as if nothing happened.

import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Token } from '../Token';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const TEAM = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const HOLDER = 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
const ONE = 10n ** 18n;
const TOTAL = 1_000_000n * ONE;

const teamLock = {
  id: 9,
  creator: TEAM,
  beneficiary: HOLDER,
  token: 'FOXSY-5d5f3e',
  total: TOTAL,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 730 * 86_400,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: T,
  claimNonce: 9,
  cancelNonce: 0,
  label: 'Team lock, 24 months',
  claimed: 0n,
  cancelledAt: 0,
  vested: 400_000n * ONE,
  claimable: 400_000n * ONE,
  finalAmount: TOTAL,
  refunded: 0n,
  timestamp: T + 292 * 86_400
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
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'Foxsy',
    decimals: 18,
    verified: true,
    owner: TEAM,
    isPaused: false,
    canPause: true,
    canFreeze: true,
    canWipe: true,
    canAddSpecialRoles: true,
    canUpgrade: true
  }),
  historyOf: async () => [],
  keyHolder: async () => HOLDER,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => teamLock,
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    isKeyStamping: async () => true,
    // The contract's books: 1,000,000 deposited, nothing paid out.
    tokenTotals: async () => ({
      deposited: 1_000_000n * 10n ** 18n,
      claimed: 0n,
      refunded: 0n
    }),
    // The contract's answer after the wipe: it lacks everything it owes.
    deficit: async () => 1_000_000n * 10n ** 18n,
    surplus: async () => 0n
  }
}));
jest.mock('chain/mine', () => ({
  tokenVestings: async () => ({ list: [teamLock], count: 1 })
}));

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

describe('red team: the issuer froze and wiped the contract’s balance of the token', () => {
  it('the Token page does not show the wiped amount as still in the contract without a word', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/t/FOXSY-5d5f3e']}>
        <Routes>
          <Route path='/t/:token' element={<Token />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    const text = container.textContent ?? '';
    expect(text).toMatch(/Still in the contract/);
    expect(text).toMatch(
      /no longer holds|does not hold|wiped|lacks|short of|missing/i
    );
  });

  it('the vesting page does not call 400,000 claimable when the contract holds nothing', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/v/9']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    const text = container.textContent ?? '';
    expect(text).toMatch(/Claimable now/);
    expect(text).toMatch(
      /no longer holds|does not hold|wiped|lacks|short of|missing/i
    );
  });
});
