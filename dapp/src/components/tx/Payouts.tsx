// What finished claims and cancels paid, in words: read from the contract's
// own events once the network has the result, so the figures are what moved,
// not what the page expected. After a cancel, what the beneficiary can still
// claim is read from the vesting itself: the event's vested part counts what
// was claimed before the cancel too (third audit, C1/W1).

import { Fragment, ReactNode, useEffect, useRef } from 'react';
import { Payout, payoutsOf, TokenInfo, tokenInfo } from 'chain/reads';
import { vesting } from 'chain/vesting';
import { Amount, Notice } from 'components/ui';
import { TokenId } from 'components/vesting/TokenTrust';
import { useAsync } from 'hooks';

/** "A", "A and B", "A, B and C". */
const listOf = (items: ReactNode[]) =>
  items.map((item, index) => (
    <Fragment key={index}>
      {index === 0 ? '' : index === items.length - 1 ? ' and ' : ', '}
      {item}
    </Fragment>
  ));

type Shown = Payout & {
  info?: TokenInfo;
  /** After the cancels: what the claim keys can still collect, if read. */
  stillClaimable?: bigint;
};

/** A read made before the API has indexed the result is tried once more. */
const RETRY_MS = 5_000;

export const Payouts = ({
  hashes,
  sender
}: {
  hashes: string[];
  /** The wallet that was paid: only its own claims and cancels count. */
  sender?: string;
}) => {
  const { data, error, reload } = useAsync(async (): Promise<Shown[]> => {
    const payouts = await payoutsOf(hashes, sender);
    const ids = payouts.flatMap((payout) => payout.cancelledIds);
    const [infos, after] = await Promise.all([
      Promise.all(
        payouts.map((payout) => tokenInfo(payout.token).catch(() => undefined))
      ),
      ids.length
        ? vesting.vestings(ids).catch(() => undefined)
        : Promise.resolve([])
    ]);
    return payouts.map((payout, index) => ({
      ...payout,
      info: infos[index],
      stillClaimable: after
        ?.filter((v) => payout.cancelledIds.includes(v.id))
        .reduce((sum, v) => sum + v.claimable, 0n)
    }));
  }, [hashes.join(','), sender]);

  const retried = useRef(false);
  useEffect(() => {
    if (retried.current || !(error || data?.length === 0)) return;
    retried.current = true;
    const timer = setTimeout(reload, RETRY_MS);
    return () => clearTimeout(timer);
  }, [error, data]);

  if (error && retried.current)
    return (
      <Notice tone='warn'>
        Could not read what was paid: the explorer link above shows it.
      </Notice>
    );
  if (!data?.length) return null;

  const amounts = (pick: (payout: Shown) => bigint | undefined) =>
    data
      .filter((payout) => (pick(payout) ?? 0n) > 0n)
      .map((payout) => (
        <span key={payout.token}>
          <Amount
            units={pick(payout)!}
            decimals={payout.info?.decimals}
            ticker={payout.info?.ticker ?? payout.token.split('-')[0]}
          />{' '}
          <TokenId
            token={payout.info ?? { identifier: payout.token, verified: false }}
          />
        </span>
      ));
  const claimed = amounts((payout) => payout.claimed);
  const refunded = amounts((payout) => payout.refunded);
  const stays = amounts((payout) => payout.stillClaimable);
  if (!claimed.length && !refunded.length && !stays.length) return null;

  return (
    <Notice tone='ok'>
      {claimed.length > 0 && <p>Received in this wallet: {listOf(claimed)}.</p>}
      {refunded.length > 0 && (
        <p>Returned to this wallet: {listOf(refunded)}.</p>
      )}
      {stays.length > 0 && (
        <p>Still claimable by the beneficiary: {listOf(stays)}.</p>
      )}
    </Notice>
  );
};
