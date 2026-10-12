// Second adversarial review: amounts with a dot as thousands separator.
//
// The fix for the decimal comma refuses "1,500" ("in much of Europe it means
// 1.5") and "1.500,75" (European 1500.75). It still reads "1.500" as 1.5. In
// the same European semicolon CSV (Excel with a thousands format), round
// amounts are written "10.000" and "25.000" and amounts with cents
// "1.500,75": the cents are refused, the round ones are accepted 1000x too
// small, without a word. Grants are usually round, so a whole file can go
// through like this.
//
// (Amounts are compared as strings: jest workers cannot serialise a bigint.)

import { parseBeneficiaries } from '../csv';

const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const B = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const TOKEN = 10n ** 18n;
const s = (value: bigint | null | undefined) => String(value);

describe('review2: dot as thousands separator', () => {
  it('a semicolon CSV with "10.000" and "25.000" (European 10,000 and 25,000) is not read as 10 and 25', () => {
    const { rows, errors } = parseBeneficiaries(
      `address;amount\n${A};10.000\n${B};25.000`,
      18
    );
    // Either refused (as "1,500" and "1.500,75" are), or read as 10,000 and
    // 25,000; never silently as 10 and 25. Today: no error, 10 and 25.
    expect({
      errors: errors.length,
      amounts: rows.map((row) => s(row.amount))
    }).not.toEqual({ errors: 0, amounts: [s(10n * TOKEN), s(25n * TOKEN)] });
  });

  it('the same file is not half refused, half read 1000x too small', () => {
    const { rows, errors } = parseBeneficiaries(
      `${A};1.500,75\n${B};1.500`,
      18
    );
    // Line 1 is refused (the fix of the first review)...
    expect(errors.map((error) => error.line)).toContain(1);
    // ...while line 2, written by the same spreadsheet with the same format,
    // is accepted as 1.5. Today: B gets 1.5 instead of 1500.
    const lineTwo = rows.find((row) => row.line === 2);
    expect(s(lineTwo?.amount)).not.toBe(s((15n * TOKEN) / 10n));
  });
});
