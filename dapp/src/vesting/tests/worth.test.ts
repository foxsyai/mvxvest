import type { Vesting } from '../client';
import { worthClaiming } from '../describe';

const T = 10n ** 18n;
const linear = (claimable: bigint, claimed = 0n): Vesting =>
  ({
    total: 12_000n * T,
    finalAmount: 12_000n * T,
    claimed,
    claimable,
    cancelledAt: 0,
    schedule: {
      start: 0,
      cliff: 0,
      cliffAmount: 0n,
      end: 100,
      curve: { kind: 'linear' }
    }
  }) as unknown as Vesting;

describe('worth claiming in "Claim all"', () => {
  it('not a few seconds of a linear vesting right after a claim', () => {
    expect(worthClaiming(linear(27n * 10n ** 15n, 4_002n * T))).toBe(false);
  });
  it('a linear vesting once 1% of it is claimable', () => {
    expect(worthClaiming(linear(120n * T))).toBe(true);
  });
  it('the last of a linear vesting, however small', () => {
    expect(worthClaiming(linear(1n, 12_000n * T - 1n))).toBe(true);
  });
  it('any release of a vesting on dates', () => {
    const v = linear(1n);
    (v.schedule as any).curve = { kind: 'tranches', tranches: [] };
    expect(worthClaiming(v)).toBe(true);
  });
});
