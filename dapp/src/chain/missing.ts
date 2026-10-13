// Sends the network has not seen ("missing"). Kept apart from send.ts so the
// signing panel can share the rule without depending on how transactions are
// sent.

import { getState } from '@multiversx/sdk-dapp/out/store/store';
import { api } from './network';

/** How long the network may not know a sent hash before it is called missing. */
export const MISSING_AFTER_MS = 120_000;

/**
 * The API lists a transaction a second or two after the node takes it; until
 * then an unknown hash means nothing.
 */
const INDEXING_GRACE_MS = 30_000;

const unseen = async (hash: string) => {
  try {
    await api(`/transactions/${hash}?fields=status`);
    return false;
  } catch (failure) {
    // Only a clear "not found": a slow or refused read proves nothing.
    return (failure as any)?.status === 404;
  }
};

/**
 * A transaction of `sender` that sdk-dapp's wallet session still counts, that
 * has not executed (its nonce is not below the account's) and that the network
 * does not know. sdk-dapp signs every new transaction after the highest nonce
 * it counts, so anything signed now would wait behind it, and both would
 * execute if it turned up (main audit D1).
 *
 * The clock is the session's own: sdk-dapp names a session after the
 * Date.now() it was created at, and keeps it across a reload, so the rule holds
 * whether or not a page followed the send (main audit D1, 13 Oct 2026).
 */
export const lostSend = async (
  sender: string,
  accountNonce: bigint
): Promise<{ hash: string; missing: boolean } | undefined> => {
  const now = Date.now();
  const sessions = Object.entries<any>(getState()?.transactions ?? {});
  for (const [sessionId, session] of sessions) {
    const sentAt = Number(sessionId);
    const age = Number.isFinite(sentAt) ? now - sentAt : Infinity;
    if (age < INDEXING_GRACE_MS) continue;
    for (const tx of session?.transactions ?? []) {
      if (!tx?.hash || tx.sender !== sender) continue;
      if (BigInt(tx.nonce ?? 0) < accountNonce) continue;
      if (await unseen(tx.hash))
        return { hash: tx.hash, missing: age > MISSING_AFTER_MS };
    }
  }
  return undefined;
};
