// Fourth adversarial review: the CSV export guard after 2223f82 (T9).
//
// The guard puts an apostrophe before a formula start at the beginning of a
// cell and after an inner ";" or tab (the separators a semicolon-locale
// spreadsheet splits on, where the comma CSV's quotes do not hold: a quote
// only opens a quoted section at the start of a cell). A line break is the
// other separator such a spreadsheet splits on: it ends the record, and the
// next record starts with whatever follows it. In the label "x\n=1+1;" the
// quote that toCsv puts around the cell sits after "7," in the same
// semicolon-cell, so it is literal there; the line break ends the record and
// the next record's first cell is "=1+1", a formula. The guard does not look
// at "\n" (nor "\r"). Labels are any 64 bytes on chain; the exported ones are
// the exporting wallet's own (see review2_csv), hence Low.

import { toCsv } from '../csv';

const B = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

/**
 * A CSV file read the way a semicolon-locale spreadsheet reads it (the model
 * of review2_csv and review3_csv, extended to records): a quote opens a quoted
 * section only at the start of a cell; outside one, ";" ends a cell and a line
 * break ends the record.
 */
const semicolonRecords = (text: string): string[][] => {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ';') {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || cells.length > 0) records.push([...cells, cell]);
  return records;
};

describe('review4: CSV export in a semicolon spreadsheet', () => {
  it('a line break before a formula does not make a formula cell', () => {
    const csv = toCsv(['id', 'label', 'beneficiary'], [[7, 'x\n=1+1;', B]]);
    // Today: 7,"x\n=1+1;",erd1... and the third record's first cell is =1+1.
    expect(
      semicolonRecords(csv)
        .flat()
        .filter((cell) => /^[=+\-@]/.test(cell))
    ).toEqual([]);
  });
});
