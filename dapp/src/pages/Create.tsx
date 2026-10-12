import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { balancesOf, createdIdsOf } from 'chain/reads';
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
import { Beneficiary, parseBeneficiaries } from 'vesting/csv';
import { formatAmount } from 'vesting/format';
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

/** What was reviewed and is being signed: frozen while the panel is open. */
interface Review {
  key: string;
  tokenId: string;
  batches: NewVesting[][];
  cancelable: boolean;
  label: string;
  fee: bigint;
  count: number;
  sum: bigint;
  decimals: number;
  ticker: string;
  /** Batches already accepted by the network. */
  done: number;
  /** Bumped to sign the remaining batches after a partial send. */
  attempt: number;
  /** Something was sent: the form stays locked. */
  sending?: boolean;
  /** The last send stopped before the end. */
  stopped?: boolean;
  nextNonce?: bigint;
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
  const [changed, setChanged] = useState(false);

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
  const batches = splitIntoBatches(
    entries,
    cancelable === true,
    limits,
    tranchesEach
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

  const openReview = () => {
    setChanged(false);
    setCreated([]);
    setReview({
      key: formKey,
      tokenId,
      batches,
      cancelable: cancelable === true,
      label,
      fee,
      count: beneficiaries.list.length,
      sum,
      decimals,
      ticker: token?.ticker ?? '',
      done: 0,
      attempt: 0
    });
  };

  // Nothing sent yet and the form changed: close the review; it must be
  // checked again. (The form is disabled while it is open; this is the guard
  // behind that.)
  useEffect(() => {
    if (
      review &&
      review.done === 0 &&
      !review.sending &&
      review.key !== formKey
    ) {
      setReview(null);
      setChanged(true);
    }
  }, [review, formKey]);

  const remaining = review ? review.batches.slice(review.done) : [];
  const build = useCallback(
    () =>
      Promise.all(
        remaining.map((batch) =>
          batch.length === 1
            ? client.create(
                address,
                review!.tokenId,
                batch[0],
                review!.cancelable,
                review!.label,
                review!.fee
              )
            : client.createBatch(
                address,
                review!.tokenId,
                batch,
                review!.cancelable,
                review!.label,
                review!.fee
              )
        )
      ),
    // A new build only for a new review or a new attempt at the remaining.

    [review?.key, review?.attempt, address]
  );

  const sent = (result: Sent) => {
    setReview((current) =>
      current
        ? {
            ...current,
            sending: true,
            done: current.done + result.hashes.length,
            nextNonce: result.nextNonce,
            stopped: Boolean(result.stopped)
          }
        : current
    );
  };

  const finished = async (hashes: string[]) => {
    const ids = (await Promise.all(hashes.map(createdIdsOf))).flat();
    setCreated((previous) =>
      [...new Set([...previous, ...ids])].sort((a, b) => a - b)
    );
  };

  const startOver = () => {
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
        {changed && !review && (
          <Notice tone='warn'>
            The form changed after the review opened. Check and sign again.
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
            {(remaining.length > 0 || review.sending) && (
              <TxPanel
                key={`${review.key}:${review.attempt}`}
                sender={address}
                label={
                  review.count === 1
                    ? 'Create a vesting'
                    : `Create ${review.count} vestings`
                }
                summary={
                  <p>
                    {review.done > 0 && !review.sending
                      ? `The remaining ${remaining.length} of ${review.batches.length} transactions: `
                      : ''}
                    Locks{' '}
                    <Amount
                      units={review.sum}
                      decimals={review.decimals}
                      ticker={review.ticker}
                    />{' '}
                    in {review.count} vesting{review.count === 1 ? '' : 's'}
                    {review.cancelable
                      ? ' that you can cancel'
                      : ' that cannot be cancelled'}
                    {review.batches.length > 1
                      ? `, in ${review.batches.length} transactions`
                      : ''}
                    . Each beneficiary receives a claim key NFT
                    {review.cancelable
                      ? '; you receive a cancel key per vesting'
                      : ''}
                    .
                  </p>
                }
                build={build}
                firstNonce={review.nextNonce}
                onSent={sent}
                onFinished={finished}
                onClose={() => (review.sending ? undefined : setReview(null))}
              />
            )}
            {review.sending && review.stopped && remaining.length > 0 && (
              <div className='space-y-2'>
                <Notice tone='warn'>
                  {review.done} of {review.batches.length} transactions were
                  sent; {remaining.length} were not. Check the created vestings
                  above before going on.
                </Notice>
                <Button
                  onClick={() =>
                    setReview({
                      ...review,
                      sending: false,
                      stopped: false,
                      attempt: review.attempt + 1
                    })
                  }
                >
                  Sign the remaining {remaining.length}
                </Button>
              </div>
            )}
            {review.sending && (
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
