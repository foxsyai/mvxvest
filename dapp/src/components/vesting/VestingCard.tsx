import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Amount, Badge, Card, Progress, When } from 'components/ui';
import { useToken } from 'hooks';
import type { Vesting } from 'vesting/client';
import { STATUS_LABEL, statusOf } from 'vesting/describe';
import { nextRelease } from 'vesting/schedule';

const STATUS_TONE = {
  upcoming: 'info',
  vesting: 'accent',
  vested: 'ok',
  cancelled: 'cancel',
  done: 'info'
} as const;

/** A vesting at a glance, with room for actions (Claim, Cancel). */
export const VestingCard = ({
  vesting,
  now,
  actions
}: {
  vesting: Vesting;
  now: number;
  actions?: ReactNode;
}) => {
  const token = useToken(vesting.token);
  const status = statusOf(vesting, now);
  const next = vesting.cancelledAt
    ? null
    : nextRelease(vesting.schedule, vesting.total, now);
  return (
    <Card className='space-y-3'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <Link
            to={`/v/${vesting.id}`}
            className='font-semibold hover:text-accent'
          >
            #{vesting.id}
            {vesting.label && (
              <span className='ml-2 text-muted'>{vesting.label}</span>
            )}
          </Link>
          <div className='text-sm'>
            <Amount
              units={vesting.total}
              decimals={token.decimals}
              ticker={token.ticker}
            />
          </div>
        </div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </div>
      <Progress
        total={vesting.total}
        vested={vesting.vested}
        claimed={vesting.claimed}
        refunded={vesting.refunded}
      />
      <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4'>
        <div>
          <dt className='text-xs text-muted'>Vested</dt>
          <dd>
            <Amount units={vesting.vested} decimals={token.decimals} />
          </dd>
        </div>
        <div>
          <dt className='text-xs text-muted'>Claimed</dt>
          <dd>
            <Amount units={vesting.claimed} decimals={token.decimals} />
          </dd>
        </div>
        <div>
          <dt className='text-xs text-muted'>Claimable now</dt>
          <dd className='font-semibold'>
            <Amount units={vesting.claimable} decimals={token.decimals} />
          </dd>
        </div>
        <div>
          <dt className='text-xs text-muted'>Next release</dt>
          <dd>
            {next ? (
              <>
                <When seconds={next[0]} />
                {vesting.schedule.curve.kind !== 'linear' && (
                  <span className='block text-xs text-muted'>
                    + <Amount units={next[1]} decimals={token.decimals} />
                  </span>
                )}
              </>
            ) : (
              <span className='text-muted'>none</span>
            )}
          </dd>
        </div>
      </dl>
      {actions && <div className='flex flex-wrap gap-2 pt-1'>{actions}</div>}
    </Card>
  );
};
