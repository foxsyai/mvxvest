// A wallet's vestings, as many as it holds: anyone can send a wallet
// thousands of dust vestings of a token of their own (red team RT1), so the
// list can be narrowed to one token and is shown 50 at a time.

import { ReactNode, useState } from 'react';
import { keysCount } from 'chain/reads';
import { Button, Notice } from 'components/ui';
import { useAsync, useToken } from 'hooks';
import type { Vesting } from 'vesting/client';
import { VestingCard } from './VestingCard';

const PAGE = 50;
const MOST_CHIPS = 30;

const ChipButton = ({
  active,
  onClick,
  title,
  children
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) => (
  <button
    type='button'
    onClick={onClick}
    title={title}
    className={`rounded-full border px-3 py-1 text-xs font-semibold ${active ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:border-accent'}`}
  >
    {children}
  </button>
);

const TokenChip = ({
  token,
  count,
  active,
  onClick
}: {
  token: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) => {
  const info = useToken(token);
  return (
    <ChipButton active={active} onClick={onClick} title={token}>
      {info.ticker} {count.toLocaleString('en-US')}
      {info.verified === false && (
        <span className='font-normal text-warn'> · unverified</span>
      )}
    </ChipButton>
  );
};

/** Buttons to show one token only; nothing when there is only one token. */
export const TokenFilter = ({
  list,
  value,
  onChange
}: {
  list: Vesting[];
  value: string | null;
  onChange: (token: string | null) => void;
}) => {
  const counts = new Map<string, number>();
  for (const v of list) counts.set(v.token, (counts.get(v.token) ?? 0) + 1);
  if (counts.size < 2) return null;
  // The fewest first: a token sent by the thousand is rarely the one wanted.
  const tokens = [...counts.entries()].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
  );
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <ChipButton active={value === null} onClick={() => onChange(null)}>
        All {list.length.toLocaleString('en-US')}
      </ChipButton>
      {tokens.slice(0, MOST_CHIPS).map(([token, count]) => (
        <TokenChip
          key={token}
          token={token}
          count={count}
          active={value === token}
          onClick={() => onChange(token)}
        />
      ))}
      {tokens.length > MOST_CHIPS && (
        <span className='text-xs text-muted'>
          and {tokens.length - MOST_CHIPS} more tokens
        </span>
      )}
    </div>
  );
};

/** The cards, 50 at a time. */
export const VestingGrid = ({
  list,
  now,
  actions
}: {
  list: Vesting[];
  now: number;
  actions?: (v: Vesting) => ReactNode;
}) => {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      <div className='grid gap-4 lg:grid-cols-2'>
        {list.slice(0, shown).map((v) => (
          <VestingCard
            key={v.id}
            vesting={v}
            now={now}
            actions={actions?.(v)}
          />
        ))}
      </div>
      {list.length > shown && (
        <Button variant='secondary' onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more (
          {(list.length - shown).toLocaleString('en-US')} not shown)
        </Button>
      )}
    </>
  );
};

/**
 * When the wallet holds more claim keys than the API can list, says so: only
 * worth a read when the list is already that long.
 */
export const KeyWindowNote = ({
  address,
  collection,
  listed
}: {
  address: string;
  collection: string;
  listed: number;
}) => {
  const { data: held } = useAsync(
    async () => (listed >= 9_000 ? keysCount(address, collection) : 0),
    [address, collection, listed]
  );
  if (!held || held <= listed) return null;
  return (
    <Notice tone='warn'>
      This wallet holds {held.toLocaleString('en-US')} claim keys, more than the
      network&apos;s API lists ({listed.toLocaleString('en-US')} are shown, the
      newest vestings included). Sending unwanted keys to another wallet brings
      the others into view.
    </Notice>
  );
};
