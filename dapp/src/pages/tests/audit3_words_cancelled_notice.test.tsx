// Third audit (Fable 5.1, 14 Oct 2026), words: a cancelled vesting's notice
// on the vesting page reads "<refunded> went back to whoever cancelled;
// <finalAmount> had vested and stays claimable." finalAmount is what had
// vested at the cancel, claimed or not. Once the beneficiary has claimed it,
// nothing stays claimable and the claim key is burned, but the sentence
// still promises the whole vested part.
//
// A live case, mainnet vesting #2 (MAINNET.md, the in-house test; getVesting(2)
// read on 14 Oct 2026): cancelled with 39.722222 FOXSY vested, 60.277778
// refunded, then the 39.722222 claimed and both keys burned. The page says
// "39.722222 FOXSY had vested and stays claimable." next to "Claim key:
// burned: nothing more to claim".
//
// Expected once fixed: the notice says what still stays claimable (0 here),
// or "had vested" without "stays claimable".

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { VestingPage } from '../Vesting';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const CREATOR =
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const BENEFICIARY =
  'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';

jest.mock('config', () => ({
  get contractAddress() {
    return CONTRACT;
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

// Mainnet #2's figures, as getVesting(2) answers them (18 decimals).
const VESTED = 39_722_222_222_222_222_222n;
const REFUNDED = 60_277_777_777_777_777_778n;
const vesting: Vesting = {
  id: 2,
  creator: CREATOR,
  beneficiary: BENEFICIARY,
  token: 'FOXSY-5d5f3e',
  total: 100n * 10n ** 18n,
  schedule: {
    start: 1_791_902_400,
    cliff: 1_791_902_400,
    cliffAmount: 0n,
    end: 1_791_906_000,
    curve: { kind: 'linear' }
  },
  cancelable: true,
  createdAt: 1_791_902_395,
  claimNonce: 2,
  cancelNonce: 2,
  label: 'Test 1 - Mainnet',
  claimed: VESTED,
  cancelledAt: 1_791_903_830,
  vested: VESTED,
  claimable: 0n,
  finalAmount: VESTED,
  refunded: REFUNDED,
  timestamp: 1_792_000_000
};

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
    decimals: 18
  }),
  historyOf: async () => [],
  // Both keys burned: the API knows no holder.
  keyHolder: async () => null,
  outcomeOf: async () => ({ status: 'pending' }),
  payoutsOf: async () => []
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => vesting,
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    })
  }
}));

describe('audit 3, words: the cancelled notice once the vested part was claimed', () => {
  it('does not say the vested part "stays claimable" when nothing does', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_792_000_000_000);
    render(
      <MemoryRouter initialEntries={['/v/2']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    for (let i = 0; i < 8; i++) await act(async () => undefined);

    const notice = screen.getByText(/went back to whoever cancelled/);
    expect(notice.textContent).toMatch(/60\.277777\s*FOXSY/);
    // Claimed in full, key burned: 39.722222 does not stay claimable.
    expect(notice.textContent).not.toMatch(
      /39\.722222\s*FOXSY\s*had vested and stays claimable/
    );
  });
});
