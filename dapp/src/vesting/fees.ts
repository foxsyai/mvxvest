// The token fee of version 2 of the contract (DECISIONS.md #10): a share of
// each vesting's total, in its own token, paid by the creator on top of the
// total and sent to the owner multisig. Computed exactly as the contract does
// (per vesting, rounded down), because the payment must match to the unit.

/** Basis points in one whole: 100 is 1%. */
export const BPS = 10_000n;

/** The token fee of one vesting of `total` at `bps`. */
export const tokenFeeOf = (total: bigint, bps: number): bigint =>
  bps > 0 ? (total * BigInt(bps)) / BPS : 0n;

/** The token fee of several vestings: each rounded down on its own. */
export const tokenFeeOfAll = (totals: bigint[], bps: number): bigint =>
  totals.reduce((sum, total) => sum + tokenFeeOf(total, bps), 0n);

/** "1%", "1.5%", "0.25%". */
export const percentOf = (bps: number): string =>
  `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
