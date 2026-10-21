// Fourth audit (DT, 20 Oct 2026): the release table of a long linear vesting
// stops short of its end and says nothing about it.
//
// releases() (vesting/builder.ts) shows a linear curve as checkpoints at a
// round step: the first of CHECKPOINT_STEPS whose 24th checkpoint reaches the
// end. The largest step is 12 months, so for a vesting longer than about 26
// years no step qualifies, the 12-month step is used anyway, and the loop
// stops after the 27th checkpoint (`rows.length > MAX_CHECKPOINTS + 2`)
// without ever reaching the end. `truncated` stays false, so the ReleaseTable
// shows no "Only the first N releases are listed" note either.
//
// A 30-year linear vesting (the longest the contract allows, MAX_HORIZON)
// shows 27 rows: the last one at year 27 with "Vested in total" at 90% of
// the total. On the Create page's preview and on the vesting page the table
// reads as if the vesting ended at year 27 with a tenth missing; the chart
// above it reaches the end. (buildSchedule's own test checks that the last
// row holds the total, for plans of up to four years.)
//
// Expected once fixed: the last row is the end, with the whole total vested
// (a larger step for long vestings, or the end row appended).

import { DAY, releases } from '../builder';
import { Schedule } from '../schedule';

const T0 = Date.UTC(2026, 9, 20) / 1000;

describe('audit4 DT: the checkpoints of a long linear vesting', () => {
  for (const years of [28, 30]) {
    it(`a ${years}-year linear vesting's table ends at its end with the whole total`, () => {
      const schedule: Schedule = {
        start: T0,
        cliff: T0,
        cliffAmount: 0n,
        end: T0 + years * 365 * DAY,
        curve: { kind: 'linear' }
      };
      const total = 1_000_000n * 10n ** 18n;
      const { rows } = releases(schedule, total);
      const last = rows[rows.length - 1];
      // Today: 27 rows, the last at year 27 with 27/30 of the total.
      expect(last.time).toBe(schedule.end);
      // (As text: jest's worker cannot report a failing BigInt.)
      expect(String(last.vested)).toBe(String(total));
    });
  }
});
