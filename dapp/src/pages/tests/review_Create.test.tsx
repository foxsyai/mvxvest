// Adversarial review: the Create page and its signing panel, end to end with
// the chain mocked out.
//
// 1. After the vestings are sent, the app's own "mvxvest:settled" event (fired
//    by chain/send.ts 8 s and 18 s after sending, and on success or failure)
//    reloads Create's useAsync reads; the re-render hands TxPanel a new
//    `build` (`batches` is rebuilt every render), TxPanel runs check() again
//    and throws away the "Sent. Following the result" state: the same
//    vestings are offered for signing again, and the created ids never show.
//    A second "Sign in your wallet" creates every vesting twice.
// 2. While the panel is open the form stays editable, and the panel keeps
//    building from whatever lines parse: a line broken after opening the
//    panel is silently left out, and Sign stays enabled though the page
//    itself says the form is not ready.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const TOKEN = 'TFOX-d61b09';

const prepareMock = jest.fn();
const sendMock = jest.fn();
const createMock = jest.fn();
const createBatchMock = jest.fn();

// sdk-dapp's account store, reduced to what matters here: signing calls
// refreshAccount() and setAccountNonce(), which hand useGetAccount() a new
// object, and every component using it re-renders.
const mockAccountStore = {
  version: 0,
  listeners: new Set<() => void>(),
  bump() {
    mockAccountStore.version++;
    mockAccountStore.listeners.forEach((listener) => listener());
  }
};
jest.mock('lib', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  return {
    useGetAccount: () => {
      const nonce = useSyncExternalStore(
        (listener: () => void) => {
          mockAccountStore.listeners.add(listener);
          return () => mockAccountStore.listeners.delete(listener);
        },
        () => mockAccountStore.version
      );
      return { address: SENDER, nonce };
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
  createdIdsOf: async () => [],
  // The network has not answered yet: the panel keeps following.
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
    }),
    create: (...args: unknown[]) => createMock(...args),
    createBatch: (...args: unknown[]) => createBatchMock(...args)
  }
}));

const fakeTx = (beneficiaries: string[]) =>
  ({
    beneficiaries,
    data: new Uint8Array(100),
    gasLimit: 50_000_000n
  }) as any;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

beforeEach(() => {
  jest.useRealTimers();
  prepareMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
  createBatchMock.mockReset();
  prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }));
  createMock.mockImplementation(
    async (_sender: string, _token: string, entry: any) =>
      fakeTx([entry.beneficiary])
  );
  createBatchMock.mockImplementation(
    async (_sender: string, _token: string, entries: any[]) =>
      fakeTx(entries.map((entry) => entry.beneficiary))
  );
  sendMock.mockResolvedValue({ hashes: ['hash-of-the-first-signing'] });
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

describe('review: Create page signing panel', () => {
  it('after sending, the settled event does not offer the same vestings for signing again', async () => {
    await fillForm([[A, '1000']]);
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Sent\. Following the result/)).toBeTruthy();

    // What chain/send.ts dispatches 8 s after sending (and on success/fail).
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('mvxvest:settled', {
          detail: { addresses: [SENDER] }
        })
      );
    });
    await flush();

    // Today: the panel has gone back to "Checked with the network: it would
    // go through" with an enabled "Sign in your wallet" for the same vesting,
    // and "Sent. Following the result" is gone. A creator who takes that at
    // its word signs again:
    const again = screen.queryByText('Sign in your wallet');
    if (again) {
      fireEvent.click(again);
      await flush();
    }
    // Each vesting must be signed once. Today: [[A], [A]].
    expect(
      sendMock.mock.calls.map((call) =>
        call[0].flatMap((tx: any) => tx.beneficiaries)
      )
    ).toEqual([[A]]);
  });

  it('after sending, the panel keeps following the result', async () => {
    await fillForm([[A, '1000']]);
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mvxvest:settled'));
    });
    await flush();
    expect(screen.queryByText(/Sent\. Following the result/)).toBeTruthy();
  });

  it('signing itself (which refreshes the account store) does not re-arm the panel', async () => {
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    // The first check answers at once; any later one takes a network round
    // trip (getAccount, then a simulation per transaction).
    let checks = 0;
    prepareMock.mockImplementation(async (_sender: string, txs: any[]) => {
      if (checks++ > 0) await wait(30);
      return { transactions: txs, problems: txs.map(() => null) };
    });
    // What send() goes through: sdk-dapp signs (refreshAccount, then
    // setAccountNonce: the account store changes), then POSTs (one round
    // trip, shorter than a check).
    sendMock.mockImplementation(async () => {
      mockAccountStore.bump();
      await wait(5);
      return { hashes: ['hash-of-the-first-signing'] };
    });

    await fillForm([[A, '1000']]);
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await act(async () => {
      await wait(100);
    });

    // Today, about a second after signing on the real network: "Checked with
    // the network: it would go through." and "Sign in your wallet" again.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/it would go through/)).toBeNull();
    expect(screen.queryByText(/Sent\. Following the result/)).toBeTruthy();
    expect(screen.queryByText('Sign in your wallet')).toBeNull();
  });

  it('a line broken after the panel opened is not silently left out of what is signed', async () => {
    await fillForm([
      [A, '1000'],
      [B, '2000']
    ]);
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();

    // The creator edits the second address with the panel open (a typo).
    fireEvent.change(
      screen.getAllByPlaceholderText('erd1... beneficiary address')[1],
      { target: { value: B.slice(0, -1) } }
    );
    await flush();
    // The page knows the form is broken...
    expect(screen.getByText(/Fix these lines first/)).toBeTruthy();

    // ...but the panel is ready to sign whatever still parses.
    const sign = screen.queryByText('Sign in your wallet') as HTMLButtonElement;
    if (sign && !sign.disabled) {
      fireEvent.click(sign);
      await flush();
    }
    const signed = sendMock.mock.calls.flatMap((call) =>
      call[0].flatMap((tx: any) => tx.beneficiaries)
    );
    // Either nothing is signed while the form has errors, or both lines are.
    expect(signed.length === 0 || signed.length === 2).toBe(true);
  });
});
