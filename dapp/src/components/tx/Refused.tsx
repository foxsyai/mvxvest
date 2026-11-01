// A payout the wallet refused, or a key that could not be delivered: the
// contract has booked it and holds what came back, and the API calls the
// transaction `fail` (fifth audit, RT-1). Nothing here may read as paid, nor as
// "it did not happen": a reader who believes that signs again. And nothing may
// say more came back than did: every word comes from the transfers that came
// back, so it holds whichever version of the contract ran the transaction.

import type { RefusedPayout, TxOutcome } from 'chain/reads';
import { refusedPayouts } from 'chain/reads';
import { ExplorerLink, Notice, When } from 'components/ui';
import { GITHUB_REPO_URL } from 'config';
import { useAsync } from 'hooks';

/** Who can send it back, and how to reach them. */
export const OwnersOnly = () => (
  <>
    The money is safe in the contract and nobody else can take it, but only the
    owners&apos; multisig can send it on, by a vote. To ask for that,{' '}
    <a
      href={`${GITHUB_REPO_URL}/issues`}
      target='_blank'
      rel='noreferrer'
      className='text-accent hover:underline'
    >
      open an issue on GitHub
    </a>{' '}
    with the link to the transaction.
  </>
);

const listOf = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const keysOf = (keys: { nonce: number }[]) =>
  listOf(keys.map(({ nonce }) => `claim key #${nonce}`));

const wordsOf = ({ bounced, refusal }: TxOutcome): string => {
  if (bounced === 'created')
    return 'The vestings of this transaction were created and their tokens are locked. Do not create them again. A key could not be delivered to the address it was for: it is held by the contract and each vesting’s page shows which.';
  const action = bounced === 'cancelled' ? 'cancel' : 'claim';
  if (!refusal)
    return `The contract booked this ${action}, but one of its transfers was refused at this wallet. Some of what it paid may be held by the contract: the transaction shows which.`;
  const tokens = listOf(refusal.tokens.map(({ token }) => token));
  if (bounced === 'cancelled')
    return `The vesting is cancelled and its cancel key is burned, but the network refused to pay the refund in ${tokens} to this wallet: it is held by the contract.`;
  const money =
    refusal.tokens.length === 0
      ? ''
      : refusal.paid.length === 0
        ? `No tokens reached this wallet: the network refused ${tokens} and it is held by the contract. `
        : `The network refused to pay ${tokens} to this wallet: it is held by the contract. The rest of this claim was paid. `;
  return `${money}${
    refusal.keys.length > 0
      ? `Also ${keysOf(refusal.keys)} came back and the contract holds ${refusal.keys.length === 1 ? 'it' : 'them'}.`
      : 'No claim key came back to the contract.'
  }`;
};

export const RefusedNotice = ({ outcome }: { outcome: TxOutcome }) => (
  <Notice tone='warn'>
    {wordsOf(outcome)} <OwnersOnly />
  </Notice>
);

const LINE: Record<RefusedPayout['kind'], string> = {
  claimed: 'A claim from this wallet had a payout refused at this wallet',
  cancelled: 'A cancel from this wallet had its refund refused at this wallet'
};

const whatCameBack = ({ tokens, keys, ids }: RefusedPayout) => {
  const parts = tokens.flatMap(({ token, ids: vestings }) =>
    vestings.map((id) => `#${id} (${token})`)
  );
  const money = parts.join(', ');
  const held = keys.filter((key) => key.held === true);
  const unknown = keys.filter((key) => key.held === null);
  const words = [
    money,
    held.length > 0 && `${keysOf(held)} is held by the contract`,
    unknown.length > 0 &&
      `${keysOf(unknown)} came back and may still be held by the contract`
  ].filter(Boolean);
  // The results show nothing that came back: all that is known is what it was for.
  return tokens.length === 0 && keys.length === 0
    ? `one of ${ids.map((id) => `#${id}`).join(', ')} (the transaction shows which)`
    : words.join('; ');
};

/**
 * What this wallet's earlier claims or cancels left behind: a refused token, and
 * perhaps a key that came back with it. The owners may have sent the tokens back
 * since: the chain's list of failures cannot say. A key's place can be read.
 */
export const RefusedPayouts = ({
  wallet,
  kind
}: {
  wallet: string;
  kind: RefusedPayout['kind'];
}) => {
  const { data, error } = useAsync(
    async () => refusedPayouts(wallet),
    [wallet]
  );
  if (error && !data)
    return (
      <p className='text-xs text-muted'>
        It could not be checked whether an earlier transaction of this wallet
        was refused at the wallet.
      </p>
    );
  const refused = (data ?? []).filter((entry) => entry.kind === kind);
  if (refused.length === 0) return null;
  return (
    <Notice tone='warn'>
      <ul className='space-y-1'>
        {refused.map((entry) => (
          <li key={entry.txHash}>
            {LINE[kind]} on <When seconds={entry.timestamp} />:{' '}
            {whatCameBack(entry)}.{' '}
            <ExplorerLink path={`/transactions/${entry.txHash}`}>
              transaction
            </ExplorerLink>
          </li>
        ))}
      </ul>
      <p className='mt-2'>
        Unless the owners have sent them back since, the tokens named here are
        held by the contract. <OwnersOnly />
      </p>
    </Notice>
  );
};
