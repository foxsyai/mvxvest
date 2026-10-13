// Red team: a smart contract as beneficiary passes the form without a word.
//
// CONTRACT_SPEC.md (section 5) and the Guide rely on it: "The dApp checks
// smart contract beneficiaries before creating, so this should not happen
// through it" and "the dApp warns when a beneficiary is a smart contract".
// No such check exists (grep of dapp/src, 2026-10-13): parseBeneficiaries
// accepts any valid bech32 address, and a smart contract address is told
// apart from a wallet by its shape alone (its first eight bytes are zero:
// every one starts with erd1qqqqqqqqqqqqq), so no network read is needed.
//
// What follows from it: a creator who pastes a list with a contract address
// in another shard that cannot receive tokens from contracts gets the key
// bounced into the vesting contract and must ask the owner multisig for it;
// a contract that is payable but has no way to move NFTs (a DEX pair, a
// wrapper) keeps the key for ever, and "no dead ends" no longer holds; and a
// community airdrop list with a same-shard non-payable contract fails the
// whole batch at signing, with the protocol's words, not the line.
//
// Expected once fixed: the line is flagged ("this is a smart contract: it
// must accept tokens from other contracts and be able to move the key").

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

// The owner multisig: a smart contract, in another shard than the vesting
// contract on mainnet.
const MULTISIG =
  'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/reads', () => ({
  balancesOf: async () => [
    {
      identifier: 'FOXSY-5d5f3e',
      ticker: 'FOXSY',
      name: 'Foxsy',
      decimals: 18,
      balance: 10n ** 30n
    }
  ],
  createdIdsOf: async () => [],
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    creationPaused: async () => false,
    limits: async () => ({
      maxBatch: 50,
      maxBatchCancelable: 33,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    })
  }
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

beforeEach(() => {
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

describe('red team: a smart contract typed as beneficiary', () => {
  it('is flagged before the review', async () => {
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: 'FOXSY-5d5f3e' }
    });
    const address = screen.getByPlaceholderText('erd1... beneficiary address');
    const amount = screen.getByPlaceholderText(/^Amount/);
    fireEvent.change(address, { target: { value: MULTISIG } });
    fireEvent.change(amount, { target: { value: '1000' } });
    fireEvent.blur(amount, { relatedTarget: document.body });
    await flush();
    expect(screen.queryByText(/smart contract/i)).not.toBeNull();
  });
});
