// "Claim all" refused in words that name no token: each key is checked on its
// own, the one that blocks is named, and the others can be claimed (red team
// RT7, the path its proof does not reach).

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Vesting } from 'vesting/client';
import { BlockingKeys } from '../BlockingKeys';

const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';

const mockPrepare = jest.fn();
jest.mock('chain/send', () => ({
  prepare: (...args: unknown[]) => mockPrepare(...args)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    claim: async (_address: string, _collection: string, nonces: number[]) => ({
      nonces
    })
  }
}));

const vesting = (id: number, label: string, token: string) =>
  ({ id, label, token, claimNonce: id }) as unknown as Vesting;
const salary = vesting(1, 'Salary', 'FOX-a1b2c3');
const bonus = vesting(3, 'Bonus', 'FOX-a1b2c3');
const airdrop = vesting(2, 'airdrop', 'EVIL-123456');

/** A paragraph's whole text: the label sits in its own element, quoted (fourth audit, WEB-9). */
const paragraph = (text: RegExp) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && text.test(element.textContent ?? '');

beforeEach(() => {
  mockPrepare.mockReset();
  // Only the airdrop's key is refused on its own.
  mockPrepare.mockImplementation(async (_sender: string, [tx]: any[]) => ({
    transactions: [tx],
    problems: [tx.nonces[0] === 2 ? 'action is not allowed' : null]
  }));
});

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => undefined);
};

it('checks each key on its own and offers the others', async () => {
  const onClaim = jest.fn();
  render(
    <BlockingKeys
      problems={['action is not allowed']}
      vestings={[salary, airdrop, bonus]}
      address={ALICE}
      collection='VESTKEY-f56bea'
      onClaim={onClaim}
    />
  );
  fireEvent.click(screen.getByText('Check each vesting on its own'));
  await flush();
  expect(mockPrepare).toHaveBeenCalledTimes(3);
  expect(
    screen.getByText(paragraph(/Vesting #2 “airdrop” blocks the others/))
  ).toBeTruthy();
  fireEvent.click(screen.getByText('Claim the other 2'));
  expect(onClaim).toHaveBeenCalledWith([salary, bonus]);
});

it('names the vesting at once when the refusal names its token', () => {
  render(
    <BlockingKeys
      problems={['ESDT token is frozen for EVIL-123456']}
      vestings={[salary, airdrop]}
      address={ALICE}
      collection='VESTKEY-f56bea'
      onClaim={() => undefined}
    />
  );
  expect(
    screen.getByText(paragraph(/Vesting #2 “airdrop” blocks/))
  ).toBeTruthy();
  expect(screen.getByText('Claim the other 1')).toBeTruthy();
  expect(mockPrepare).not.toHaveBeenCalled();
});
