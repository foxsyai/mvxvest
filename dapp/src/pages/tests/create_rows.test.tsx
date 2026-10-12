// A beneficiary line typed one by one is judged when the reader leaves it,
// not while they are still in it (Sebastian, devnet test, 12 Oct 2026).

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';

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
      identifier: 'TFOX-d61b09',
      ticker: 'TFOX',
      name: 'TFOX',
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
};

describe('beneficiaries typed one by one', () => {
  it('a line is not judged while the reader is still in it', async () => {
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: 'TFOX-d61b09' }
    });
    fireEvent.change(
      screen.getByPlaceholderText('erd1... beneficiary address'),
      {
        target: { value: A }
      }
    );
    fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
      target: { value: '100' }
    });
    fireEvent.click(screen.getByText('Add a beneficiary'));
    const [, address] = screen.getAllByPlaceholderText(
      'erd1... beneficiary address'
    );
    const [, amount] = screen.getAllByPlaceholderText(/^Amount/);
    fireEvent.change(address, { target: { value: B } });
    // Tab from the address to the amount of the same line: still in it.
    fireEvent.blur(address, { relatedTarget: amount });
    await flush();
    expect(screen.queryByText(/Fix these lines first/)).toBeNull();
    expect(screen.getByText(/Finish line 2/)).toBeTruthy();

    // Leaving the line without an amount: now it is said, plainly.
    fireEvent.blur(amount, { relatedTarget: document.body });
    await flush();
    expect(screen.getByText(/Line 2: The amount is missing\./)).toBeTruthy();

    // Completing it clears it.
    fireEvent.change(amount, { target: { value: '200' } });
    await flush();
    expect(screen.queryByText(/Fix these lines first/)).toBeNull();
  });

  it('every line can be removed; the last one is emptied', async () => {
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: 'TFOX-d61b09' }
    });
    fireEvent.change(
      screen.getByPlaceholderText('erd1... beneficiary address'),
      {
        target: { value: A }
      }
    );
    fireEvent.click(screen.getByText('Add a beneficiary'));
    fireEvent.change(
      screen.getAllByPlaceholderText('erd1... beneficiary address')[1],
      { target: { value: B } }
    );
    fireEvent.click(screen.getAllByText('Remove')[0]);
    await flush();
    expect(screen.getByDisplayValue(B)).toBeTruthy();
    fireEvent.click(screen.getByText('Remove'));
    await flush();
    expect(screen.queryByDisplayValue(B)).toBeNull();
    expect(
      screen.getAllByPlaceholderText('erd1... beneficiary address')
    ).toHaveLength(1);
  });
});
