import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimableVestings } from 'chain/mine';
import { vesting as client } from 'chain/vesting';
import { TxPanel } from 'components/tx/TxPanel';
import { Button, Notice, PageTitle, ReadFailed, Spinner } from 'components/ui';
import { VestingCard } from 'components/vesting/VestingCard';
import { useAsync } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { splitKeys } from 'vesting/batches';
import type { Vesting } from 'vesting/client';

/** A key worth sending: it pays something, or it is spent and only burns. */
const worthClaiming = (v: Vesting) =>
  v.claimable > 0n || (v.cancelledAt !== 0 && v.claimed === v.finalAmount);

export const Mine = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [claiming, setClaiming] = useState<Vesting[] | null>(null);

  const data = useAsync(async () => {
    if (!address) return null;
    const collections = await client.collections();
    return {
      collections,
      list: await claimableVestings(address, collections.claim)
    };
  }, [address]);

  const build = useCallback(async () => {
    const nonces = claiming!.map((v) => v.claimNonce);
    return Promise.all(
      splitKeys(nonces).map((part) =>
        client.claim(address, data.data!.collections.claim, part)
      )
    );
  }, [claiming, address, data.data]);

  if (!isLoggedIn) {
    return (
      <div>
        <PageTitle
          title='My vestings'
          lead='The vestings whose claim key is in your wallet.'
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
        <PageTitle title='My vestings' />
        <ReadFailed
          what='your vestings'
          retry={data.reload}
          busy={data.loading}
        />
      </div>
    ) : (
      <Spinner />
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const list = data.data.list;
  const ready = list.filter(worthClaiming);

  return (
    <div className='space-y-6'>
      <PageTitle
        title='My vestings'
        lead='Every vesting whose claim key is in this wallet. Whoever holds the key claims: send the key to another wallet and the vesting goes with it.'
      />
      {list.length === 0 ? (
        <Notice>
          No claim keys in this wallet. If someone created a vesting for you,
          its key is in the wallet they sent it to. Anyone can look a vesting up
          from the{' '}
          <Link to='/' className='text-accent hover:underline'>
            start page
          </Link>
          .
        </Notice>
      ) : (
        <>
          {ready.length > 1 && !claiming && (
            <Button onClick={() => setClaiming(ready)}>
              Claim all ({ready.length})
            </Button>
          )}
          {claiming && (
            <TxPanel
              sender={address}
              label={
                claiming.length === 1
                  ? `Claim from vesting #${claiming[0].id}`
                  : `Claim ${claiming.length} vestings`
              }
              summary={
                <p>
                  Claims what has vested on{' '}
                  {claiming.length === 1
                    ? `vesting #${claiming[0].id}`
                    : `${claiming.length} vestings`}{' '}
                  to this wallet
                  {claiming.length > 50
                    ? `, in ${Math.ceil(claiming.length / 50)} transactions of at most 50 keys`
                    : ''}
                  . Each key comes back to you, or is burned when its vesting
                  has nothing more to pay.
                </p>
              }
              build={build}
              onClose={() => setClaiming(null)}
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
                  worthClaiming(v) && !claiming ? (
                    <Button onClick={() => setClaiming([v])}>
                      {v.claimable > 0n
                        ? 'Claim'
                        : 'Close (burns the spent key)'}
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
