// Words for a vesting: its status and its schedule, as a reader would say them.

import type { Vesting } from './client';
import { formatDuration } from './format';
import { Schedule } from './schedule';

export type Status = 'upcoming' | 'vesting' | 'vested' | 'cancelled' | 'done';

export const statusOf = (vesting: Vesting, now: number): Status => {
  if (
    vesting.claimed === vesting.finalAmount &&
    (vesting.cancelledAt !== 0 || vesting.claimed === vesting.total)
  ) {
    return 'done';
  }
  if (vesting.cancelledAt !== 0) return 'cancelled';
  if (now < vesting.schedule.cliff) return 'upcoming';
  if (now >= vesting.schedule.end) return 'vested';
  return 'vesting';
};

export const STATUS_LABEL: Record<Status, string> = {
  upcoming: 'Not started',
  vesting: 'Vesting',
  vested: 'Fully vested',
  cancelled: 'Cancelled',
  done: 'Completed'
};

/** "Linear over 3 years", "Every 30 days, 12 releases", "4 explicit releases". */
export const describeCurve = (schedule: Schedule): string => {
  const { curve, start, end } = schedule;
  switch (curve.kind) {
    case 'linear':
      return `Linear over ${formatDuration(end - start)}`;
    case 'stepped': {
      const steps = Math.ceil((end - start) / curve.interval);
      return `Every ${formatDuration(curve.interval)}, ${steps} release${steps === 1 ? '' : 's'}`;
    }
    case 'tranches':
      return `${curve.tranches.length} release${curve.tranches.length === 1 ? '' : 's'} on set dates`;
  }
};

/** The key is spent: claiming only burns it. */
export const spent = (v: Vesting) =>
  v.cancelledAt !== 0 && v.claimed === v.finalAmount;

/**
 * Worth a claim in "Claim all": a release on a date, the last of a vesting,
 * a spent key, or, for a curve that grows every second, at least 1% of the
 * vesting (each claim costs a network fee; right after a claim a few seconds'
 * worth is claimable again, which is not worth one).
 */
export const worthClaiming = (v: Vesting) => {
  if (spent(v)) return true;
  if (v.claimable === 0n) return false;
  if (v.schedule.curve.kind !== 'linear') return true;
  if (v.claimed + v.claimable >= v.finalAmount) return true;
  return v.claimable * 100n >= v.finalAmount;
};
