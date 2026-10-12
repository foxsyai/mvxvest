// Second adversarial review: chain/send.ts, a retry after a timeout.
//
// sendOne() retries a POST that timed out (and on 429/5xx/"network"). A POST
// that timed out at the browser may well have reached the network: sdk-dapp's
// own POST timeout is 4 s (its fallback network config, apiTimeout "4000";
// this app does not pass its own), and devnet and mainnet run 0.6 s rounds
// (erd_round_duration 600, read from devnet-gateway on 12 Oct 2026). By the
// time the retry is POSTed the first copy has usually been EXECUTED, so the
// node no longer answers "duplicate": it refuses the retry for its nonce
// (mx-chain-go txValidator: "invalid transaction lowerNonceInTx: true,
// veryHighNonceInTx: false"). sendOne() only recognises /already|duplicat/ as
// "the network holds it", so:
//
//  1. first transaction: send() rejects, TxPanel says "<label> did not go
//     through: ..." and, believing "Nothing reached the network: checking
//     again is safe", offers "Check again"; prepare() then reads the advanced
//     account nonce and the same vestings are signed and created a second
//     time;
//  2. a later transaction: send() reports it as not sent (stopped.at), and
//     Create offers "Sign the remaining N", which creates that batch again.

import {
  Address,
  Transaction,
  TransactionComputer
} from '@multiversx/sdk-core';
import { send } from '../send';
import { explainWalletFailure } from '../walletFailure';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const postMock = jest.fn();

jest.mock('../network', () => ({
  api: async () => ({}),
  forget: () => undefined,
  networkProvider: {}
}));
jest.mock(
  '@multiversx/sdk-dapp/out/store/actions/account/accountActions',
  () => ({ setAccountNonce: () => undefined })
);
// The real sdk-dapp TransactionManager, with axios answering per transaction.
jest.mock('axios', () => {
  const instance = {
    post: (...args: unknown[]) => postMock(...args),
    get: async () => ({ data: {} }),
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
  getAccountProvider: () => ({
    signTransactions: async (txs: unknown[]) => txs
  }),
  TransactionManager: jest.requireActual(
    '@multiversx/sdk-dapp/out/managers/TransactionManager/TransactionManager'
  ).TransactionManager
}));

const createTx = (nonce: bigint) =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 50_000_000n,
    chainID: 'D',
    nonce,
    data: new TextEncoder().encode('create@01')
  });

// sdk-core 15 returns the hash as hex already (corrected after review 3: the
// first version of this test hex-encoded it twice, as send.ts then did).
const hashOf = (tx: Transaction) =>
  new TransactionComputer().computeTransactionHash(tx);

/** axios as sdk-dapp sees it: the POST gave up after 4 s, no response. */
const timeout = () => {
  const error: any = new Error('timeout of 4000ms exceeded');
  error.code = 'ECONNABORTED';
  return error;
};
/** What the node answers for a transaction whose nonce it has already used. */
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
 * The network: every POST of a nonce is received, even the one whose answer
 * the browser stopped waiting for; `slow` nonces answer after the timeout,
 * and their copy is executed before any retry arrives.
 */
const network = (slow: number[]) => {
  const executed = new Set<number>();
  postMock.mockImplementation(async (_url: string, body: any) => {
    if (executed.has(body.nonce)) throw lowerNonce();
    executed.add(body.nonce);
    if (slow.includes(body.nonce)) throw timeout();
    return { data: { txHash: `hash-of-nonce-${body.nonce}` } };
  });
  return executed;
};

beforeEach(() => postMock.mockReset());

describe('review2: send() after a POST that timed out', () => {
  it('a timed-out first transaction that was executed is not reported as "did not go through"', async () => {
    const executed = network([42]);
    let outcome: string;
    try {
      const { hashes } = await send([createTx(42n)], 'Create a vesting');
      outcome = `sent ${hashes.join(',')}`;
    } catch (failure) {
      outcome = explainWalletFailure(failure, 'Create a vesting');
    }
    // The vesting exists on chain...
    expect(executed.has(42)).toBe(true);
    // ...but today the creator reads "Create a vesting did not go through:
    // transaction generation failed: invalid transaction lowerNonceInTx: ..."
    // next to a "Check again" button that signs it a second time.
    expect(outcome).not.toMatch(/did not go through/);
  });

  it('a timed-out later transaction that was executed is not reported as "not sent"', async () => {
    const executed = network([43]);
    const second = createTx(43n);
    const result = await send([createTx(42n), second], 'Create 60 vestings');
    expect(executed.has(43)).toBe(true);
    // Today: stopped = { at: 1, reason: 'transaction generation failed: ...
    // lowerNonceInTx: true ...' } and nextNonce 43: Create says "1 of 2
    // transactions were sent" and offers "Sign the remaining 1", which creates
    // the second batch again.
    expect(result.stopped).toBeUndefined();
    expect(result.hashes).toContain(hashOf(second));
  });
});
