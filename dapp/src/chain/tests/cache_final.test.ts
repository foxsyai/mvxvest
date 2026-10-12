// A read cached before a transaction's final result is fetched again once a
// signing panel announces that result (#331 showed "Vesting" after its cancel
// was done: Sebastian, devnet, 12 Oct 2026).

import { cached } from '../network';

it('reads again after "mvxvest:final"', async () => {
  let reads = 0;
  const read = () => cached('test:vesting-331', async () => ++reads);
  expect(await read()).toBe(1);
  expect(await read()).toBe(1);
  window.dispatchEvent(new CustomEvent('mvxvest:final'));
  expect(await read()).toBe(2);
});
