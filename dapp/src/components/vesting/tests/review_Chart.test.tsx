// Adversarial review: the schedule chart of a long stepped schedule.
//
// The chart draws the releases listed by releases(..., { limit: 2000 }) and
// then a flat line to the right edge at the level reached. A schedule with
// more than 2,000 releases ("every 1 day" for 6 years and more) is drawn as
// if it stopped vesting part way, both in the Create preview and on the
// vesting page; nothing on the chart says it is cut.

import { render } from '@testing-library/react';
import { ScheduleChart } from 'components/vesting/Chart';
import { buildSchedule, DAY } from 'vesting/builder';

describe('review: chart of a schedule with more than 2,000 releases', () => {
  it('reaches 100% at the end', () => {
    const start = Date.UTC(2027, 0, 1) / 1000;
    const total = 3650n * 10n ** 18n;
    // Every day for ten years: 3,650 releases.
    const schedule = buildSchedule(
      { start, shape: { kind: 'days', days: 1, count: 3650 } },
      total
    );
    expect(schedule.end).toBe(start + 3650 * DAY);
    const { container } = render(
      <ScheduleChart
        schedule={schedule}
        total={total}
        decimals={18}
        ticker='TFOX'
      />
    );
    const line = container.querySelector(
      'path.stroke-accent'
    ) as SVGPathElement;
    const points = (line.getAttribute('d') ?? '').trim().split(' ');
    const [, lastY] = points[points.length - 1].slice(1).split(',');
    // y = 0 is the top of the box: everything vested. Today: 135.6, i.e. the
    // chart shows 2000/3650 = 55% vested at the end, flat for four years.
    expect(Number(lastY)).toBe(0);
  });
});
