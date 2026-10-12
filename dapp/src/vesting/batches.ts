// Splitting many vestings into transactions. The network allows about 100
// built-in calls per transaction (NFT mints and transfers): a vesting needs two,
// three when cancelable, so at most 50 or 33 fit (measured on devnet; the
// contract's getLimits reports both). Gas is checked again at signing time by
// simulating each transaction.

export interface Limits {
  maxBatch: number;
  maxBatchCancelable: number;
  maxTranches: number;
  maxLabelLen: number;
  maxHorizon: number;
  maxPage: number;
}

/** The contract's limits, used until getLimits has answered. */
export const DEFAULT_LIMITS: Limits = {
  maxBatch: 50,
  maxBatchCancelable: 33,
  maxTranches: 120,
  maxLabelLen: 64,
  maxHorizon: 30 * 365 * 86_400,
  maxPage: 100
};

/**
 * Splits `items` into batches of at most the contract's limit, as even as
 * possible: 120 cancelable vestings become 4 transactions of 30, not 33, 33,
 * 33 and 21, so no transaction is the odd one out.
 */
export const splitIntoBatches = <T>(
  items: T[],
  cancelable: boolean,
  limits = DEFAULT_LIMITS
): T[][] => {
  const max = cancelable ? limits.maxBatchCancelable : limits.maxBatch;
  if (items.length === 0) return [];
  const count = Math.ceil(items.length / max);
  const size = Math.ceil(items.length / count);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    batches.push(items.slice(i, i + size));
  return batches;
};

/** At most this many keys go into one claim or cancel (each may be burned). */
export const MAX_KEYS_PER_CALL = 50;

export const splitKeys = <T>(keys: T[], size = MAX_KEYS_PER_CALL): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < keys.length; i += size)
    batches.push(keys.slice(i, i + size));
  return batches;
};
