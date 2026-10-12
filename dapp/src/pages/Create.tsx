import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { balancesOf, createdIdsOf, TxOutcome } from 'chain/reads';
import type { Sent } from 'chain/send';
import { vesting as client } from 'chain/vesting';
import { TxPanel } from 'components/tx/TxPanel';
import {
  Amount,
  Button,
  Card,
  Field,
  inputClass,
  Notice,
  PageTitle,
  Spinner
} from 'components/ui';
import { ScheduleChart } from 'components/vesting/Chart';
import { ReleaseTable } from 'components/vesting/ReleaseTable';
import { useAsync } from 'hooks';
import { useGetAccount, useGetIsLoggedIn } from 'lib';
import { DEFAULT_LIMITS, splitIntoBatches } from 'vesting/batches';
import { buildSchedule, DAY, Plan, planProblem, Shape } from 'vesting/builder';
import { EGLD, NewVesting } from 'vesting/client';
import {
  Beneficiary,
  downloadFile,
  parseBeneficiaries,
  toCsv
} from 'vesting/csv';
import { formatAmount, plainAmount } from 'vesting/format';
import { validateSchedule } from 'vesting/schedule';

// ---------------------------------------------------------------- helpers

const pad = (n: number) => String(n).padStart(2, '0');
/** Seconds to the value of a datetime-local input, in the reader's time zone. */
const toLocalInput = (seconds: number) => {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
};
/**
 * "12.5" or "12,5" (percent) to basis points; NaN when it is not a percentage
 * with at most two decimals (12.345% is refused, not rounded).
 */
const toBps = (value: string) => {
  const match = /^(\d{1,3})(?:[.,](\d{0,2}))?$/.exec(value.trim());
  return match
    ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
    : NaN;
};

const Step = ({
  n,
  title,
  children,
  done
}: {
  n: number;
  title: string;
  children: ReactNode;
  done?: boolean;
}) => (
  <Card className='space-y-4'>
    <h2 className='flex items-center gap-3 text-lg font-bold'>
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${done ? 'bg-accent text-accent-ink' : 'bg-raised text-muted'}`}
      >
        {n}
      </span>
      {title}
    </h2>
    {children}
  </Card>
);

/** One signing of some of the review's transactions. */
interface Attempt {
  n: number;
  /** Which of the review's transactions (indexes into `batches`). */
  indexes: number[];
  /** The account's next nonce when earlier ones may still be pending. */
  firstNonce?: bigint;
  /** Something of it reached the network: it stays on the page. */
  sent?: boolean;
  /** What send() returned: the panel is rebuilt from it if mounted again. */
  result?: Sent;
}

/**
 * What was reviewed and is being signed, frozen when "Check and sign" is
 * pressed. Once any of it reached the network the review stays (the form stays
 * locked) until "Start a new creation": what was sent is never offered again,
 * only the transactions that created nothing.
 */
interface Review {
  key: string;
  /** The account that opened it: only it signs any of it. */
  account: string;
  tokenId: string;
  batches: NewVesting[][];
  cancelable: boolean;
  label: string;
  fee: bigint;
  decimals: number;
  ticker: string;
  /** Per transaction: the hash it was sent with. */
  hashes: (string | undefined)[];
  /** Final results by hash. */
  results: Record<string, 'success' | 'failed' | 'missing'>;
  /** Sent, but the network did not confirm receiving them. */
  unconfirmed: string[];
  attempts: Attempt[];
  /** The wallet is asked, or the transactions are being sent. */
  busy: boolean;
  /** The attempt whose wallet prompt is open. */
  busyAttempt?: number;
  nextNonce?: bigint;
  /** Unique per review: late answers for an earlier one are dropped. */
  id: number;
  /** The next attempt's number: never reused. */
  nextAttempt: number;
}

interface Row {
  address: string;
  amount: string;
}

type CliffChoice = 'none' | 'catch-up' | 'lump';
type ShapeChoice = 'linear' | 'days' | 'months' | 'tranches';

// -------------------------------------------------------------------- page

export const Create = () => {
  const isLoggedIn = useGetIsLoggedIn();
  const { address } = useGetAccount();
  const balances = useAsync(
    () => (address ? balancesOf(address) : Promise.resolve([])),
    [address]
  );
  const settings = useAsync(
    async () => ({
      fee: await client.fee(),
      paused: await client.creationPaused(),
      limits: await client.limits()
    }),
    []
  );

  // 1. token
  const [tokenId, setTokenId] = useState('');
  const token = balances.data?.find(
    (balance) => balance.identifier === tokenId
  );
  const decimals = token?.decimals ?? 18;

  // 2. beneficiaries
  const [mode, setMode] = useState<'rows' | 'csv'>('rows');
  const [rows, setRows] = useState<Row[]>([{ address: '', amount: '' }]);
  const [csv, setCsv] = useState('');

  // 3. schedule
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60, []);
  const [start, setStart] = useState(toLocalInput(now));
  const [cliffChoice, setCliffChoice] = useState<CliffChoice>('none');
  const [cliffAt, setCliffAt] = useState(toLocalInput(now + 180 * DAY));
  const [cliffShare, setCliffShare] = useState('10');
  const [shapeChoice, setShapeChoice] = useState<ShapeChoice>('linear');
  const [end, setEnd] = useState(toLocalInput(now + 2 * 365 * DAY));
  const [everyDays, setEveryDays] = useState('30');
  const [everyMonths, setEveryMonths] = useState('1');
  const [count, setCount] = useState('24');
  const [dates, setDates] = useState<{ at: string; share: string }[]>([
    { at: toLocalInput(now + 90 * DAY), share: '50' },
    { at: toLocalInput(now + 180 * DAY), share: '50' }
  ]);

  // 4. options
  const [cancelable, setCancelable] = useState<boolean | null>(null);
  const [label, setLabel] = useState('');

  // 5. signing: what was reviewed is frozen until it is sent or dropped
  const [review, setReview] = useState<Review | null>(null);
  const [created, setCreated] = useState<number[]>([]);
  /** Why an open review was closed before anything was sent. */
  const [closed, setClosed] = useState<'form' | 'account' | null>(null);

  // ------------------------------------------------------------ derived

  const beneficiaries = useMemo((): {
    list: Beneficiary[];
    errors: { line: number; message: string }[];
    repeated: string[];
  } => {
    if (mode === 'csv') {
      const result = parseBeneficiaries(csv, decimals);
      return {
        list: result.rows,
        errors: result.errors,
        repeated: result.repeated
      };
    }
    // One line per row, empty ones included, so "line N" is row N; an empty
    // row is skipped by the parser, and no row is ever taken for a header.
    const text = rows
      .map((row) => `${row.address.trim()}\t${row.amount.trim()}`)
      .join('\n');
    const result = parseBeneficiaries(text, decimals, { header: false });
    return {
      list: result.rows,
      errors: result.errors,
      repeated: result.repeated
    };
  }, [mode, csv, rows, decimals]);

  const plan = useMemo((): Plan | null => {
    const startAt = fromLocalInput(start);
    if (!Number.isFinite(startAt)) return null;
    let shape: Shape;
    switch (shapeChoice) {
      case 'linear':
        shape = { kind: 'linear', end: fromLocalInput(end) };
        break;
      case 'days':
        shape = { kind: 'days', days: Number(everyDays), count: Number(count) };
        break;
      case 'months':
        shape = {
          kind: 'months',
          months: Number(everyMonths),
          count: Number(count)
        };
        break;
      case 'tranches':
        shape = {
          kind: 'tranches',
          tranches: dates.map((d) => ({
            time: fromLocalInput(d.at),
            bps: toBps(d.share)
          }))
        };
        break;
    }
    const cliff =
      cliffChoice === 'none'
        ? undefined
        : {
            at: fromLocalInput(cliffAt),
            style: cliffChoice,
            bps: cliffChoice === 'lump' ? toBps(cliffShare) : 0
          };
    return { start: startAt, cliff, shape };
  }, [
    start,
    shapeChoice,
    end,
    everyDays,
    everyMonths,
    count,
    dates,
    cliffChoice,
    cliffAt,
    cliffShare
  ]);

  const planIssue = plan ? planProblem(plan) : 'Choose a start date.';
  const limits = settings.data?.limits ?? DEFAULT_LIMITS;

  const entries = useMemo((): NewVesting[] => {
    if (!plan || planIssue) return [];
    return beneficiaries.list.map((b) => ({
      beneficiary: b.address,
      total: b.amount,
      schedule: buildSchedule(plan, b.amount)
    }));
  }, [plan, planIssue, beneficiaries.list]);

  // The contract's own check on every vesting, in its words.
  const entryIssues = useMemo(() => {
    const issues: string[] = [];
    const horizon = Math.floor(Date.now() / 1000) + limits.maxHorizon;
    entries.forEach((entry, index) => {
      const problem = validateSchedule(entry.schedule, entry.total);
      if (problem)
        issues.push(
          `Line ${beneficiaries.list[index].line}: the contract would refuse it (${problem}).`
        );
      else if (entry.schedule.end > horizon)
        issues.push(
          'The schedule ends more than 30 years from now, which the contract refuses.'
        );
    });
    return [...new Set(issues)].slice(0, 10);
  }, [entries, beneficiaries.list, limits]);

  const sum = beneficiaries.list.reduce((total, b) => total + b.amount, 0n);
  const fee = settings.data?.fee ?? 0n;
  const feeTotal = fee * BigInt(beneficiaries.list.length);
  const tranchesEach = entries.reduce(
    (most, entry) =>
      Math.max(
        most,
        entry.schedule.curve.kind === 'tranches'
          ? entry.schedule.curve.tranches.length
          : 0
      ),
    0
  );
  const batches = useMemo(
    () => splitIntoBatches(entries, cancelable === true, limits, tranchesEach),
    [entries, cancelable, limits, tranchesEach]
  );
  const egld =
    balances.data?.find((balance) => balance.identifier === EGLD)?.balance ??
    0n;
  const tooMuch = token
    ? tokenId === EGLD
      ? sum + feeTotal > token.balance
      : sum > token.balance
    : false;
  const noFeeMoney = tokenId !== EGLD && feeTotal > egld;
  const labelBytes = new TextEncoder().encode(label).length;

  const ready =
    !!settings.data &&
    !!token &&
    beneficiaries.list.length > 0 &&
    beneficiaries.errors.length === 0 &&
    !planIssue &&
    entryIssues.length === 0 &&
    cancelable !== null &&
    labelBytes <= limits.maxLabelLen &&
    !tooMuch &&
    !noFeeMoney &&
    !settings.data?.paused;

  // Everything the transactions are built from, as one string: when it
  // changes after the review opened, what is shown is no longer what would be
  // signed.
  const formKey = useMemo(
    () =>
      JSON.stringify(
        {
          tokenId,
          entries,
          cancelable,
          label,
          fee,
          batches: batches.map((batch) => batch.length)
        },
        (_, value) => (typeof value === 'bigint' ? value.toString() : value)
      ),
    [tokenId, entries, cancelable, label, fee, batches]
  );

  // A build per attempt, made once: TxPanel checks again only for a new one.
  const builds = useRef(new Map<string, () => Promise<any[]>>());
  const buildFor = (r: Review, attempt: Attempt) => {
    const id = `${r.id}:${attempt.n}`;
    let build = builds.current.get(id);
    if (!build) {
      build = () =>
        Promise.all(
          attempt.indexes.map((index) => {
            const batch = r.batches[index];
            return batch.length === 1
              ? client.create(
                  r.account,
                  r.tokenId,
                  batch[0],
                  r.cancelable,
                  r.label,
                  r.fee
                )
              : client.createBatch(
                  r.account,
                  r.tokenId,
                  batch,
                  r.cancelable,
                  r.label,
                  r.fee
                );
          })
        );
      builds.current.set(id, build);
    }
    return build;
  };

  // The review answers belong to: anything for another one is dropped.
  const reviewId = useRef(0);

  const openReview = () => {
    builds.current.clear();
    reviewId.current += 1;
    setClosed(null);
    setCreated([]);
    setReview({
      key: formKey,
      account: address,
      tokenId,
      batches,
      cancelable: cancelable === true,
      label,
      fee,
      decimals,
      ticker: token?.ticker ?? '',
      hashes: batches.map(() => undefined),
      results: {},
      unconfirmed: [],
      attempts: [{ n: 0, indexes: batches.map((_, index) => index) }],
      busy: false,
      id: reviewId.current,
      nextAttempt: 1
    });
  };

  const anySent = review ? review.hashes.some(Boolean) : false;
  const openAttempt = review?.attempts.find((attempt) => !attempt.sent);
  const indexes = review ? review.batches.map((_, index) => index) : [];
  const resultOf = (index: number) => {
    const hash = review?.hashes[index];
    return hash ? (review!.results[hash] ?? 'pending') : 'not sent';
  };
  // What can be signed again: never sent, or executed and failed (its nonce
  // is used, so nothing else can execute in its place).
  const toSign = indexes.filter((index) =>
    ['not sent', 'failed'].includes(resultOf(index))
  );
  // Sent, but the network has not seen it for minutes. It may still turn up,
  // so it is never signed again here, and nothing more of this creation is
  // signed while its fate is unknown.
  const lost = indexes.filter((index) => resultOf(index) === 'missing');
  // A send the network did not confirm receiving must be settled first.
  const waiting = review
    ? review.unconfirmed.some((hash) => !review.results[hash])
    : false;
  const sameAccount = review?.account === address;

  // Before anything is sent, the review closes when what it was made from
  // changes: the form (locked while it is open, so only the token's settings
  // can) or the connected account. After, it stays: it is the record of what
  // was sent.
  useEffect(() => {
    if (!review || review.busy || review.hashes.some(Boolean)) return;
    if (review.account !== address) {
      setReview(null);
      setClosed('account');
    } else if (review.key !== formKey) {
      setReview(null);
      setClosed('form');
    }
  }, [review, formKey, address]);

  // Leaving the page with transactions half done loses this record.
  useEffect(() => {
    if (!review || !(review.busy || (anySent && toSign.length > 0))) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [review, anySent, toSign.length]);

  /** Applies `change` to the review `id` only, never to a later one. */
  const update = (id: number, change: (current: Review) => Review | null) =>
    setReview((current) =>
      current && current.id === id ? change(current) : current
    );

  const onBusy = (id: number, attempt: Attempt) => (busy: boolean) =>
    update(id, (current) => ({
      ...current,
      busy,
      busyAttempt: busy ? attempt.n : undefined
    }));

  const onSent = (id: number, attempt: Attempt) => (result: Sent) =>
    update(id, (current) => {
      const hashes = [...current.hashes];
      const results = { ...current.results };
      // send() returns the hashes in order, stopping at the first not sent.
      result.hashes.forEach((hash, k) => {
        hashes[attempt.indexes[k]] = hash;
      });
      return {
        ...current,
        hashes,
        results,
        busy: false,
        busyAttempt: undefined,
        nextNonce: result.nextNonce,
        unconfirmed: [...current.unconfirmed, ...(result.unconfirmed ?? [])],
        attempts: current.attempts.map((a) =>
          a.n === attempt.n ? { ...a, sent: true, result } : a
        )
      };
    });

  const onFinished =
    (id: number) => async (hashes: string[], outcomes: TxOutcome[]) => {
      update(id, (current) => ({
        ...current,
        results: {
          ...current.results,
          ...Object.fromEntries(
            hashes.map((hash, k) => [
              hash,
              outcomes[k].status === 'success'
                ? 'success'
                : outcomes[k].status === 'missing'
                  ? 'missing'
                  : 'failed'
            ])
          )
        }
      }));
      const ids = (
        await Promise.all(
          hashes
            .filter((_, k) => outcomes[k].status === 'success')
            .map(createdIdsOf)
        )
      ).flat();
      // Read while another review may have started: not that one's.
      if (reviewId.current !== id) return;
      setCreated((previous) =>
        [...new Set([...previous, ...ids])].sort((a, b) => a - b)
      );
    };

  const onClose = (id: number, attempt: Attempt) => () =>
    update(id, (current) =>
      // Nothing of the review was sent: the form unlocks.
      !current.hashes.some(Boolean)
        ? null
        : {
            ...current,
            attempts: current.attempts.filter((a) => a.n !== attempt.n)
          }
    );

  const signRemaining = () => {
    if (!review) return;
    setReview({
      ...review,
      nextAttempt: review.nextAttempt + 1,
      attempts: [
        ...review.attempts,
        { n: review.nextAttempt, indexes: toSign, firstNonce: review.nextNonce }
      ]
    });
  };

  // The lines of this creation that created nothing (never sent, failed, or
  // not found), to create again later from a file, with the same settings.
  const downloadNotCreated = () => {
    if (!review) return;
    const lines = indexes
      .filter((index) =>
        ['not sent', 'failed', 'missing'].includes(resultOf(index))
      )
      .flatMap((index) => review.batches[index])
      .map((v) => [v.beneficiary, plainAmount(v.total, review.decimals)]);
    downloadFile(
      `mvxvest-not-created-${review.ticker || review.tokenId}.csv`,
      toCsv(['address', 'amount'], lines)
    );
  };

  const startOver = () => {
    reviewId.current += 1;
    setReview(null);
    setCreated([]);
    setRows([{ address: '', amount: '' }]);
    setCsv('');
  };

  // ------------------------------------------------------------- render

  if (!isLoggedIn) {
    return (
      <div>
        <PageTitle
          title='Create vestings'
          lead='Lock a token for one or many beneficiaries. Each gets a claim key NFT; you choose the schedule and whether you can cancel.'
        />
        <Notice>
          Connect your wallet (top right) to choose a token from it. Connecting
          signs nothing.
        </Notice>
      </div>
    );
  }

  const previewEntry = entries[0];
  const ticker = token?.ticker ?? '';

  return (
    <div className='space-y-6'>
      <PageTitle
        title='Create vestings'
        lead='Lock a token for one or many beneficiaries. Each gets a claim key NFT; you choose the schedule and whether you can cancel. Nothing is sent until you sign at the end.'
      />
      {settings.data?.paused && (
        <Notice tone='warn'>
          Creating vestings is paused by the contract owner right now. Claims
          and cancels still work.
        </Notice>
      )}

      {/* Locked while a review is open: what is signed is what was checked. */}
      <fieldset
        disabled={!!review}
        className='min-w-0 space-y-6 disabled:opacity-60'
      >
        <Step n={1} title='Token' done={!!token}>
          {!balances.data ? (
            <Spinner label='Reading your wallet' />
          ) : (
            <Field
              label='The token to lock'
              hint='EGLD or any fungible token in this wallet.'
            >
              <select
                className={inputClass}
                value={tokenId}
                onChange={(event) => setTokenId(event.target.value)}
              >
                <option value=''>Choose a token</option>
                {balances.data
                  .filter((balance) => balance.balance > 0n)
                  .map((balance) => (
                    <option key={balance.identifier} value={balance.identifier}>
                      {balance.ticker} (
                      {balance.identifier === EGLD
                        ? 'EGLD'
                        : balance.identifier}
                      ): {formatAmount(balance.balance, balance.decimals)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </Step>

        <Step
          n={2}
          title='Beneficiaries'
          done={
            beneficiaries.list.length > 0 && beneficiaries.errors.length === 0
          }
        >
          <div className='flex gap-2'>
            <Button
              variant={mode === 'rows' ? 'primary' : 'secondary'}
              onClick={() => setMode('rows')}
            >
              One by one
            </Button>
            <Button
              variant={mode === 'csv' ? 'primary' : 'secondary'}
              onClick={() => setMode('csv')}
            >
              From a CSV
            </Button>
          </div>
          {mode === 'rows' ? (
            <div className='space-y-2'>
              {rows.map((row, index) => (
                <div key={index} className='flex flex-col gap-2 sm:flex-row'>
                  <input
                    className={`${inputClass} font-mono sm:flex-[3]`}
                    placeholder='erd1... beneficiary address'
                    value={row.address}
                    onChange={(event) =>
                      setRows(
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, address: event.target.value }
                            : r
                        )
                      )
                    }
                  />
                  <input
                    className={`${inputClass} sm:flex-1`}
                    placeholder={`Amount${ticker ? ` of ${ticker}` : ''}`}
                    inputMode='decimal'
                    value={row.amount}
                    onChange={(event) =>
                      setRows(
                        rows.map((r, i) =>
                          i === index ? { ...r, amount: event.target.value } : r
                        )
                      )
                    }
                  />
                  {rows.length > 1 && (
                    <Button
                      variant='ghost'
                      onClick={() =>
                        setRows(rows.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant='secondary'
                onClick={() => setRows([...rows, { address: '', amount: '' }])}
              >
                Add a beneficiary
              </Button>
            </div>
          ) : (
            <div className='space-y-2'>
              <Field
                label='One line per vesting: address, amount'
                hint={`A header line is fine. Amounts in ${ticker || 'token'} units, at most ${decimals} decimals. Comma, semicolon or tab between the two.`}
              >
                <textarea
                  className={`${inputClass} h-48 font-mono`}
                  value={csv}
                  onChange={(event) => setCsv(event.target.value)}
                  placeholder={'address,amount\nerd1...,1000\nerd1...,2500.5'}
                />
              </Field>
              <input
                type='file'
                accept='.csv,text/csv,text/plain'
                className='text-sm'
                onChange={(event) =>
                  event.target.files?.[0]?.text().then(setCsv)
                }
              />
            </div>
          )}
          {beneficiaries.errors.length > 0 && (
            <Notice tone='danger'>
              Fix these lines first:
              <ul className='mt-1 list-disc pl-5'>
                {beneficiaries.errors.slice(0, 20).map((error) => (
                  <li key={error.line}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
              {beneficiaries.errors.length > 20 && (
                <p>and {beneficiaries.errors.length - 20} more.</p>
              )}
            </Notice>
          )}
          {beneficiaries.repeated.length > 0 && (
            <Notice tone='warn'>
              {beneficiaries.repeated.length} address
              {beneficiaries.repeated.length === 1
                ? ' appears'
                : 'es appear'}{' '}
              more than once. Each line becomes its own vesting.
            </Notice>
          )}
          {beneficiaries.list.length > 0 && token && (
            <p className='text-sm text-muted'>
              {beneficiaries.list.length} vesting
              {beneficiaries.list.length === 1 ? '' : 's'},{' '}
              <Amount units={sum} decimals={decimals} ticker={ticker} /> in
              total.
            </p>
          )}
        </Step>

        <Step n={3} title='Schedule' done={!planIssue}>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field
              label='Start'
              hint='When vesting begins. It may be in the past: what has vested since is claimable at once.'
            >
              <input
                type='datetime-local'
                className={inputClass}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </Field>
            <Field
              label='Cliff'
              hint='Nothing can be claimed before the cliff.'
            >
              <select
                className={inputClass}
                value={cliffChoice}
                onChange={(event) =>
                  setCliffChoice(event.target.value as CliffChoice)
                }
              >
                <option value='none'>No cliff</option>
                <option value='catch-up'>
                  Cliff: what vested before it unlocks at once
                </option>
                <option value='lump'>
                  Cliff: a share unlocks at it, the rest vests after
                </option>
              </select>
            </Field>
            {cliffChoice !== 'none' && (
              <Field label='Cliff date'>
                <input
                  type='datetime-local'
                  className={inputClass}
                  value={cliffAt}
                  onChange={(event) => setCliffAt(event.target.value)}
                />
              </Field>
            )}
            {cliffChoice === 'lump' && (
              <Field label='Share unlocked at the cliff (%)'>
                <input
                  className={inputClass}
                  inputMode='decimal'
                  value={cliffShare}
                  onChange={(event) => setCliffShare(event.target.value)}
                />
              </Field>
            )}
            <Field label='How the rest is released'>
              <select
                className={inputClass}
                value={shapeChoice}
                onChange={(event) =>
                  setShapeChoice(event.target.value as ShapeChoice)
                }
              >
                <option value='linear'>
                  Every second (linear) until an end date
                </option>
                <option value='days'>Every N days</option>
                <option value='months'>
                  Every N months, on the same day (your time zone)
                </option>
                <option value='tranches'>On dates I choose</option>
              </select>
            </Field>
            {shapeChoice === 'linear' && (
              <Field label='End' hint='Everything has vested at this moment.'>
                <input
                  type='datetime-local'
                  className={inputClass}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </Field>
            )}
            {(shapeChoice === 'days' || shapeChoice === 'months') && (
              <>
                <Field
                  label={
                    shapeChoice === 'days'
                      ? 'Every how many days'
                      : 'Every how many months'
                  }
                >
                  <input
                    className={inputClass}
                    inputMode='numeric'
                    value={shapeChoice === 'days' ? everyDays : everyMonths}
                    onChange={(event) =>
                      (shapeChoice === 'days' ? setEveryDays : setEveryMonths)(
                        event.target.value
                      )
                    }
                  />
                </Field>
                <Field
                  label='Number of releases'
                  hint={
                    shapeChoice === 'months'
                      ? `At most ${limits.maxTranches}.`
                      : undefined
                  }
                >
                  <input
                    className={inputClass}
                    inputMode='numeric'
                    value={count}
                    onChange={(event) => setCount(event.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          {shapeChoice === 'tranches' && (
            <div className='space-y-2'>
              <p className='text-sm text-muted'>
                Each release: a date and its share of each beneficiary’s total.
                The shares must add up to 100%.
              </p>
              {dates.map((row, index) => (
                <div key={index} className='flex flex-col gap-2 sm:flex-row'>
                  <input
                    type='datetime-local'
                    className={`${inputClass} sm:flex-[2]`}
                    value={row.at}
                    onChange={(event) =>
                      setDates(
                        dates.map((d, i) =>
                          i === index ? { ...d, at: event.target.value } : d
                        )
                      )
                    }
                  />
                  <input
                    className={`${inputClass} sm:flex-1`}
                    inputMode='decimal'
                    placeholder='%'
                    value={row.share}
                    onChange={(event) =>
                      setDates(
                        dates.map((d, i) =>
                          i === index ? { ...d, share: event.target.value } : d
                        )
                      )
                    }
                  />
                  {dates.length > 1 && (
                    <Button
                      variant='ghost'
                      onClick={() =>
                        setDates(dates.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant='secondary'
                onClick={() =>
                  setDates([
                    ...dates,
                    { at: dates[dates.length - 1].at, share: '' }
                  ])
                }
              >
                Add a release
              </Button>
            </div>
          )}
          {planIssue ? (
            <Notice tone='warn'>{planIssue}</Notice>
          ) : previewEntry && token ? (
            <div className='space-y-3'>
              <p className='text-sm text-muted'>
                Preview for the first beneficiary (
                <Amount
                  units={previewEntry.total}
                  decimals={decimals}
                  ticker={ticker}
                />
                ); every other one follows the same schedule in proportion to
                their amount.
              </p>
              <ScheduleChart
                schedule={previewEntry.schedule}
                total={previewEntry.total}
                decimals={decimals}
                ticker={ticker}
                now={now}
              />
              <ReleaseTable
                schedule={previewEntry.schedule}
                total={previewEntry.total}
                decimals={decimals}
                ticker={ticker}
              />
            </div>
          ) : (
            <p className='text-sm text-muted'>
              The chart and every release appear here once a token and a
              beneficiary are set.
            </p>
          )}
        </Step>

        <Step n={4} title='Options' done={cancelable !== null}>
          <div className='grid gap-3 sm:grid-cols-2'>
            <button
              type='button'
              onClick={() => setCancelable(false)}
              className={`rounded-xl border p-4 text-left ${cancelable === false ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
            >
              <span className='font-semibold'>Cannot be cancelled</span>
              <span className='mt-1 block text-sm text-muted'>
                Once created, no key can stop it: the beneficiaries receive
                everything on schedule. The strongest promise to a community
                (the contract is upgradeable by its multisig; see the guide).
              </span>
            </button>
            <button
              type='button'
              onClick={() => setCancelable(true)}
              className={`rounded-xl border p-4 text-left ${cancelable === true ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
            >
              <span className='font-semibold'>Cancelable</span>
              <span className='mt-1 block text-sm text-muted'>
                You receive a cancel key NFT per vesting. Sending it back stops
                that vesting: what has vested stays with the beneficiary, the
                rest comes back. Anyone can see that it is cancelable.
              </span>
            </button>
          </div>
          <Field
            label='Label (optional)'
            hint={`Shown on every vesting, for example "Team 2027" or "Seed round". ${labelBytes}/${limits.maxLabelLen} bytes.`}
          >
            <input
              className={inputClass}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={limits.maxLabelLen}
            />
          </Field>
        </Step>
      </fieldset>

      <Step n={5} title='Review and sign' done={created.length > 0}>
        {token && beneficiaries.list.length > 0 ? (
          <dl className='grid gap-3 text-sm sm:grid-cols-2'>
            <div>
              <dt className='text-muted'>Vestings</dt>
              <dd className='font-semibold'>{beneficiaries.list.length}</dd>
            </div>
            <div>
              <dt className='text-muted'>Locked in total</dt>
              <dd className='font-semibold'>
                <Amount units={sum} decimals={decimals} ticker={ticker} />
              </dd>
            </div>
            <div>
              <dt className='text-muted'>Contract fee</dt>
              <dd>
                {fee === 0n ? (
                  'none'
                ) : (
                  <>
                    <Amount units={feeTotal} decimals={18} ticker='EGLD' /> (
                    <Amount units={fee} decimals={18} /> per vesting, paid by
                    you, never by beneficiaries)
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className='text-muted'>Transactions to sign</dt>
              <dd>
                {batches.length}
                {batches.length > 1 && (
                  <span className='text-muted'>
                    {' '}
                    (at most {Math.max(
                      ...batches.map((batch) => batch.length)
                    )}{' '}
                    vestings each; one wallet prompt for all)
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className='text-sm text-muted'>Fill in the steps above.</p>
        )}
        {tooMuch && (
          <Notice tone='danger'>
            This wallet does not hold enough {ticker} for these vestings
            {tokenId === EGLD ? ' and the fee' : ''}.
          </Notice>
        )}
        {noFeeMoney && (
          <Notice tone='danger'>
            This wallet does not hold enough EGLD for the contract fee.
          </Notice>
        )}
        {entryIssues.length > 0 && (
          <Notice tone='danger'>
            <ul className='list-disc pl-5'>
              {entryIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Notice>
        )}
        {cancelable === null && token && beneficiaries.list.length > 0 && (
          <Notice tone='warn'>
            Choose whether the vestings can be cancelled (step 4).
          </Notice>
        )}
        {closed && !review && (
          <Notice tone='warn'>
            {closed === 'account'
              ? 'The wallet changed account after the review opened. Check and sign again.'
              : 'The form changed after the review opened. Check and sign again.'}
          </Notice>
        )}
        {created.length > 0 && (
          <Notice tone='ok'>
            Created {created.length} vesting{created.length === 1 ? '' : 's'}:{' '}
            {created.map((id, index) => (
              <span key={id}>
                {index > 0 && ', '}
                <Link to={`/v/${id}`} className='text-accent hover:underline'>
                  #{id}
                </Link>
              </span>
            ))}
            . The claim keys are in the beneficiaries’ wallets
            {review?.cancelable ? ', the cancel keys in yours' : ''}.
          </Notice>
        )}
        {review ? (
          <>
            {review.attempts.map((attempt) => {
              // An attempt not sent yet is signed only by the account that
              // opened the review.
              // (A panel whose wallet prompt is open always stays.)
              if (
                !attempt.sent &&
                !sameAccount &&
                review.busyAttempt !== attempt.n
              )
                return null;
              const vestings = attempt.indexes.flatMap(
                (index) => review.batches[index]
              );
              const locked = vestings.reduce((total, v) => total + v.total, 0n);
              return (
                <TxPanel
                  key={`${review.id}:${attempt.n}`}
                  sender={review.account}
                  label={
                    vestings.length === 1
                      ? 'Create a vesting'
                      : `Create ${vestings.length} vestings`
                  }
                  summary={
                    <p>
                      {attempt.n > 0
                        ? `The remaining ${attempt.indexes.length} of ${review.batches.length} transactions: `
                        : ''}
                      Locks{' '}
                      <Amount
                        units={locked}
                        decimals={review.decimals}
                        ticker={review.ticker}
                      />{' '}
                      in {vestings.length} vesting
                      {vestings.length === 1 ? '' : 's'}
                      {review.cancelable
                        ? ' that you can cancel'
                        : ' that cannot be cancelled'}
                      {attempt.indexes.length > 1
                        ? `, in ${attempt.indexes.length} transactions`
                        : ''}
                      . Each beneficiary receives a claim key NFT
                      {review.cancelable
                        ? '; you receive a cancel key per vesting'
                        : ''}
                      .
                    </p>
                  }
                  build={buildFor(review, attempt)}
                  firstNonce={attempt.firstNonce}
                  onBusy={onBusy(review.id, attempt)}
                  onSent={onSent(review.id, attempt)}
                  onFinished={onFinished(review.id)}
                  keepAfterSent
                  resume={{
                    sent: attempt.result,
                    signing: review.busyAttempt === attempt.n,
                    total: attempt.indexes.length
                  }}
                  onClose={onClose(review.id, attempt)}
                />
              );
            })}
            {anySent && lost.length > 0 && !review.busy && (
              <div className='space-y-2'>
                <Notice tone='warn'>
                  {lost.length === 1
                    ? 'One transaction was'
                    : `${lost.length} transactions were`}{' '}
                  not seen on the network for 2 minutes. Most likely{' '}
                  {lost.length === 1 ? 'it' : 'they'} did not go through, but
                  this cannot be certain, so nothing more of this creation is
                  signed here: signing {lost.length === 1 ? 'it' : 'them'} again
                  could create the same vestings twice. The page keeps looking.
                  <span className='mt-2 block'>
                    To create what is missing: download the lines not created,
                    check on the explorer (links above) that the transaction is
                    not there, disconnect and connect your wallet again, then
                    start a new creation with the same settings and that file.
                  </span>
                </Notice>
                <Button variant='secondary' onClick={downloadNotCreated}>
                  Download the lines not created (CSV)
                </Button>
              </div>
            )}
            {anySent &&
              lost.length === 0 &&
              toSign.length > 0 &&
              !openAttempt &&
              !review.busy && (
                <div className='space-y-2'>
                  {!sameAccount ? (
                    <Notice tone='warn'>
                      {toSign.length} of {review.batches.length} transactions
                      created nothing yet. They were prepared for{' '}
                      <span className='font-mono'>{review.account}</span>:
                      connect that account again to sign them.
                    </Notice>
                  ) : waiting ? (
                    <Notice>
                      Waiting for the network to confirm the transaction above
                      before the rest can be signed.
                    </Notice>
                  ) : (
                    <>
                      <Notice tone='warn'>
                        {toSign.length} of {review.batches.length} transactions
                        created nothing yet (not sent, or failed). The vestings
                        already created are listed above and are not signed
                        again.
                      </Notice>
                      <Button onClick={signRemaining}>
                        Sign the remaining {toSign.length}
                      </Button>
                    </>
                  )}
                </div>
              )}
            {anySent && !review.busy && (
              <Button variant='secondary' onClick={startOver}>
                Start a new creation
              </Button>
            )}
          </>
        ) : (
          <Button disabled={!ready} onClick={openReview}>
            Check and sign
          </Button>
        )}
      </Step>
    </div>
  );
};
