// Past the API's 10,000-item window the newest keys are asked about by name,
// so a vesting created after a wallet was flooded with dust still shows (red
// team RT1, the path its proof does not reach).

import { keysHeld } from '../reads';

const HELD_OLD = 10_400;
const NEWEST = 12_000;
const asked: string[] = [];

jest.mock('../network', () => ({
  api: async (path: string) => {
    asked.push(path);
    const url = new URL(`https://api.multiversx.com${path}`);
    const identifiers = url.searchParams.get('identifiers');
    if (identifiers) {
      // Held: the newest vesting's key only.
      return identifiers
        .split(',')
        .filter((id) => id === `VESTKEY-f56bea-${NEWEST.toString(16)}`)
        .map(() => ({ nonce: NEWEST }));
    }
    const from = Number(url.searchParams.get('from'));
    const size = Number(url.searchParams.get('size'));
    if (from + size > 10_000)
      throw Object.assign(new Error('400'), { status: 400 });
    return Array.from({ length: Math.min(size, HELD_OLD - from) }, (_, i) => ({
      nonce: from + i + 1
    }));
  }
}));

it('finds the newest key past the window', async () => {
  const nonces = await keysHeld('erd1...', 'VESTKEY-f56bea', NEWEST);
  expect(nonces).toContain(NEWEST);
  expect(nonces).toContain(10_000);
  // Never a page past the window.
  expect(asked.some((path) => /from=10000/.test(path))).toBe(false);
});
