import { useState } from 'react';
import type { Sent } from 'chain/send';

interface SigningRecord {
  sender: string;
  signing: boolean;
  sent?: Sent;
  total: number;
}

/**
 * A page's record of its current signing, kept by the page rather than the
 * signing panel: a disconnect unmounts the panel while the wallet prompt is
 * open or the send is in flight, and a panel mounted again on reconnect must
 * resume from this record instead of offering "Sign" again (main audit D2;
 * Create keeps its own, richer record).
 *
 * Spread `panel(sender, total)` into the TxPanel and call `clear()` when the
 * reader closes it or starts another action.
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
  return { panel, clear: () => setRecord(null) };
};
