// The small building blocks every page uses. Colors are theme tokens only
// (styles/tailwind.css), so light and dark both stay complete.

import {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  useState
} from 'react';
import { Link } from 'react-router-dom';
import { explorerUrl } from 'chain/network';
import {
  formatAmount,
  formatAmountExact,
  formatDate,
  formatUtc
} from 'vesting/format';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'border border-line bg-surface text-ink hover:border-accent',
  danger: 'bg-cancel text-white hover:opacity-90 dark:text-canvas',
  ghost: 'text-muted hover:text-ink'
};

export const Button = ({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) => (
  <button
    type='button'
    {...props}
    className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
  />
);

export const Card = ({
  children,
  className = ''
}: PropsWithChildren<{ className?: string }>) => (
  <div className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>
    {children}
  </div>
);

export const PageTitle = ({
  title,
  lead
}: {
  title: string;
  lead?: ReactNode;
}) => (
  <div className='mb-6'>
    <h1 className='text-2xl font-bold tracking-tight sm:text-3xl'>{title}</h1>
    {lead && <p className='mt-2 max-w-2xl text-muted'>{lead}</p>}
  </div>
);

type Tone = 'info' | 'warn' | 'danger' | 'ok';
const TONES: Record<Tone, string> = {
  info: 'border-line bg-raised text-ink',
  warn: 'border-warn/40 bg-warn-soft text-ink',
  danger: 'border-danger/40 bg-danger-soft text-ink',
  ok: 'border-ok/40 bg-ok-soft text-ink'
};

export const Notice = ({
  tone = 'info',
  children
}: PropsWithChildren<{ tone?: Tone }>) => (
  <div className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone]}`}>
    {children}
  </div>
);

/**
 * A read that failed (the public API rate-limits under load): says so and
 * offers to try again, rather than spinning for ever or guessing.
 */
export const ReadFailed = ({
  what,
  retry,
  busy = false
}: {
  /** "your vestings", "this token". */
  what: string;
  retry: () => void;
  busy?: boolean;
}) => (
  <div className='space-y-3'>
    <Notice tone='warn'>
      Could not read {what} right now: the network did not answer. Nothing is
      lost; try again in a moment.
    </Notice>
    <Button onClick={retry} disabled={busy}>
      Try again
    </Button>
  </div>
);

export const Spinner = ({
  label = 'Reading the chain'
}: {
  label?: string;
}) => (
  <div
    className='flex items-center gap-3 py-6 text-sm text-muted'
    role='status'
  >
    <span
      className='h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent'
      aria-hidden
    />
    {label}...
  </div>
);

/** An amount with the token's decimals; every digit on hover. */
export const Amount = ({
  units,
  decimals,
  ticker,
  className = ''
}: {
  units: bigint;
  /** Undefined while the token's decimals are not known: no figure is shown. */
  decimals: number | undefined;
  ticker?: string;
  className?: string;
}) =>
  decimals === undefined ? (
    <span
      className={`tabular whitespace-nowrap text-muted ${className}`}
      title="The token's decimals are not known yet"
    >
      …{ticker && <span className='ml-1'>{ticker}</span>}
    </span>
  ) : (
    <span
      className={`tabular whitespace-nowrap ${className}`}
      title={`${formatAmountExact(units, decimals)}${ticker ? ` ${ticker}` : ''}`}
    >
      {formatAmount(units, decimals)}
      {ticker && <span className='ml-1 text-muted'>{ticker}</span>}
    </span>
  );

/** A moment in the reader's time zone, the same in UTC on hover. */
export const When = ({
  seconds,
  className = ''
}: {
  seconds: number;
  className?: string;
}) => (
  <time
    dateTime={new Date(seconds * 1000).toISOString()}
    title={formatUtc(seconds)}
    className={`tabular ${className}`}
  >
    {formatDate(seconds)}
  </time>
);

export const shortAddress = (address: string, size = 6) =>
  address.length > 2 * size + 4
    ? `${address.slice(0, 4 + size)}…${address.slice(-size)}`
    : address;

/** An address: shortened, copied on click, with a link to its page here. */
export const AddressText = ({
  address,
  link = true
}: {
  address: string;
  link?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <span className='inline-flex items-center gap-1 font-mono text-sm'>
      {link ? (
        <Link
          to={`/a/${address}`}
          className='hover:text-accent'
          title={address}
        >
          {shortAddress(address)}
        </Link>
      ) : (
        <span title={address}>{shortAddress(address)}</span>
      )}
      <button
        type='button'
        onClick={copy}
        className='text-xs text-faint hover:text-accent'
        aria-label='Copy the address'
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
};

export const ExplorerLink = ({
  path,
  children
}: PropsWithChildren<{ path: string }>) => (
  <a
    href={`${explorerUrl}${path}`}
    target='_blank'
    rel='noreferrer'
    className='text-accent hover:underline'
  >
    {children}
  </a>
);

/**
 * Progress of a vesting: claimed, vested but not claimed, still locked, and
 * (after a cancel) what went back, at the right end.
 */
export const Progress = ({
  total,
  vested,
  claimed,
  refunded = 0n
}: {
  total: bigint;
  vested: bigint;
  claimed: bigint;
  refunded?: bigint;
}) => {
  const share = (part: bigint) =>
    total === 0n ? 0 : Number((part * 10_000n) / total) / 100;
  const claimedShare = share(claimed);
  const vestedShare = share(vested);
  const refundedShare = share(refunded);
  return (
    <div
      className='relative h-2.5 w-full overflow-hidden rounded-full bg-raised'
      role='progressbar'
      aria-valuenow={vestedShare}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${vestedShare}% vested, ${claimedShare}% claimed${refunded ? `, ${refundedShare}% refunded on cancel` : ''}`}
    >
      <div
        className='absolute inset-y-0 left-0 bg-accent/35'
        style={{ width: `${vestedShare}%` }}
      />
      <div
        className='absolute inset-y-0 left-0 bg-accent'
        style={{ width: `${claimedShare}%` }}
      />
      {refunded > 0n && (
        <div
          className='absolute inset-y-0 right-0 bg-cancel/50'
          style={{ width: `${refundedShare}%` }}
        />
      )}
    </div>
  );
};

export const Badge = ({
  tone = 'info',
  children
}: PropsWithChildren<{ tone?: Tone | 'accent' | 'cancel' }>) => {
  const styles: Record<string, string> = {
    info: 'bg-raised text-muted',
    accent: 'bg-accent-soft text-accent',
    cancel: 'bg-cancel-soft text-cancel',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    ok: 'bg-ok-soft text-ok'
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles[tone]}`}
    >
      {children}
    </span>
  );
};

export const Field = ({
  label,
  hint,
  children
}: PropsWithChildren<{ label: ReactNode; hint?: ReactNode }>) => (
  <label className='block'>
    <span className='mb-1 block text-sm font-semibold'>{label}</span>
    {children}
    {hint && <span className='mt-1 block text-xs text-muted'>{hint}</span>}
  </label>
);

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none';
