// Fourth audit (DT, 20 Oct 2026): the Token page's unlock calendar walks the
// months in the reader's local calendar from a UTC month start.
//
// unlockCalendar() (vesting/calendar.ts) takes the first second of the
// current month in UTC (monthStart: Date.UTC(y, m, 1)) and then walks the
// months with addMonths() from builder.ts, which works in the reader's LOCAL
// calendar (it was written for the Create form, whose dates are typed in the
// reader's zone). The Token page labels each bucket with the UTC month of its
// start (Token.tsx, monthLabel with timeZone 'UTC').
//
// West of UTC, 00:00 UTC on the first is still the last day of the previous
// local month, so every later bucket starts a day early. Read from New York
// in October 2026 the buckets start on 1 Oct, 31 Oct, 1 Dec 01:00, 31 Dec
// 01:00, 31 Jan 01:00, 1 Mar 01:00, 31 Mar 00:00... and the labels read
// "Oct 2026, Oct 2026, Dec 2026, Dec 2026, Jan 2027, Mar 2027, Mar 2027":
// November and February are missing, three months show twice, and what
// unlocks on 30 Nov is counted under "Oct 2026". East of UTC the summer-time
// change does the same once a year: read from Bucharest (the zone the tests
// run in) in January 2027, the April bucket starts on 31 Mar 23:00 UTC and is
// labelled "Mar 2027", next to the real March.
//
// The guide says of this page: "This is how a community checks a team."
// Expected once fixed: every bucket starts on the first second of a UTC
// month whatever the reader's zone (Date.UTC(y, m + i, 1), not addMonths).

import { unlockCalendar } from '../calendar';
import type { Vesting } from '../client';

/** Runs `work` with the process in time zone `zone` (Node reads TZ live). */
const inZone = <T>(zone: string, work: () => T): T => {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    return work();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
};

const utcFirsts = (year: number, month: number, count = 24) =>
  Array.from({ length: count }, (_, i) => Date.UTC(year, month + i, 1) / 1000);

const starts = (now: number) =>
  unlockCalendar([], now, 24).map((month) => month.start);

const T = 10n ** 18n;
/** One release of `total` at `time`. */
const releaseAt = (time: number, total: bigint): Vesting => {
  const start = Date.UTC(2026, 9, 1) / 1000;
  return {
    id: 1,
    creator: '',
    beneficiary: '',
    token: 'FOXSY-5d5f3e',
    total,
    schedule: {
      start,
      cliff: start,
      cliffAmount: 0n,
      end: time,
      curve: { kind: 'tranches', tranches: [{ time, amount: total }] }
    },
    cancelable: false,
    createdAt: start,
    claimNonce: 1,
    cancelNonce: 0,
    label: '',
    claimed: 0n,
    cancelledAt: 0,
    vested: 0n,
    claimable: 0n,
    finalAmount: total,
    refunded: 0n,
    timestamp: start
  };
};

describe('audit4 DT: the unlock calendar starts every bucket on the first of a UTC month', () => {
  it('read from New York (west of UTC) in October 2026', () => {
    const now = Date.UTC(2026, 9, 20, 12) / 1000;
    // Today: [1 Oct, 31 Oct, 1 Dec 01:00, 31 Dec 01:00, 31 Jan 01:00, ...].
    expect(inZone('America/New_York', () => starts(now))).toEqual(
      utcFirsts(2026, 9)
    );
  });

  it('read from Bucharest in January 2027, across the summer-time change', () => {
    const now = Date.UTC(2027, 0, 15, 12) / 1000;
    // Today: the April bucket starts on 31 Mar 2027 23:00 UTC ("Mar 2027").
    expect(inZone('Europe/Bucharest', () => starts(now))).toEqual(
      utcFirsts(2027, 0)
    );
  });

  it('counts a release on 30 November under November, read from New York', () => {
    const now = Date.UTC(2026, 9, 20, 12) / 1000;
    const release = Date.UTC(2026, 10, 30, 23, 30) / 1000;
    const total = 1_000n * T;
    const calendar = inZone('America/New_York', () =>
      unlockCalendar([releaseAt(release, total)], now, 3)
    );
    const november = calendar.find(
      (month) => month.start === Date.UTC(2026, 10, 1) / 1000
    );
    // Today: no bucket starts on 1 Nov; the release sits in the bucket that
    // starts on 31 Oct 00:00 UTC, which the page labels "Oct 2026".
    // (Compared as text: jest's worker cannot report a failing BigInt.)
    expect(String(november?.unlocked)).toBe(String(total));
  });
});
