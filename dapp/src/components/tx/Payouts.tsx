// What finished claims and cancels paid, in words: read from the contract's
// own events once the network has the result, so the figures are what moved,
// not what the page expected.

import { Fragment, ReactNode } from 'react';
import { Payout, payoutsOf, TokenInfo, tokenInfo } from 'chain/reads';
import { Amount, Notice } from 'components/ui';
import { useAsync } from 'hooks';

/** "A", "A and B", "A, B and C". */
const listOf = (items: ReactNode[]) =>
  items.map((item, index) => (
    <Fragment key={index}>
      {index === 0 ? '' : index === items.length - 1 ? ' and ' : ', '}
      {item}
    </Fragment>
  ));

type Shown = Payout & { info?: TokenInfo };

export const Payouts = ({ hashes }: { hashes: string[] }) => {
  const { data } = useAsync(async (): Promise<Shown[]> => {
    const payouts = await payoutsOf(hashes);
    const infos = await Promise.all(
      payouts.map((payout) => tokenInfo(payout.token).catch(() => undefined))
    );
    return payouts.map((payout, index) => ({ ...payout, info: infos[index] }));
  }, [hashes.join(',')]);
  if (!data?.length) return null;

  const amounts = (pick: (payout: Shown) => bigint) =>
    data
      .filter((payout) => pick(payout) > 0n)
      .map((payout) => (
        <Amount
          key={payout.token}
          units={pick(payout)}
          decimals={payout.info?.decimals}
          ticker={payout.info?.ticker ?? payout.token.split('-')[0]}
        />
      ));
  const claimed = amounts((payout) => payout.claimed);
  const refunded = amounts((payout) => payout.refunded);
  const stays = amounts((payout) => payout.staysClaimable);
  if (!claimed.length && !refunded.length && !stays.length) return null;

  return (
    <Notice tone='ok'>
      {claimed.length > 0 && <p>Received in this wallet: {listOf(claimed)}.</p>}
      {refunded.length > 0 && (
        <p>Returned to this wallet: {listOf(refunded)}.</p>
      )}
      {stays.length > 0 && (
        <p>Stays claimable by the beneficiary: {listOf(stays)}.</p>
      )}
    </Notice>
  );
};
