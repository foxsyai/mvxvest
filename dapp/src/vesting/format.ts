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
 * Why `text` is not an amount, in words, or null when it reads as one. A comma
 * is only taken as a thousands separator where it cannot be a decimal comma:
 * "1,234.5" and "1,234,567" are fine, "1,5", "1,500" and "1.500,75" are refused
 * (in much of Europe they mean 1.5, 1.5 and 1500.75), never guessed.
 *
 * The point the other way round: where the comma is the decimal mark, a point
 * groups thousands ("10.000" is ten thousand in a German or Romanian sheet,
 * and a paste from one carries it). So a point followed by exactly three
 * digits, after 1 to 3 digits that do not start with 0, is refused too: write
 * 10000, or 10.0 for ten. ("0.125" and "2.5" are fine.)
 */
export const amountProblem = (
  text: string,
  decimals: number
): string | null => {
  const clean = text.trim().replace(/[_\s]/g, '');
  if (!clean) return 'empty';
  if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(clean)) {
    const whole = clean.replace(/\./g, '');
    return clean.split('.').length > 2
      ? `${clean} groups thousands with points: write ${whole}`
      : `${clean} could mean ${whole}: write ${whole} for that, or ${clean}0 if you mean ${clean}`;
  }
  let plain = clean;
  if (clean.includes(',')) {
    const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(clean);
    const unambiguous = clean.includes('.') || clean.split(',').length > 2;
    if (!grouped || !unambiguous)
      return 'use a point for decimals and no comma, like 1500.25';
    plain = clean.replace(/,/g, '');
  }
  const match = /^(\d+)(?:\.(\d*))?$/.exec(plain);
  if (!match) return 'not a positive number';
  const fraction = match[2] ?? '';
  if (fraction.length > decimals && /[^0]/.test(fraction.slice(decimals)))
    return `at most ${decimals} decimals`;
  return null;
};

/**
 * Parses what a person typed ("1,234.5", "1234.50", " 7 ") into token units.
 * Null when it is not a plain positive number, when a comma could be a decimal
 * comma (see amountProblem), or when it has more decimals than the token
 * allows: an amount must never be rounded or guessed silently.
 */
export const parseAmount = (text: string, decimals: number): bigint | null => {
  if (amountProblem(text, decimals) !== null) return null;
  const clean = text.trim().replace(/[,_\s]/g, '');
  const [whole, fraction = ''] = clean.split('.');
  const digits = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(digits || '0');
};

/**
 * An amount as plain text that parseAmount reads back exactly: every digit,
 * no thousands commas, and never a point followed by exactly three digits
 * (refused as ambiguous), which gets a fourth decimal: "12.3450".
 */
export const plainAmount = (units: bigint, decimals: number): string => {
  const text = formatAmountExact(units, decimals).replace(/,/g, '');
  return /^[1-9]\d{0,2}\.\d{3}$/.test(text) ? `${text}0` : text;
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

/** A time no Date can hold (NaN, beyond year 275760): shown, never thrown. */
const validDate = (seconds: number) =>
  Number.isFinite(new Date(seconds * 1000).getTime());
const NO_DATE = 'no valid date';

/** A timestamp (seconds) in the reader's own time zone. */
export const formatDate = (seconds: number) =>
  validDate(seconds) ? localFormat.format(new Date(seconds * 1000)) : NO_DATE;

/** The day only, in the reader's own time zone. */
export const formatDay = (seconds: number) =>
  validDate(seconds) ? localDay.format(new Date(seconds * 1000)) : NO_DATE;

/** The same moment in UTC, for the hover text: "2027-03-01 00:00 UTC". */
export const formatUtc = (seconds: number) =>
  validDate(seconds)
    ? `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : NO_DATE;

/** For a dateTime attribute; empty when the time is not a valid date. */
export const isoDate = (seconds: number) =>
  validDate(seconds) ? new Date(seconds * 1000).toISOString() : '';

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
