// Second adversarial review: the Create page after the fixes of 3d35c88, end
// to end with the chain mocked out. Two vestings in two transactions (the
// contract's batch limit is mocked to 1), the first accepted by the network,
// the second refused (a partial send, which the fix handles with "Sign the
// remaining N").
//
// 1. "Sign the remaining N" sets `sending: false`. The new panel's "Not now"
//    (or "Close" after a wallet refusal or a failed check) then calls
//    setReview(null): the review and what was already sent are forgotten, the
//    form unlocks with every line still in it, and "Check and sign" signs ALL
//    the vestings again, the created ones included.
// 2. The panel for the remaining batches shows the review's totals: "Locks
//    3,000 TFOX in 2 vestings" while it signs one vesting of 2,000.
// 3. "Sign the remaining N" replaces the first panel (its key changes) before
//    it has followed its transactions to their end: the ids they created never
//    reach "Created N vestings", and their explorer links disappear.
// 4. A wallet that changes account between a partial send and "Sign the
//    remaining N" signs the remaining batches from the new account with the
//    nonce computed for the old one (review.nextNonce is not tied to a sender).
// 5. "Every N days" with a large number of releases passes planProblem; the
//    preview then formats a date outside what Date can hold and the whole app
//    unmounts (no error boundary): the class of crash fixed for NaN in #9.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const OTHER = 'erd1sdslvlxvfnnflzj42l8czrcngq3xjjzkjp3rgul4ttk6hntr4qdsv6sets';
const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const TOKEN = 'TFOX-d61b09';

const prepareMock = jest.fn();
const sendMock = jest.fn();
const createMock = jest.fn();
const outcomeMock = jest.fn();
const createdIdsMock = jest.fn();

// The connected account, switchable from a test.
const mockAccount = {
  address: SENDER,
  listeners: new Set<() => void>(),
  switchTo(address: string) {
    mockAccount.address = address;
    mockAccount.listeners.forEach((listener) => listener());
  }
};
jest.mock('lib', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  return {
    useGetAccount: () => {
      const address = useSyncExternalStore(
        (listener: () => void) => {
          mockAccount.listeners.add(listener);
          return () => mockAccount.listeners.delete(listener);
        },
        () => mockAccount.address
      );
      return { address };
    },
    useGetIsLoggedIn: () => true
  };
});
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  prepare: (...args: unknown[]) => prepareMock(...args),
  send: (...args: unknown[]) => sendMock(...args)
}));
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
      balance: 10n ** 30n
    }
  ],
  createdIdsOf: (hash: string) => createdIdsMock(hash),
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => 0,
    creationPaused: async () => false,
    // One vesting per transaction: two lines make two transactions.
    limits: async () => ({
      maxBatch: 1,
      maxBatchCancelable: 1,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: (...args: unknown[]) => createMock(...args),
    createBatch: () => {
      throw new Error('unused: one vesting per transaction');
    }
  }
}));

const fakeTx = (sender: string, beneficiaries: string[]) =>
  ({
    sender,
    beneficiaries,
    data: new Uint8Array(100),
    gasLimit: 50_000_000n
  }) as any;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** What the network accepted: the first of the two transactions. */
const PARTIAL = {
  hashes: ['hash-1'],
  stopped: { at: 1, reason: 'Too Many Requests' },
  nextNonce: 43n
};

let settled = false;

beforeEach(() => {
  mockAccount.address = SENDER;
  settled = false;
  prepareMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
  outcomeMock.mockReset();
  createdIdsMock.mockReset();
  prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }));
  createMock.mockImplementation(
    async (sender: string, _token: string, entry: any) =>
      fakeTx(sender, [entry.beneficiary])
  );
  outcomeMock.mockImplementation(async () =>
    settled ? { status: 'success' } : { status: 'pending' }
  );
  createdIdsMock.mockImplementation(async (hash: string) =>
    hash === 'hash-1' ? [101] : hash === 'hash-2' ? [102] : []
  );
});

const fillForm = async (lines: [string, string][]) => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: TOKEN }
  });
  lines.forEach(([address, amount], index) => {
    if (index > 0) fireEvent.click(screen.getByText('Add a beneficiary'));
    fireEvent.change(
      screen.getAllByPlaceholderText('erd1... beneficiary address')[index],
      { target: { value: address } }
    );
    fireEvent.change(screen.getAllByPlaceholderText(/^Amount/)[index], {
      target: { value: amount }
    });
  });
  fireEvent.click(screen.getByText('Cannot be cancelled'));
  await flush();
};

/** Two vestings, two transactions; the network takes only the first. */
const partialSend = async () => {
  await fillForm([
    [A, '1000'],
    [B, '2000']
  ]);
  sendMock.mockResolvedValueOnce(PARTIAL);
  fireEvent.click(screen.getByText('Check and sign'));
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  expect(screen.getByText('Sign the remaining 1')).toBeTruthy();
};

const signedBeneficiaries = (calls: any[][]) =>
  calls.flatMap((call) => call[0].flatMap((tx: any) => tx.beneficiaries));

describe('review2: Create after a partial send', () => {
  it('"Not now" on the remaining batches does not re-arm the vestings already created', async () => {
    await partialSend();
    sendMock.mockResolvedValue({
      hashes: ['hash-2', 'hash-3'],
      nextNonce: 45n
    });

    fireEvent.click(screen.getByText('Sign the remaining 1'));
    await flush();
    // The creator wants to look at the created vesting first.
    fireEvent.click(screen.getByText('Not now'));
    await flush();

    // Today: the review is gone, the form is unlocked with both lines, and
    // "Check and sign" builds both vestings again.
    const again = screen.queryByText('Check and sign') as HTMLButtonElement;
    if (again && !again.disabled) {
      fireEvent.click(again);
      await flush();
      const sign = screen.queryByText('Sign in your wallet');
      if (sign) {
        fireEvent.click(sign);
        await flush();
      }
    }
    // Vesting A was accepted by the network in the first signing: it must
    // never be signed again. Today: [A, B] signed a second time.
    expect(signedBeneficiaries(sendMock.mock.calls.slice(1))).not.toContain(A);
  });

  it('the panel for the remaining batches shows what they lock, not the whole review', async () => {
    await partialSend();
    fireEvent.click(screen.getByText('Sign the remaining 1'));
    await flush();
    const summary = screen.getByText(/The remaining 1 of 2 transactions/)
      .textContent as string;
    // It signs one vesting of 2,000 TFOX (B). Today: "The remaining 1 of 2
    // transactions: Locks 3,000 TFOX in 2 vestings that cannot be cancelled,
    // in 2 transactions."
    expect(summary).not.toMatch(/3,000/);
    expect(summary).toMatch(/2,000/);
  });

  it('the vestings of the first signing still show as created after "Sign the remaining"', async () => {
    await partialSend();
    // The creator goes on at once, as the button invites.
    fireEvent.click(screen.getByText('Sign the remaining 1'));
    await flush();
    sendMock.mockResolvedValueOnce({ hashes: ['hash-2'], nextNonce: 44n });
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    // Both transactions are now final on chain.
    settled = true;
    await wait(3_500);
    await flush();

    // Vesting #101 (hash-1) and #102 (hash-2) were both created. Today only
    // "Created 1 vesting: #102": the first panel was unmounted while it was
    // still following hash-1.
    expect(screen.getByText(/Created 2 vestings/)).toBeTruthy();
    expect(screen.getByText('#101')).toBeTruthy();
  });

  it("a wallet that changed account does not sign the rest with the old account's nonce", async () => {
    await partialSend();
    // xPortal (or a disconnect and connect) now holds another account.
    await act(async () => mockAccount.switchTo(OTHER));
    await flush();
    const sign = screen.queryByText('Sign the remaining 1');
    if (sign) {
      fireEvent.click(sign);
      await flush();
    }
    // PARTIAL.nextNonce (43) belongs to SENDER. Today prepare(OTHER, ..., 43n)
    // is called: OTHER's transactions get SENDER's next nonce, a gap (they
    // wait in the mempool, "processing" for ever) or a refusal.
    const mixed = prepareMock.mock.calls.filter(
      ([sender, , firstNonce]) => sender === OTHER && firstNonce === 43n
    );
    expect(mixed).toHaveLength(0);
  });
});

describe('review2: Create preview with large numbers', () => {
  it('"Every N days" with a very large number of releases does not crash the page', async () => {
    await fillForm([[A, '1000']]);
    fireEvent.change(screen.getByDisplayValue(/Every second \(linear\)/), {
      target: { value: 'days' }
    });
    await flush();
    // One zero too many in "Number of releases": 30 days x 100,000,000 ends
    // about 8 million years from now, a whole number of seconds (planProblem
    // and validateSchedule's isTime accept it) but past the largest Date.
    // Today: RangeError: Invalid time value (formatDay in ScheduleChart) and
    // the whole app unmounts, the form with it.
    let error: unknown;
    try {
      fireEvent.change(screen.getByDisplayValue('24'), {
        target: { value: '100000000' }
      });
      await flush();
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeUndefined();
    expect(screen.queryByText('Create vestings')).toBeTruthy();
  });

  it('"Every N months" with a very large interval does not crash the page', async () => {
    await fillForm([[A, '1000']]);
    fireEvent.change(screen.getByDisplayValue(/Every second \(linear\)/), {
      target: { value: 'months' }
    });
    await flush();
    // 100,000,000 months: addMonths returns NaN (beyond Date), planProblem
    // only checks that the count is a whole number, the chart formats NaN.
    let error: unknown;
    try {
      fireEvent.change(screen.getByDisplayValue('1'), {
        target: { value: '100000000' }
      });
      await flush();
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeUndefined();
    expect(screen.queryByText('Create vestings')).toBeTruthy();
  });
});
