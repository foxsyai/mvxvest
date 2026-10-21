// Fourth audit (DT, 20 Oct 2026): Create with a failed read of the contract's
// settings says "Fees: none"; with a failed read of the wallet it reads the
// wallet for ever.
//
// 1. Create reads the fee, the token fee, the pause flag and the limits in
//    one useAsync (`settings`). `client.fee()`, `tokenFee()` and
//    `creationPaused()` throw on a refused or timed-out read (rightly: a
//    guessed fee builds a payment the contract refuses). The page then falls
//    back to `fee = 0n` and `tokenFeeBps = 0` for everything it shows: the
//    review box says "Fees: none" on mainnet, where the fees are 0.1% plus
//    0.1 EGLD per vesting, and "Transactions to sign" is counted with the
//    default limits. "Check and sign" is disabled (ready needs
//    settings.data), but nothing says why, and nothing offers to read again:
//    useAsync only re-runs on a dependency change or after one of this tab's
//    transactions settles. A creator preparing a large creation plans with
//    "Fees: none" in front of them until they reload by chance.
// 2. The wallet's balances (`balances`) have no error branch either: a failed
//    read shows "Reading your wallet..." for ever, no retry.
//
// Both reads fail under the public API's rate limit, which a page start can
// trip on its own (chain/network.ts).
//
// Expected once fixed: a failed read of the settings or the wallet is said
// ("could not read...") with a "Try again", and no fee figure is shown as
// "none" while the fees are unknown.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

const mockBalances = jest.fn();
const mockFee = jest.fn();

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
  balancesOf: (...args: unknown[]) => mockBalances(...args),
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'FOXSY',
    decimals: 18,
    verified: true
  }),
  createdIdsOf: async () => [],
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: () => mockFee(),
    tokenFee: async () => 10,
    creationPaused: async () => false,
    limits: async () => ({
      maxBatch: 49,
      maxBatchCancelable: 32,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    })
  }
}));

const balances = [
  {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18,
    balance: 10n ** 21n
  },
  {
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'FOXSY',
    decimals: 18,
    balance: 10n ** 24n
  }
];

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

beforeEach(() => {
  mockBalances.mockReset();
  mockFee.mockReset();
  mockBalances.mockResolvedValue(balances);
  mockFee.mockResolvedValue(10n ** 17n);
});

describe('audit4 DT: Create when a read fails', () => {
  it('does not say "Fees: none" when the fees could not be read, and offers to read again', async () => {
    // The public API refuses the query (rate limit); `cached` gave up.
    mockFee.mockRejectedValue(new Error('/query answered 429'));
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: 'FOXSY-5d5f3e' }
    });
    fireEvent.change(
      screen.getByPlaceholderText('erd1... beneficiary address'),
      {
        target: { value: A }
      }
    );
    fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
      target: { value: '1000' }
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    await flush();

    const feesValue =
      screen.getByText('Fees').parentElement?.querySelector('dd')
        ?.textContent ?? '';
    // Today: "none".
    expect(feesValue.trim()).not.toBe('none');
    expect(
      screen.queryByText(/could not (be )?read|Try again/i)
    ).not.toBeNull();
  });

  it('says so when the wallet could not be read, instead of reading it for ever', async () => {
    mockBalances.mockRejectedValue(
      new Error(
        '/accounts/erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd answered 429'
      )
    );
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    // Today: "Reading your wallet..." with nothing else, for ever.
    expect(
      screen.queryByText(/could not (be )?read|Try again/i)
    ).not.toBeNull();
  });
});
