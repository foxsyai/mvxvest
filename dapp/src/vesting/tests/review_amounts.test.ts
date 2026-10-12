// Adversarial review: amounts typed with a decimal comma.
//
// parseAmount strips every comma as a "thousands separator", wherever it is.
// A decimal comma (the norm in most of Europe, and what the decimal keypad of a
// phone set to such a locale types into an inputMode='decimal' field) is then
// silently read as a 10x, 100x or 1000x larger amount. The percentage fields of
// the same form (Create.tsx toBps) read the comma as a decimal point, so the
// page itself is inconsistent.
//
// (Amounts are compared as strings: jest workers cannot serialise a bigint in
// a failure message.)

import { parseBeneficiaries } from '../csv';
import { parseAmount } from '../format';

const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const TOKEN = 10n ** 18n;
const s = (value: bigint | null | undefined) => String(value);

describe('review: decimal comma in amounts', () => {
  it('does not read "0,05" as 5 tokens (100x)', () => {
    // Either refuse it (null) or read it as 0.05; never as 5.
    expect(s(parseAmount('0,05', 18))).not.toBe(s(5n * TOKEN));
  });

  it('does not read "1,5" as 15 tokens (10x)', () => {
    expect(s(parseAmount('1,5', 18))).not.toBe(s(15n * TOKEN));
  });

  it('a semicolon CSV with decimal commas (European Excel) keeps its amounts', () => {
    // "1500,25" means 1500.25: the file is semicolon-separated precisely
    // because the comma is the decimal mark.
    const { rows, errors } = parseBeneficiaries(`${A};1500,25`, 18);
    expect({
      errors: errors.length,
      amount: s(rows[0]?.amount)
    }).not.toEqual({ errors: 0, amount: s(150_025n * TOKEN) });
  });

  it('a semicolon CSV line "1,500" (European 1.5) is not read as 1500 (1000x)', () => {
    const { rows, errors } = parseBeneficiaries(`${A};1,500`, 18);
    expect({
      errors: errors.length,
      amount: s(rows[0]?.amount)
    }).not.toEqual({ errors: 0, amount: s(1500n * TOKEN) });
  });

  it('a semicolon CSV line "1.500,75" (European 1500.75) is not read as 1.50075', () => {
    // The other direction: dot as thousands separator, 1000x too little.
    const { rows, errors } = parseBeneficiaries(`${A};1.500,75`, 18);
    expect({
      errors: errors.length,
      amount: s(rows[0]?.amount)
    }).not.toEqual({ errors: 0, amount: s(150_075n * 10n ** 13n) });
  });

  it('the "one by one" rows (joined with a tab by Create.tsx) keep "0,5"', () => {
    // Create.tsx builds `${address}\t${amount}` for each row and parses that.
    const { rows, errors } = parseBeneficiaries(`${A}\t0,5`, 18);
    expect({
      errors: errors.length,
      amount: s(rows[0]?.amount)
    }).not.toEqual({ errors: 0, amount: s(5n * TOKEN) });
  });
});
