// Fifth audit, VSD-09 in the fixer's words: what the proof leaves open. A check
// that could not run must never read as a refusal, and a refusal must never
// read as a check that could not run: a contract's words can hold any number.

import { Address, Transaction } from '@multiversx/sdk-core';
import { prepare } from '../send';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const estimateMock = jest.fn();
const accountMock = jest.fn();

jest.mock('../network', () => ({
  api: async () => ({ isGuarded: false }),
  forget: () => undefined,
  networkProvider: {
    getAccount: () => accountMock(),
    estimateTransactionCost: (tx: unknown) => estimateMock(tx)
  }
}));
jest.mock('../missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock(
  '@multiversx/sdk-dapp/out/store/actions/account/accountActions',
  () => ({ setAccountNonce: () => undefined })
);
jest.mock('lib', () => ({
  getAccountProvider: () => ({}),
  TransactionManager: { getInstance: () => ({}) }
}));

const claimTx = () =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 0n,
    chainID: 'D',
    nonce: 0n,
    data: new TextEncoder().encode('claim')
  });
const transport = (inner: string) =>
  new Error(`Request error on url [transaction/cost]: [${inner}]`);

beforeEach(() => {
  estimateMock.mockReset();
  accountMock.mockReset();
  accountMock.mockResolvedValue({ nonce: 42n });
});

describe('a simulation that keeps not running', () => {
  it.each([
    'Request failed with status code 429',
    'Request failed with status code 503',
    'timeout of 15000ms exceeded',
    'Network Error'
  ])(
    '%s is thrown, to be checked again, never a problem',
    async (inner) => {
      estimateMock.mockRejectedValue(transport(inner));
      await expect(prepare(SENDER, [claimTx()])).rejects.toThrow(
        /check again/i
      );
    },
    15_000
  );
});

describe('a nonce complaint', () => {
  it('reads the nonce again before asking again', async () => {
    accountMock
      .mockResolvedValueOnce({ nonce: 42n })
      .mockResolvedValue({ nonce: 43n });
    estimateMock
      .mockRejectedValueOnce(transport('lower nonce in transaction'))
      .mockResolvedValue({ gasLimit: 10_000_000 });
    const { problems, transactions } = await prepare(SENDER, [claimTx()]);
    expect(problems).toEqual([null]);
    expect(transactions[0].nonce).toBe(43n);
  });
});

describe('a refusal stays a refusal', () => {
  it.each([
    'execution failed: user error: 429 keys is too many',
    'execution failed: too many requests',
    'not allowed to bypass guardian',
    'insufficient funds'
  ])('%s', async (inner) => {
    estimateMock.mockRejectedValue(transport(inner));
    const { problems } = await prepare(SENDER, [claimTx()]);
    expect(problems[0]).toBeTruthy();
    expect(estimateMock).toHaveBeenCalledTimes(1);
  });
});
