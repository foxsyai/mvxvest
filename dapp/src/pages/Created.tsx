import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { createdVestings } from 'chain/mine';
import { keysHeld, tokenInfo } from 'chain/reads';
import { vesting as client } from 'chain/vesting';
import { TxPanel } from 'components/tx/TxPanel';
import { Button, Notice, PageTitle, Spinner } from 'components/ui';
import { VestingCard } from 'components/vesting/VestingCard';
import { useAsync } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import type { Vesting } from 'vesting/client';
import { toCsv } from 'vesting/csv';
import { STATUS_LABEL, statusOf } from 'vesting/describe';
import { formatAmountExact } from 'vesting/format';

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

export const Created = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [cancelling, setCancelling] = useState<Vesting | null>(null);

  const data = useAsync(async () => {
    if (!address) return null;
    const collections = await client.collections();
    const [list, cancelKeys] = await Promise.all([
      createdVestings(address),
      keysHeld(address, collections.cancel)
    ]);
    return { collections, list, cancelKeys: new Set(cancelKeys) };
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
      const amount = (units: bigint) =>
        formatAmountExact(units, token.decimals).replace(/,/g, '');
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
        new Date(v.schedule.start * 1000).toISOString(),
        new Date(v.schedule.end * 1000).toISOString(),
        v.cancelable ? 'yes' : 'no'
      ]);
    }
    download(
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
          lead='The vestings this wallet created.'
        />
        <Notice>
          Connect your wallet (top right) to see them. Connecting signs nothing.
        </Notice>
      </div>
    );
  }
  if (!data.data) return <Spinner />;

  const now = Math.floor(Date.now() / 1000);
  const { list, cancelKeys } = data.data;

  return (
    <div className='space-y-6'>
      <PageTitle
        title='Created by me'
        lead='Every vesting this wallet created, and every beneficiary’s progress. Cancel is offered where this wallet still holds the cancel key.'
      />
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
          <Button variant='secondary' onClick={exportCsv}>
            Export to CSV
          </Button>
          {cancelling && (
            <TxPanel
              sender={address}
              label={`Cancel vesting #${cancelling.id}`}
              summary={
                <Notice tone='warn'>
                  Stops vesting #{cancelling.id} when the transaction runs, and
                  cannot be undone. What has vested by then stays claimable with
                  the claim key; the rest comes back to this wallet. The cancel
                  key is burned.
                </Notice>
              }
              build={build}
              onClose={() => setCancelling(null)}
              onFinished={() => data.reload()}
            />
          )}
          <div className='grid gap-4 lg:grid-cols-2'>
            {list.map((v) => (
              <VestingCard
                key={v.id}
                vesting={v}
                now={now}
                actions={
                  v.cancelable &&
                  v.cancelledAt === 0 &&
                  cancelKeys.has(v.cancelNonce) &&
                  !cancelling ? (
                    <Button variant='danger' onClick={() => setCancelling(v)}>
                      Cancel
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
