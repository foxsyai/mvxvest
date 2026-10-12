import { Transaction } from '@multiversx/sdk-core';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { outcomeOf, TxOutcome } from 'chain/reads';
import { prepare, send } from 'chain/send';
import { explainWalletFailure } from 'chain/walletFailure';
import { Amount, Button, ExplorerLink, Notice, Spinner } from 'components/ui';

type Phase =
  | { step: 'checking' }
  | { step: 'ready'; transactions: Transaction[]; problems: (string | null)[] }
  | { step: 'signing' }
  | { step: 'sent'; hashes: string[] }
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

const outcomeText = (outcome?: TxOutcome) => {
  if (!outcome || outcome.status === 'pending') return 'processing';
  if (outcome.status === 'success') return 'done';
  return `failed: ${outcome.reason ?? outcome.status}`;
};

/**
 * Shows what will happen, checks every transaction against the network first,
 * then asks the wallet once and follows each transaction to its result.
 */
export const TxPanel = ({
  sender,
  label,
  summary,
  build,
  onFinished,
  onClose
}: {
  sender: string;
  /** "Claim", "Cancel vesting #4", "Create 120 vestings". */
  label: string;
  /** What will happen, in words, shown before signing. */
  summary: ReactNode;
  build: () => Promise<Transaction[]>;
  onFinished?: (hashes: string[], outcomes: TxOutcome[]) => void;
  onClose: () => void;
}) => {
  const [phase, setPhase] = useState<Phase>({ step: 'checking' });
  const [outcomes, setOutcomes] = useState<Record<string, TxOutcome>>({});

  const check = useCallback(async () => {
    setPhase({ step: 'checking' });
    try {
      const prepared = await prepare(sender, await build());
      setPhase({ step: 'ready', ...prepared });
    } catch (failure) {
      setPhase({
        step: 'error',
        message: `Could not prepare it: ${String((failure as any)?.message ?? failure)}`
      });
    }
  }, [sender, build]);

  useEffect(() => {
    check();
  }, [check]);

  const sign = async (transactions: Transaction[]) => {
    setPhase({ step: 'signing' });
    try {
      const { hashes } = await send(transactions, label);
      setPhase({ step: 'sent', hashes });
    } catch (failure) {
      setPhase({
        step: 'error',
        message: explainWalletFailure(failure, label)
      });
    }
  };

  // Follow each sent transaction until the network has its result.
  useEffect(() => {
    if (phase.step !== 'sent') return;
    let stopped = false;
    const poll = async () => {
      const next: Record<string, TxOutcome> = {};
      for (const hash of phase.hashes)
        next[hash] = await outcomeOf(hash).catch(() => ({
          status: 'pending' as const
        }));
      if (stopped) return;
      setOutcomes(next);
      if (Object.values(next).some((outcome) => outcome.status === 'pending'))
        setTimeout(poll, 3_000);
      else
        onFinished?.(
          phase.hashes,
          phase.hashes.map((hash) => next[hash])
        );
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [phase]);

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
          <p className='text-sm font-semibold'>Sent. Following the result:</p>
          <ul className='space-y-1 text-sm'>
            {phase.hashes.map((hash, index) => (
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
          <Button variant='secondary' onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      {phase.step === 'error' && (
        <div className='space-y-2'>
          <Notice tone='danger'>{phase.message}</Notice>
          <div className='flex gap-2'>
            <Button onClick={check}>Try again</Button>
            <Button variant='secondary' onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
