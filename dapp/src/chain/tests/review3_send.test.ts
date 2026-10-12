// Third adversarial review: chain/send.ts after eb66702 (the fix of R1).
//
// 1. The hash sendOne() computes for itself is not the network's hash.
//    sdk-core 15's TransactionComputer.computeTransactionHash() already
//    returns the hash as a hex STRING (out/core/transactionComputer.js:80-84).
//    send.ts:174 passes that string to Buffer.from() without an encoding, so
//    it is read as UTF-8 text and hex-encoded a second time: 128 characters,
//    the hex of the ASCII of the real hash. That hash is used for every send
//    the network did not confirm (unconfirmed), for "nonce already used after
//    a timeout" and for "already holds it": exactly the paths R1 added. The
//    devnet API refuses it with 400 "Length should be 64" (checked on
//    devnet-api, 12 Oct 2026), outcomeOf reads 400 as "pending" without
//    `unknown`, so TxPanel shows "processing" for ever, never "done" and never
//    "not found"; Create's `waiting` stays true for ever, so "Sign the
//    remaining" is never offered again, and the explorer link is dead. The
//    review2 test passed only because it computed its expected hash with the
//    same double encoding.
//    The raw computeTransactionHash() does match the network: checked against
//    devnet transactions 90f852b1... (this contract's create, nonce 49) and
//    fb94c6b9... (a guarded transaction, options 2, with guardian signature).
//
// 2. A server error on the POST never counts as "may have arrived".
//    sdk-dapp's TransactionManager.send() catches the axios error and throws
//    a plain STRING (`responseData?.message ?? error.message`,
//    TransactionManager.ts send()). mayHaveArrived() and retryable() look for
//    `failure.response.status`, which a string never has, so the `status >=
//    500` branch is dead: a 504 (gateway timeout: the request reached the
//    origin, which may have passed it on) is retried as a mere refusal, the
//    retry is refused for its nonce, and send() rejects. TxPanel then says
//    "did not go through" and offers "Check again", which signs the same
//    vestings with the next nonce: created twice (the very case R1 fixed for
//    timeouts). An API "500 Internal server error" is not even retried.
//
// 3. Signing a "not found" transaction again does not keep its nonce.
//    Create.signRemaining() relies on "read the nonce from the network: the
//    new one takes its nonce, so at most one of the two can ever execute".
//    But sdk-dapp's DappProvider.signTransactions() re-nonces every
//    transaction: computeNonces() sets max(tx.nonce, latestNonce + index),
//    where latestNonce = max(store nonce, nonce of every tracked transaction
//    + 1, API nonce) (getLatestNonce.ts). send() tracked the lost transaction
//    (nonce 42) and the store nonce was moved to 43 when it was signed, so the
//    new copy is signed with 43. If the old one never arrived, the new one
//    waits behind a nonce gap for ever (and so does every later send from this
//    tab, each re-offer adding another copy that all execute once the gap is
//    filled); if the old one does execute, both do: created twice.

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
/** The wallet: by default it signs by handing the transactions back. */
const mockWallet: { current: any } = { current: null };

jest.mock('../network', () => ({
  api: async () => ({}),
  forget: () => undefined,
  networkProvider: {}
}));
// The real sdk-dapp TransactionManager (and, in part 3, the real
// DappProvider), with axios answering per transaction.
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
  getAccountProvider: () =>
    mockWallet.current ?? {
      signTransactions: async (txs: unknown[]) => txs
    },
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

/** The hash the network gives a transaction (matches devnet, see above). */
const networkHash = (tx: Transaction) =>
  new TransactionComputer().computeTransactionHash(tx);

/** axios as sdk-dapp sees it: the POST gave up after 4 s, no response. */
const timeout = () => {
  const error: any = new Error('timeout of 4000ms exceeded');
  error.code = 'ECONNABORTED';
  return error;
};
/** A gateway timeout from the proxy in front of the API (HTML body). */
const gatewayTimeout = () => {
  const error: any = new Error('Request failed with status code 504');
  error.response = {
    status: 504,
    data: '<html><body><h1>504 Gateway Time-out</h1></body></html>'
  };
  return error;
};
/** The API when its own call to the gateway failed. */
const internalError = () => {
  const error: any = new Error('Request failed with status code 500');
  error.response = {
    status: 500,
    data: { statusCode: 500, message: 'Internal server error' }
  };
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
 * The network: every POST of a nonce is received (even one whose answer the
 * browser never got) and executed before any retry arrives; `lost` says how
 * the first POST of each nonce looks to the browser.
 */
const network = (lost: () => Error) => {
  const executed = new Set<number>();
  postMock.mockImplementation(async (_url: string, body: any) => {
    if (executed.has(body.nonce)) throw lowerNonce();
    executed.add(body.nonce);
    throw lost();
  });
  return executed;
};

/** Two real devnet transactions, as the gateway returns them. */
const DEVNET = {
  // create on this app's contract, sent by this app (nonce 49).
  create: {
    hash: '90f852b1dda645e20c8634d725e5b1cb61b2cff37981b9d730d7238d3df22fcd',
    plain: {
      nonce: 49,
      value: '0',
      receiver: CONTRACT,
      sender: SENDER,
      gasPrice: 1000000000,
      gasLimit: 12680484,
      data: 'RVNEVFRyYW5zZmVyQDU0NTA1NDUzMmQzNjY1NjQzMTM2MzJAMDdANjM3MjY1NjE3NDY1QGFlN2MyMDVhODAxNTdjOWU3ODVlYTBmNmMxMGM0YmE2MTliNGE3MjU5ZmExZThlYmM1MzJmNTZiZjFlNWM4ZWRAMDdAMDAwMDAwMDA2YWNhM2M5YzAwMDAwMDAwNmFjYjhlMWMwMDAwMDAwMTA3MDAwMDAwMDA2YWNlMzExYzAwQEA2MzZjNjk2NjY2MjA2MTZjNmM=',
      chainID: 'D',
      version: 2,
      options: 0,
      signature:
        'b5680807fcefb54936d7ef1526dbeb0467ca3255b1b8c7fa6df47c1379bedec3116d89cc25de3da061cccd5bdf44de121c7c8118aaa0e27cbc623e0c1cb1bf07'
    }
  },
  // A guarded transaction: guardian and guardian signature applied.
  guarded: {
    hash: 'fb94c6b9716c4b99df05a8c37876ac583fd832afd49eef3bd6a1e680a5edeedf',
    plain: {
      nonce: 4196,
      value: '0',
      receiver:
        'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf',
      sender: 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf',
      gasPrice: 1000000000,
      gasLimit: 1000000,
      data: 'VW5HdWFyZEFjY291bnQ=',
      chainID: 'D',
      version: 2,
      options: 2,
      guardian:
        'erd1mjdch8uumhl3wcqjky0es8f38ee262lu4qkxe64k4jvy4l0q3mwqtwf7vs',
      signature:
        'd3ee8a020d571abdd5f51b1262a4006acf25e2b10fd50493f69ea8601d50a8aec8e05bdb04420f40c0a69cd1e8b3deeadec6b306690286d0bdd22dded7605a0e',
      guardianSignature:
        '46d070413b9b04c4a4e022945bb1b37ba3034523ff78dfd4bb577462ef1390cd0bbda88f0fc5b1c45c04f424f9eae9767b775b3d853ed05dbae6c156e48fdf02'
    }
  }
};

beforeEach(() => {
  postMock.mockReset();
  mockWallet.current = null;
});

describe('review3: the hash a send that was not confirmed is followed by', () => {
  it('is the network hash for a timed-out send that was executed', async () => {
    const executed = network(timeout);
    const tx = createTx(42n);
    const { hashes } = await send([tx], 'Create a vesting');
    expect(executed.has(42)).toBe(true);
    // Today: a 128-character "hash" (the hex of the hex), which the API
    // refuses with 400: the panel says "processing" for ever.
    expect(hashes).toEqual([networkHash(tx)]);
  });

  it('is the network hash of a real devnet create when no POST was confirmed', async () => {
    postMock.mockImplementation(async () => {
      throw timeout();
    });
    const tx = Transaction.newFromPlainObject(DEVNET.create.plain);
    expect(networkHash(tx)).toBe(DEVNET.create.hash);
    const result = await send([tx], 'Create a vesting');
    // Today: unconfirmed = ['3930663835...'] (128 characters): Create waits
    // for it for ever ("Waiting for the network to confirm the transaction
    // above") and never offers the rest.
    expect(result.unconfirmed).toEqual([DEVNET.create.hash]);
    expect(result.hashes).toEqual([DEVNET.create.hash]);
  });

  it('is the network hash of a guarded devnet transaction', async () => {
    postMock.mockImplementation(async () => {
      throw timeout();
    });
    const tx = Transaction.newFromPlainObject(DEVNET.guarded.plain);
    expect(networkHash(tx)).toBe(DEVNET.guarded.hash);
    const result = await send([tx], 'Create a vesting');
    expect(result.unconfirmed).toEqual([DEVNET.guarded.hash]);
  });
});

describe('review3: a server error on the POST', () => {
  const outcomeOf = async (lost: () => Error) => {
    const executed = network(lost);
    let outcome: string;
    try {
      const { hashes } = await send([createTx(42n)], 'Create a vesting');
      outcome = `sent ${hashes.join(',')}`;
    } catch (failure) {
      outcome = explainWalletFailure(failure, 'Create a vesting');
    }
    return { outcome, executed };
  };

  it('a 504 that was executed is not reported as "did not go through"', async () => {
    const { outcome, executed } = await outcomeOf(gatewayTimeout);
    expect(executed.has(42)).toBe(true);
    // Today: "Create a vesting did not go through: transaction generation
    // failed: invalid transaction lowerNonceInTx: true ..." next to "Check
    // again", which signs the vesting a second time.
    expect(outcome).not.toMatch(/did not go through/);
  });

  it('an API 500 that was executed is not reported as "did not go through"', async () => {
    const { outcome, executed } = await outcomeOf(internalError);
    expect(executed.has(42)).toBe(true);
    // Today: "Create a vesting did not go through: Internal server error",
    // not even retried (the string has no status for retryable() to read).
    expect(outcome).not.toMatch(/did not go through/);
  });
});

describe('review3: a transaction signed again after it was "not found"', () => {
  it("keeps the nonce prepare() gave it (the lost one's nonce)", async () => {
    const { DappProvider } = jest.requireActual(
      '@multiversx/sdk-dapp/out/providers/DappProvider/DappProvider'
    );
    const { loginAction } = jest.requireActual(
      '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions'
    );
    const { setAccount } = jest.requireActual(
      '@multiversx/sdk-dapp/out/store/actions/account/accountActions'
    );
    const { emptyAccount } = jest.requireActual(
      '@multiversx/sdk-dapp/out/store/slices/account/emptyAccount'
    );
    // Connected with the browser extension; the account's nonce is 42 (as
    // sdk-dapp's own refresh reads it from the API: the GET is not answered
    // here, which leaves the store as it is).
    loginAction({ address: SENDER, providerType: 'extension' });
    setAccount({ ...emptyAccount, address: SENDER, nonce: 42 });
    mockWallet.current = new DappProvider({
      init: async () => true,
      isInitialized: () => true,
      getType: () => 'extension',
      signTransactions: async (txs: Transaction[]) => txs
    });

    // 1. Nonce 42 is sent, every POST times out, and it never arrived.
    const posted: number[] = [];
    postMock.mockImplementation(async (_url: string, body: any) => {
      posted.push(body.nonce);
      throw timeout();
    });
    const first = await send([createTx(42n)], 'Create a vesting');
    expect(first.unconfirmed).toHaveLength(1);
    expect(posted[0]).toBe(42);

    // 2. Two minutes later TxPanel calls it "not found", Create offers it
    // again with firstNonce undefined, and prepare() reads the account's
    // nonce from the network: still 42, nothing executed.
    posted.length = 0;
    postMock.mockImplementation(async (_url: string, body: any) => {
      posted.push(body.nonce);
      return { data: { txHash: 'ab'.repeat(32) } };
    });
    await send([createTx(42n)], 'Create a vesting');

    // Today: 43. Nonce 42 stays a gap: this copy never executes; or, if the
    // first copy turns up after all, both execute.
    expect(posted).toEqual([42]);
  });
});
