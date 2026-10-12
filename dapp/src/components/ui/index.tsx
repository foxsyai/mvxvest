// The small building blocks every page uses. Colors are theme tokens only
// (styles/tailwind.css), so light and dark both stay complete.

import {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { explorerUrl } from 'chain/network';
import {
  formatAmount,
  formatAmountExact,
  formatDate,
  formatUtc,
  isoDate
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

/**
 * Back to the page the reader came from inside the app (My vestings, a
 * token...), or to the start when the page was opened from outside.
 */
export const BackLink = () => {
  const navigate = useNavigate();
  // React Router numbers the entries it pushed: 0 is where the visit began.
  const inApp =
    ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const className =
    'mb-2 flex w-fit items-center gap-1 text-sm text-muted hover:text-accent';
  return inApp ? (
    <button type='button' className={className} onClick={() => navigate(-1)}>
      ← Back
    </button>
  ) : (
    <Link to='/' className={className}>
      ← Home
    </Link>
  );
};

/**
 * A small "i" that holds an explanation, so pages show data rather than
 * paragraphs: it opens on hover (desktop) and on tap (phone). A tap elsewhere,
 * Escape or scrolling closes it. Not for use inside a button or a link.
 */
export const Info = ({
  children,
  label = 'More information'
}: PropsWithChildren<{ label?: string }>) => {
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Opened by a tap or a click: it stays until closed, not on mouse leave.
  const pinned = useRef(false);
  const id = useId();

  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(300, window.innerWidth - 32);
    const left = Math.min(
      Math.max(16, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 16
    );
    setPlace({ left, top: rect.bottom + 8, width });
  };
  const hide = () => {
    pinned.current = false;
    setPlace(null);
  };

  useEffect(() => {
    if (!place) return;
    const onPointer = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node)) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [place]);

  return (
    <>
      <button
        ref={button}
        type='button'
        aria-label={label}
        aria-expanded={Boolean(place)}
        aria-describedby={place ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned.current) setPlace(null);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pinned.current) hide();
          else {
            pinned.current = true;
            show();
          }
        }}
        className='ml-1.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-faint align-middle text-[11px] font-bold leading-none text-muted hover:border-accent hover:text-accent'
      >
        i
      </button>
      {place &&
        createPortal(
          <span
            id={id}
            role='tooltip'
            style={{ position: 'fixed', ...place }}
            className='z-50 rounded-xl border border-line bg-raised p-3 text-sm font-normal leading-relaxed text-ink shadow-lg'
          >
            {children}
          </span>,
          document.body
        )}
    </>
  );
};

export const PageTitle = ({
  title,
  lead,
  info,
  back = false
}: {
  title: string;
  /** Data that belongs under the title (an address, a total). */
  lead?: ReactNode;
  /** What the page is for, behind an "i" next to the title. */
  info?: ReactNode;
  /** A detail page: "← Back" above the title. */
  back?: boolean;
}) => (
  <div className='mb-6'>
    {back && <BackLink />}
    <h1 className='flex items-center text-2xl font-bold tracking-tight sm:text-3xl'>
      {title}
      {info && <Info label={`About ${title}`}>{info}</Info>}
    </h1>
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
  digits = 6,
  className = ''
}: {
  units: bigint;
  /** Undefined while the token's decimals are not known: no figure is shown. */
  decimals: number | undefined;
  ticker?: string;
  /** Decimals shown (cut, never rounded up); every digit is in the tooltip. */
  digits?: number;
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
      {formatAmount(units, decimals, digits)}
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
    dateTime={isoDate(seconds)}
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

/**
 * A labelled form field. `hint` is an explanation behind an "i" next to the
 * label; `note` is short live information shown under the field (a counter).
 * The "i" sits outside the <label>, which would otherwise hand its clicks to
 * the button instead of the input.
 */
export const Field = ({
  label,
  hint,
  note,
  children
}: PropsWithChildren<{
  label: ReactNode;
  hint?: ReactNode;
  note?: ReactNode;
}>) => (
  <div>
    <div className='mb-1 flex items-center text-sm font-semibold'>
      <span aria-hidden>{label}</span>
      {hint && <Info>{hint}</Info>}
    </div>
    <label className='block'>
      <span className='sr-only'>{label}</span>
      {children}
    </label>
    {note && <span className='mt-1 block text-xs text-muted'>{note}</span>}
  </div>
);

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none';
