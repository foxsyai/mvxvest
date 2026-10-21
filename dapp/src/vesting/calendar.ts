// What a set of vestings unlocks month by month: the community's view of a
// token's supply coming free.

import type { Vesting } from './client';
import { vestedWithCancel } from './schedule';

export interface Month {
  /** First second of the month, UTC. */
  start: number;
  /** Vested during this month, across every vesting. */
  unlocked: bigint;
}

/**
 * The first second (UTC) of the month `offset` months after the one holding
 * `seconds`. In UTC throughout, like the labels: the Create form's
 * addMonths() keeps the reader's local time of day, which moved every later
 * month's start a day early west of UTC and an hour across a summer-time
 * change, so releases landed under the wrong month (fourth audit, DT-1).
 */
const monthStart = (seconds: number, offset = 0) => {
  const date = new Date(seconds * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1) / 1000;
};

/** The next `months` calendar months from the one containing `now`. */
export const unlockCalendar = (
  list: Vesting[],
  now: number,
  months = 24
): Month[] => {
  const first = monthStart(now);
  const calendar: Month[] = [];
  for (let i = 0; i < months; i++) {
    const start = monthStart(first, i);
    const end = monthStart(first, i + 1);
    let unlocked = 0n;
    for (const v of list) {
      const from = Math.max(start, now);
      unlocked +=
        vestedWithCancel(v.schedule, v.total, v.cancelledAt, end - 1) -
        vestedWithCancel(v.schedule, v.total, v.cancelledAt, from - 1);
    }
    calendar.push({ start, unlocked });
  }
  return calendar;
};
