// Fourth audit (DT-8, reported unproven; proven here): a label of fewer than
// 64 characters but more than 64 bytes (accents and emoji take two to four
// bytes each) disables "Check and sign" with only the counter under the field
// ("70/64 bytes") to say why. Every other reason the button is off has a
// notice in step 5; this one should too.

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

describe('audit4 DT: a label over 64 bytes', () => {
  it('says why "Check and sign" is off when the label is too long in bytes', async () => {
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
      { target: { value: A } }
    );
    fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
      target: { value: '1000' }
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    // 35 characters, 70 bytes: every "ș" is two bytes in UTF-8.
    const label = 'ș'.repeat(35);
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: label }
    });
    await flush();
    expect(
      (screen.getByText('Check and sign') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(screen.queryByText(/label is (too long|longer)/i)).not.toBeNull();
  });
});
