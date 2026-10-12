// Adversarial review: the vesting page reads any failure as "no such vesting".
//
// The public API answers 429 (or Cloudflare 1015) under load, as
// chain/network.ts documents; after four tries the read fails. VestingPage
// then tells a beneficiary that their vesting does not exist on this network.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VestingPage } from '../Vesting';

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => {
    throw new Error('unused');
  },
  historyOf: async () => [],
  keyHolder: async () => null,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => {
      throw new Error(
        'Request error on url [vm-values/query]: [Too Many Requests] 429'
      );
    },
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    })
  }
}));

describe('review: vesting page when a read fails', () => {
  it('does not say the vesting does not exist when the API is rate limiting', async () => {
    render(
      <MemoryRouter initialEntries={['/v/5']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    for (let i = 0; i < 5; i++) await act(async () => undefined);
    expect(screen.queryByText(/No vesting with this number/)).toBeNull();
  });
});
