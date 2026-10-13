import { Address } from '@multiversx/sdk-core';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { balancesOf, createdIdsOf, TxOutcome } from 'chain/reads';
import type { Sent } from 'chain/send';
import { vesting as client } from 'chain/vesting';
import { LeaveGuard } from 'components/shell/LeaveGuard';
import { TxPanel } from 'components/tx/TxPanel';
import {
  Amount,
  Button,
  Card,
  Field,
  Info,
  inputClass,
  Notice,
  PageTitle,
  Spinner
} from 'components/ui';
import { ScheduleChart } from 'components/vesting/Chart';
import { ReleaseTable } from 'components/vesting/ReleaseTable';
import { IssuerPowers } from 'components/vesting/TokenTrust';
import { useAsync, useToken } from 'hooks';
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

/** Sorted ids as runs of consecutive ones: [340..459] instead of 120 ids. */
const runsOf = (ids: number[]): [number, number][] => {
  const runs: [number, number][] = [];
  for (const id of ids) {
    const last = runs[runs.length - 1];
    if (last && id === last[1] + 1) last[1] = id;
    else runs.push([id, id]);
  }
  return runs;
};

const Step = ({
  n,
  title,
  info,
  children,
  done
}: {
  n: number;
  title: string;
  /** What the step decides, behind an "i" next to its title. */
  info?: ReactNode;
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
      {info && <Info>{info}</Info>}
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
  // Its issuer's powers and whether it is verified: the wallet's balance list
  // does not carry them.
  const tokenFacts = useToken(tokenId || undefined);

  // 2. beneficiaries
  const [mode, setMode] = useState<'rows' | 'csv'>('rows');
  const [rows, setRows] = useState<Row[]>([{ address: '', amount: '' }]);
  const [csv, setCsv] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  // The name of the file the lines came from, while they are unedited.
  const [csvFile, setCsvFile] = useState<string | null>(null);
  const loadCsv = (file: File) =>
    file.text().then((text) => {
      setCsv(text);
      setCsvFile(file.name);
    });
  // Rows typed one by one are judged once the reader leaves them for
  // something else on the page, not while still typing in them, and not when
  // they only switch to another window (to copy an address, say). Editing a
  // row hides its message again until it is left. After "Check and sign"
  // every row is judged, live.
  const [judged, setJudged] = useState<Set<number>>(new Set());
  const [judgeAll, setJudgeAll] = useState(false);
  const editing = (index: number) =>
    setJudged((previous) => {
      if (!previous.has(index)) return previous;
      const next = new Set(previous);
      next.delete(index);
      return next;
    });

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

  // In rows mode a line's problems show once it was left (see `judged`).
  const shownErrors =
    mode === 'rows'
      ? beneficiaries.errors.filter(
          (error) => judgeAll || judged.has(error.line - 1)
        )
      : beneficiaries.errors;

  // A smart contract as beneficiary is allowed, but it must accept tokens from
  // other contracts and be able to move the key (red team RT9). Its address
  // says so by its shape: the first eight bytes are zero.
  const contracts = beneficiaries.list.filter(
    (row) =>
      (mode === 'csv' || judgeAll || judged.has(row.line - 1)) &&
      Address.newFromBech32(row.address).isSmartContract()
  );

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
    setJudgeAll(true);
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

  // Leaving the page with transactions half done loses this record: a reload
  // or a closed tab asks the browser's question, an in-app link LeaveGuard's.
  const halfDone = Boolean(
    review &&
    (review.busy || (anySent && (toSign.length > 0 || lost.length > 0)))
  );
  useEffect(() => {
    if (!halfDone) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [halfDone]);

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

  // Hashes whose created ids were already read (each is read once).
  const idsRead = useRef(new Set<string>());

  /**
   * What the panel knows, on every change: a final result is recorded, a
   * pending one clears any earlier verdict (a missing transaction that turns
   * up is processing again, not missing). Never "failed" for pending: only
   * a real failure lets a line be signed again.
   */
  const onProgress =
    (id: number) => async (hashes: string[], outcomes: TxOutcome[]) => {
      update(id, (current) => {
        const results = { ...current.results };
        hashes.forEach((hash, k) => {
          const status = outcomes[k].status;
          if (status === 'pending') delete results[hash];
          else
            results[hash] =
              status === 'success'
                ? 'success'
                : status === 'missing'
                  ? 'missing'
                  : 'failed';
        });
        return { ...current, results };
      });
      const fresh = hashes.filter(
        (hash, k) =>
          outcomes[k].status === 'success' && !idsRead.current.has(hash)
      );
      fresh.forEach((hash) => idsRead.current.add(hash));
      const ids = (await Promise.all(fresh.map(createdIdsOf))).flat();
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
    setCsvFile(null);
    setJudged(new Set());
    setJudgeAll(false);
  };

  // ------------------------------------------------------------- render

  const leaveGuard = (
    <LeaveGuard
      when={halfDone}
      message='Transactions of this creation are not all done. Leaving this page loses its record of what was sent and what is left to sign. Leave anyway?'
    />
  );

  if (!isLoggedIn) {
    return (
      <div>
        {leaveGuard}
        <PageTitle
          title='Create vestings'
          info='Lock a token for one or many beneficiaries. Each gets a claim key NFT; you choose the schedule and whether you can cancel.'
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
      {leaveGuard}
      <PageTitle
        title='Create vestings'
        info='Lock a token for one or many beneficiaries. Each gets a claim key NFT; you choose the schedule and whether you can cancel. Nothing is sent until you sign at the end.'
      />
      {settings.data?.paused && (
        <Notice tone='warn'>
          Creating vestings is paused by the contract owner right now. Claims
          and cancels still work.
        </Notice>
      )}

      {/* Locked while a review is open: what is signed is what was checked. */}
      {review && (
        <Notice>
          The form is locked while this creation is open (see step 5).{' '}
          {review.hashes.some(Boolean)
            ? 'Press "Start a new creation" there to make another one.'
            : 'Close its panel there ("Not now") to edit it.'}
        </Notice>
      )}
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
          {token && tokenFacts.known && tokenFacts.verified === false && (
            <p className='text-sm text-warn'>
              {tokenFacts.identifier} has no registered logo or description:
              check that it is the token you mean, not a look-alike.
            </p>
          )}
          {token && tokenFacts.known && <IssuerPowers token={tokenFacts} />}
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
                <div
                  key={index}
                  className='flex flex-col gap-2 sm:flex-row'
                  onBlur={(event) => {
                    const row = event.currentTarget;
                    const next = event.relatedTarget as Node | null;
                    // If the page itself lost focus (another window, another
                    // app), it is not leaving the row: checked now and once
                    // the blur is over, whichever the browser reports first.
                    const pageHadFocus = document.hasFocus();
                    setTimeout(() => {
                      if (!pageHadFocus || !document.hasFocus()) return;
                      if (next && row.contains(next)) return;
                      setJudged((previous) => new Set(previous).add(index));
                    }, 0);
                  }}
                >
                  <input
                    className={`${inputClass} font-mono sm:flex-[3]`}
                    placeholder='erd1... beneficiary address'
                    value={row.address}
                    onChange={(event) => {
                      editing(index);
                      setRows(
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, address: event.target.value }
                            : r
                        )
                      );
                    }}
                  />
                  <input
                    className={`${inputClass} sm:flex-1`}
                    placeholder={`Amount${ticker ? ` of ${ticker}` : ''}`}
                    inputMode='decimal'
                    value={row.amount}
                    onChange={(event) => {
                      editing(index);
                      setRows(
                        rows.map((r, i) =>
                          i === index ? { ...r, amount: event.target.value } : r
                        )
                      );
                    }}
                  />
                  {(rows.length > 1 || row.address || row.amount) && (
                    <Button
                      variant='ghost'
                      onClick={() => {
                        // The last line is emptied rather than removed: there
                        // is always one to type into.
                        setRows(
                          rows.length > 1
                            ? rows.filter((_, i) => i !== index)
                            : [{ address: '', amount: '' }]
                        );
                        // The rows below move up one place.
                        setJudged(
                          (previous) =>
                            new Set(
                              [...previous]
                                .filter((i) => i !== index)
                                .map((i) => (i > index ? i - 1 : i))
                            )
                        );
                      }}
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
            <div className='space-y-3'>
              <div className='flex flex-wrap items-center gap-3'>
                {/* A real button that opens the hidden file input: the
                    browser's own control was easy to miss, and a <label>
                    around it did nothing on some phones (Sebastian, devnet
                    test). Every common CSV type is accepted: phones name
                    them text/csv, text/comma-separated-values or even
                    application/vnd.ms-excel, and grey out the others. */}
                <Button onClick={() => fileInput.current?.click()}>
                  Choose a CSV file
                </Button>
                <input
                  ref={fileInput}
                  type='file'
                  accept='.csv,.txt,text/csv,text/plain,text/comma-separated-values,application/csv,application/vnd.ms-excel'
                  className='hidden'
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // The same file can be chosen again after an edit.
                    event.target.value = '';
                    if (file) loadCsv(file);
                  }}
                />
                <span className='text-sm text-muted'>
                  {csvFile ? (
                    <>
                      <span className='font-semibold text-ink'>{csvFile}</span>{' '}
                      loaded: check the lines below.
                    </>
                  ) : (
                    'or drop a file on the box below or paste the lines into it'
                  )}
                </span>
              </div>
              <Field
                label='One line per vesting: address, amount'
                hint={`A header line is fine. Amounts in ${ticker || 'token'} units, at most ${decimals} decimals. Comma, semicolon or tab between the two.`}
              >
                <textarea
                  className={`${inputClass} h-48 font-mono`}
                  value={csv}
                  onChange={(event) => {
                    setCsv(event.target.value);
                    setCsvFile(null);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const file = event.dataTransfer.files?.[0];
                    if (!file) return;
                    event.preventDefault();
                    loadCsv(file);
                  }}
                  placeholder={'address,amount\nerd1...,1000\nerd1...,2500.5'}
                />
              </Field>
            </div>
          )}
          {shownErrors.length > 0 && (
            <Notice tone='danger'>
              Fix these lines first:
              <ul className='mt-1 list-disc pl-5'>
                {shownErrors.slice(0, 20).map((error) => (
                  <li key={error.line}>
                    Line {error.line}: {error.message}
                  </li>
                ))}
              </ul>
              {shownErrors.length > 20 && (
                <p>and {shownErrors.length - 20} more.</p>
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
          {contracts.length > 0 && (
            <Notice tone='warn'>
              {contracts.length === 1
                ? `Line ${contracts[0].line} is a smart contract`
                : `Lines ${contracts
                    .slice(0, 10)
                    .map((row) => row.line)
                    .join(
                      ', '
                    )}${contracts.length > 10 ? ' and more' : ''} are smart contracts`}
              . It must accept tokens from other contracts and be able to send
              the claim key on; if it cannot, the key comes back to the vesting
              contract until the owner returns it, or stays stuck. A wallet
              address is safer unless you know the contract can.
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
                )
                <Info>
                  Every other beneficiary follows the same schedule in
                  proportion to their amount.
                </Info>
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

        <Step
          n={4}
          title='Options'
          info={
            <>
              <b>Cannot be cancelled:</b> once created, no key can stop it; the
              beneficiaries receive everything on schedule, as far as the
              token&apos;s own issuer allows (step 1 shows its powers). The
              strongest promise to a community (the contract itself is
              upgradeable by its multisig; see How it works).
              <br />
              <br />
              <b>Cancelable:</b> you receive a cancel key NFT per vesting.
              Sending it back stops that vesting: what has vested stays with the
              beneficiary and the rest comes back to you. Anyone can see that a
              vesting is cancelable.
            </>
          }
          done={cancelable !== null}
        >
          <div className='grid gap-3 sm:grid-cols-2'>
            <button
              type='button'
              onClick={() => setCancelable(false)}
              className={`rounded-xl border p-4 text-left ${cancelable === false ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
            >
              <span className='font-semibold'>Cannot be cancelled</span>
              <span className='mt-1 block text-sm text-muted'>
                Nobody can stop it.
              </span>
            </button>
            <button
              type='button'
              onClick={() => setCancelable(true)}
              className={`rounded-xl border p-4 text-left ${cancelable === true ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
            >
              <span className='font-semibold'>Cancelable</span>
              <span className='mt-1 block text-sm text-muted'>
                You get a cancel key for each vesting.
              </span>
            </button>
          </div>
          <Field
            label='Label (optional)'
            hint='Shown on every vesting, for example "Team 2027" or "Seed round".'
            note={`${labelBytes}/${limits.maxLabelLen} bytes`}
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
                  <Info>
                    At most {Math.max(...batches.map((batch) => batch.length))}{' '}
                    vestings per transaction. Your wallet asks once for all of
                    them.
                  </Info>
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
        {shownErrors.length < beneficiaries.errors.length && (
          <Notice tone='warn'>
            Finish line{' '}
            {beneficiaries.errors
              .filter((error) => !shownErrors.includes(error))
              .map((error) => error.line)
              .join(', ')}{' '}
            of the beneficiaries (step 2).
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
            {runsOf(created).map(([first, last], index) => (
              <span key={first}>
                {index > 0 && ', '}
                <Link
                  to={`/v/${first}`}
                  className='text-accent hover:underline'
                >
                  #{first}
                </Link>
                {last !== first && (
                  <>
                    {last === first + 1 ? ', ' : '–'}
                    <Link
                      to={`/v/${last}`}
                      className='text-accent hover:underline'
                    >
                      #{last}
                    </Link>
                  </>
                )}
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
              // A signing not sent yet is also withdrawn once a send of this
              // creation is missing: nothing more of it is signed then.
              if (
                !attempt.sent &&
                review.busyAttempt !== attempt.n &&
                (!sameAccount || lost.length > 0)
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
                  onProgress={onProgress(review.id)}
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
                        created nothing yet (not sent or failed). The vestings
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
