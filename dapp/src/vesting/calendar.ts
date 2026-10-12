// What a set of vestings unlocks month by month: the community's view of a
// token's supply coming free.

import { addMonths } from './builder';
import type { Vesting } from './client';
import { vestedWithCancel } from './schedule';

export interface Month {
  /** First second of the month, UTC. */
  start: number;
  /** Vested during this month, across every vesting. */
  unlocked: bigint;
}

const monthStart = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
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
    const start = addMonths(first, i);
    const end = addMonths(first, i + 1);
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
