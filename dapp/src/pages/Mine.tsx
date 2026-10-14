import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimableVestings } from 'chain/mine';
import { vesting as client } from 'chain/vesting';
import { TxPanel } from 'components/tx/TxPanel';
import { Button, Notice, PageTitle, ReadFailed, Spinner } from 'components/ui';
import { BlockingKeys } from 'components/vesting/BlockingKeys';
import {
  KeyWindowNote,
  TokenFilter,
  VestingGrid
} from 'components/vesting/VestingList';
import { useAsync, useSigningRecord } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { MAX_KEYS_PER_CALL, splitKeys } from 'vesting/batches';
import type { Vesting } from 'vesting/client';
import { spent, worthClaiming } from 'vesting/describe';

export const Mine = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [claiming, setClaiming] = useState<Vesting[] | null>(null);
  const signing = useSigningRecord();
  const [tokenFilter, setTokenFilter] = useState<string | null>(null);
  const startClaim = (vestings: Vesting[]) => {
    signing.clear();
    setClaiming(vestings);
  };

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
          info='The vestings whose claim key is in your wallet.'
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
  const all = data.data.list;
  const list = tokenFilter ? all.filter((v) => v.token === tokenFilter) : all;
  const ready = list.filter(worthClaiming);

  return (
    <div className='space-y-6'>
      <PageTitle
        title='My vestings'
        info='Every vesting whose claim key is in this wallet. Whoever holds the key claims: send the key to another wallet and the vesting goes with it.'
      />
      <KeyWindowNote
        address={address}
        collection={data.data.collections.claim}
        listed={all.length}
      />
      {all.length === 0 ? (
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
          <TokenFilter
            list={all}
            value={tokenFilter}
            onChange={setTokenFilter}
          />
          {ready.length > 1 && !claiming && (
            <Button onClick={() => startClaim(ready)}>
              Claim all ({ready.length})
            </Button>
          )}
          {claiming && (
            <TxPanel
              showPayouts
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
                  {claiming.length > MAX_KEYS_PER_CALL
                    ? `, in ${Math.ceil(claiming.length / MAX_KEYS_PER_CALL)} transactions of at most ${MAX_KEYS_PER_CALL} keys`
                    : ''}
                  . Each key comes back to you or is burned when its vesting has
                  nothing more to pay.
                </p>
              }
              build={build}
              {...signing.panel(
                address,
                splitKeys(claiming.map((v) => v.claimNonce)).length
              )}
              refusalHelp={(problems) => (
                <BlockingKeys
                  problems={problems}
                  vestings={claiming}
                  address={address}
                  collection={data.data!.collections.claim}
                  onClaim={startClaim}
                />
              )}
              onClose={() => {
                signing.clear();
                setClaiming(null);
              }}
              onFinished={() => data.reload()}
            />
          )}
          <VestingGrid
            list={list}
            now={now}
            actions={(v) =>
              (v.claimable > 0n || spent(v)) && !claiming ? (
                // Any amount can be claimed from its own card; a small one is
                // offered quietly.
                <Button
                  variant={worthClaiming(v) ? 'primary' : 'secondary'}
                  onClick={() => startClaim([v])}
                >
                  {v.claimable > 0n ? 'Claim' : 'Close (burns the spent key)'}
                </Button>
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );
};
