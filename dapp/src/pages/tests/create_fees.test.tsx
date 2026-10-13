// Contract version 2: Create shows the token fee next to the EGLD fee and
// what the creator pays in all, and counts it in the balance check
// (DECISIONS.md #10). The amounts are the contract's: per vesting, rounded
// down.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const mockBalance = { current: 10n ** 30n };

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/reads', () => ({
  balancesOf: async () => [
    {
      identifier: 'EGLD-000000',
      ticker: 'EGLD',
      name: 'EGLD',
      decimals: 18,
      balance: 10n ** 21n
    },
    {
      identifier: 'TFOX-d61b09',
      ticker: 'TFOX',
      name: 'TFOX',
      decimals: 18,
      balance: mockBalance.current
    }
  ],
  createdIdsOf: async () => [],
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 10n ** 17n,
    tokenFee: async () => 100,
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

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

beforeEach(() => {
  mockBalance.current = 10n ** 30n;
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const fill = async (amount: string) => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: 'TFOX-d61b09' }
  });
  fireEvent.change(screen.getByPlaceholderText('erd1... beneficiary address'), {
    target: { value: A }
  });
  fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
    target: { value: amount }
  });
  await flush();
};

describe('Create with the token fee set', () => {
  it('shows 1% of each vesting, the EGLD fee and what is paid in all', async () => {
    await fill('1000');
    // 1% of 1,000 TFOX, and 0.1 EGLD per vesting.
    expect(screen.getByText(/1% of each vesting/)).toBeTruthy();
    expect(screen.getByText(/per vesting/)).toBeTruthy();
    expect(screen.getByText('You pay in TFOX')).toBeTruthy();
    const paid = screen.getByText('You pay in TFOX').nextSibling as HTMLElement;
    expect(paid.textContent).toMatch(/1,010/);
  });

  it('counts the fee in the balance check', async () => {
    // 1,005 TFOX held: enough for the 1,000 locked, not with the 10 fee.
    mockBalance.current = 1_005n * 10n ** 18n;
    await fill('1000');
    expect(
      screen.getByText(
        /does not hold enough TFOX for these vestings and the fees/
      )
    ).toBeTruthy();
  });
});
