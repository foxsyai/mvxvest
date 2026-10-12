// The TypeScript port of the vesting maths against golden vectors written by
// the contract's own Rust code (contracts/vesting/tests/export_vectors.rs):
// 400 random schedules, 6,800 moments. Any difference fails here.

import {
  Curve,
  nextRelease,
  Schedule,
  SCHEDULE_ERRORS,
  validateSchedule,
  vestedAt,
  vestedWithCancel
} from '../schedule';
import vectors from './vectors.json';

interface RawCurve {
  kind: 'linear' | 'stepped' | 'tranches';
  interval?: number;
  tranches?: { time: number; amount: string }[];
}

interface RawCase {
  total: string;
  schedule: {
    start: number;
    cliff: number;
    cliffAmount: string;
    end: number;
    curve: RawCurve;
  };
  samples: { t: number; vested: string; next: [number, string] | null }[];
}

const toCurve = (raw: RawCurve): Curve => {
  if (raw.kind === 'linear') return { kind: 'linear' };
  if (raw.kind === 'stepped')
    return { kind: 'stepped', interval: raw.interval! };
  return {
    kind: 'tranches',
    tranches: raw.tranches!.map((tranche) => ({
      time: tranche.time,
      amount: BigInt(tranche.amount)
    }))
  };
};

const cases = (vectors as RawCase[]).map((raw) => ({
  total: BigInt(raw.total),
  schedule: {
    start: raw.schedule.start,
    cliff: raw.schedule.cliff,
    cliffAmount: BigInt(raw.schedule.cliffAmount),
    end: raw.schedule.end,
    curve: toCurve(raw.schedule.curve)
  } as Schedule,
  samples: raw.samples
}));

describe('vesting maths matches the contract', () => {
  it('has the vectors', () => {
    expect(cases.length).toBe(400);
  });

  it('accepts every schedule the contract accepted', () => {
    for (const { schedule, total } of cases) {
      expect(validateSchedule(schedule, total)).toBeNull();
    }
  });

  it('vests exactly what the contract vests, at every sampled moment', () => {
    for (const [index, { schedule, total, samples }] of cases.entries()) {
      for (const sample of samples) {
        const ours = vestedAt(schedule, total, sample.t).toString();
        if (ours !== sample.vested) {
          throw new Error(
            `case ${index} at ${sample.t}: ${ours} != ${sample.vested}`
          );
        }
      }
    }
  });

  it('predicts the same next release', () => {
    for (const [index, { schedule, total, samples }] of cases.entries()) {
      for (const sample of samples) {
        const ours = nextRelease(schedule, total, sample.t);
        const theirs = sample.next;
        const same =
          ours === null
            ? theirs === null
            : theirs !== null &&
              ours[0] === theirs[0] &&
              ours[1].toString() === theirs[1];
        if (!same) {
          throw new Error(
            `case ${index} at ${sample.t}: ${JSON.stringify(ours, (_, v) => (typeof v === 'bigint' ? v.toString() : v))} != ${JSON.stringify(theirs)}`
          );
        }
      }
    }
  });
});

describe('validation gives the contract error messages', () => {
  const linear = (
    start: number,
    cliff: number,
    cliffAmount: bigint,
    end: number
  ): Schedule => ({
    start,
    cliff,
    cliffAmount,
    end,
    curve: { kind: 'linear' }
  });

  it('refuses what the contract refuses', () => {
    expect(validateSchedule(linear(0, 0, 0n, 10), 0n)).toBe(
      SCHEDULE_ERRORS.zeroTotal
    );
    expect(validateSchedule(linear(5, 4, 0n, 10), 1n)).toBe(
      SCHEDULE_ERRORS.timeOrder
    );
    expect(validateSchedule(linear(0, 0, 2n, 10), 1n)).toBe(
      SCHEDULE_ERRORS.cliffAboveTotal
    );
    expect(
      validateSchedule(
        { ...linear(0, 0, 0n, 10), curve: { kind: 'stepped', interval: 11 } },
        1n
      )
    ).toBe(SCHEDULE_ERRORS.intervalTooLong);
    expect(
      validateSchedule(
        {
          ...linear(0, 0, 0n, 20),
          curve: {
            kind: 'tranches',
            tranches: [
              { time: 20, amount: 1n },
              { time: 10, amount: 1n }
            ]
          }
        },
        2n
      )
    ).toBe(SCHEDULE_ERRORS.trancheOrder);
  });
});

describe('a cancel freezes what has vested', () => {
  it('stops at the cancel', () => {
    const schedule: Schedule = {
      start: 0,
      cliff: 0,
      cliffAmount: 0n,
      end: 1000,
      curve: { kind: 'linear' }
    };
    expect(vestedWithCancel(schedule, 1000n, 300, 700)).toBe(300n);
    expect(vestedWithCancel(schedule, 1000n, 300, 200)).toBe(200n);
    expect(vestedWithCancel(schedule, 1000n, 0, 700)).toBe(700n);
  });
});
