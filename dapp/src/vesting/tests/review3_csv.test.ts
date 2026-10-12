// Third adversarial review: vesting/csv.ts and format.ts after eb66702 (the
// fixes of R7 and R9).
//
// (Amounts are compared as strings: jest workers cannot serialise a bigint.)

import { parseBeneficiaries, toCsv } from '../csv';

const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const B = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const s = (value: bigint | null | undefined) => String(value);

// 1. R7 refuses "10.000" only when the LINE holds a semicolon
//    (pointMayGroup: separator === ';'). Copying cells from a spreadsheet and
//    pasting them into the CSV box gives TAB-separated text in every locale,
//    with the numbers as the sheet shows them: in a German or Romanian sheet
//    with a thousands format, 10,000 and 25,000 are copied as "10.000" and
//    "25.000", and are read as 10 and 25 without a word. The rows typed one by
//    one are joined with a tab too (Create.tsx), so "10.000" typed there is 10.
describe('review3: "10.000" in tab-separated text', () => {
  it('a paste from a European spreadsheet is not read 1000x too small', () => {
    const { rows, errors } = parseBeneficiaries(
      `address\tamount\n${A}\t10.000\n${B}\t25.000`,
      18
    );
    // Either refused (as in a semicolon file) or read as 10,000 and 25,000.
    // Today: no error, 10 and 25.
    expect({
      errors: errors.length,
      amounts: rows.map((row) => s(row.amount))
    }).not.toEqual({
      errors: 0,
      amounts: [s(10n * 10n ** 18n), s(25n * 10n ** 18n)]
    });
  });

  it('a row typed one by one as "10.000" is not read as 10', () => {
    // Exactly what Create builds from its rows.
    const { rows, errors } = parseBeneficiaries(`${A}\t10.000`, 18, {
      header: false
    });
    expect({
      errors: errors.length,
      amounts: rows.map((row) => s(row.amount))
    }).not.toEqual({ errors: 0, amounts: [s(10n * 10n ** 18n)] });
  });
});

// 2. R9 puts an apostrophe after a ";" or tab that is followed by a formula
//    start (optionally after spaces). A quote between them is not covered: the
//    label `x;"=1+1&";` is written `"x;""=1+1&"";"`. A semicolon-locale
//    spreadsheet (the same model as review2_csv) starts a cell at the ";",
//    opens a quoted section at the first quote, closes it at the second
//    (followed by "="), and keeps the rest as text: the cell is `=1+1&""`, a
//    valid formula. Labels are anyone's 64 bytes on chain.
const semicolonCells = (line: string): string[] => {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ';') {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
};

describe('review3: CSV export in a semicolon spreadsheet', () => {
  it('a quote between the semicolon and the formula does not make a formula cell', () => {
    const csv = toCsv(['id', 'label', 'beneficiary'], [[7, 'x;"=1+1&";', B]]);
    const row = csv.split('\n')[1];
    // Today: 7,"x;""=1+1&"";",erd1... and its second cell is =1+1&"".
    expect(semicolonCells(row).filter((cell) => /^[=+\-@]/.test(cell))).toEqual(
      []
    );
  });
});
