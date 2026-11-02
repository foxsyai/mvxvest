import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { cancelKeysOfOthers, createdVestings } from 'chain/mine';
import { keysHeld, tokenInfo } from 'chain/reads';
import { vesting as client } from 'chain/vesting';
import { RefusedPayouts } from 'components/tx/Refused';
import { TxPanel } from 'components/tx/TxPanel';
import {
  Button,
  Info,
  Notice,
  PageTitle,
  ReadFailed,
  Spinner
} from 'components/ui';
import { PayoutGate } from 'components/vesting/PayoutCheck';
import { VestingCard } from 'components/vesting/VestingCard';
import { useAsync, usePayoutCheck, useSigningRecord } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import type { Vesting } from 'vesting/client';
import { downloadFile, toCsv } from 'vesting/csv';
import { STATUS_LABEL, statusOf } from 'vesting/describe';
import { isoDate, plainAmount } from 'vesting/format';

export const Created = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [cancelling, setCancelling] = useState<Vesting | null>(null);
  // Each cancel gets a panel of its own, also one started while the last
  // one's result is still on screen.
  const [round, setRound] = useState(0);
  const signing = useSigningRecord();
  // A cancel pays this wallet what has not vested; with nothing left to pay it
  // reads nothing.
  const refund =
    cancelling && cancelling.total > cancelling.vested
      ? cancelling.token
      : undefined;
  const payout = usePayoutCheck(
    address,
    cancelling ? (refund ? [refund] : []) : null,
    cancelling
  );

  const data = useAsync(async () => {
    if (!address) return null;
    const collections = await client.collections();
    const [{ list, count }, cancelKeys] = await Promise.all([
      createdVestings(address),
      keysHeld(address, collections.cancel)
    ]);
    const held = await cancelKeysOfOthers(address, collections.cancel, list);
    return { collections, list, count, held, cancelKeys: new Set(cancelKeys) };
  }, [address]);

  const build = useCallback(
    () =>
      client
        .cancel(address, data.data!.collections.cancel, [
          cancelling!.cancelNonce
        ])
        .then((tx) => [tx]),
    [address, data.data, cancelling]
  );

  const exportCsv = async () => {
    const now = Math.floor(Date.now() / 1000);
    const lines: (string | number)[][] = [];
    for (const v of data.data!.list) {
      const token = await tokenInfo(v.token);
      const amount = (units: bigint) => plainAmount(units, token.decimals);
      lines.push([
        v.id,
        v.label,
        v.beneficiary,
        v.token,
        amount(v.total),
        amount(v.vested),
        amount(v.claimed),
        amount(v.claimable),
        STATUS_LABEL[statusOf(v, now)],
        isoDate(v.schedule.start),
        isoDate(v.schedule.end),
        v.cancelable ? 'yes' : 'no'
      ]);
    }
    downloadFile(
      `mvxvest-created-${address.slice(0, 10)}.csv`,
      toCsv(
        [
          'id',
          'label',
          'beneficiary',
          'token',
          'total',
          'vested',
          'claimed',
          'claimable',
          'status',
          'start',
          'end',
          'cancelable'
        ],
        lines
      )
    );
  };

  if (!isLoggedIn) {
    return (
      <div>
        <PageTitle
          title='Created by me'
          info='The vestings this wallet created.'
        />
        <Notice>
          Connect your wallet (top right) to see them. Connecting signs nothing.
        </Notice>
      </div>
    );
  }
  if (!data.data) {
    return data.error ? (
      <div className='space-y-4'>
        <PageTitle title='Created by me' />
        <ReadFailed
          what='the vestings you created'
          retry={data.reload}
          busy={data.loading}
        />
      </div>
    ) : (
      <Spinner />
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const { list, count, held, cancelKeys } = data.data;
  // No other cancel while one is under way. Once its result is final and the
  // list is read again, the cards offer theirs with the result still shown.
  const busy =
    cancelling !== null && (!signing.settled(address) || data.loading);
  const cancelAction = (v: Vesting) =>
    v.cancelable &&
    v.cancelledAt === 0 &&
    cancelKeys.has(v.cancelNonce) &&
    !busy ? (
      <Button
        variant='danger'
        onClick={() => {
          signing.clear();
          setRound((value) => value + 1);
          setCancelling(v);
        }}
      >
        Cancel
      </Button>
    ) : undefined;

  return (
    <div className='space-y-6'>
      <PageTitle
        title='Created by me'
        info='Every vesting this wallet created and how far each beneficiary has got. Cancel appears wherever this wallet holds the cancel key, also for vestings another wallet created and whose cancel key was sent here.'
      />
      <RefusedPayouts wallet={address} kind='cancelled' />
      {cancelling && (
        <PayoutGate
          key={round}
          check={payout.check}
          token={refund}
          action='cancel'
          retry={payout.retry}
          started={signing.started(address)}
          busy={payout.reading}
          onClose={() => {
            signing.clear();
            setCancelling(null);
          }}
        >
          <TxPanel
            showPayouts
            sender={address}
            label={`Cancel vesting #${cancelling.id}`}
            summary={
              <Notice tone='warn'>
                Stops vesting #{cancelling.id} when the transaction runs. This
                cannot be undone. What has vested by then stays the
                beneficiary&apos;s (claimable with the claim key until claimed);
                the rest comes back to this wallet. The cancel key is burned.
              </Notice>
            }
            build={build}
            {...signing.panel(address, 1)}
            onClose={() => {
              signing.clear();
              setCancelling(null);
            }}
            onFinished={(_, outcomes) => {
              signing.settle(outcomes);
              data.reload();
            }}
          />
        </PayoutGate>
      )}
      {list.length === 0 ? (
        <Notice>
          This wallet has not created any vestings yet.{' '}
          <Link to='/create' className='text-accent hover:underline'>
            Create some
          </Link>
          .
        </Notice>
      ) : (
        <>
          {count > list.length && (
            <Notice>
              This wallet created {count.toLocaleString('en-US')} vestings; the
              newest {list.length} are listed here and in the export. Each
              vesting has its own page at /v/ and its number.
            </Notice>
          )}
          <Button variant='secondary' onClick={exportCsv}>
            Export to CSV
          </Button>
          <div className='grid gap-4 lg:grid-cols-2'>
            {list.map((v) => (
              <VestingCard
                key={v.id}
                vesting={v}
                now={now}
                actions={cancelAction(v)}
              />
            ))}
          </div>
        </>
      )}
      {held.length > 0 && (
        <section className='space-y-3'>
          <h2 className='flex items-center font-bold'>
            Cancel keys in this wallet
            <Info>
              Vestings another wallet created whose cancel key was sent to this
              one. This wallet can cancel them; what has not vested comes here.
            </Info>
          </h2>
          <div className='grid gap-4 lg:grid-cols-2'>
            {held.map((v) => (
              <VestingCard
                key={v.id}
                vesting={v}
                now={now}
                actions={cancelAction(v)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
