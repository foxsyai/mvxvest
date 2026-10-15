// The footer links to the source, as mvxsafe.io's does: anyone can reach the
// public repository in one click. (The commit link needs the build's commit,
// which jest does not have.)

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../Layout';

jest.mock('lib', () => ({
  useGetIsLoggedIn: () => false,
  useGetAccount: () => ({ address: '' }),
  getAccountProvider: () => ({ logout: async () => undefined }),
  UnlockPanelManager: {
    init: () => ({ openUnlockPanel: () => undefined })
  }
}));
jest.mock('lib/sdkDapp/sdkDapp.constants', () => ({ ALLOWED_WALLETS: [] }));
jest.mock('chain/network', () => ({
  networkName: 'mainnet',
  explorerUrl: 'https://explorer.multiversx.com',
  apiUrl: 'https://api.multiversx.com',
  api: async () => {
    throw new Error('offline');
  }
}));

it('links to the public repository', async () => {
  render(
    <MemoryRouter>
      <Layout>
        <p>a page</p>
      </Layout>
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  const source = screen.getByText('Source').closest('a')!;
  expect(source.getAttribute('href')).toBe(
    'https://github.com/foxsyai/mvxvest'
  );
  expect(source.getAttribute('target')).toBe('_blank');
  expect(source.getAttribute('rel')).toBe('noreferrer');
});
