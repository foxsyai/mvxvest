// Second adversarial review: vesting/csv.ts, the CSV import (header
// detection) and the CSV export (Created page, toCsv).

import { parseBeneficiaries, toCsv } from '../csv';

// 1. Header detection (fix #7) skips a line while nothing has been read yet
// (rows.length + errors.length === 0). After a real header that is still
// true, so the line after it is skipped too when it "looks like a header":
// an address cell that is not erd1 and an amount that is not a number. A
// placeholder row a spreadsheet commonly holds ("TBD,TBD", ",pending") then
// vanishes without a word instead of stopping the creation with an error.
describe('review2: header detection skips more than one line', () => {
  const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';

  it('a placeholder line right after the header is an error, not skipped', () => {
    const { rows, errors } = parseBeneficiaries(
      `address,amount\nTBD,pending\n${A},100`,
      0
    );
    // Line 2 must be reported (as it would be anywhere else in the file).
    // Today: rows = [line 3], errors = [] and "Check and sign" is enabled.
    expect(rows.length + errors.length).toBe(2);
  });
});

// 2. The export in a spreadsheet whose list separator is a semicolon. csvCell
// prefixes an apostrophe when a cell STARTS like a formula, and quotes a cell
// only when it holds a quote, a comma or a line break. Excel opens a .csv with
// the system list separator, which is ";" wherever the comma is the decimal
// mark (most of Europe). In the label "x;=1+1" the semicolon is not quoted, so
// such a spreadsheet splits the cell and the second half, "=1+1", is a
// formula (a DDE payload such as "x;=cmd|' /C calc'!A0;" fits in the 64
// bytes of a label). Quoting the cell keeps it whole in both dialects. The
// labels exported are the exporting wallet's own, so this matters where a
// creating wallet is shared (a multisig) or the export is handed on.

/** A CSV line read the way a semicolon-locale spreadsheet reads it. */
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

describe('review2: CSV export in a semicolon spreadsheet', () => {
  it('a label with a semicolon does not become a formula cell', () => {
    const csv = toCsv(
      ['id', 'label', 'beneficiary'],
      [
        [
          7,
          "x;=cmd|' /C calc'!A0;",
          'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u'
        ]
      ]
    );
    const row = csv.split('\n')[1];
    // Today the row is: 7,x;=cmd|' /C calc'!A0;,erd1...
    // and its second cell for such a spreadsheet is "=cmd|' /C calc'!A0".
    expect(semicolonCells(row).filter((cell) => /^[=+\-@]/.test(cell))).toEqual(
      []
    );
  });
});
