// Adversarial review: plans the form accepts but cannot build, and monthly
// releases anchored in UTC rather than in the reader's own calendar.

// Tests run in Europe/Bucharest (jest.globalSetup.js).
import { buildSchedule, DAY, Plan, planProblem, releases } from '../builder';
import { validateSchedule } from '../schedule';

const T0 = Date.UTC(2027, 0, 1) / 1000;

describe('review: values the form produces from a cleared or odd field', () => {
  // Create.tsx: fromLocalInput('') is NaN (a datetime-local input that was
  // cleared, or has one segment deleted), toBps('10%') is NaN.

  it('a cleared End date is reported as a problem, not built', () => {
    const plan: Plan = { start: T0, shape: { kind: 'linear', end: NaN } };
    expect(planProblem(plan)).not.toBeNull();
  });

  it('a NaN schedule is not accepted by the contract-check port', () => {
    const schedule = buildSchedule(
      { start: T0, shape: { kind: 'linear', end: NaN } },
      1000n
    );
    expect(validateSchedule(schedule, 1000n)).not.toBeNull();
  });

  it('the preview of such a plan does not throw (Create.tsx renders it)', () => {
    const schedule = buildSchedule(
      { start: T0, shape: { kind: 'linear', end: NaN } },
      1000n
    );
    // Today: RangeError (BigInt(NaN)) inside render, which unmounts the whole
    // app: a blank page and the form lost.
    expect(() => releases(schedule, 1000n)).not.toThrow();
  });

  it('a cleared cliff date is reported as a problem', () => {
    const plan: Plan = {
      start: T0,
      cliff: { at: NaN, style: 'catch-up', bps: 0 },
      shape: { kind: 'linear', end: T0 + 365 * DAY }
    };
    expect(planProblem(plan)).not.toBeNull();
  });

  it('a cliff share typed as "10%" (NaN) is reported, not thrown from render', () => {
    const plan: Plan = {
      start: T0,
      cliff: { at: T0 + 30 * DAY, style: 'lump', bps: NaN },
      shape: { kind: 'linear', end: T0 + 365 * DAY }
    };
    // planProblem lets NaN through (NaN < 0 and NaN > 10000 are both false)...
    expect(planProblem(plan)).not.toBeNull();
    // ...and buildSchedule then throws RangeError: BigInt(NaN).
    expect(() => buildSchedule(plan, 1000n)).not.toThrow();
  });
});

describe('review: "every N months, on the same day" in the reader\'s time zone', () => {
  // The form takes datetime-local in the reader's zone; addMonths keeps the
  // UTC day. East of UTC, a start late in the month at night lands on another
  // day in UTC, and the releases jump between the 1st and the last day.
  const bucharestDay = (seconds: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(seconds * 1000));

  it('monthly from 31 Jan 2027 00:30 in Bucharest releases once a month, at month end', () => {
    // 31 Jan 2027 00:30 in Bucharest (UTC+2) is 30 Jan 22:30 UTC.
    const start = Date.UTC(2027, 0, 30, 22, 30) / 1000;
    expect(bucharestDay(start)).toBe('31/01/2027');
    const schedule = buildSchedule(
      { start, shape: { kind: 'months', months: 1, count: 4 } },
      4000n
    );
    const days =
      schedule.curve.kind === 'tranches'
        ? schedule.curve.tranches.map((t) => bucharestDay(t.time))
        : [];
    // What the form promises: Feb 28, Mar 31, Apr 30, May 31.
    // What it builds today: 01/03, 31/03, 01/05, 31/05 (none in Feb or Apr).
    expect(days).toEqual([
      '28/02/2027',
      '31/03/2027',
      '30/04/2027',
      '31/05/2027'
    ]);
  });
});
