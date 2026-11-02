import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { claimableVestings } from 'chain/mine';
import { vesting as client } from 'chain/vesting';
import { RefusedPayouts } from 'components/tx/Refused';
import { TxPanel } from 'components/tx/TxPanel';
import { Button, Notice, PageTitle, ReadFailed, Spinner } from 'components/ui';
import { BlockingKeys } from 'components/vesting/BlockingKeys';
import {
  CheckingPayout,
  LeftOut,
  PayoutGate,
  PayoutUnread
} from 'components/vesting/PayoutCheck';
import {
  KeyWindowNote,
  TokenFilter,
  VestingGrid
} from 'components/vesting/VestingList';
import { tokensOf, useAsync, usePayoutCheck, useSigningRecord } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { claimBatches, MAX_KEYS_PER_CALL } from 'vesting/batches';
import type { Vesting } from 'vesting/client';
import { spent, worthClaiming } from 'vesting/describe';

export const Mine = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const [claiming, setClaiming] = useState<Vesting[] | null>(null);
  // Each claim gets a panel of its own, also one started while the last
  // one's result is still on screen.
  const [round, setRound] = useState(0);
  const signing = useSigningRecord();
  const [tokenFilter, setTokenFilter] = useState<string | null>(null);
  const startClaim = (vestings: Vesting[]) => {
    signing.clear();
    setRound((value) => value + 1);
    setClaiming(vestings);
  };
  // A spent key pays nothing: only the keys that pay are read and left out.
  const paying = useMemo(
    () => claiming?.filter((v) => v.claimable > 0n) ?? null,
    [claiming]
  );
  const payout = usePayoutCheck(
    address,
    paying ? tokensOf(paying) : null,
    claiming
  );
  const blocked = (v: Vesting) =>
    v.claimable > 0n &&
    ['frozen', 'paused'].includes(payout.check?.[v.token] ?? '');
  const several = (claiming?.length ?? 0) > 1;
  const started = signing.started(address);
  // A key of its own warns instead (PayoutGate): the reader chose that one.
  // The same array while the check stands: a new one asks TxPanel to check
  // again. Once the wallet is asked it is what is being signed, whatever a read
  // that answers late says.
  const signed = useRef<Vesting[] | null>(null);
  const chosen = useMemo(
    () =>
      !claiming || !payout.check
        ? null
        : several
          ? claiming.filter((v) => !blocked(v))
          : claiming,
    [claiming, payout.check]
  );
  const sending = started && signed.current ? signed.current : chosen;
  signed.current = sending;
  const leftOut =
    several && claiming
      ? claiming.filter((v) => blocked(v) && !sending?.includes(v))
      : [];
  const unread = several
    ? Object.entries(payout.check ?? {})
        .filter(([, answer]) => answer === 'unread')
        .map(([token]) => token)
    : [];

  const data = useAsync(async () => {
    if (!address) return null;
    const collections = await client.collections();
    return {
      collections,
      list: await claimableVestings(address, collections.claim)
    };
  }, [address]);

  const build = useCallback(
    async () =>
      Promise.all(
        claimBatches(sending!).map((part) =>
          client.claim(address, data.data!.collections.claim, part)
        )
      ),
    [sending, address, data.data]
  );

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
  // No other claim while one is under way. Once its result is final and the
  // list is read again, the cards offer theirs with the result still shown.
  const busy = claiming !== null && !signing.settled(address);
  const all = data.data.list;
  const list = tokenFilter ? all.filter((v) => v.token === tokenFilter) : all;
  const ready = list.filter(worthClaiming);
  const transactions = sending ? claimBatches(sending).length : 0;
  const closeClaim = () => {
    signing.clear();
    setClaiming(null);
  };
  const panel = sending && sending.length > 0 && (
    <TxPanel
      showPayouts
      sender={address}
      label={
        sending.length === 1
          ? `Claim from vesting #${sending[0].id}`
          : `Claim ${sending.length} vestings`
      }
      summary={
        <p>
          Claims what has vested on{' '}
          {sending.length === 1
            ? `vesting #${sending[0].id}`
            : `${sending.length} vestings`}{' '}
          to this wallet. Each key comes back to you or is burned when its
          vesting has nothing more to pay.
          {transactions > 1 &&
            ` You will sign ${transactions} transactions: one per token, with at most ${MAX_KEYS_PER_CALL} keys in each, so a token that cannot reach this wallet can only send back its own keys.`}
        </p>
      }
      build={build}
      {...signing.panel(address, transactions)}
      refusalHelp={(problems) => (
        <BlockingKeys
          problems={problems}
          vestings={sending}
          address={address}
          collection={data.data!.collections.claim}
          onClaim={startClaim}
        />
      )}
      onClose={closeClaim}
      onFinished={(hashes, outcomes) =>
        // Settled once the list read after the result is on screen.
        data.reload().then(() => signing.settle(hashes, outcomes))
      }
    />
  );

  return (
    <div className='space-y-6'>
      <PageTitle
        title='My vestings'
        info='Every vesting whose claim key is in this wallet. Whoever holds the key claims: send the key to another wallet and the vesting goes with it.'
      />
      <RefusedPayouts wallet={address} kind='claimed' />
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
          {ready.length > 1 && !busy && (
            <Button onClick={() => startClaim(ready)}>
              Claim all ({ready.length})
            </Button>
          )}
          {claiming &&
            (several ? (
              !payout.check ? (
                <CheckingPayout />
              ) : (
                <div key={round} className='space-y-3'>
                  <LeftOut keys={leftOut} check={payout.check} />
                  <PayoutUnread
                    tokens={unread}
                    retry={started ? undefined : payout.retry}
                    busy={payout.reading}
                  />
                  {panel || (
                    <Button variant='secondary' onClick={closeClaim}>
                      Close
                    </Button>
                  )}
                </div>
              )
            ) : (
              <PayoutGate
                key={round}
                check={payout.check}
                token={paying?.[0]?.token}
                action='claim'
                retry={payout.retry}
                started={started}
                busy={payout.reading}
                onClose={closeClaim}
              >
                {panel}
              </PayoutGate>
            ))}
          <VestingGrid
            list={list}
            now={now}
            actions={(v) =>
              (v.claimable > 0n || spent(v)) && !busy ? (
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
