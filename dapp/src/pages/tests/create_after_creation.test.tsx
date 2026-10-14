// Found while retaking the guide's pictures (14 Oct 2026), with a fresh demo
// wallet in shard 2 and the contract in shard 0:
// 1. The creation was done, but "Created N vestings" never appeared: the
//    page read the created ids once, as soon as the transaction showed
//    success, before the API had the cross-shard result's logs, and never
//    again.
// 2. The page then said "This wallet does not hold enough TFOX for these
//    vestings and the fees": the balance had dropped because the vestings were
//    just paid for, and the form was judged as if about to create them again.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const TOKEN = 'TFOX-d61b09';
const UNIT = 10n ** 18n;

const sendMock = jest.fn();
const createdIdsMock = jest.fn();
const chain = { settled: false, tfox: 1_500n * UNIT };

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: SENDER }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }),
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
      balance: chain.tfox
    }
  ],
  createdIdsOf: (hash: string) => createdIdsMock(hash),
  outcomeOf: async () =>
    chain.settled ? { status: 'success' } : { status: 'pending' }
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => 10,
    creationPaused: async () => false,
    limits: async () => ({
      maxBatch: 49,
      maxBatchCancelable: 32,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: async (sender: string) =>
      ({ sender, data: new Uint8Array(100), gasLimit: 50_000_000n }) as any,
    createBatch: async (sender: string) =>
      ({ sender, data: new Uint8Array(100), gasLimit: 50_000_000n }) as any
  }
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  chain.settled = false;
  chain.tfox = 1_500n * UNIT;
  sendMock.mockReset();
  sendMock.mockResolvedValue({ hashes: ['hash-1'] });
  createdIdsMock.mockReset();
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

it('says what it created even when the ids reach the API late, and does not judge the done creation against the new balance', async () => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: TOKEN }
  });
  fireEvent.change(screen.getByPlaceholderText('erd1... beneficiary address'), {
    target: { value: A }
  });
  fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
    target: { value: '1000' }
  });
  fireEvent.click(screen.getByText('Cannot be cancelled'));
  await flush();
  fireEvent.click(screen.getByText('Check and sign'));
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();

  // The network runs it: 1,001 TFOX leave the wallet; the API knows the
  // transaction succeeded before it has the result's logs.
  chain.tfox = 499n * UNIT;
  chain.settled = true;
  let reads = 0;
  createdIdsMock.mockImplementation(async () => (++reads < 2 ? [] : [101]));
  await wait(3_500);
  await flush();
  await wait(3_500);
  await flush();

  expect(screen.getByText(/Transaction 1:/).parentElement!.textContent).toMatch(
    /done/
  );
  expect(screen.getByText(/Created 1 vesting/)).toBeTruthy();
  expect(screen.queryByText(/does not hold enough/)).toBeNull();
}, 20_000);
