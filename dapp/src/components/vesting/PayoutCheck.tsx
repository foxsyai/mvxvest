// Before a claim or a cancel that pays a token: can that token reach this
// wallet? From a wallet in another shard than the contract the simulation
// passes, the contract books it, the wallet refuses it and what it paid goes
// back to the contract, keys included, until the owners vote (fifth audit,
// RT-1). A read that failed says so, in words that never read as fine.

import { ReactNode, useState } from 'react';
import type { PayoutBlock } from 'chain/reads';
import { Button, Notice, Spinner } from 'components/ui';
import type { PayoutCheck } from 'hooks';

type Action = 'claim' | 'cancel';

const whyNot = (block: PayoutBlock, token: string) =>
  block === 'frozen'
    ? `The issuer of ${token} has frozen it for this wallet`
    : `The issuer of ${token} has paused it`;

const THEN: Record<Action, string> = {
  claim:
    'so the payout would be refused. From most wallets the claim still runs: the tokens and the claim key could come back to the contract and stay there until the owners vote to send them on. Wait until the issuer lifts it.',
  cancel:
    'so the refund would be refused. From most wallets the cancel still runs: the vesting stops for good, the cancel key is burned and the refund could come back to the contract and stay there until the owners vote to send it on. Wait until the issuer lifts it.'
};

const UNREAD = (tokens: string[]) =>
  `It could not be checked whether ${tokens.join(', ')} can reach this wallet: the network did not answer. If the issuer has frozen or paused it, the payout would be refused and could come back to the contract until the owners vote.`;

export const CheckingPayout = () => (
  <Spinner label='Checking that this can reach your wallet' />
);

/** The read that failed, with the way to ask again. */
export const PayoutUnread = ({
  tokens,
  retry,
  busy
}: {
  tokens: string[];
  retry: () => void;
  busy: boolean;
}) =>
  tokens.length === 0 ? null : (
    <Notice tone='warn'>
      <p>{UNREAD(tokens)}</p>
      <div className='mt-2'>
        <Button variant='secondary' onClick={retry} disabled={busy}>
          Try again
        </Button>
      </div>
    </Notice>
  );

/** One token, one action: says what would happen and holds the signature back. */
export const PayoutGate = ({
  check,
  token,
  action,
  retry,
  busy,
  onClose,
  children
}: {
  check: PayoutCheck | null;
  /** The token paid; undefined when the action pays nothing. */
  token?: string;
  action: Action;
  retry: () => void;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) => {
  const [insisted, setInsisted] = useState(false);
  const answer = token && check ? check[token] : null;
  if (token && !check) return <CheckingPayout />;
  if (answer === 'frozen' || answer === 'paused')
    return (
      <div className='space-y-3'>
        <Notice tone='danger'>
          {whyNot(answer, token!)}, {THEN[action]}
        </Notice>
        {insisted ? (
          children
        ) : (
          <div className='flex flex-wrap gap-2'>
            <Button variant='secondary' onClick={onClose}>
              Not now
            </Button>
            <Button variant='danger' onClick={() => setInsisted(true)}>
              Go on anyway
            </Button>
          </div>
        )}
      </div>
    );
  return (
    <div className='space-y-3'>
      {answer === 'unread' && (
        <PayoutUnread
          tokens={[token!]}
          busy={busy}
          retry={() => {
            // A signature already on its way stays on the page, whatever the
            // new answer says.
            setInsisted(true);
            retry();
          }}
        />
      )}
      {children}
    </div>
  );
};

/** What Claim all left out, and why. */
export const LeftOut = ({
  keys,
  check
}: {
  keys: { id: number; token: string }[];
  check: PayoutCheck;
}) =>
  keys.length === 0 ? null : (
    <Notice tone='warn'>
      <p className='font-semibold'>
        Left out of this claim, because the payout would be refused:
      </p>
      <ul className='mt-1 list-disc pl-5'>
        {keys.map(({ id, token }) => (
          <li key={id}>
            #{id}: {whyNot(check[token] as PayoutBlock, token)}.
          </li>
        ))}
      </ul>
      <p className='mt-1'>
        Claimed now, its tokens and key could come back to the contract and stay
        there until the owners vote to send them on. Its own Claim says the same
        once more.
      </p>
    </Notice>
  );
