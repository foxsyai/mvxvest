// Fourth audit (DT, 20 Oct 2026): "Claim all" refused as a whole while every
// key passes on its own: the page says the opposite and offers the same
// claim again.
//
// BlockingKeys handles a refusal that names no token by simulating each key
// alone ("Check each vesting on its own"). When every key passes alone, the
// refusal was about the whole transaction, not a key: a gas need above what
// one transaction may carry (prepare() simulates with the 600M cap, so the
// simulation itself fails and its words name no token: claim gas grows with
// the schedule it decodes, and 50 keys is a fixed split by count), or a
// passing network failure. `checked.blocked` is then empty, `checked.ok` is
// everything, and the component renders:
//   "Each of them is refused on its own too."  (false: each one passed)
//   "Claim the other 3"                        (the same three keys)
// The button starts the same claim, refused the same way, and the page loops.
// Nothing suggests the one thing that would work: fewer keys at once.
//
// Expected once fixed: the page says every key passes alone and offers to
// claim them in smaller groups (or one by one), never the same set again.

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

const vesting = (id: number) =>
  ({
    id,
    label: `Monthly ${id}`,
    token: 'FOXSY-5d5f3e',
    claimNonce: id
  }) as unknown as Vesting;
const three = [vesting(1), vesting(2), vesting(3)];

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => undefined);
};

beforeEach(() => {
  mockPrepare.mockReset();
  // Alone, every key passes the simulation.
  mockPrepare.mockImplementation(async (_sender: string, [tx]: any[]) => ({
    transactions: [tx],
    problems: [null]
  }));
});

describe('audit4 DT: a whole claim refused, each key fine alone', () => {
  it('does not say each key is refused, and does not offer the same claim again', async () => {
    const onClaim = jest.fn();
    render(
      <BlockingKeys
        problems={[
          'insufficient gas limit: gas needed 712000000, gas limit 600000000'
        ]}
        vestings={three}
        address={ALICE}
        collection='VESTKEY-f56bea'
        onClaim={onClaim}
      />
    );
    fireEvent.click(screen.getByText('Check each vesting on its own'));
    await flush();
    expect(mockPrepare).toHaveBeenCalledTimes(3);
    // Today: "Each of them is refused on its own too." and "Claim the other 3".
    expect(screen.queryByText(/Each of them is refused on its own/)).toBeNull();
    expect(screen.queryByText('Claim the other 3')).toBeNull();
    // What would help: every key passes alone; claim fewer at once.
    expect(
      screen.queryByText(
        /passes|pass on (its|their) own|fewer|smaller|one (at a time|by one)/i
      )
    ).not.toBeNull();
  });
});
