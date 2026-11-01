// A payout the wallet refused, or a key that could not be delivered: the
// contract has booked it and holds what came back, and the API calls the
// transaction `fail` (fifth audit, RT-1). Nothing here may read as paid, nor as
// "it did not happen": a reader who believes that signs again.

import type { BookedKind, RefusedPayout } from 'chain/reads';
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

const WORDS: Record<BookedKind, string> = {
  claimed:
    'The contract booked this claim, but the network refused to pay it to this wallet. Nothing reached this wallet: the tokens and any claim key due back are held by the contract.',
  cancelled:
    'The vesting is cancelled and its cancel key is burned, but the network refused to pay the refund to this wallet: the tokens are held by the contract.',
  created:
    'The vestings of this transaction were created and their tokens are locked. Do not create them again. A key could not be delivered to the address it was for: it is held by the contract, and each vesting’s page shows which.'
};

export const RefusedNotice = ({ kind }: { kind: BookedKind }) => (
  <Notice tone='warn'>
    {WORDS[kind]} <OwnersOnly />
  </Notice>
);

const LINE: Record<RefusedPayout['kind'], string> = {
  claimed: 'A claim from this wallet was refused at this wallet',
  cancelled: 'A cancel from this wallet had its refund refused at this wallet'
};

/**
 * What this wallet's earlier claims or cancels left behind. Its keys are gone
 * from the wallet by then, so no list would show them. The owners may have sent
 * it back since: the chain's list of failures cannot say.
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
            {entry.ids.map((id) => `#${id}`).join(', ')}.{' '}
            <ExplorerLink path={`/transactions/${entry.txHash}`}>
              transaction
            </ExplorerLink>
          </li>
        ))}
      </ul>
      <p className='mt-2'>
        Unless the owners have sent it back since, what it was to pay and any
        key due back are held by the contract. <OwnersOnly />
      </p>
    </Notice>
  );
};
