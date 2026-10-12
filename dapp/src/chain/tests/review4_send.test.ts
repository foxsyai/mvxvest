// Fourth adversarial review: chain/send.ts after 2223f82 (the fix of T5:
// releaseNonces and the registry of unconfirmed sends).
//
// Everything here runs the real sdk-dapp signing path: DappProvider ->
// signTransactionsWithProvider -> refreshAccount -> getLatestNonce ->
// computeNonces, on the real zustand store (devtools(persist(immer))). Only
// the wallet (it hands the transactions back) and the API's account read
// (getAccountFromApi) are faked, plus axios for the POST, as in review3_send.
//
// 1. The copy of a lost send keeps its nonce only if the account's nonce has
//    not moved by the time the wallet is opened. releaseNonces() drops the
//    lost send from the store and sets the store nonce to the prepared one,
//    but signTransactionsWithProvider() then calls refreshAccount(), which
//    reads the API again: getLatestNonce() = max(tracked + 1, API nonce,
//    store nonce). If the lost send turned up and executed after the panel's
//    check (prepare) and before the click on "Sign in your wallet", the API
//    says 43 and computeNonces() silently moves the copy to 43, where it
//    executes too: the vestings are created twice. The comment above
//    releaseNonces ("Both can never execute") holds only when the copy is
//    POSTed at the prepared nonce. (Create-level twin, for a lost send that
//    executes before the check: pages/tests/review4_Create.)
//
// 2. A released nonce is followed as "the earlier one went through" whatever
//    the new transaction is. releaseNonces() releases every unconfirmed send
//    of the sender at or above the first prepared nonce, from any panel of any
//    page, and the "refused copy" branch then substitutes the earlier hash for
//    ANY transaction refused for its nonce. A claim whose POST timed out (it
//    is in the pool), then a cancel of the same vesting prepared at the same
//    nonce: the claim executes while the wallet prompt for the cancel is
//    open, the cancel is refused "lowerNonceInTx", and send() resolves with
//    the CLAIM's hash. TxPanel shows "Cancel vesting #4 ... done" (the claim's
//    success) and the vesting was never cancelled. On Create the same happens
//    to a new review opened with "Start a new creation" while the earlier
//    review's send is unconfirmed: it is reported done, and the earlier
//    review's vesting ids are listed as created by it; nothing of it was.
//
// 3. Only sends whose POST was never confirmed are in the registry. A send
//    the API accepted (txHash returned) and that then vanished (dropped from
//    the pool) is "not found" after 2 minutes just the same, and Create offers
//    it again, missing first, "at a nonce read from the network: its nonce,
//    which is still free" (Create.signRemaining). But sdk-dapp still tracks it
//    at 42, so the copy is signed at 43: it waits behind a gap that never
//    fills (and so does every later transaction from this tab, the store being
//    kept in sessionStorage); if the lost one turns up, both execute. This is
//    T5, unfixed for sends whose POST was confirmed.
//
// 4. releaseNonces() empties the registry before the wallet is asked. If the
//    wallet refuses (or the first POST is refused), the lost send is gone from
//    the registry and nothing puts it back. The next "Check again" is then not
//    protected: if the lost one executes while that prompt is open, the copy
//    is refused for its nonce, send() rejects, the panel says "did not go
//    through" next to "Check again", and that check signs the copy at the next
//    nonce, where it executes: created twice.

import {
  Address,
  Transaction,
  TransactionComputer
} from '@multiversx/sdk-core';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const postMock = jest.fn();
const mockWallet: { current: any } = { current: null };
/** The account's nonce as the API answers sdk-dapp's refreshAccount(). */
const mockApi = { nonce: 0 };

jest.mock('../network', () => ({
  api: async () => ({}),
  forget: () => undefined,
  networkProvider: {}
}));
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
jest.mock('lib', () => ({
  getAccountProvider: () => mockWallet.current,
  TransactionManager: jest.requireActual(
    '@multiversx/sdk-dapp/out/managers/TransactionManager/TransactionManager'
  ).TransactionManager
}));
// sdk-dapp's own read of the account (refreshAccount, before every signing).
jest.mock(
  '@multiversx/sdk-dapp/out/apiCalls/account/getAccountFromApi.cjs',
  () => ({
    getAccountFromApi: async ({ address }: { address: string }) => ({
      address,
      balance: '1000000000000000000000',
      nonce: mockApi.nonce,
      isGuarded: false,
      txCount: 0,
      scrCount: 0,
      claimableRewards: '0'
    })
  })
);

const tx = (nonce: bigint, data: string, gasLimit = 50_000_000n) =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit,
    chainID: 'D',
    nonce,
    data: new TextEncoder().encode(data)
  });

const hashOf = (transaction: Transaction) =>
  new TransactionComputer().computeTransactionHash(transaction);

const timeout = () => {
  const error: any = new Error('timeout of 4000ms exceeded');
  error.code = 'ECONNABORTED';
  return error;
};
const lowerNonce = () => {
  const error: any = new Error('Request failed with status code 400');
  error.response = {
    status: 400,
    data: {
      statusCode: 400,
      message:
        'transaction generation failed: invalid transaction lowerNonceInTx: true, veryHighNonceInTx: false'
    }
  };
  return error;
};

/**
 * The chain as these tests need it: nonce -> what executed with it. A POST
 * of a used nonce is refused; any other is accepted and executes (unless the
 * test says how the POST looks to the browser).
 */
const chain = {
  executed: new Map<number, string>(),
  posted: [] as number[],
  /** How the next POSTs look: 'accept', 'timeout' (in limbo, not executed). */
  mode: 'accept' as 'accept' | 'timeout'
};
const dataOf = (body: any) =>
  Buffer.from(String(body.data ?? ''), 'base64').toString();
const execute = (nonce: number, data: string) => {
  chain.executed.set(nonce, data);
  mockApi.nonce = Math.max(mockApi.nonce, nonce + 1);
};

/**
 * A fresh sdk-dapp (store, providers) and a fresh send.ts, logged in with the
 * extension at `nonce`. `duringPrompt` runs while the wallet prompt is open
 * (after sdk-dapp's refreshAccount), `refuse` makes the wallet refuse.
 */
// Fresh copies of the modules per test need require() after resetModules.
/* eslint-disable @typescript-eslint/no-require-imports */
const setup = (nonce: number) => {
  jest.resetModules();
  const { send } = require('../send');
  const {
    DappProvider
  } = require('@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider');
  const {
    setAccountProvider
  } = require('@multiversx/sdk-dapp/out/providers/helpers/accountProvider');
  const {
    loginAction
  } = require('@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions');
  const {
    setAccount
  } = require('@multiversx/sdk-dapp/out/store/actions/account/accountActions');
  const {
    emptyAccount
  } = require('@multiversx/sdk-dapp/out/store/slices/account/emptyAccount');
  mockApi.nonce = nonce;
  loginAction({ address: SENDER, providerType: 'extension' });
  setAccount({ ...emptyAccount, address: SENDER, nonce });
  const wallet = {
    duringPrompt: undefined as undefined | (() => void),
    refuse: false
  };
  const provider = new DappProvider({
    init: async () => true,
    isInitialized: () => true,
    getType: () => 'extension',
    signTransactions: async (txs: Transaction[]) => {
      wallet.duringPrompt?.();
      wallet.duringPrompt = undefined;
      if (wallet.refuse) {
        wallet.refuse = false;
        throw new Error('Transaction canceled by user');
      }
      return txs;
    }
  });
  setAccountProvider(provider);
  mockWallet.current = provider;
  return { send: send as typeof import('../send').send, wallet };
};
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  chain.executed = new Map();
  chain.posted = [];
  chain.mode = 'accept';
  postMock.mockReset();
  postMock.mockImplementation(async (_url: string, body: any) => {
    chain.posted.push(body.nonce);
    if (chain.executed.has(body.nonce)) throw lowerNonce();
    if (chain.mode === 'timeout') throw timeout();
    execute(body.nonce, dataOf(body));
    return { data: { txHash: hashOf(Transaction.newFromPlainObject(body)) } };
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const creates = () =>
  [...chain.executed.values()].filter((data) => data === 'create@01').length;

// After the fix (round 4): the release mechanism these findings were about
// is gone. The page never signs a send the network did not confirm, or did
// not find, a second time (pages/tests/review4_Create, review3_Create), and
// send() no longer touches sdk-dapp's store: a later transaction always goes
// after a possibly-lost one, never in its place, and is reported under its
// own hash. Findings 1, 3 and 4 have no copy to sign any more; their tests
// are replaced by the two below, which keep the property they protected:
// nothing executes twice, and nothing is reported under another's hash.

describe('review4: a later transaction after a send that was never confirmed', () => {
  it('never takes the nonce of the lost one, so each executes at most once', async () => {
    const { send } = setup(42);
    chain.mode = 'timeout';
    const first = await send([tx(42n, 'create@01')], 'Create a vesting');
    expect(first.unconfirmed).toHaveLength(1);

    // Prepared at 42 (the network has not moved), signed after the lost one.
    chain.mode = 'accept';
    await send([tx(42n, 'claim@05')], 'Claim from vesting #5');
    expect(chain.posted.slice(-1)).toEqual([43]);

    // The lost one turns up later: it executes once, at its own nonce.
    execute(42, 'create@01');
    expect(creates()).toBe(1);
    expect([...chain.executed.entries()].sort()).toEqual([
      [42, 'create@01'],
      [43, 'claim@05']
    ]);
  }, 20_000);
});

describe('review4: a nonce taken by a different transaction', () => {
  it('a cancel is not reported under the claim that took the nonce', async () => {
    const { send, wallet } = setup(50);
    chain.mode = 'timeout';
    const claim = tx(50n, 'claim@04');
    const claimed = await send([claim], 'Claim from vesting #4');
    expect(claimed.unconfirmed).toEqual([hashOf(claim)]);

    // The cancel is prepared at 50; the claim executes while its wallet
    // prompt is open. The cancel goes after it (51), as its own transaction.
    chain.mode = 'accept';
    wallet.duringPrompt = () => execute(50, 'claim@04');
    const cancel = tx(50n, 'cancel@04');
    const { hashes } = await send([cancel], 'Cancel vesting #4');
    expect(hashes).not.toContain(hashOf(claim));
    expect(hashes).toEqual([hashOf(cancel)]);
    expect([...chain.executed.values()].sort()).toEqual([
      'cancel@04',
      'claim@04'
    ]);
  }, 20_000);
});
