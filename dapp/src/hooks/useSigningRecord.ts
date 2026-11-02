import { useState } from 'react';
import type { TxOutcome } from 'chain/reads';
import type { Sent } from 'chain/send';

interface SigningRecord {
  sender: string;
  signing: boolean;
  sent?: Sent;
  total: number;
  /** Every transaction sent has its final result. */
  settled?: boolean;
}

/** "Missing" is never final: it may still turn up. */
const final = (outcome: TxOutcome) =>
  outcome.status !== 'pending' && outcome.status !== 'missing';

/**
 * A page's record of its current signing, kept by the page rather than the
 * signing panel: a disconnect unmounts the panel while the wallet prompt is
 * open or the send is in flight, and a panel mounted again on reconnect must
 * resume from this record instead of offering "Sign" again (main audit D2;
 * Create keeps its own, richer record).
 *
 * Spread `panel(sender, total)` into the TxPanel, pass its `onFinished`
 * outcomes to `settle()` and call `clear()` when the reader closes it or starts
 * another action.
 */
export const useSigningRecord = () => {
  const [record, setRecord] = useState<SigningRecord | null>(null);
  const panel = (sender: string, total: number) => ({
    onBusy: (busy: boolean) =>
      setRecord((current) =>
        busy ? { sender, signing: true, total } : current?.sent ? current : null
      ),
    onSent: (sent: Sent) => setRecord({ sender, signing: false, sent, total }),
    // Another wallet connected since: its panel starts afresh.
    resume:
      record && record.sender === sender
        ? { sent: record.sent, signing: record.signing, total: record.total }
        : undefined
  });
  return {
    panel,
    /** The wallet was asked, and it did not end with nothing sent. */
    started: (sender: string) => record?.sender === sender,
    /**
     * What was sent has its final result: the page may offer its other
     * actions again, with the result still on screen.
     */
    settled: (sender: string) =>
      record?.sender === sender && Boolean(record.settled),
    /** Pass the TxPanel's `onFinished` outcomes. */
    settle: (outcomes: TxOutcome[]) =>
      setRecord((current) =>
        current?.sent ? { ...current, settled: outcomes.every(final) } : current
      ),
    clear: () => setRecord(null)
  };
};
