// Amounts and dates as people read them. Amounts are bigint token units and are
// never passed through a float: 10^30 units must come out exactly.

/**
 * `units` with `decimals`, thousands separated by commas, at most
 * `maxFraction` decimals (cut, not rounded, so a balance is never shown as more
 * than it is), trailing zeros dropped. `formatAmount(1234567890000000000000n, 18)`
 * is "1,234.56789".
 */
export const formatAmount = (
  units: bigint,
  decimals: number,
  maxFraction = 6
): string => {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fraction =
    decimals > 0 ? (abs % base).toString().padStart(decimals, '0') : '';
  fraction = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (fraction === '' && abs > 0n && abs < base && maxFraction < decimals) {
    // A non-zero amount too small to show: say so rather than print 0.
    return `${negative ? '-' : ''}< 0.${'0'.repeat(Math.max(0, maxFraction - 1))}1`;
  }
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
};

/** Every digit, for a tooltip or a review screen: nothing hidden. */
export const formatAmountExact = (units: bigint, decimals: number) =>
  formatAmount(units, decimals, decimals);

/**
 * Parses what a person typed ("1,234.5", "1234.50", " 7 ") into token units.
 * Null when it is not a plain positive number or has more decimals than the
 * token allows: an amount must never be rounded silently.
 */
export const parseAmount = (text: string, decimals: number): bigint | null => {
  const clean = text.trim().replace(/[,_\s]/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    if (/[^0]/.test(fraction.slice(decimals))) return null;
  }
  const digits = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(digits || '0');
};

/** `part` of `whole` as a percentage with one decimal, for progress bars. */
export const percent = (part: bigint, whole: bigint): number =>
  whole === 0n ? 0 : Number((part * 1000n) / whole) / 10;

const localFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const localDay = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

/** A timestamp (seconds) in the reader's own time zone. */
export const formatDate = (seconds: number) =>
  localFormat.format(new Date(seconds * 1000));

/** The day only, in the reader's own time zone. */
export const formatDay = (seconds: number) =>
  localDay.format(new Date(seconds * 1000));

/** The same moment in UTC, for the hover text: "2027-03-01 00:00 UTC". */
export const formatUtc = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** "3 days", "5 months": a duration in seconds, roughly, for prose. */
export const formatDuration = (seconds: number): string => {
  const day = 86_400;
  const units: [number, string][] = [
    [365 * day, 'year'],
    [30 * day, 'month'],
    [7 * day, 'week'],
    [day, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
    [1, 'second']
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const n = Math.round(seconds / size);
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return '0 seconds';
};
