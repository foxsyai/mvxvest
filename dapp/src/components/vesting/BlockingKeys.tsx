// "Claim all" puts every key in one transaction, and the payout is one
// transfer: a single key whose token cannot move (frozen for this wallet,
// paused, a transfer role) makes the network refuse all of them, in words that
// name a token, not a vesting (red team RT7). This finds the key that blocks
// and offers to claim the others. When every key passes on its own, the
// whole set was too much for one transaction (a claim's gas grows with the
// schedule it reads): it offers smaller groups, never the same set again
// (fourth audit, DT-6).

import { Fragment, useState } from 'react';
import { prepare } from 'chain/send';
import { vesting as client } from 'chain/vesting';
import { Button } from 'components/ui';
import type { Vesting } from 'vesting/client';
import { CreatorLabel } from './CreatorLabel';

/** A vesting's number, and its label quoted as the creator's (WEB-9). */
const Named = ({ vesting }: { vesting: Vesting }) => (
  <>
    #{vesting.id}
    {vesting.label && (
      <>
        {' '}
        <CreatorLabel text={vesting.label} />
      </>
    )}
  </>
);

export const BlockingKeys = ({
  problems,
  vestings,
  address,
  collection,
  onClaim
}: {
  problems: (string | null)[];
  vestings: Vesting[];
  address: string;
  collection: string;
  /** Start a new claim of these. */
  onClaim: (vestings: Vesting[]) => void;
}) => {
  const [checked, setChecked] = useState<{
    blocked: { vesting: Vesting; reason: string }[];
    ok: Vesting[];
  } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  if (vestings.length < 2) return null;

  // The protocol's words often name the token that cannot move.
  const words = problems.filter(Boolean).join(' ');
  const byToken = vestings.filter((v) => words.includes(v.token));
  const blocked =
    checked?.blocked ??
    (byToken.length > 0 && byToken.length < vestings.length
      ? byToken.map((vesting) => ({ vesting, reason: '' }))
      : null);
  const rest = checked
    ? checked.ok
    : blocked
      ? vestings.filter((v) => !byToken.includes(v))
      : [];

  const allPass = checked !== null && checked.blocked.length === 0;
  const half = Math.ceil(vestings.length / 2);

  const checkEach = async () => {
    const result: NonNullable<typeof checked> = { blocked: [], ok: [] };
    setProgress(0);
    for (const [index, v] of vestings.entries()) {
      try {
        const tx = await client.claim(address, collection, [v.claimNonce]);
        const [problem] = (await prepare(address, [tx])).problems;
        if (problem) result.blocked.push({ vesting: v, reason: problem });
        else result.ok.push(v);
      } catch (failure) {
        result.blocked.push({
          vesting: v,
          reason: String((failure as any)?.message ?? failure)
        });
      }
      setProgress(index + 1);
    }
    setProgress(null);
    setChecked(result);
  };

  return (
    <div className='mt-3 space-y-2'>
      {blocked && blocked.length > 0 ? (
        <>
          <p>
            {blocked.length === 1 ? 'Vesting ' : 'Vestings '}
            {blocked.map(({ vesting }, index) => (
              <Fragment key={vesting.id}>
                {index > 0 && ', '}
                <Named vesting={vesting} />
              </Fragment>
            ))}{' '}
            {blocked.length === 1 ? 'blocks' : 'block'} the others: its token
            cannot move to this wallet now.
          </p>
          {checked &&
            blocked.map(({ vesting, reason }) => (
              <p key={vesting.id} className='text-xs'>
                <Named vesting={vesting} />: {reason}
              </p>
            ))}
        </>
      ) : allPass ? (
        <p>
          Each of them passes on its own: together they are more than one
          transaction can carry. Claim them in smaller groups.
        </p>
      ) : null}
      {allPass ? (
        <Button onClick={() => onClaim(vestings.slice(0, half))}>
          Claim the first {half}
        </Button>
      ) : rest.length > 0 ? (
        <Button onClick={() => onClaim(rest)}>
          Claim the other {rest.length}
        </Button>
      ) : !checked ? (
        <Button
          variant='secondary'
          disabled={progress !== null}
          onClick={checkEach}
        >
          {progress === null
            ? 'Check each vesting on its own'
            : `Checked ${progress} of ${vestings.length}`}
        </Button>
      ) : null}
    </div>
  );
};
