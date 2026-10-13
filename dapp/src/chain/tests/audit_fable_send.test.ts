// Main audit (Fable 5.1, 13 Oct 2026): send() reports "sent" when the wallet
// signed nothing.
//
// send() is documented to reject "when the wallet refuses or when not even
// the first transaction reached the network", and TxPanel builds on it: a
// resolved send() is phase 'sent' ("Sent. Following the result:"), and Create
// marks the attempt sent, keeps the form locked and, with no hash to follow,
// offers neither "Sign the remaining" nor "Start a new creation" (both need
// anySent): the creator is stuck with a locked form that says "Sent" until a
// reload, for vestings that were never signed.
//
// sdk-dapp can hand back an empty list: signTransactionsWithProvider does
// `await provider.signTransactions(...) ?? []`, and for a guarded account
// guardTransactions.cjs returns `[]` when the web wallet's cross-window
// provider cannot be initialised (`?.guardTransactions(r) || []`). A custom
// or future provider that resolves with nothing does the same. send() then
// loops over zero signed transactions, POSTs nothing, and resolves with
// `hashes: []` and a nextNonce as if the first one had gone through.
//
// Expected once fixed: a signing that produced no transaction is a refusal
// (nothing reached the network), so TxPanel says "did not go through" and
// offers "Check again".

import { Address, Transaction } from '@multiversx/sdk-core';
import { send } from '../send';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const postMock = jest.fn();
const mockWallet: { current: any } = { current: null };

jest.mock('axios', () => {
  const instance = {
    post: (...args: unknown[]) => postMock(...args),
    get: async () => {
      throw new Error('no GET in this test');
    },
    create: () => instance,
    isAxiosError: () => true,
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: () => 0, eject: () => undefined },
      response: { use: () => 0, eject: () => undefined }
    }
  };
  return { __esModule: true, default: instance, ...instance };
});
jest.mock('../network', () => ({
  api: async () => ({}),
  forget: () => undefined,
  networkProvider: {}
}));
jest.mock('lib', () => ({
  getAccountProvider: () => mockWallet.current,
  TransactionManager: jest.requireActual(
    '@multiversx/sdk-dapp/out/managers/TransactionManager/TransactionManager'
  ).TransactionManager
}));

const createTx = () =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 50_000_000n,
    chainID: 'D',
    nonce: 42n,
    data: new TextEncoder().encode('create@01')
  });

beforeEach(() => {
  postMock.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('audit: a wallet that hands back no signed transaction', () => {
  it('is a refusal, not a send', async () => {
    mockWallet.current = { signTransactions: async () => [] };
    // Today: resolves with { hashes: [], nextNonce: 43n }, and the panel
    // shows "Sent. Following the result:" with nothing under it.
    await expect(send([createTx()], 'Create a vesting')).rejects.toBeTruthy();
    expect(postMock).not.toHaveBeenCalled();
  });
});
