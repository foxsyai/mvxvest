// Audit 5 (vest-dapp, VSD-06): a system clock stepped backwards stalls every
// read for as long as the step.
//
// chain/network.ts paces its requests with a token bucket refilled from
// Date.now() deltas: `tokens = min(BURST, tokens + (now - lastRefill) / 1000
// * RATE)`. A clock that steps back (a laptop waking up and syncing, a
// manual change) makes the delta negative, the bucket deeply negative, and
// pump() then waits `(1 - tokens) / RATE` seconds, which is the whole step:
// an hour back is an hour of a page that reads nothing. The same gap was
// found and fixed in mvxsafe on 21 Oct 2026 (BRW-11) with a monotonic clock.
//
// The control passes today; the last test fails on 26b0d4c and passes once
// the bucket runs on a monotonic clock (performance.now) or clamps the
// delta at zero.

import { api } from '../network';

const fetchMock = jest.fn(
  async () =>
    ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response
);

beforeAll(() => {
  jest.useFakeTimers();
  (globalThis as any).fetch = fetchMock;
});
afterAll(() => jest.useRealTimers());

describe('VSD-06, control (passes today)', () => {
  it('a read goes through at once', async () => {
    let done = false;
    api('/accounts/one').then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });
});

describe('VSD-06: the clock steps back one hour', () => {
  it('the next read still goes through within seconds', async () => {
    jest.setSystemTime(Date.now() - 3_600_000);
    let done = false;
    api('/accounts/two').then(() => {
      done = true;
    });
    // Today: pump() schedules the next pass about an hour ahead.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(done).toBe(true);
  });
});
