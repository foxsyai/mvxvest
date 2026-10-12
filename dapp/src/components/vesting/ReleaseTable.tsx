import { useMemo, useState } from 'react';
import { Amount, Info, When } from 'components/ui';
import { releases } from 'vesting/builder';
import { Schedule } from 'vesting/schedule';

/**
 * Every release with its date, amount and running total. A linear curve
 * releases every second, so its rows are checkpoints, marked as such.
 */
export const ReleaseTable = ({
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
  const { rows, truncated } = useMemo(
    () => releases(schedule, total),
    [schedule, total]
  );
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 24);
  const continuous = schedule.curve.kind === 'linear';
  return (
    <div>
      {continuous && (
        <p className='mb-2 flex items-center text-xs text-muted'>
          Checkpoints
          <Info>
            Linear: tokens vest every second. These rows are checkpoints along
            the way, not separate releases.
          </Info>
        </p>
      )}
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-line text-left text-xs text-muted'>
              <th className='py-2 pr-4 font-semibold'>#</th>
              <th className='py-2 pr-4 font-semibold'>Date</th>
              <th className='py-2 pr-4 text-right font-semibold'>
                {continuous ? 'Vested since previous' : 'Released'}
              </th>
              <th className='py-2 text-right font-semibold'>Vested in total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr
                key={`${row.time}-${index}`}
                className={`border-b border-line/60 ${cancelledAt && row.time > cancelledAt ? 'text-faint line-through' : now !== undefined && row.time <= now ? 'text-muted' : ''}`}
              >
                <td className='py-1.5 pr-4 tabular text-faint'>{index + 1}</td>
                <td className='py-1.5 pr-4'>
                  <When seconds={row.time} />
                </td>
                <td className='py-1.5 pr-4 text-right'>
                  <Amount
                    units={row.amount}
                    decimals={decimals}
                    ticker={ticker}
                  />
                </td>
                <td className='py-1.5 text-right'>
                  <Amount units={row.vested} decimals={decimals} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <button
          type='button'
          onClick={() => setAll(true)}
          className='mt-2 text-sm text-accent hover:underline'
        >
          Show all {rows.length} rows
        </button>
      )}
      {truncated && (
        <p className='mt-2 text-xs text-muted'>
          Only the first {rows.length} releases are listed.
        </p>
      )}
    </div>
  );
};
