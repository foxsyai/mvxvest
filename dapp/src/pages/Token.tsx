import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { tokenVestings } from 'chain/mine';
import { vesting as client } from 'chain/vesting';
import {
  Amount,
  Badge,
  Button,
  Card,
  Info,
  Notice,
  PageTitle,
  Progress,
  Spinner
} from 'components/ui';
import { useAsync, useToken } from 'hooks';
import { unlockCalendar } from 'vesting/calendar';
import { STATUS_LABEL, statusOf } from 'vesting/describe';
import { formatAmount } from 'vesting/format';
import { vestedWithCancel } from 'vesting/schedule';

const monthLabel = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

/** Every vesting of one token: what is locked, vested and claimed, and when it unlocks. */
export const Token = () => {
  const identifier = useParams().token ?? '';
  const token = useToken(identifier);
  const [shown, setShown] = useState(50);
  const data = useAsync(async () => {
    const [totals, { list, count }] = await Promise.all([
      client.tokenTotals(identifier),
      tokenVestings(identifier)
    ]);
    return { totals, list, count };
  }, [identifier]);

  if (!data.data || token.decimals === undefined) {
    const failed = (data.error && !data.data) || token.failed;
    return (
      <div className='space-y-4'>
        <PageTitle back title={identifier} />
        {failed ? (
          <>
            <Notice tone='warn'>
              This token could not be read right now: the network did not
              answer.
            </Notice>
            <Button
              onClick={() => {
                if (!data.data) data.reload();
                if (token.failed) token.reload();
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    );
  }

  const { totals, list, count } = data.data;
  const now = Math.floor(Date.now() / 1000);
  const locked = totals.deposited - totals.claimed - totals.refunded;
  const vestedNow = list.reduce(
    (sum, v) => sum + vestedWithCancel(v.schedule, v.total, v.cancelledAt, now),
    0n
  );
  const committed = list.reduce(
    (sum, v) => sum + (v.cancelledAt ? v.finalAmount : v.total),
    0n
  );
  // With more vestings than are read, what is vested and when it unlocks is
  // computed from the newest ones only; the contract's totals are exact.
  const partial = count > list.length;
  const claimedListed = list.reduce((sum, v) => sum + v.claimed, 0n);
  const calendar = unlockCalendar(list, now);
  const biggest = calendar.reduce(
    (max, month) => (month.unlocked > max ? month.unlocked : max),
    0n
  );
  const d = token.decimals;

  return (
    <div className='space-y-6'>
      <PageTitle
        back
        title={token.ticker || identifier}
        lead={`${identifier} · ${count.toLocaleString('en-US')} vestings`}
        info='Every vesting of this token, read from the contract.'
      />
      <Card className='space-y-4'>
        <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <div>
            <dt className='text-xs text-muted'>Deposited in total</dt>
            <dd className='font-semibold'>
              <Amount
                digits={2}
                units={totals.deposited}
                decimals={d}
                ticker={token.ticker}
              />
            </dd>
          </div>
          <div>
            <dt className='text-xs text-muted'>Still in the contract</dt>
            <dd className='font-semibold'>
              <Amount
                digits={2}
                units={locked}
                decimals={d}
                ticker={token.ticker}
              />
            </dd>
          </div>
          <div>
            <dt className='text-xs text-muted'>Vested so far</dt>
            <dd>
              <Amount
                digits={2}
                units={vestedNow}
                decimals={d}
                ticker={token.ticker}
              />
            </dd>
          </div>
          <div>
            <dt className='text-xs text-muted'>Claimed / refunded on cancel</dt>
            <dd>
              <Amount digits={2} units={totals.claimed} decimals={d} /> /{' '}
              <Amount digits={2} units={totals.refunded} decimals={d} />
            </dd>
          </div>
        </dl>
        <Progress
          total={committed === 0n ? 1n : committed}
          vested={vestedNow}
          claimed={partial ? claimedListed : totals.claimed}
        />
        {partial && (
          <p className='text-xs text-muted'>
            Deposited, in the contract, claimed and refunded are the
            contract&apos;s totals. Vested so far, the bar and the calendar
            below are computed from the newest{' '}
            {list.length.toLocaleString('en-US')} of{' '}
            {count.toLocaleString('en-US')} vestings.
          </p>
        )}
      </Card>

      <Card>
        <h2 className='mb-4 flex items-center font-bold'>
          Unlock calendar
          <Info>
            What vests each month over the next two years (months in UTC).
          </Info>
        </h2>
        <div className='space-y-1.5'>
          {calendar.map((month) => (
            <div key={month.start} className='flex items-center gap-3 text-sm'>
              <span className='w-20 shrink-0 text-muted'>
                {monthLabel.format(new Date(month.start * 1000))}
              </span>
              <div className='h-2 flex-1 rounded-full bg-raised'>
                <div
                  className='h-2 rounded-full bg-accent'
                  style={{
                    width: `${biggest === 0n ? 0 : Number((month.unlocked * 1000n) / biggest) / 10}%`
                  }}
                />
              </div>
              <span className='w-36 shrink-0 text-right tabular'>
                {formatAmount(month.unlocked, d, 2)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className='mb-3 font-bold'>Vestings</h2>
        <div className='overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-line text-left text-xs text-muted'>
                <th className='py-2 pr-3 font-semibold'>Vesting</th>
                <th className='py-2 pr-3 text-right font-semibold'>Total</th>
                <th className='py-2 pr-3 text-right font-semibold'>Vested</th>
                <th className='py-2 pr-3 text-right font-semibold'>Claimed</th>
                <th className='py-2 font-semibold'>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((v) => (
                <tr key={v.id} className='border-b border-line/60'>
                  <td className='py-1.5 pr-3'>
                    <Link to={`/v/${v.id}`} className='hover:text-accent'>
                      #{v.id}{' '}
                      {v.label && (
                        <span className='text-muted'>
                          <bdi>{v.label}</bdi>
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className='py-1.5 pr-3 text-right'>
                    <Amount units={v.total} decimals={d} />
                  </td>
                  <td className='py-1.5 pr-3 text-right'>
                    <Amount units={v.vested} decimals={d} />
                  </td>
                  <td className='py-1.5 pr-3 text-right'>
                    <Amount units={v.claimed} decimals={d} />
                  </td>
                  <td className='py-1.5'>
                    <Badge>{STATUS_LABEL[statusOf(v, now)]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > shown && (
          <button
            type='button'
            onClick={() => setShown(shown + 100)}
            className='mt-3 text-sm text-accent hover:underline'
          >
            Show {Math.min(100, list.length - shown)} more of {list.length}
          </button>
        )}
        {count > list.length && (
          <p className='mt-2 text-xs text-muted'>
            The {list.length} most recent are listed.
          </p>
        )}
      </Card>
    </div>
  );
};
