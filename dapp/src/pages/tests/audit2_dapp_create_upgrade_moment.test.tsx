// Second audit: the Create page across the upgrade from contract version 1
// to version 2 (and any later change of the fees by the multisig).
//
// Create reads the contract's settings (EGLD fee, token fee, limits) once,
// when the page mounts, and again only after a transaction it sent has
// settled. A page opened before the upgrade keeps "no token fee, 50 per
// batch"; once the multisig has upgraded and voted `setTokenFee`, every
// creation from that page is built without the fee and refused by the
// network's simulation ("payment must equal the vested total plus the
// fee"). Closing the panel and checking again builds the same refused
// transaction, from the same stale settings: the reader is stuck, with
// "Fees: none" on screen, until they happen to reload. The page should read
// the settings again when the network refuses what they produced (or before
// each review), and say what changed.
//
// Also pinned here (safe): what an EGLD vesting shows and pays with both
// fees set.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const TOKEN = 'TFOX-d61b09';
const WRONG_DEPOSIT = 'payment must equal the vested total plus the fee';
const BATCH_SIZE = 'batch size out of range';

/** The contract as the multisig leaves it; changed mid-test for an upgrade. */
const contract = {
  bps: 0,
  fee: 0n,
  limits: { maxBatch: 50, maxBatchCancelable: 33 }
};
const createMock = jest.fn();
const createBatchMock = jest.fn();
const tokenFeeMock = jest.fn();
const balances = { egld: 10n ** 21n };

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  // The network's simulation, as the version 2 contract judges a creation:
  // the payment must carry the current token fee, a batch must fit.
  prepare: async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map((tx) =>
      tx.bps !== contract.bps
        ? WRONG_DEPOSIT
        : tx.count >
            (tx.cancelable
              ? contract.limits.maxBatchCancelable
              : contract.limits.maxBatch)
          ? BATCH_SIZE
          : null
    )
  }),
  send: jest.fn()
}));
jest.mock('chain/reads', () => ({
  balancesOf: async () => [
    {
      identifier: 'EGLD-000000',
      ticker: 'EGLD',
      name: 'EGLD',
      decimals: 18,
      balance: balances.egld
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
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => contract.fee,
    tokenFee: (...args: unknown[]) => tokenFeeMock(...args),
    creationPaused: async () => false,
    limits: async () => ({
      ...contract.limits,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: (...args: unknown[]) => createMock(...args),
    createBatch: (...args: unknown[]) => createBatchMock(...args)
  }
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

beforeEach(() => {
  contract.bps = 0;
  contract.fee = 0n;
  contract.limits = { maxBatch: 50, maxBatchCancelable: 33 };
  balances.egld = 10n ** 21n;
  createMock.mockReset();
  createBatchMock.mockReset();
  tokenFeeMock.mockReset();
  tokenFeeMock.mockImplementation(async () => contract.bps);
  // What the page built, kept on the fake transaction for the emulated
  // simulation: the rate it paid and the batch's size.
  createMock.mockImplementation(
    async (
      sender: string,
      _token: string,
      entry: any,
      cancelable: boolean,
      _label: string,
      _fee: bigint,
      bps?: number
    ) => ({
      sender,
      beneficiaries: [entry.beneficiary],
      cancelable,
      count: 1,
      bps: bps ?? 0,
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    })
  );
  createBatchMock.mockImplementation(
    async (
      sender: string,
      _token: string,
      entries: any[],
      cancelable: boolean,
      _label: string,
      _fee: bigint,
      bps?: number
    ) => ({
      sender,
      beneficiaries: entries.map((entry) => entry.beneficiary),
      cancelable,
      count: entries.length,
      bps: bps ?? 0,
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    })
  );
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const open = async () => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
};

const fill = async (token: string, lines: [string, string][]) => {
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: token }
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

describe('the Create page opened before the upgrade, used after it', () => {
  it('reads the settings again after the network refused the creation for its payment', async () => {
    // Version 1: no token fee, 50 per batch.
    await open();
    expect(tokenFeeMock).toHaveBeenCalledTimes(1);

    // The multisig upgrades to version 2 and votes setTokenFee 10 (0.1%).
    contract.bps = 10;
    contract.limits = { maxBatch: 49, maxBatchCancelable: 32 };

    await fill(TOKEN, [[A, '1000']]);
    // Still "Fees: none" on screen, from the settings read before.
    expect(feesShown()).toMatch(/none/);

    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    expect(createMock.mock.calls[0][6]).toBe(0);
    expect(screen.getByText(/The network would refuse/)).toBeTruthy();
    expect(screen.getByText(new RegExp(WRONG_DEPOSIT))).toBeTruthy();

    // The reader closes the panel and checks again: the page should by now
    // know the contract's current fee and build the creation with it.
    fireEvent.click(screen.getByText('Not now'));
    await flush();
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    expect(tokenFeeMock.mock.calls.length).toBeGreaterThan(1);
    expect(createMock.mock.calls[createMock.mock.calls.length - 1][6]).toBe(10);
    expect(feesShown()).toMatch(/0\.1% of each vesting/);
  });

  it('splits by the limits the contract has now, not the ones read before the upgrade', async () => {
    await open();
    contract.limits = { maxBatch: 49, maxBatchCancelable: 32 };

    // 50 beneficiaries from a CSV: one batch of 50 for version 1, two for
    // version 2.
    fireEvent.click(screen.getByText('From a CSV'));
    const lines = Array.from({ length: 50 }, (_, i) => `${A},${1000 + i}`).join(
      '\n'
    );
    fireEvent.change(screen.getByPlaceholderText(/address,amount/), {
      target: { value: `address,amount\n${lines}` }
    });
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: TOKEN }
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    await flush();

    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    expect(screen.getByText(new RegExp(BATCH_SIZE))).toBeTruthy();
    fireEvent.click(screen.getByText('Not now'));
    await flush();
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    const sizes = createBatchMock.mock.calls
      .slice(-2)
      .map((call) => (call[2] as unknown[]).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(49);
  });
});

describe('safe: an EGLD vesting with both fees', () => {
  it('safe: shows total + token fee + EGLD fee as what is paid, and counts all three against the balance', async () => {
    contract.bps = 10;
    contract.fee = 10n ** 17n;
    balances.egld = 1_000n * 10n ** 18n;
    await open();
    // 999 EGLD locked: 0.999 token fee and 0.1 EGLD fee make 1,000.099, more
    // than the 1,000 held.
    await fill('EGLD-000000', [[A, '999']]);
    // (Amount renders the figure and the ticker in two spans: no space.)
    expect(feesShown()).toMatch(/0\.999\s*EGLD \(0\.1% of each vesting\)/);
    expect(feesShown()).toMatch(/0\.1\s*EGLD \(0\.1 per vesting\)/);
    const paid = screen.getByText('You pay in EGLD').nextSibling as HTMLElement;
    expect(paid.textContent).toMatch(/1,000\.099\s*EGLD/);
    expect(
      screen.getByText(
        /does not hold enough EGLD for these vestings and the fees/
      )
    ).toBeTruthy();
    expect(
      (screen.getByText('Check and sign') as HTMLButtonElement).disabled
    ).toBe(true);

    // 900 EGLD: 900 + 0.9 + 0.1 = 901, which fits.
    fireEvent.change(screen.getAllByPlaceholderText(/^Amount/)[0], {
      target: { value: '900' }
    });
    await flush();
    expect(paid.textContent).toMatch(/901\s*EGLD/);
    expect(screen.queryByText(/does not hold enough EGLD/)).toBeNull();
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    // Built at the current rate, so the simulation passes.
    expect(createMock.mock.calls[createMock.mock.calls.length - 1][6]).toBe(10);
    expect(screen.getByText(/Checked with the network/)).toBeTruthy();
  });
});
