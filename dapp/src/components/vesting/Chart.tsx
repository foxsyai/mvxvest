import { useMemo } from 'react';
import { releases } from 'vesting/builder';
import { formatAmount, formatDay } from 'vesting/format';
import { Schedule, vestedAt, vestedWithCancel } from 'vesting/schedule';

const W = 1000;
const H = 300;

/** The vested-amount curve as points in a W x H box (y down). */
const curve = (
  schedule: Schedule,
  total: bigint,
  from: number,
  to: number,
  at: (t: number) => bigint
): string => {
  const x = (t: number) => ((t - from) / (to - from)) * W;
  const y = (v: bigint) =>
    H - (total === 0n ? 0 : Number((v * 10_000n) / total) / 10_000) * H;
  const points: [number, number][] = [[0, H]];
  if (schedule.curve.kind === 'linear') {
    points.push([x(schedule.cliff), y(at(schedule.cliff - 1))]);
    const segments = 160;
    for (let i = 0; i <= segments; i++) {
      const t =
        schedule.cliff + Math.round(((to - schedule.cliff) * i) / segments);
      points.push([x(t), y(at(t))]);
    }
  } else {
    let level = 0n;
    for (const row of releases(schedule, total, { limit: 2000 }).rows) {
      const next = at(row.time);
      points.push([x(row.time), y(level)]);
      points.push([x(row.time), y(next)]);
      level = next;
    }
    points.push([W, y(level)]);
  }
  return points
    .map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
    .join(' ');
};

/**
 * The vested amount over time: a line for a linear curve, steps for releases
 * on dates. Shapes only in the SVG, which stretches to any width; the labels
 * are text around it, so they stay readable on a phone.
 */
export const ScheduleChart = ({
  schedule,
  total,
  decimals,
  ticker,
  now,
  cancelledAt = 0
}: {
  schedule: Schedule;
  total: bigint;
  decimals: number;
  ticker: string;
  now?: number;
  cancelledAt?: number;
}) => {
  const from = Math.min(schedule.start, schedule.cliff);
  const to = Math.max(schedule.end, from + 1);
  const { actual, planned } = useMemo(
    () => ({
      planned: curve(schedule, total, from, to, (t) =>
        vestedAt(schedule, total, t)
      ),
      actual: cancelledAt
        ? curve(schedule, total, from, to, (t) =>
            vestedWithCancel(schedule, total, cancelledAt, t)
          )
        : null
    }),
    [schedule, total, from, to, cancelledAt]
  );
  const xPercent = (t: number) => ((t - from) / (to - from)) * 100;
  const inside = (t?: number) => t !== undefined && t > from && t < to;
  const main = actual ?? planned;

  return (
    <figure className='space-y-1'>
      <div className='flex justify-between text-xs text-muted'>
        <span>
          {formatAmount(total, decimals, 2)} {ticker}
        </span>
        <span>vested over time</span>
      </div>
      <div className='relative h-44 w-full sm:h-56'>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio='none'
          className='absolute inset-0 h-full w-full overflow-visible'
          role='img'
          aria-label='Vested amount over time'
        >
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            className='stroke-line'
            vectorEffect='non-scaling-stroke'
          />
          <path d={`${main} L${W},${H} L0,${H} Z`} className='fill-accent/10' />
          {actual && (
            <path
              d={planned}
              fill='none'
              className='stroke-faint'
              strokeWidth='1.5'
              strokeDasharray='5 5'
              vectorEffect='non-scaling-stroke'
            />
          )}
          <path
            d={main}
            fill='none'
            className='stroke-accent'
            strokeWidth='2.5'
            strokeLinejoin='round'
            vectorEffect='non-scaling-stroke'
          />
        </svg>
        {inside(now) && (
          <div
            className='absolute inset-y-0 border-l border-dashed border-ink/40'
            style={{ left: `${xPercent(now!)}%` }}
          />
        )}
        {inside(cancelledAt) && (
          <div
            className='absolute inset-y-0 border-l-2 border-cancel'
            style={{ left: `${xPercent(cancelledAt)}%` }}
          />
        )}
      </div>
      <div className='flex justify-between text-xs text-muted'>
        <span>{formatDay(from)}</span>
        <span>{formatDay(to)}</span>
      </div>
      {(inside(now) || inside(cancelledAt)) && (
        <figcaption className='flex flex-wrap gap-4 text-xs text-muted'>
          {inside(now) && (
            <span className='flex items-center gap-1.5'>
              <span className='inline-block h-3 border-l border-dashed border-ink/60' />{' '}
              now
            </span>
          )}
          {inside(cancelledAt) && (
            <span className='flex items-center gap-1.5'>
              <span className='inline-block h-3 border-l-2 border-cancel' />{' '}
              cancelled; the dashed line is the original plan
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
};
