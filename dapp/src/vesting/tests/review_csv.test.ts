// Adversarial review: beneficiary lines silently dropped, and the CSV export.

import { parseBeneficiaries, toCsv } from '../csv';

const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const B = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

describe('review: the first line is taken for a header', () => {
  it('an upper-case address on line 1 is a beneficiary, not a header', () => {
    // Bech32 is valid in upper case (QR codes use it), and every later line
    // accepts it: only line 1 is silently dropped.
    const { rows, errors } = parseBeneficiaries(
      `${A.toUpperCase()},100\n${B},200`,
      0
    );
    // Line 1 must be either a vesting or an error, never nothing at all.
    expect(rows.length + errors.length).toBe(2);
  });

  it('upper case is accepted on line 2, so line 1 is the only one lost', () => {
    const { rows } = parseBeneficiaries(`${B},200\n${A.toUpperCase()},100`, 0);
    expect(rows.map((row) => row.address)).toEqual([B, A]);
  });

  it('the first "one by one" row with a mistyped address is reported, not skipped', () => {
    // Create.tsx joins the rows as `${address}\t${amount}`: the first row is
    // line 1. A typo in its prefix ("erdl", "edr1") or a herotag makes the
    // whole row vanish without a word, and the other rows are created.
    const typo = 'erdl' + A.slice(4);
    const { rows, errors } = parseBeneficiaries(`${typo}\t5000\n${B}\t200`, 0);
    expect(errors.map((error) => error.line)).toContain(1);
    expect(rows).toHaveLength(1);
  });
});

describe('review: CSV export', () => {
  it('neutralises spreadsheet formulas in a label', () => {
    // Labels are arbitrary bytes on chain. Opened in Excel or Sheets, a cell
    // starting with = + - @ is a formula (=HYPERLINK, =IMPORTXML, DDE...).
    const out = toCsv(['label'], [['=HYPERLINK("https://evil.example","x")']]);
    const cell = out.split('\n')[1].replace(/^"/, '');
    expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
  });

  it('quotes a carriage return, which spreadsheets read as a new row', () => {
    const out = toCsv(['label', 'id'], [['a\rb', 1]]);
    expect(out).toBe('label,id\n"a\rb",1\n');
  });
});
