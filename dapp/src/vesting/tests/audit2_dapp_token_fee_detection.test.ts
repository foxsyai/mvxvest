// Second audit (dApp against contract versions 1 and 2): how the site learns
// the token fee, through the real sdk-core 15.4.1 provider with its HTTP
// layer replaced by what the public API really answers.
//
// Version 1, live on mainnet, has no `getTokenFee`. Read on 14 Oct 2026:
//   POST https://api.multiversx.com/query {funcName: "getTokenFee"} answers
//   HTTP 400 {"statusCode":400,"code":"function not found",
//             "message":"invalid function (not found)"}
// which ApiNetworkProvider turns into ErrContractQuery "Request error on url
// [query]: [invalid function (not found)]". The site must read exactly that
// as "no token fee", and nothing else as 0: a rate limit, a timeout or a
// server error read as 0 would show "Fees: none" and build a payment the
// contract refuses.

import { ApiNetworkProvider } from '@multiversx/sdk-core';
import { cached, clearCache } from 'chain/network';
import { VestingClient } from '../client';

const MAINNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';

/** The dApp's client on a real provider whose HTTP is the stub `post`. */
const clientWith = (
  post: jest.Mock,
  run?: ConstructorParameters<typeof VestingClient>[3]
) => {
  const provider = new ApiNetworkProvider('https://api.multiversx.com', {
    clientName: 'audit2',
    timeout: 15000
  });
  (provider as any).axios = { default: { post, get: jest.fn() } };
  return new VestingClient(MAINNET_CONTRACT, provider, '1', run);
};

/** An axios failure with an HTTP answer. */
const httpFailure = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
    toString: () => `AxiosError: Request failed with status code ${status}`
  });

/** An axios failure without any answer (timeout, dropped connection). */
const noAnswer = (text: string) =>
  Object.assign(new Error(text), { toString: () => `AxiosError: ${text}` });

/** The API's own answer for a successful query (HTTP 201). */
const ok = (returnData: string[]) => ({
  data: { returnData, returnCode: 'ok', returnMessage: '' }
});

// Mainnet's exact answer for version 1 (14 Oct 2026).
const V1_ANSWER = {
  statusCode: 400,
  code: 'function not found',
  message: 'invalid function (not found)'
};

beforeEach(() => clearCache());

describe('safe: reading the token fee of version 1', () => {
  it("safe: mainnet's exact 400 answer reads as no token fee, in one request, through the app's queue", async () => {
    const post = jest.fn().mockRejectedValue(httpFailure(400, V1_ANSWER));
    const client = clientWith(post, cached);
    await expect(client.tokenFee()).resolves.toBe(0);
    // No retry: the contract said no, the network did not fail.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({
      scAddress: MAINNET_CONTRACT,
      funcName: 'getTokenFee'
    });
  });

  it("safe: the gateway's shape (returnCode 'function not found') reads as no token fee too", async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        returnData: null,
        returnCode: 'function not found',
        returnMessage: 'invalid function (not found)'
      }
    });
    await expect(clientWith(post, cached).tokenFee()).resolves.toBe(0);
  });

  it('safe: the other settings of version 1 are read as before (getFee, getLimits of mainnet)', async () => {
    // Mainnet's real answers on 14 Oct 2026: fee 0 (an empty buffer) and
    // limits 120, 50, 33, 64, 30 years, 100.
    const post = jest.fn().mockImplementation((_url: string, body: any) => {
      if (body.funcName === 'getFee') return Promise.resolve(ok(['']));
      if (body.funcName === 'getLimits')
        return Promise.resolve(
          ok([
            'AAAAAAAAAHgAAAAAAAAAMgAAAAAAAAAhAAAAAAAAAEAAAAAAOGQJAAAAAAAAAABk'
          ])
        );
      return Promise.reject(httpFailure(400, V1_ANSWER));
    });
    const client = clientWith(post, cached);
    await expect(client.fee()).resolves.toBe(0n);
    await expect(client.limits()).resolves.toEqual({
      maxBatch: 50,
      maxBatchCancelable: 33,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    });
    await expect(client.tokenFee()).resolves.toBe(0);
  });
});

describe('safe: reading the token fee of version 2', () => {
  it('safe: 10 bps, and 0 when the owner has not set it yet (an empty buffer)', async () => {
    // Devnet's real answer on 14 Oct 2026: "Cg==" is 10.
    const ten = jest.fn().mockResolvedValue(ok(['Cg==']));
    await expect(clientWith(ten, cached).tokenFee()).resolves.toBe(10);
    clearCache();
    const unset = jest.fn().mockResolvedValue(ok(['']));
    await expect(clientWith(unset, cached).tokenFee()).resolves.toBe(0);
  });

  it("safe: devnet's version 2 limits decode as 49 and 32", async () => {
    const post = jest
      .fn()
      .mockResolvedValue(
        ok(['AAAAAAAAAHgAAAAAAAAAMQAAAAAAAAAgAAAAAAAAAEAAAAAAOGQJAAAAAAAAAABk'])
      );
    await expect(clientWith(post, cached).limits()).resolves.toMatchObject({
      maxBatch: 49,
      maxBatchCancelable: 32
    });
  });
});

describe('safe: a failure of the network is never read as no token fee', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Runs `work` while the queue's retries and pauses play out. */
  const settle = async <T>(work: () => Promise<T>) => {
    const promise = work();
    // Swallowed here only so an unhandled rejection does not fire while the
    // clock advances; the caller inspects `promise`.
    promise.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(120_000);
    return promise;
  };

  it("safe: the API's rate limit (429) is retried, then thrown", async () => {
    const post = jest.fn().mockRejectedValue(
      httpFailure(429, {
        statusCode: 429,
        message: 'ThrottlerException: Too Many Requests'
      })
    );
    const promise = settle(() => clientWith(post, cached).tokenFee());
    await expect(promise).rejects.toThrow(/Too Many Requests/);
    expect(post.mock.calls.length).toBeGreaterThan(1);
  });

  it("safe: Cloudflare's HTML answer (502 or 1015) is thrown", async () => {
    const post = jest
      .fn()
      .mockRejectedValue(
        httpFailure(502, '<html><body>502 Bad Gateway</body></html>')
      );
    const promise = settle(() => clientWith(post, cached).tokenFee());
    await expect(promise).rejects.toThrow(/502/);
  });

  it('safe: a timeout is thrown', async () => {
    const post = jest
      .fn()
      .mockRejectedValue(noAnswer('timeout of 15000ms exceeded'));
    const promise = settle(() => clientWith(post, cached).tokenFee());
    await expect(promise).rejects.toThrow(/timeout/);
  });

  it('safe: a network error is thrown', async () => {
    const post = jest.fn().mockRejectedValue(noAnswer('Network Error'));
    const promise = settle(() => clientWith(post, cached).tokenFee());
    await expect(promise).rejects.toThrow(/Network Error/);
  });

  it("safe: the contract's own refusals other than a missing function are thrown", async () => {
    // What a query answers when the VM fails inside the function.
    const post = jest.fn().mockResolvedValue({
      data: {
        returnData: null,
        returnCode: 'execution failed',
        returnMessage: 'not enough gas'
      }
    });
    const promise = settle(() => clientWith(post, cached).tokenFee());
    await expect(promise).rejects.toThrow(/not enough gas/);
    // The contract answered: asked once, not retried.
    expect(post).toHaveBeenCalledTimes(1);
  });
});
