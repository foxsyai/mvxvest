import {
  formatAmount,
  formatAmountExact,
  formatDuration,
  formatUtc,
  parseAmount,
  percent
} from '../format';

describe('amounts', () => {
  it('formats with separators and decimals, cutting rather than rounding', () => {
    expect(formatAmount(1_234_567_890_000_000_000_000n, 18)).toBe(
      '1,234.56789'
    );
    expect(formatAmount(1_999_999_999_999_999_999n, 18)).toBe('1.999999');
    expect(formatAmount(10n ** 30n, 18)).toBe('1,000,000,000,000');
    expect(formatAmount(7n, 0)).toBe('7');
    expect(formatAmount(1n, 18)).toBe('< 0.000001');
    expect(formatAmount(0n, 18)).toBe('0');
    expect(formatAmountExact(1n, 18)).toBe('0.000000000000000001');
  });

  it('parses what people type, refusing anything it would have to round', () => {
    expect(parseAmount('1,234.5', 6)).toBe(1_234_500_000n);
    expect(parseAmount(' 7 ', 0)).toBe(7n);
    expect(parseAmount('0.1', 0)).toBeNull();
    expect(parseAmount('0.10', 1)).toBe(1n);
    expect(parseAmount('1.000000000000000001', 18)).toBe(10n ** 18n + 1n);
    expect(parseAmount('-1', 18)).toBeNull();
    expect(parseAmount('1e3', 18)).toBeNull();
    expect(parseAmount('', 18)).toBeNull();
  });

  it('percent', () => {
    expect(percent(1n, 3n)).toBe(33.3);
    expect(percent(0n, 0n)).toBe(0);
  });
});

describe('dates', () => {
  it('UTC for the hover text', () => {
    expect(formatUtc(Date.UTC(2027, 2, 1) / 1000)).toBe('2027-03-01 00:00 UTC');
  });
  it('durations in words', () => {
    expect(formatDuration(86_400 * 3)).toBe('3 days');
    expect(formatDuration(86_400 * 365 * 4)).toBe('4 years');
  });
});
