// The table of a linear schedule shows checkpoints at a round step: a week by
// day, a year by month, four years by quarter (Sebastian asked about 24 rows
// at 7-hour steps for a one-week vesting).

import { addMonths, DAY, releases } from '../builder';
import type { Schedule } from '../schedule';

const START = new Date(2026, 9, 12, 22, 30).getTime() / 1000;
const linear = (end: number): Schedule => ({
  start: START,
  cliff: START,
  cliffAmount: 0n,
  end,
  curve: { kind: 'linear' }
});
const times = (schedule: Schedule) =>
  releases(schedule, 1_000_000n).rows.map((row) => row.time);

describe('checkpoints of a linear schedule', () => {
  it('a week: one a day', () => {
    const rows = times(linear(START + 7 * DAY));
    expect(rows).toEqual(
      Array.from({ length: 7 }, (_, k) => START + (k + 1) * DAY)
    );
  });
  it('a year: one a month, on the same day of the month', () => {
    const rows = times(linear(addMonths(START, 12)));
    expect(rows).toEqual(
      Array.from({ length: 12 }, (_, k) => addMonths(START, k + 1))
    );
  });
  it('four years: one a quarter', () => {
    expect(times(linear(addMonths(START, 48)))).toHaveLength(16);
  });
  it('the last row is the end, and everything has vested there', () => {
    const schedule = linear(START + 10 * DAY + 3_600);
    const { rows } = releases(schedule, 1_000_000n);
    expect(rows[rows.length - 1].time).toBe(schedule.end);
    expect(rows[rows.length - 1].vested).toBe(1_000_000n);
    expect(rows.length).toBeLessThanOrEqual(25);
  });
});
