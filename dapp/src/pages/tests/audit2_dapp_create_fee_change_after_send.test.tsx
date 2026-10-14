// Second audit: a creation of several transactions, with the token fee
// changed by the multisig between them (the upgrade moment: `setTokenFee`
// lands while a creation's batches are still executing, or any later vote).
//
// The review is frozen when "Check and sign" is pressed, by design: what is
// signed is what was checked. The transactions after the change fail with
// "payment must equal the vested total plus the fee", and the page offers
// "Sign the remaining", which builds them again from the frozen rate: they
// can never go through. Two things go wrong around that dead end:
//
// 1. once the first transactions settled, the page reads the settings again
//    and the review's "Fees" row shows the NEW rate, while "Sign the
//    remaining" pays the OLD one: what is shown is not what is signed;
// 2. the lines that failed are offered no file. The CSV of the lines not
//    created exists only for a send that went missing; here the only way
//    out is "Start a new creation", which empties the form, and the creator
//    must work out by hand which lines were created.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const C = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const TOKEN = 'TFOX-d61b09';
const WRONG_DEPOSIT = 'payment must equal the vested total plus the fee';

const contract = { bps: 10 };
const createMock = jest.fn();
const sendMock = jest.fn();
const outcomeMock = jest.fn();
const mockDownloads: { name: string; text: string }[] = [];

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[], firstNonce?: bigint) => {
    const start = firstNonce ?? 42n;
    txs.forEach((tx, index) => {
      tx.nonce = start + BigInt(index);
    });
    return { transactions: txs, problems: txs.map(() => null) };
  },
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
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => contract.bps,
    creationPaused: async () => false,
    // One vesting per transaction, as review5_Create does.
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
jest.mock('vesting/csv', () => ({
  ...jest.requireActual('vesting/csv'),
  downloadFile: (name: string, text: string) =>
    mockDownloads.push({ name, text })
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

let outcomes: Record<string, any> = {};

beforeEach(() => {
  contract.bps = 10;
  outcomes = {};
  mockDownloads.length = 0;
  createMock.mockReset();
  sendMock.mockReset();
  outcomeMock.mockReset();
  createMock.mockImplementation(
    async (
      sender: string,
      _token: string,
      entry: any,
      _cancelable: boolean,
      _label: string,
      _fee: bigint,
      bps?: number
    ) => ({
      sender,
      beneficiaries: [entry.beneficiary],
      bps: bps ?? 0,
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    })
  );
  outcomeMock.mockImplementation(
    async (hash: string) => outcomes[hash] ?? { status: 'pending' }
  );
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

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

/** The "Fees" row of the review. */
const feesShown = () =>
  (screen.getByText('Fees').nextSibling as HTMLElement).textContent;

/**
 * Three vestings at 0.1%, signed and sent; A executes, then the multisig's
 * `setTokenFee 20` lands, and B and C fail for their payment. The panel's
 * poll sees it, the settings are read again.
 */
const sendAndFail = async () => {
  await fillForm([
    [A, '1000'],
    [B, '2000'],
    [C, '3000']
  ]);
  expect(feesShown()).toMatch(/0\.1% of each vesting/);
  sendMock.mockResolvedValueOnce({
    hashes: ['hash-A', 'hash-B', 'hash-C'],
    nextNonce: 45n
  });
  fireEvent.click(screen.getByText('Check and sign'));
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  expect(createMock.mock.calls.map((call) => call[6])).toEqual([10, 10, 10]);

  contract.bps = 20;
  outcomes = {
    'hash-A': { status: 'success' },
    'hash-B': { status: 'fail', reason: WRONG_DEPOSIT },
    'hash-C': { status: 'fail', reason: WRONG_DEPOSIT }
  };
  await wait(3_500);
  await flush();
  // Fixed: with the fees changed, "Sign the remaining" (which could only be
  // refused) gives way to a notice saying why, and the file.
  expect(screen.queryByText('Sign the remaining 2')).toBeNull();
  expect(screen.getByText(/fees or limits changed since/)).toBeTruthy();
};

describe('the token fee changed after the first transaction of a creation', () => {
  it('shows the rate the remaining transactions were frozen at, not the new one', async () => {
    await sendAndFail();
    // "Sign the remaining 2" pays 0.1% (the frozen review); the row above it
    // must say so, not 0.2%.
    expect(feesShown()).not.toMatch(/0\.2% of each vesting/);
    expect(feesShown()).toMatch(/0\.1% of each vesting/);
  }, 20_000);

  it('offers the file of the lines not created, as it does for a missing send', async () => {
    await sendAndFail();
    // The remaining two can never go through at the frozen rate; the lines
    // B and C must be available as a file for a new creation.
    fireEvent.click(screen.getByText('Download the lines not created (CSV)'));
    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0].text).toContain(B);
    expect(mockDownloads[0].text).toContain(C);
    expect(mockDownloads[0].text).not.toContain(A);
  }, 20_000);
});
