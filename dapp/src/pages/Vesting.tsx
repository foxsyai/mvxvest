import { ReactNode, useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { historyOf, keyHolder } from 'chain/reads';
import { vesting as client } from 'chain/vesting';
import { TxPanel } from 'components/tx/TxPanel';
import {
  AddressText,
  Amount,
  Badge,
  Button,
  Card,
  ExplorerLink,
  Info,
  Notice,
  PageTitle,
  Progress,
  Spinner,
  When
} from 'components/ui';
import { ScheduleChart } from 'components/vesting/Chart';
import { ReleaseTable } from 'components/vesting/ReleaseTable';
import { IssuerPowers } from 'components/vesting/TokenTrust';
import { contractAddress } from 'config';
import { useAsync, useSigningRecord, useToken } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { describeCurve, STATUS_LABEL, statusOf } from 'vesting/describe';
import { nextRelease } from 'vesting/schedule';

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt className='text-xs text-muted'>{label}</dt>
    <dd className='mt-0.5'>{children}</dd>
  </div>
);

/**
 * A key sent to a smart contract that could not take it comes back to the
 * vesting contract, which holds it until the owner returns it (main audit D4).
 */
const Bounced = () => (
  <span className='text-warn'>
    could not be delivered: the vesting contract holds it until the owner
    returns it
    <Info label='About a returned key'>
      The address it was sent to is a smart contract that could not receive it,
      so it came back. Nothing is lost: the tokens stay in the contract. Only
      the owner multisig can send the key on, by a vote (recoverBouncedKey). Ask
      the creator or the owner to have it returned.
    </Info>
  </span>
);

export const VestingPage = () => {
  const params = useParams();
  const id = Number(params.id);
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [action, setAction] = useState<'claim' | 'cancel' | null>(null);
  const signing = useSigningRecord();
  const start = (next: 'claim' | 'cancel') => {
    signing.clear();
    setAction(next);
  };
  const close = () => {
    signing.clear();
    setAction(null);
  };

  const data = useAsync(async () => {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new Error('not a vesting number');
    const [v, collections] = await Promise.all([
      client.vesting(id),
      client.collections()
    ]);
    // undefined: could not be read now; null: burned.
    const [claimHolder, cancelHolder] = await Promise.all([
      keyHolder(collections.claim, v.claimNonce).catch(() => undefined),
      v.cancelNonce
        ? keyHolder(collections.cancel, v.cancelNonce).catch(() => undefined)
        : Promise.resolve(null)
    ]);
    return { v, collections, claimHolder, cancelHolder };
  }, [id]);
  const history = useAsync(() => historyOf(id), [id]);
  const v = data.data?.v;
  const token = useToken(v?.token);

  const buildClaim = useCallback(
    () =>
      client
        .claim(address, data.data!.collections.claim, [v!.claimNonce])
        .then((tx) => [tx]),
    [address, data.data, v]
  );
  const buildCancel = useCallback(
    () =>
      client
        .cancel(address, data.data!.collections.cancel, [v!.cancelNonce])
        .then((tx) => [tx]),
    [address, data.data, v]
  );

  if (data.error && !v) {
    // Only the contract's own answer means there is no such vesting; a busy
    // or unreachable API is a reason to try again, not a verdict.
    const unknown = /unknown vesting|not a vesting number/i.test(
      String((data.error as any)?.message ?? data.error)
    );
    return (
      <div className='space-y-4'>
        <PageTitle back title={`Vesting #${params.id}`} />
        {unknown ? (
          <Notice tone='warn'>
            No vesting with this number on this network.
          </Notice>
        ) : (
          <>
            <Notice tone='danger'>
              Could not read this vesting right now: the network did not answer.
              Nothing is wrong with the vesting itself.
            </Notice>
            <Button onClick={data.reload} disabled={data.loading}>
              Try again
            </Button>
          </>
        )}
      </div>
    );
  }
  if (!v) return <Spinner />;

  const now = Math.max(Math.floor(Date.now() / 1000), v.timestamp);
  const status = statusOf(v, now);
  const next = v.cancelledAt ? null : nextRelease(v.schedule, v.total, now);
  const { claimHolder, cancelHolder } = data.data!;
  const holdsClaim = isLoggedIn && claimHolder === address;
  const holdsCancel =
    isLoggedIn && cancelHolder === address && v.cancelledAt === 0;
  const canClaim =
    holdsClaim &&
    (v.claimable > 0n || (v.cancelledAt !== 0 && v.claimed === v.finalAmount));
  const ticker = token.ticker;

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <PageTitle
          back
          title={`Vesting #${v.id}`}
          lead={
            <>
              {v.label && (
                <span className='font-semibold text-ink'>
                  <bdi>{v.label}</bdi>.{' '}
                </span>
              )}
              <Amount
                units={v.total}
                decimals={token.decimals}
                ticker={ticker}
              />{' '}
              of{' '}
              <Link
                to={`/t/${v.token}`}
                className='text-accent hover:underline'
              >
                {v.token}
              </Link>
              {token.verified === false && (
                <span className='ml-1.5 text-sm font-semibold text-warn'>
                  unverified
                </span>
              )}
              , {describeCurve(v.schedule).toLowerCase()}.
            </>
          }
        />
        <Badge
          tone={
            status === 'cancelled'
              ? 'cancel'
              : status === 'vesting'
                ? 'accent'
                : 'info'
          }
        >
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      <Card className='space-y-4'>
        <Progress
          total={v.total}
          vested={v.vested}
          claimed={v.claimed}
          refunded={v.refunded}
        />
        {/* The arithmetic, so the figures below add up at a glance:
            claimed is part of vested, not added to it (Sebastian, mainnet
            test). */}
        <p className='text-xs text-muted'>
          <Amount units={v.vested} decimals={token.decimals} digits={4} />{' '}
          vested ={' '}
          <Amount units={v.claimed} decimals={token.decimals} digits={4} />{' '}
          claimed +{' '}
          <Amount units={v.claimable} decimals={token.decimals} digits={4} />{' '}
          claimable ·{' '}
          {v.cancelledAt ? (
            <>
              <Amount units={v.refunded} decimals={token.decimals} digits={4} />{' '}
              returned on cancel
            </>
          ) : (
            <>
              <Amount
                units={v.total - v.vested}
                decimals={token.decimals}
                digits={4}
              />{' '}
              not vested yet
            </>
          )}{' '}
          ({ticker})
        </p>
        <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <Fact label='Vested so far'>
            <Amount
              digits={4}
              units={v.vested}
              decimals={token.decimals}
              ticker={ticker}
            />
          </Fact>
          <Fact label='Claimed'>
            <Amount
              digits={4}
              units={v.claimed}
              decimals={token.decimals}
              ticker={ticker}
            />
          </Fact>
          <Fact label='Claimable now'>
            <span className='font-semibold'>
              <Amount
                digits={4}
                units={v.claimable}
                decimals={token.decimals}
                ticker={ticker}
              />
            </span>
          </Fact>
          <Fact label='Next release'>
            {next &&
            v.schedule.curve.kind === 'linear' &&
            now >= v.schedule.cliff ? (
              // Past the cliff a linear curve releases continuously.
              <>
                every second
                <span className='block text-xs text-muted'>
                  until <When seconds={v.schedule.end} />
                </span>
              </>
            ) : next ? (
              <>
                <When seconds={next[0]} />
                <span className='block text-xs text-muted'>
                  +{' '}
                  <Amount
                    units={next[1]}
                    decimals={token.decimals}
                    ticker={ticker}
                  />
                </span>
              </>
            ) : (
              <span className='text-muted'>
                none, {v.cancelledAt ? 'cancelled' : 'all vested'}
              </span>
            )}
          </Fact>
        </dl>
        {v.cancelledAt !== 0 && (
          <Notice tone='warn'>
            Cancelled on <When seconds={v.cancelledAt} />.{' '}
            <Amount
              units={v.refunded}
              decimals={token.decimals}
              ticker={ticker}
            />{' '}
            went back to whoever cancelled;{' '}
            <Amount
              units={v.finalAmount}
              decimals={token.decimals}
              ticker={ticker}
            />{' '}
            had vested and stays claimable.
          </Notice>
        )}
        {token.known && <IssuerPowers token={token} />}
        {(canClaim || holdsCancel) && !action && (
          <div className='flex flex-wrap gap-2'>
            {canClaim && <Button onClick={() => start('claim')}>Claim</Button>}
            {holdsCancel && (
              <Button variant='danger' onClick={() => start('cancel')}>
                Cancel this vesting
              </Button>
            )}
          </div>
        )}
        {action === 'claim' && (
          <TxPanel
            sender={address}
            label={`Claim from vesting #${v.id}`}
            summary={
              <p>
                Claims what has vested and is not claimed yet, about{' '}
                <Amount
                  units={v.claimable}
                  decimals={token.decimals}
                  ticker={ticker}
                />{' '}
                now, to this wallet. The claim key comes back to you or is
                burned if this is the last of it.
              </p>
            }
            build={buildClaim}
            {...signing.panel(address, 1)}
            onClose={close}
            onFinished={() => data.reload()}
          />
        )}
        {action === 'cancel' && (
          <TxPanel
            sender={address}
            label={`Cancel vesting #${v.id}`}
            summary={
              <Notice tone='warn'>
                Stops vesting #{v.id} at the moment the transaction runs. This
                cannot be undone. What has vested by then (about{' '}
                <Amount
                  units={v.vested}
                  decimals={token.decimals}
                  ticker={ticker}
                />{' '}
                now) stays claimable with the claim key; the rest (about{' '}
                <Amount
                  units={v.total - v.vested}
                  decimals={token.decimals}
                  ticker={ticker}
                />
                ) comes back to this wallet. The cancel key is burned.
              </Notice>
            }
            build={buildCancel}
            {...signing.panel(address, 1)}
            onClose={close}
            onFinished={() => data.reload()}
          />
        )}
      </Card>

      <Card className='space-y-4'>
        <h2 className='font-bold'>Schedule</h2>
        <dl className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
          <Fact label='Start'>
            <When seconds={v.schedule.start} />
          </Fact>
          <Fact label='Cliff'>
            {v.schedule.cliff > v.schedule.start ||
            v.schedule.cliffAmount > 0n ? (
              <>
                <When seconds={v.schedule.cliff} />
                {v.schedule.cliffAmount > 0n && (
                  <span className='block text-xs text-muted'>
                    <Amount
                      units={v.schedule.cliffAmount}
                      decimals={token.decimals}
                      ticker={ticker}
                    />{' '}
                    at the cliff
                  </span>
                )}
              </>
            ) : (
              <span className='text-muted'>none</span>
            )}
          </Fact>
          <Fact label='End'>
            <When seconds={v.schedule.end} />
          </Fact>
          <Fact label='Shape'>{describeCurve(v.schedule)}</Fact>
        </dl>
        {token.decimals === undefined ? (
          token.failed ? (
            <div className='flex flex-wrap items-center gap-3 text-sm'>
              <span className='text-muted'>
                The token&apos;s decimals could not be read, so no amounts are
                shown.
              </span>
              <Button variant='secondary' onClick={token.reload}>
                Try again
              </Button>
            </div>
          ) : (
            <Spinner />
          )
        ) : (
          <>
            <ScheduleChart
              schedule={v.schedule}
              total={v.total}
              decimals={token.decimals}
              ticker={ticker}
              now={now}
              cancelledAt={v.cancelledAt}
            />
            <ReleaseTable
              schedule={v.schedule}
              total={v.total}
              decimals={token.decimals}
              ticker={ticker}
              now={now}
              cancelledAt={v.cancelledAt}
            />
          </>
        )}
      </Card>

      <Card className='space-y-3'>
        <h2 className='font-bold'>Keys and people</h2>
        <dl className='grid gap-4 sm:grid-cols-2'>
          <Fact
            label={`Claim key (${data.data!.collections.claim} #${v.claimNonce})`}
          >
            {claimHolder === undefined ? (
              <span className='text-muted'>could not be read right now</span>
            ) : claimHolder === contractAddress ? (
              <Bounced />
            ) : claimHolder ? (
              <AddressText address={claimHolder} />
            ) : v.claimed === v.finalAmount ? (
              <span className='text-muted'>burned: nothing more to claim</span>
            ) : (
              // Not found though the vesting still holds tokens: the API has
              // not indexed a fresh key yet.
              <span className='text-muted'>
                not listed by the API yet; try again in a minute
              </span>
            )}
          </Fact>
          <Fact
            label={
              v.cancelNonce
                ? `Cancel key (${data.data!.collections.cancel} #${v.cancelNonce})`
                : 'Cancel key'
            }
          >
            {!v.cancelable ? (
              <span className='text-muted'>
                none: this vesting can never be cancelled
              </span>
            ) : cancelHolder === undefined ? (
              <span className='text-muted'>could not be read right now</span>
            ) : cancelHolder === contractAddress ? (
              <Bounced />
            ) : cancelHolder ? (
              <AddressText address={cancelHolder} />
            ) : v.cancelledAt !== 0 ? (
              <span className='text-muted'>used</span>
            ) : (
              <span className='text-muted'>
                not listed by the API yet; try again in a minute
              </span>
            )}
          </Fact>
          <Fact label='Created by'>
            <AddressText address={v.creator} />
          </Fact>
          <Fact label='Made for'>
            <AddressText address={v.beneficiary} />
          </Fact>
          <Fact label='Created on'>
            <When seconds={v.createdAt} />
          </Fact>
        </dl>
      </Card>

      <Card>
        <h2 className='mb-3 font-bold'>History</h2>
        {history.error && !history.data ? (
          <div className='flex flex-wrap items-center gap-3 text-sm'>
            <span className='text-muted'>
              Could not read the history right now.
            </span>
            <Button
              variant='secondary'
              onClick={history.reload}
              disabled={history.loading}
            >
              Try again
            </Button>
          </div>
        ) : history.loading && !history.data ? (
          <Spinner />
        ) : history.data && history.data.length > 0 ? (
          <ul className='space-y-2 text-sm'>
            {history.data.map((event) => (
              <li
                key={`${event.txHash}-${event.kind}`}
                className='flex flex-wrap items-center gap-x-3 gap-y-1'
              >
                <When seconds={event.timestamp} className='text-muted' />
                <span className='font-semibold'>
                  {event.kind === 'created'
                    ? 'Created'
                    : event.kind === 'claimed'
                      ? 'Claimed'
                      : 'Cancelled, refunded'}
                </span>
                <Amount
                  units={event.amount}
                  decimals={token.decimals}
                  ticker={ticker}
                />
                <span className='text-muted'>by</span>
                <AddressText address={event.address} />
                <ExplorerLink path={`/transactions/${event.txHash}`}>
                  transaction
                </ExplorerLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted'>No events found.</p>
        )}
      </Card>
    </div>
  );
};
