// Main audit (Fable 5.1, 13 Oct 2026): a claim key that bounced back into
// the vesting contract is shown as if a wallet held it.
//
// A key sent to a beneficiary that cannot receive it (a smart contract in
// another shard that is not payable by smart contracts) bounces back to the
// vesting contract, which then holds it until the owner multisig votes
// recoverBouncedKey (CONTRACT_SPEC.md, "No dead ends"). The vesting page
// reads the holder from /nfts/{key} and, when it is an address, renders it
// with AddressText like any holder: "Claim key (VESTKEY-... #7)
// erd1qq...xfrp copy", with a link to the contract's own address page. The
// beneficiary sees a stranger holding their key and nothing about what
// happened or what to do (ask the owner to return it; the Guide has the
// one line about it); the creator, looking for whom to tell, gets the same
// view. The contract's address is known to the page (config.contractAddress),
// so the case costs no read.
//
// Expected once fixed: the page says the key could not be delivered and is
// held by the vesting contract until the owner returns it.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { VestingPage } from '../Vesting';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const CREATOR =
  'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
// A smart contract in another shard, the beneficiary the key bounced from.
const BENEFICIARY =
  'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';

// A getter: jest hoists this factory above the const it reads.
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
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));

const T = 10n ** 18n;
const vesting: Vesting = {
  id: 7,
  creator: CREATOR,
  beneficiary: BENEFICIARY,
  token: 'TFOX-d61b09',
  total: 1_000n * T,
  schedule: {
    start: 1_790_000_000,
    cliff: 1_790_000_000,
    cliffAmount: 0n,
    end: 1_821_000_000,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: 1_790_000_000,
  claimNonce: 7,
  cancelNonce: 0,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  vested: 100n * T,
  claimable: 100n * T,
  finalAmount: 1_000n * T,
  refunded: 0n,
  timestamp: 1_791_500_000
};

jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'TFOX-d61b09',
    ticker: 'TFOX',
    name: 'TFOX',
    decimals: 18
  }),
  historyOf: async () => [],
  // The API: the key is held by the vesting contract itself (it bounced).
  keyHolder: async () =>
    'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => vesting,
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    })
  }
}));

describe('audit: a claim key the vesting contract holds (it bounced)', () => {
  it('is not shown as an ordinary holder', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_791_500_000_000);
    render(
      <MemoryRouter initialEntries={['/v/7']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    for (let i = 0; i < 6; i++) await act(async () => undefined);
    expect(screen.getByText('Keys and people')).toBeTruthy();
    // Today: "erd1qqqqqqqqqq…26xfrp" with a copy button and a link to the
    // contract's address page, as for any holder.
    expect(
      screen.queryByText(
        /bounced|could not be delivered|held by the (vesting )?contract|returned to the contract/i
      )
    ).not.toBeNull();
  });
});
