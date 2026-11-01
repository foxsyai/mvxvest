// Fifth audit (DAPP, 1 Nov 2026): amounts a person could paste that read as
// one number to a human and another to a parser. Every one of them must
// either be refused or give exactly the units a careful reader expects: an
// amount is money, and a silent factor of 10 or 1000 is the harm hunted.

import { amountProblem, parseAmount, plainAmount } from '../format';

const refused = (text: string, decimals = 18) =>
  parseAmount(text, decimals) === null &&
  amountProblem(text, decimals) !== null;

describe('audit5 DAPP: amounts that are not plain decimal numbers are refused', () => {
  const inputs: [string, string][] = [
    ['１０００', 'full width digits'],
    ['١٠٠٠', 'Arabic-Indic digits'],
    ['१०००', 'Devanagari digits'],
    ['1e3', 'exponent'],
    ['1E3', 'exponent, upper case'],
    ['1e-3', 'negative exponent'],
    ['0x10', 'hexadecimal'],
    ['0b101', 'binary'],
    ['0o17', 'octal'],
    ['+5', 'leading plus'],
    ['-5', 'negative'],
    ['5-', 'trailing minus'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['1,5', 'decimal comma'],
    ['1,500', 'ambiguous comma'],
    ['1.500', 'ambiguous point'],
    ['10.000', 'ambiguous point, European thousands'],
    ['1.500,75', 'European full'],
    ['1,500.', 'comma group then bare point is fine but'],
    ['١,٠٠٠.٥', 'mixed scripts'],
    ['1٫5', 'Arabic decimal separator'],
    ['1·5', 'middle dot'],
    ['1⁠5', 'word joiner inside'],
    ['1​000', 'zero width space inside'],
    ['1­000', 'soft hyphen inside'],
    ['1 000,5', 'space group with decimal comma'],
    ['1,000,00', 'wrong group'],
    ['1..5', 'two points'],
    ['.5.', 'odd points'],
    ['5e', 'dangling exponent'],
    ['1/2', 'fraction'],
    ['½', 'vulgar fraction'],
    ['1²', 'superscript'],
    ['1 000', 'no-break space: a group, accepted as 1000 below'],
    ['', 'empty'],
    ['   ', 'blank'],
    ['.', 'a point'],
    ['1.', 'trailing point is fine but listed to check']
  ];
  for (const [text, why] of inputs) {
    // The last four of these are valid spellings (listed for the record):
    // "1,500." is 1500, "1 000" is 1000 (a space is a thousands group),
    // "1." is 1, "." is refused.
    if (text === '1,500.' || text === '1 000' || text === '1.') continue;
    it(`refuses ${JSON.stringify(text)} (${why})`, () => {
      expect(refused(text)).toBe(true);
    });
  }

  it('reads the few accepted spellings as exactly what they say', () => {
    expect(parseAmount('1,500.', 18)?.toString()).toBe(
      (1500n * 10n ** 18n).toString()
    );
    expect(parseAmount('1 000', 18)?.toString()).toBe(
      (1000n * 10n ** 18n).toString()
    );
    expect(parseAmount('1.', 18)?.toString()).toBe((10n ** 18n).toString());
    expect(parseAmount('1_000', 6)?.toString()).toBe('1000000000');
    expect(parseAmount('0.000001', 6)?.toString()).toBe('1');
    expect(parseAmount('1,234,567.891', 3)?.toString()).toBe('1234567891');
  });

  it('refuses more decimals than the token has, even when the extra are not shown', () => {
    expect(refused('0.0000001', 6)).toBe(true);
    expect(refused('1.5', 0)).toBe(true);
    // Trailing zeros past the decimals are not money: fine.
    expect(parseAmount('1.50000000', 2)?.toString()).toBe('150');
  });

  it('a token with 0 decimals: whole units only, never a factor', () => {
    expect(parseAmount('1000', 0)?.toString()).toBe('1000');
    expect(parseAmount('1,000', 0)).toBeNull();
    expect(parseAmount('1.000', 0)).toBeNull();
  });

  it('a thirty digit amount keeps every digit (no float on the way)', () => {
    expect(parseAmount('123456789012.345678901234567891', 18)?.toString()).toBe(
      '123456789012345678901234567891'
    );
  });
});

describe('audit5 DAPP: plainAmount round trips through parseAmount', () => {
  // A deterministic generator, so the vectors are the same on every run.
  let seed = 20261101;
  const next = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed;
  };
  it('for 5,000 amounts at every decimals from 0 to 18, the CSV of what was not created reads back to the unit', () => {
    for (let i = 0; i < 5000; i++) {
      const decimals = next() % 19;
      const digits = 1 + (next() % 30);
      let text = '';
      for (let d = 0; d < digits; d++) text += String(next() % 10);
      const units = BigInt(text);
      if (units === 0n) continue;
      const plain = plainAmount(units, decimals);
      const back = parseAmount(plain, decimals);
      if (back === null || back !== units)
        throw new Error(
          `${units} at ${decimals} decimals became "${plain}", read back as ${back} (${amountProblem(plain, decimals)})`
        );
    }
  });
});
