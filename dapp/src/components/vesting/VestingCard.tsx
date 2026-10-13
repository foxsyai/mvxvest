import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Amount, Badge, Card, Progress, When } from 'components/ui';
import { useToken } from 'hooks';
import type { Vesting } from 'vesting/client';
import { STATUS_LABEL, statusOf } from 'vesting/describe';
import { nextRelease } from 'vesting/schedule';
import { TokenId } from './TokenTrust';

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
    // As tall as its row (cards side by side match), actions at the bottom so
    // the buttons of neighbouring cards line up.
    <Card className='relative flex h-full flex-col gap-3 transition hover:border-accent'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          {/* The whole card opens the vesting: the link's overlay covers it,
              and the actions sit above the overlay. */}
          <Link
            to={`/v/${vesting.id}`}
            className="font-semibold after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-accent"
          >
            #{vesting.id}
            {vesting.label && (
              <span className='ml-2 text-muted'>
                <bdi>{vesting.label}</bdi>
              </span>
            )}
          </Link>
          <div className='text-sm'>
            <Amount
              units={vesting.total}
              decimals={token.decimals}
              ticker={token.ticker}
            />
            <TokenId token={token} className='ml-2' />
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
          <dt className='text-xs text-muted'>Vested so far</dt>
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
            {vesting.schedule.curve.kind === 'linear' &&
              vesting.cancelledAt === 0 &&
              now < vesting.schedule.end && (
                <span className='block text-xs font-normal text-muted'>
                  grows every second
                </span>
              )}
          </dd>
        </div>
        <div>
          <dt className='text-xs text-muted'>Next release</dt>
          <dd>
            {next &&
            vesting.schedule.curve.kind === 'linear' &&
            now >= vesting.schedule.cliff ? (
              // Past the cliff a linear curve releases continuously: the next
              // "release" is a second away, so say how it goes instead.
              <>
                every second
                <span className='block text-xs text-muted'>
                  until <When seconds={vesting.schedule.end} />
                </span>
              </>
            ) : next ? (
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
      {actions && (
        <div className='relative z-10 mt-auto flex flex-wrap gap-2 pt-1'>
          {actions}
        </div>
      )}
    </Card>
  );
};
