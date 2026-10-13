// Main audit (Fable 5.1, 13 Oct 2026): the guard against signing behind a
// possibly-lost send holds only while a TxPanel is mounted.
//
// The fifth check (docs/reviews/2026-10-12-dapp.md) says: "While the wallet
// session (sdk-dapp's store) still counts a send this tab found missing,
// nothing new is prepared, on any page." The only thing that ever "finds" a
// send missing is the poll loop of a mounted TxPanel: it starts the 2-minute
// clock on its first poll (TxPanel.tsx, `unknownSince`), calls markMissing()
// from inside its effect, and stops with the component. send() and
// missing.ts know nothing of time. Meanwhile sdk-dapp keeps the send in its
// store (TransactionManager.track -> createTransactionsSession, with the
// hash AND the nonce), and refreshAccount() sets the account nonce to
// getLatestNonce() = max(highest tracked nonce + 1, API nonce): every later
// signing goes one nonce behind the lost one, where it waits in the pool
// and executes together with it if it turns up. So:
//
// 1. A send whose POST timed out (unconfirmed) and whose panel is gone within
//    the 2 minutes is never called missing. On Create, any in-app link (My
//    vestings, the logo) unmounts the page and its record with no warning
//    (beforeunload fires only on a reload or a close). On My vestings,
//    Created by me and the vesting page the panel offers "Close" right under
//    "the network did not confirm that it received one transaction". Back on
//    Create (an empty form), the creator types the same vestings again:
//    prepare() passes (stillCounted() is empty), sdk-dapp signs the copy at
//    the next nonce, and both execute once the lost one turns up (the very
//    case the fourth review's design is about): the vestings are created
//    twice, the deposit is taken twice, and nothing on the page says so.
// 2. The same after a reload: sdk-dapp's store lives in sessionStorage and
//    comes back with the tracked session; missing.ts comes back empty.
//    sdk-dapp's own tracker times the session out after 30 polls
//    (runTransactionStatusUpdate) but never drops it, and getLatestNonce()
//    counts sessions of every status.
//
// Expected once fixed: prepare() refuses while the wallet session counts a
// transaction the network has not seen for 2 minutes, whether or not a panel
// ever followed it (the clock belongs to send()/missing.ts, or prepare()
// checks the session's hashes against the network itself), also after a
// reload. Everything below runs the real send(), the real sdk-dapp
// TransactionManager and store, and the real missing.ts; only the wallet
// (it hands the transactions back), axios (the POST) and the reads are
// faked.

import { Address, Transaction } from '@multiversx/sdk-core';
import { createTransactionsSession } from '@multiversx/sdk-dapp/out/store/actions/transactions/transactionsActions';
import { getState } from '@multiversx/sdk-dapp/out/store/store';
import { prepare, send } from '../send';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const postMock = jest.fn();

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
// The network, as prepare() and any watcher read it: the account at nonce
// 42, not guarded; every simulation passes; and NO transaction hash is known
// (404), however it is asked for.
jest.mock('../network', () => ({
  api: async (path: string) => {
    if (path.includes('/transactions/')) {
      const error: any = new Error(`${path} answered 404`);
      error.status = 404;
      throw error;
    }
    return {};
  },
  apiUrl: 'https://devnet-api.multiversx.com',
  forget: () => undefined,
  networkProvider: {
    getAccount: async () => ({ nonce: 42 }),
    estimateTransactionCost: async () => ({ gasLimit: 10_000_000 })
  }
}));
jest.mock('lib', () => ({
  getAccountProvider: () => ({
    signTransactions: async (txs: unknown[]) => txs
  }),
  TransactionManager: jest.requireActual(
    '@multiversx/sdk-dapp/out/managers/TransactionManager/TransactionManager'
  ).TransactionManager
}));

const tx = (nonce: bigint, data: string) =>
  new Transaction({
    sender: Address.newFromBech32(SENDER),
    receiver: Address.newFromBech32(CONTRACT),
    gasLimit: 50_000_000n,
    chainID: 'D',
    nonce,
    data: new TextEncoder().encode(data)
  });

/** axios as sdk-dapp sees it: the POST gave up after 4 s, no response. */
const timeout = () => {
  const error: any = new Error('timeout of 4000ms exceeded');
  error.code = 'ECONNABORTED';
  return error;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Added to Date.now(): the 2 minutes of the "missing" rule pass at once. */
let skew = 0;

/**
 * prepare() over the next `seconds`: the refusal, or undefined when it kept
 * answering with transactions ready to sign (a watcher may need a tick).
 */
const refusalOf = async (seconds: number) => {
  for (let i = 0; i < seconds; i++) {
    try {
      await prepare(SENDER, [tx(0n, 'create@02')]);
    } catch (failure) {
      return String((failure as any)?.message ?? failure);
    }
    await wait(1_000);
  }
  return undefined;
};

/** The hashes sdk-dapp's wallet session still counts. */
const trackedHashes = () =>
  Object.values<any>(getState().transactions ?? {}).flatMap((session) =>
    (session?.transactions ?? []).map((t: any) => t.hash)
  );

beforeEach(() => {
  skew = 0;
  const realNow = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  // The API knows no hash: every GET of a transaction is a 404.
  (global as any).fetch = jest.fn(async () => ({
    ok: false,
    status: 404,
    json: async () => ({})
  }));
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    throw timeout();
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('audit: a possibly-lost send with no panel following it', () => {
  it('still stops prepare() once the network has not seen it for 2 minutes', async () => {
    // The POST timed out: sent, unconfirmed, tracked by sdk-dapp. The page
    // that sent it is then left (an in-app link): no TxPanel follows it.
    const sent = await send([tx(42n, 'create@01')], 'Create a vesting');
    expect(sent.unconfirmed).toHaveLength(1);
    const [hash] = sent.hashes;
    expect(trackedHashes()).toContain(hash);

    // Two and a half minutes later the API has still never seen it.
    skew = 150_000;
    const refusal = await refusalOf(12);
    // Today: prepare() answers with the copy ready to sign, nonce 42 from
    // the API; sdk-dapp then signs it at 43, behind the lost one.
    expect(refusal).toMatch(/not seen|disconnect|connect your wallet/i);
  }, 40_000);

  it('still stops prepare() after a reload (the session is persisted, the mark is not)', async () => {
    // What sessionStorage gives back after a reload: the tracked session of
    // a send the network never saw, nothing else.
    const lost = 'cd'.repeat(32);
    createTransactionsSession({
      transactions: [
        {
          hash: lost,
          nonce: 42,
          sender: SENDER,
          receiver: CONTRACT,
          status: 'sent'
        } as any
      ],
      transactionsDisplayInfo: {},
      status: 'sent' as any
    });
    expect(trackedHashes()).toContain(lost);

    skew = 180_000;
    const refusal = await refusalOf(12);
    // Today: prepare() passes; the next signing waits behind nonce 42.
    expect(refusal).toMatch(/not seen|disconnect|connect your wallet/i);
  }, 40_000);
});
