// Fourth adversarial review: the Create page after 2223f82 (missing-first
// ordering in signRemaining), end to end with the chain mocked out, as in
// review3_Create (one vesting per transaction).
//
// signRemaining() signs a "not found" transaction again "at a nonce read from
// the network: its nonce, which is still free. The node takes one transaction
// per nonce, so the copy and the lost one can never both execute." Nothing
// checks that. The verdict "not found" is final: the panel stops following
// the hash once every hash has an outcome, and the "Sign the remaining" panel
// takes whatever nonce the network has when it is checked (firstNonce is
// undefined when something is missing). If the lost transaction turns up and
// executes after the verdict and before that check (the very case the nonce
// reuse is there for), the network's nonce is already past it: the copy is
// prepared, shown and signed at the next nonce, and executes too. The page
// still says "not found on the network: it did not go through" for the
// original. The vesting is created twice.
//
// (The same hole between the check and the wallet prompt, where sdk-dapp's
// refreshAccount moves the copy to the next nonce by itself:
// chain/tests/review4_send.)

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const TOKEN = 'TFOX-d61b09';

const prepareMock = jest.fn();
const sendMock = jest.fn();
const createMock = jest.fn();
const outcomeMock = jest.fn();

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
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => 0,
    creationPaused: async () => false,
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

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

let outcomes: Record<string, any> = {};
/** The sender's account nonce on the network (for the emulated prepare). */
let accountNonce = 42n;

beforeEach(() => {
  outcomes = {};
  accountNonce = 42n;
  prepareMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
  outcomeMock.mockReset();
  // As chain/send's prepare(): nonces from the account's nonce, or from
  // firstNonce when that is higher.
  prepareMock.mockImplementation(
    async (_sender: string, txs: any[], firstNonce?: bigint) => {
      const start =
        firstNonce !== undefined && firstNonce > accountNonce
          ? firstNonce
          : accountNonce;
      txs.forEach((tx, index) => {
        tx.nonce = start + BigInt(index);
      });
      return { transactions: txs, problems: txs.map(() => null) };
    }
  );
  createMock.mockImplementation(
    async (sender: string, _token: string, entry: any) => ({
      sender,
      beneficiaries: [entry.beneficiary],
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    })
  );
  outcomeMock.mockImplementation(
    async (hash: string) => outcomes[hash] ?? { status: 'pending' }
  );
});

afterEach(() => jest.restoreAllMocks());

describe('review4: a "not found" transaction that turned up', () => {
  it('is not signed again at the next nonce, where both execute', async () => {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);

    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: TOKEN }
    });
    fireEvent.change(
      screen.getByPlaceholderText('erd1... beneficiary address'),
      { target: { value: A } }
    );
    fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
      target: { value: '1000' }
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    await flush();

    // A is signed at 42; every POST timed out (unconfirmed).
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A'],
      unconfirmed: ['hash-A'],
      nextNonce: 43n
    });
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(String(sendMock.mock.calls[0][0][0].nonce)).toBe('42');

    // The API has not heard of it for two minutes: "not found".
    outcomes = { 'hash-A': { status: 'pending', unknown: true } };
    await wait(3_500);
    skew = 121_000;
    await wait(3_500);
    await flush();
    expect(screen.getByText(/not found on the network/)).toBeTruthy();

    // Then it turns up and executes at 42: the network's nonce is 43, the
    // API knows the hash. The page no longer asks.
    accountNonce = 43n;
    outcomes = { 'hash-A': { status: 'success' } };
    await wait(3_500);
    await flush();

    const offered = screen.queryByText('Sign the remaining 1');
    if (offered) {
      fireEvent.click(offered);
      await flush();
      const sign = screen.queryByText('Sign in your wallet');
      if (sign) {
        sendMock.mockResolvedValueOnce({ hashes: ['hash-A2'], nextNonce: 44n });
        fireEvent.click(sign);
        await flush();
      }
    }

    // Either A is not signed again, or only at its own nonce 42 (refused by
    // the node). Today: signed again at 43, where it executes: A twice.
    const copies = sendMock.mock.calls
      .slice(1)
      .flatMap((call) => call[0])
      .filter((tx: any) => tx.beneficiaries[0] === A)
      .map((tx: any) => String(tx.nonce));
    expect(copies.filter((nonce) => nonce !== '42')).toEqual([]);
  }, 30_000);
});
