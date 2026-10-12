// Sends this tab made that the network has not seen for minutes ("missing").
// Kept apart from send.ts so the signing panel can report them without
// depending on how transactions are sent.

import { getState } from '@multiversx/sdk-dapp/out/store/store';

/**
 * Hashes this tab sent that the network has not seen for minutes. While
 * sdk-dapp's wallet session still counts one of them, a new transaction would
 * be queued behind it, and both would execute if it turned up: nothing new is
 * prepared until the reader reconnects the wallet (which clears that session)
 * or it turns up.
 */
const missingHashes = new Set<string>();

export const markMissing = (hash: string, missing: boolean) => {
  if (missing) missingHashes.add(hash);
  else missingHashes.delete(hash);
};

export const stillCounted = (): string | undefined => {
  if (missingHashes.size === 0) return undefined;
  const sessions = Object.values<any>(getState()?.transactions ?? {});
  for (const session of sessions) {
    for (const tx of session?.transactions ?? []) {
      if (missingHashes.has(tx.hash)) return tx.hash;
    }
  }
  return undefined;
};
