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
// Used only when the contract's own limits cannot be read: version 2's,
// which version 1 accepts too (it allowed 50 and 33).
export const DEFAULT_LIMITS: Limits = {
  maxBatch: 49,
  maxBatchCancelable: 32,
  maxTranches: 120,
  maxLabelLen: 64,
  maxHorizon: 30 * 365 * 86_400,
  maxPage: 100
};

/** Gas one transaction should stay under (the network allows 600M). */
export const GAS_BUDGET = 500_000_000;

/**
 * About the gas one vesting costs in a batch, measured on devnet: 8.5M
 * cancelable or 5.7M not (linear, 279M for 33 and 284M for 50), plus what its
 * explicit tranches cost. That grows faster than the count (the list is
 * decoded, checked and stored whole): 0.42M each at 12 tranches (30 monthly
 * vestings of 12: 407M), 1.06M each at 120 (one `create` of 120: 132M). The
 * fit 0.3624M n + 0.005216M n^2 goes through both, with 15% on top; the
 * simulation at signing has the last word.
 */
export const gasPerVesting = (cancelable: boolean, tranches: number) =>
  (cancelable ? 8_500_000 : 5_700_000) +
  Math.ceil(1.15 * (362_400 * tranches + 5_216 * tranches * tranches));

/** Most vestings of this shape one transaction can carry. */
export const maxPerBatch = (
  cancelable: boolean,
  tranches: number,
  limits = DEFAULT_LIMITS
) =>
  Math.max(
    1,
    Math.min(
      cancelable ? limits.maxBatchCancelable : limits.maxBatch,
      Math.floor(GAS_BUDGET / gasPerVesting(cancelable, tranches))
    )
  );

/**
 * Splits `items` into batches of at most the contract's limit, and fewer when
 * each vesting carries many tranches (`tranches`), as even as possible: 120
 * cancelable vestings become 4 transactions of 30, not 33, 33, 33 and 21.
 */
export const splitIntoBatches = <T>(
  items: T[],
  cancelable: boolean,
  limits = DEFAULT_LIMITS,
  tranches = 0
): T[][] => {
  const max = maxPerBatch(cancelable, tranches, limits);
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
