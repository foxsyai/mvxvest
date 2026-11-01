// Audit 5 (vest-dapp, VSD-05): the request timeout covers the headers only;
// a stalled body holds one of the three request slots for ever.
//
// chain/network.ts settles fetchWithTimeout() within 15 s "whatever the
// connection does" (WEB-06 of the mvxsafe audits), but api() and fresh() read
// the body afterwards (`await response.json()`), outside the timed region.
// A server, a proxy or someone on the path that answers the headers and then
// never ends the body keeps that read pending for ever: the queue's
// `running` counter is only decremented when the work settles, so each such
// read holds one of MAX_IN_FLIGHT (3) slots. After three, every read in the
// app (vestings, balances, the code check, the result of a signed
// transaction) waits until the tab is reloaded. The same gap was found and
// fixed in mvxsafe on 21 Oct 2026 (BRW-03).
//
// Fake timers: 90 s of application time covers the 15 s timeout and the
// three retries cached() makes for a retryable failure. Both tests fail on
// 26b0d4c (the reads never settle) and pass once the body read is inside
// the timed region.

import { api } from '../network';

const never = () => new Promise<never>(() => undefined);

/** A response whose headers arrive at once and whose body never ends. */
const stalled = () =>
  ({ ok: true, status: 200, json: never, text: never }) as unknown as Response;
const healthy = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ fine: true })
  }) as unknown as Response;

const fetchMock = jest.fn();

beforeAll(() => {
  jest.useFakeTimers();
  (globalThis as any).fetch = fetchMock;
});
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/stall') ? stalled() : healthy()
  );
});

const settle = <T>(promise: Promise<T>) =>
  promise.then(
    () => 'resolved' as const,
    () => 'rejected' as const
  );

describe('VSD-05, control (passes today)', () => {
  it('a healthy read resolves', async () => {
    const result = settle(api('/accounts/healthy-0'));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await result).toBe('resolved');
  });
});

describe('VSD-05: a body that never ends', () => {
  it('settles the read within the timeout instead of hanging for ever', async () => {
    const outcome = settle(api('/accounts/stall-1'));
    const deadline = new Promise<'still pending'>((resolve) =>
      setTimeout(() => resolve('still pending'), 90_000)
    );
    await jest.advanceTimersByTimeAsync(90_001);
    // Today: 'still pending'. Expected: 'rejected' (a timeout, like a
    // connection that never answered).
    expect(await Promise.race([outcome, deadline])).toBe('rejected');
  });

  it('three of them do not stop every other read in the app', async () => {
    const stalls = [1, 2, 3].map((i) => settle(api(`/accounts/stall-${i}`)));
    const later = settle(api('/accounts/healthy-after-stalls'));
    const deadline = new Promise<'still pending'>((resolve) =>
      setTimeout(() => resolve('still pending'), 90_000)
    );
    await jest.advanceTimersByTimeAsync(90_001);
    // Today: the three stalled reads hold all three slots, so the healthy
    // read is queued for ever ('still pending').
    expect(await Promise.race([later, deadline])).toBe('resolved');
    await Promise.all(stalls);
  });
});
