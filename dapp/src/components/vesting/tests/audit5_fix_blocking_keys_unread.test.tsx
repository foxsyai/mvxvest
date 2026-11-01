// Fifth audit, VSD-09 with RT-1: since a check that could not run is thrown
// instead of being called a refusal, "Check each vesting on its own" must not
// call the key it could not check the key that blocks the others.

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Vesting } from 'vesting/client';
import { BlockingKeys } from '../BlockingKeys';

const mockPrepare = jest.fn();
jest.mock('chain/send', () => ({
  prepare: (...args: unknown[]) => mockPrepare(...args)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    claim: async (_address: string, _collection: string, nonces: number[]) => ({
      nonce: nonces[0]
    })
  }
}));

const vesting = (id: number, token: string) =>
  ({ id, label: '', token, claimNonce: id }) as unknown as Vesting;

it('a key it could not check is said to be unchecked, and can be checked again', async () => {
  mockPrepare.mockImplementation(async (_sender: string, [tx]: any[]) => {
    if (tx.nonce === 2) throw new Error('The network could not check this');
    return { transactions: [tx], problems: [null] };
  });
  const onClaim = jest.fn();
  render(
    <BlockingKeys
      problems={['something the words of which name no token']}
      vestings={[vesting(1, 'AAA-111111'), vesting(2, 'BBB-222222')]}
      address='erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
      collection='VESTKEY-f56bea'
      onClaim={onClaim}
    />
  );
  fireEvent.click(screen.getByText('Check each vesting on its own'));
  for (let i = 0; i < 6; i++) await act(async () => undefined);
  expect(document.body.textContent).not.toMatch(/blocks? the others/);
  expect(document.body.textContent).toMatch(/could not be checked/);
  expect(screen.getByText('Check each vesting on its own')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Each of them passes/);
});
