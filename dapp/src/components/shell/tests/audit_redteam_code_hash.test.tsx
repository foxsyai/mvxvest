// Red team: a malicious upgrade is invisible in the dApp.
//
// The contract is upgradeable by the owner multisig (2 of 3, no timelock;
// mainnet /accounts/erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu:
// isUpgradeable true, owner erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3,
// read 2026-10-13). Two signers (or one signer with a second stolen key, or
// one person who holds two of the three wallets) can replace `claim` with code
// that pays elsewhere, and every beneficiary who presses Claim afterwards
// signs a transaction against the new code. The Guide promises "each version
// is a reproducible build whose code hash anyone can check against the
// source", but the site never shows the expected hash nor compares it with
// the live one: the API returns the account's codeHash on every page load,
// and the dApp already knows the hash it was built for (config, a comment).
//
// Expected once fixed: the shell reads the contract's code hash and shows a
// warning on every page when it is not the hash this build was made for
// (an upgrade the dApp does not know yet is exactly the moment to stop).

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { contractAddress } from 'config';
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
  api: async (path: string) => {
    // The contract after an upgrade the dApp does not know: another hash.
    if (path.startsWith(`/accounts/${contractAddress}`))
      return {
        address: contractAddress,
        codeHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        isUpgradeable: true
      };
    throw new Error(`unexpected ${path}`);
  }
}));

describe('red team: the contract code is not the one this build knows', () => {
  it('warns on every page', async () => {
    render(
      <MemoryRouter>
        <Layout>
          <p>a page</p>
        </Layout>
      </MemoryRouter>
    );
    for (let i = 0; i < 6; i++) await act(async () => undefined);
    expect(
      screen.queryByText(/code (hash )?(changed|differs|is not)|upgraded/i)
    ).not.toBeNull();
  });
});
