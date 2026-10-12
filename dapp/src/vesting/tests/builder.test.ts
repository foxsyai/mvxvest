import {
  addMonths,
  buildSchedule,
  DAY,
  Plan,
  planProblem,
  releases
} from '../builder';
import { validateSchedule, vestedAt } from '../schedule';

const T0 = Date.UTC(2026, 0, 31, 12, 0, 0) / 1000; // 31 Jan 2026, 12:00 UTC
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// In the reader's calendar (tests run in Europe/Bucharest): the same wall
// clock time across summer time, so the UTC hour moves by one in April.
const local = (seconds: number) => {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe('calendar months', () => {
  it('keeps the day of the month, clamped to the month, without drifting', () => {
    const anchor = new Date(2026, 0, 31, 12, 0, 0).getTime() / 1000;
    expect(local(addMonths(anchor, 1))).toBe('2026-02-28 12:00');
    expect(local(addMonths(anchor, 2))).toBe('2026-03-31 12:00');
    expect(local(addMonths(anchor, 13))).toBe('2027-02-28 12:00');
    expect(local(addMonths(new Date(2027, 11, 31).getTime() / 1000, 2))).toBe(
      '2028-02-29 00:00'
    );
  });

  it('keeps the wall clock time across summer time', () => {
    const anchor = new Date(2026, 0, 15, 9, 30).getTime() / 1000;
    expect(iso(addMonths(anchor, 1))).toBe('2026-02-15T07:30:00.000Z');
    expect(iso(addMonths(anchor, 4))).toBe('2026-05-15T06:30:00.000Z');
  });
});

const plans: [string, Plan][] = [
  [
    'linear, no cliff',
    { start: T0, shape: { kind: 'linear', end: T0 + 365 * DAY } }
  ],
  [
    'linear, catch-up cliff',
    {
      start: T0,
      cliff: { at: T0 + 90 * DAY, style: 'catch-up', bps: 0 },
      shape: { kind: 'linear', end: T0 + 365 * DAY }
    }
  ],
  [
    'linear, 10% at the cliff',
    {
      start: T0,
      cliff: { at: T0 + 90 * DAY, style: 'lump', bps: 1000 },
      shape: { kind: 'linear', end: T0 + 365 * DAY }
    }
  ],
  [
    'every 7 days, 52 times',
    { start: T0, shape: { kind: 'days', days: 7, count: 52 } }
  ],
  [
    'monthly, 48 times',
    { start: T0, shape: { kind: 'months', months: 1, count: 48 } }
  ],
  [
    'quarterly after a 25% cliff',
    {
      start: T0,
      cliff: { at: T0 + 365 * DAY, style: 'lump', bps: 2500 },
      shape: { kind: 'months', months: 3, count: 12 }
    }
  ],
  [
    '100% at the cliff',
    {
      start: T0,
      cliff: { at: T0 + 30 * DAY, style: 'lump', bps: 10_000 },
      shape: { kind: 'months', months: 1, count: 6 }
    }
  ],
  [
    'explicit releases',
    {
      start: T0,
      shape: {
        kind: 'tranches',
        tranches: [
          { time: T0 + 10 * DAY, bps: 3333 },
          { time: T0 + 20 * DAY, bps: 3333 },
          { time: T0 + 30 * DAY, bps: 3334 }
        ]
      }
    }
  ]
];

describe('every plan builds a schedule the contract accepts', () => {
  for (const [name, plan] of plans) {
    it(name, () => {
      expect(planProblem(plan)).toBeNull();
      for (const total of [
        1n,
        7n,
        1_000n,
        10n ** 18n * 1_234_567n,
        10n ** 30n + 13n
      ]) {
        const schedule = buildSchedule(plan, total);
        expect(validateSchedule(schedule, total)).toBeNull();
        expect(vestedAt(schedule, total, schedule.end)).toBe(total);
        const { rows } = releases(schedule, total);
        expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(total);
        expect(rows[rows.length - 1].vested).toBe(total);
      }
    });
  }
});

describe('plans', () => {
  it('puts the remainder in the last monthly release', () => {
    const schedule = buildSchedule(
      { start: T0, shape: { kind: 'months', months: 1, count: 3 } },
      10n
    );
    expect(
      schedule.curve.kind === 'tranches' &&
        schedule.curve.tranches.map((t) => t.amount)
    ).toEqual([3n, 3n, 4n]);
  });

  it('a lump moves the curve to the cliff', () => {
    const cliffAt = T0 + 100 * DAY;
    const schedule = buildSchedule(
      {
        start: T0,
        cliff: { at: cliffAt, style: 'lump', bps: 1000 },
        shape: { kind: 'linear', end: T0 + 200 * DAY }
      },
      1000n
    );
    expect(schedule).toMatchObject({
      start: cliffAt,
      cliff: cliffAt,
      cliffAmount: 100n
    });
  });

  it('explains what is wrong', () => {
    expect(
      planProblem({ start: T0, shape: { kind: 'linear', end: T0 } })
    ).toMatch(/end must come after/);
    expect(
      planProblem({
        start: T0,
        shape: { kind: 'months', months: 1, count: 121 }
      })
    ).toMatch(/At most 120/);
    expect(
      planProblem({
        start: T0,
        shape: { kind: 'tranches', tranches: [{ time: T0 + 1, bps: 5000 }] }
      })
    ).toMatch(/add up to 50.00%/);
    expect(
      planProblem({
        start: T0,
        cliff: { at: T0, style: 'lump', bps: 100 },
        shape: { kind: 'tranches', tranches: [{ time: T0 + 1, bps: 10_000 }] }
      })
    ).toMatch(/first release the cliff/);
  });
});
