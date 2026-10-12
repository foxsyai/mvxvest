import { Transaction } from '@multiversx/sdk-core';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { outcomeOf, TxOutcome } from 'chain/reads';
import { prepare, send, Sent } from 'chain/send';
import { explainWalletFailure } from 'chain/walletFailure';
import { Amount, Button, ExplorerLink, Notice, Spinner } from 'components/ui';

type Phase =
  | { step: 'checking' }
  | { step: 'ready'; transactions: Transaction[]; problems: (string | null)[] }
  | { step: 'signing' }
  | { step: 'sent'; sent: Sent; total: number }
  | { step: 'error'; message: string };

/**
 * The most a transaction can cost: its data at the full gas price, the rest at
 * the 1% the network charges for contract execution (gas price 10^9).
 */
const maxFee = (tx: Transaction) => {
  const dataGas = 50_000n + 1_500n * BigInt(tx.data.length);
  const execution = tx.gasLimit > dataGas ? tx.gasLimit - dataGas : 0n;
  return dataGas * 1_000_000_000n + execution * 10_000_000n;
};

/**
 * How long a sent hash may stay unknown to the API before it is called
 * missing: a transaction is executed and indexed within seconds.
 */
const MISSING_AFTER_MS = 120_000;

const outcomeText = (outcome?: TxOutcome) => {
  if (!outcome || outcome.status === 'pending') return 'processing';
  if (outcome.status === 'success') return 'done';
  if (outcome.status === 'missing')
    return 'not found on the network: it did not go through';
  return `failed: ${outcome.reason ?? outcome.status}`;
};

/**
 * Shows what will happen, checks every transaction against the network first,
 * then asks the wallet once and follows each transaction to its result.
 *
 * What is signed is always the latest check of the latest `build`: an older
 * check that answers late is dropped. Once the wallet is asked, nothing is
 * checked or offered again: a re-render of the page (sdk-dapp refreshes the
 * account when signing, the app reloads its reads when a transaction settles)
 * must never put "Sign" back in front of transactions already signed.
 */
export const TxPanel = ({
  sender,
  label,
  summary,
  build,
  firstNonce,
  onSent,
  onFinished,
  onBusy,
  keepAfterSent = false,
  onClose
}: {
  sender: string;
  /** "Claim", "Cancel vesting #4", "Create 120 vestings". */
  label: string;
  /** What will happen, in words, shown before signing. */
  summary: ReactNode;
  build: () => Promise<Transaction[]>;
  /** The nonce to start from when earlier transactions are still pending. */
  firstNonce?: bigint;
  /** Called once, as soon as the network has accepted what it accepted. */
  onSent?: (sent: Sent) => void;
  onFinished?: (hashes: string[], outcomes: TxOutcome[]) => void;
  /** True when the wallet is asked; false again if nothing was sent. */
  onBusy?: (busy: boolean) => void;
  /** Once sent, stays on the page (no Close): the page keeps its record. */
  keepAfterSent?: boolean;
  onClose: () => void;
}) => {
  const [phase, setPhase] = useState<Phase>({ step: 'checking' });
  const [outcomes, setOutcomes] = useState<Record<string, TxOutcome>>({});
  const run = useRef(0);
  const locked = useRef(false);

  const check = async () => {
    if (locked.current) return;
    const id = ++run.current;
    setPhase({ step: 'checking' });
    try {
      const prepared = await prepare(sender, await build(), firstNonce);
      if (id === run.current && !locked.current)
        setPhase({ step: 'ready', ...prepared });
    } catch (failure) {
      if (id === run.current && !locked.current) {
        setPhase({
          step: 'error',
          message: `Could not prepare it: ${String((failure as any)?.message ?? failure)}`
        });
      }
    }
  };

  useEffect(() => {
    check();
    // Only a new build (or sender) asks for a new check, never a re-render.
  }, [build, sender]);

  const sign = async (transactions: Transaction[]) => {
    locked.current = true;
    run.current++;
    setPhase({ step: 'signing' });
    onBusy?.(true);
    try {
      const sent = await send(transactions, label);
      setPhase({ step: 'sent', sent, total: transactions.length });
      onSent?.(sent);
    } catch (failure) {
      // send() rejects only when nothing can have reached the network (a
      // send that may have arrived resolves as unconfirmed): checking again
      // is safe.
      locked.current = false;
      onBusy?.(false);
      setPhase({
        step: 'error',
        message: explainWalletFailure(failure, label)
      });
    }
  };

  // Follow each sent transaction until the network has its result.
  useEffect(() => {
    if (phase.step !== 'sent') return;
    const { hashes } = phase.sent;
    let stopped = false;
    const unknownSince = new Map<string, number>();
    const poll = async () => {
      const next: Record<string, TxOutcome> = {};
      for (const hash of hashes) {
        let outcome: TxOutcome = await outcomeOf(hash).catch(() => ({
          status: 'pending' as const
        }));
        if (outcome.unknown) {
          const since = unknownSince.get(hash) ?? Date.now();
          unknownSince.set(hash, since);
          if (Date.now() - since > MISSING_AFTER_MS)
            outcome = { status: 'missing' };
        } else unknownSince.delete(hash);
        next[hash] = outcome;
      }
      if (stopped) return;
      setOutcomes(next);
      if (Object.values(next).some((outcome) => outcome.status === 'pending'))
        setTimeout(poll, 3_000);
      else
        onFinished?.(
          hashes,
          hashes.map((hash) => next[hash])
        );
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [phase.step]);

  return (
    <div className='space-y-4'>
      <div className='text-sm'>{summary}</div>
      {phase.step === 'checking' && (
        <Spinner label='Checking with the network' />
      )}
      {phase.step === 'ready' && (
        <>
          {phase.problems.some(Boolean) ? (
            <Notice tone='danger'>
              The network would refuse{' '}
              {phase.transactions.length > 1
                ? 'some of these transactions'
                : 'this transaction'}
              , so nothing is sent:
              <ul className='mt-2 list-disc pl-5'>
                {phase.problems.map((problem, index) =>
                  problem ? (
                    <li key={index}>
                      {phase.transactions.length > 1
                        ? `Transaction ${index + 1}: `
                        : ''}
                      {problem}
                    </li>
                  ) : null
                )}
              </ul>
            </Notice>
          ) : (
            <Notice>
              {phase.transactions.length === 1
                ? 'Checked with the network: it would go through.'
                : `Checked with the network: all ${phase.transactions.length} transactions would go through. Your wallet asks once for all of them.`}{' '}
              Network fee, at most{' '}
              <Amount
                units={phase.transactions.reduce(
                  (sum, tx) => sum + maxFee(tx),
                  0n
                )}
                decimals={18}
                ticker='EGLD'
              />
              .
            </Notice>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button
              disabled={phase.problems.some(Boolean)}
              onClick={() => sign(phase.transactions)}
            >
              Sign in your wallet
            </Button>
            <Button variant='secondary' onClick={onClose}>
              Not now
            </Button>
          </div>
        </>
      )}
      {phase.step === 'signing' && <Spinner label='Waiting for your wallet' />}
      {phase.step === 'sent' && (
        <div className='space-y-2'>
          {phase.sent.unconfirmed?.length ? (
            <Notice tone='warn'>
              The network did not confirm that it received{' '}
              {phase.sent.unconfirmed.length === 1
                ? 'one transaction'
                : `${phase.sent.unconfirmed.length} transactions`}{' '}
              (the connection timed out). It may well have gone through: it is
              followed below. Do not sign it again before it shows done or not
              found.
            </Notice>
          ) : null}
          {phase.sent.stopped ? (
            <Notice tone='warn'>
              {phase.sent.hashes.length} of {phase.total} transactions were
              sent. Transaction {phase.sent.stopped.at + 1}
              {phase.sent.stopped.at + 1 < phase.total
                ? ' and the ones after it were'
                : ' was'}{' '}
              not sent ({phase.sent.stopped.reason}): what they hold was not
              done. Nothing here sends them again by itself.
            </Notice>
          ) : null}
          <p className='text-sm font-semibold'>Sent. Following the result:</p>
          <ul className='space-y-1 text-sm'>
            {phase.sent.hashes.map((hash, index) => (
              <li key={hash} className='flex flex-wrap items-center gap-2'>
                <span className='text-muted'>Transaction {index + 1}:</span>
                <span
                  className={
                    outcomes[hash]?.status === 'success'
                      ? 'text-ok'
                      : outcomes[hash]?.status &&
                          outcomes[hash].status !== 'pending'
                        ? 'text-danger'
                        : ''
                  }
                >
                  {outcomeText(outcomes[hash])}
                </span>
                <ExplorerLink path={`/transactions/${hash}`}>
                  view on the explorer
                </ExplorerLink>
              </li>
            ))}
          </ul>
          {!keepAfterSent && (
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      )}
      {phase.step === 'error' && (
        <div className='space-y-2'>
          <Notice tone='danger'>{phase.message}</Notice>
          <div className='flex gap-2'>
            <Button onClick={check}>Check again</Button>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
