// From what a person picks in the Create form (a plan) to the contract's
// schedule for one beneficiary's total. A plan is in percentages, so the same
// plan builds the schedule of every line of a CSV.
//
// Cliffs come in two styles:
// - "catch-up" (startup style): the curve runs from the start, nothing can be
//   claimed before the cliff, and at the cliff everything vested so far
//   unlocks at once;
// - "lump": a share of the total unlocks at the cliff, then the rest vests
//   from the cliff to the end.

import {
  MAX_TRANCHES,
  nextRelease,
  Schedule,
  Tranche,
  vestedAt
} from './schedule';

export const DAY = 86_400;
/** The contract refuses a schedule ending more than 30 years after creation. */
export const MAX_HORIZON = 30 * 365 * DAY;

export type Shape =
  /** Every second, until `end`. */
  | { kind: 'linear'; end: number }
  /** `count` equal releases, one every `days` days. */
  | { kind: 'days'; days: number; count: number }
  /** `count` releases on the same day of the month, every `months` months. */
  | { kind: 'months'; months: number; count: number }
  /** Explicit releases: a time and a share of the total in basis points. */
  | { kind: 'tranches'; tranches: { time: number; bps: number }[] };

export interface Cliff {
  at: number;
  style: 'catch-up' | 'lump';
  /** For a lump: the share of the total unlocked at the cliff, in basis points. */
  bps: number;
}

export interface Plan {
  start: number;
  cliff?: Cliff;
  shape: Shape;
}

/**
 * The same day of the month `months` later, in UTC, at the same time of day;
 * the 31st becomes the 30th or the 28th where the month is shorter. Always
 * from the anchor, never from the previous date, so the clamp does not drift
 * (as foxsy-ops does).
 */
export const addMonths = (anchor: number, months: number): number => {
  const date = new Date(anchor * 1000);
  const totalMonths = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return (
    Date.UTC(
      year,
      month,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    ) / 1000
  );
};

const share = (total: bigint, bps: number) =>
  (total * BigInt(Math.round(bps))) / 10_000n;

/** Equal amounts of `rest` over `count` releases, the remainder in the last. */
const equalSplit = (rest: bigint, count: number): bigint[] => {
  const each = rest / BigInt(count);
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? rest - each * BigInt(count - 1) : each
  );
};

/** Why a plan cannot be built, in words for the form; null when it can. */
export const planProblem = (plan: Plan): string | null => {
  const { shape, cliff } = plan;
  if (cliff) {
    if (cliff.at < plan.start) return 'The cliff cannot be before the start.';
    if (cliff.style === 'lump' && (cliff.bps < 0 || cliff.bps > 10_000)) {
      return 'The share at the cliff must be between 0% and 100%.';
    }
  }
  switch (shape.kind) {
    case 'linear':
      if (shape.end <= (cliff?.at ?? plan.start))
        return 'The end must come after the start and the cliff.';
      return null;
    case 'days':
      if (!Number.isInteger(shape.days) || shape.days < 1)
        return 'Choose at least 1 day between releases.';
      if (!Number.isInteger(shape.count) || shape.count < 1)
        return 'Choose at least 1 release.';
      return null;
    case 'months':
      if (!Number.isInteger(shape.months) || shape.months < 1)
        return 'Choose at least 1 month between releases.';
      if (!Number.isInteger(shape.count) || shape.count < 1)
        return 'Choose at least 1 release.';
      if (shape.count > MAX_TRANCHES)
        return `At most ${MAX_TRANCHES} releases.`;
      return null;
    case 'tranches': {
      const { tranches } = shape;
      if (cliff?.style === 'lump') {
        return 'With explicit releases, make the first release the cliff instead of a share at the cliff.';
      }
      if (tranches.length === 0) return 'Add at least one release.';
      if (tranches.length > MAX_TRANCHES)
        return `At most ${MAX_TRANCHES} releases.`;
      for (let i = 1; i < tranches.length; i++) {
        if (tranches[i].time <= tranches[i - 1].time)
          return 'Each release must come after the one before it.';
      }
      if (tranches[0].time < plan.start)
        return 'No release can come before the start.';
      if (tranches.some((tranche) => tranche.bps <= 0))
        return 'Every release needs a share above 0%.';
      const sum = tranches.reduce((total, tranche) => total + tranche.bps, 0);
      if (Math.round(sum) !== 10_000)
        return `The shares add up to ${(sum / 100).toFixed(2)}%, not 100%.`;
      return null;
    }
  }
};

/**
 * The contract schedule of `plan` for a vesting of `total`. Assumes
 * `planProblem(plan)` is null; the contract checks the result again.
 */
export const buildSchedule = (plan: Plan, total: bigint): Schedule => {
  const { shape, cliff } = plan;
  // A lump cliff moves the origin of the curve to the cliff.
  const lump = cliff?.style === 'lump';
  const origin = lump ? cliff!.at : plan.start;
  const cliffAt = cliff?.at ?? plan.start;
  const cliffAmount = lump ? share(total, cliff!.bps) : 0n;
  const rest = total - cliffAmount;

  switch (shape.kind) {
    case 'linear':
      return {
        start: origin,
        cliff: cliffAt,
        cliffAmount,
        end: shape.end,
        curve: { kind: 'linear' }
      };
    case 'days': {
      const interval = shape.days * DAY;
      return {
        start: origin,
        cliff: cliffAt,
        cliffAmount,
        end: origin + interval * shape.count,
        curve: { kind: 'stepped', interval }
      };
    }
    case 'months': {
      const amounts = equalSplit(rest, shape.count);
      const tranches: Tranche[] = amounts.map((amount, i) => ({
        time: addMonths(origin, shape.months * (i + 1)),
        amount
      }));
      return finishTranches(origin, cliffAt, cliffAmount, tranches);
    }
    case 'tranches': {
      // Shares of the total: everything goes to the tranches (no lump), the
      // rounding remainder to the last one.
      let given = 0n;
      const tranches = shape.tranches.map((tranche, i) => {
        const amount =
          i === shape.tranches.length - 1
            ? total - given
            : share(total, tranche.bps);
        given += amount;
        return { time: tranche.time, amount };
      });
      return finishTranches(plan.start, cliffAt, 0n, tranches);
    }
  }
};

/**
 * A tranche worth 0 (a tiny total split many ways) is folded into the next
 * one: the contract refuses empty tranches.
 */
const finishTranches = (
  start: number,
  cliff: number,
  cliffAmount: bigint,
  tranches: Tranche[]
): Schedule => {
  const kept: Tranche[] = [];
  let carry = 0n;
  for (const tranche of tranches) {
    const amount = tranche.amount + carry;
    if (amount === 0n) continue;
    carry = 0n;
    kept.push({ time: tranche.time, amount });
  }
  const end = tranches[tranches.length - 1].time;
  // Nothing left for the tranches (all of it unlocks at the cliff): a linear
  // curve with nothing to release says the same and the contract accepts it.
  if (kept.length === 0)
    return { start, cliff, cliffAmount, end, curve: { kind: 'linear' } };
  return {
    start,
    cliff,
    cliffAmount,
    end: kept[kept.length - 1].time,
    curve: { kind: 'tranches', tranches: kept }
  };
};

export interface Release {
  time: number;
  amount: bigint;
  /** Vested in total once this release is in. */
  vested: bigint;
  /** A checkpoint of a linear curve rather than a discrete release. */
  continuous?: boolean;
}

/**
 * Every release of a schedule, for the table and the chart. A linear curve
 * releases every second, so it is shown as the cliff plus checkpoints (about
 * `checkpoints` of them); stepped and explicit schedules list every release,
 * up to `limit`.
 */
export const releases = (
  schedule: Schedule,
  total: bigint,
  { limit = 2000, checkpoints = 24 } = {}
): { rows: Release[]; truncated: boolean } => {
  const rows: Release[] = [];
  if (schedule.curve.kind === 'linear') {
    const atCliff = vestedAt(schedule, total, schedule.cliff);
    if (atCliff > 0n)
      rows.push({ time: schedule.cliff, amount: atCliff, vested: atCliff });
    const from = schedule.cliff;
    const span = schedule.end - from;
    let previous = atCliff;
    for (let i = 1; i <= checkpoints && span > 0; i++) {
      const time =
        i === checkpoints
          ? schedule.end
          : from + Math.round((span * i) / checkpoints);
      const vested = vestedAt(schedule, total, time);
      if (vested > previous || i === checkpoints) {
        rows.push({
          time,
          amount: vested - previous,
          vested,
          continuous: true
        });
        previous = vested;
      }
    }
    return { rows, truncated: false };
  }
  let now = Math.min(schedule.start, schedule.cliff) - 1;
  let vested = vestedAt(schedule, total, now);
  for (;;) {
    const next = nextRelease(schedule, total, now);
    if (!next) break;
    if (rows.length >= limit) return { rows, truncated: true };
    const [time, amount] = next;
    vested += amount;
    rows.push({ time, amount, vested });
    now = time;
  }
  return { rows, truncated: false };
};
