// Fifth audit (DAPP, 1 Nov 2026): a CSV crafted to make the importer read an
// address or an amount other than what a human sees. Each line must either
// become exactly the vesting it says, or an error naming that line; never a
// silently different beneficiary or amount, never a dropped line.

import { MAX_CSV_LINES, parseBeneficiaries, toCsv } from '../csv';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const SC = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const E18 = 10n ** 18n;

const only = (text: string, decimals = 18) => parseBeneficiaries(text, decimals);

describe('audit5 DAPP: crafted cells', () => {
  it('a BOM, CRLF line ends and a header: every line read, none lost', () => {
    const r = only(`﻿address,amount\r\n${A},1000\r\n${B},2500.5\r\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.line, x.address, x.amount.toString()])).toEqual([
      [2, A, (1000n * E18).toString()],
      [3, B, (25005n * E18 / 10n).toString()]
    ]);
  });

  it('an address with a hidden character is an error for that line, not another address', () => {
    for (const hidden of ['​', '‌', '‍', '⁠', '﻿', '­', '‮']) {
      const spoiled = `${A.slice(0, 20)}${hidden}${A.slice(20)}`;
      const r = only(`${spoiled},1000\n${B},1`);
      expect(r.rows.map((x) => x.address)).toEqual([B]);
      expect(r.errors.map((e) => e.line)).toEqual([1]);
    }
  });

  it('a look-alike address (one character changed) fails the checksum', () => {
    const changed = `${A.slice(0, -1)}${A.endsWith('u') ? 'v' : 'u'}`;
    const r = only(`${changed},1000`);
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/Not a valid MultiversX address/);
  });

  it('an address in upper case or with the sender surrounded by quotes is the same beneficiary', () => {
    const r = only(`"${A.toUpperCase()}","1,000.25"\n'${B}',7`);
    // The quoted upper case one is read lowercased; the apostrophes are not
    // quotes, so that line is an error, never a different address.
    expect(r.rows.map((x) => [x.address, x.amount.toString()])).toEqual([
      [A, (100025n * E18 / 100n).toString()]
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([2]);
  });

  it('a herotag, a hex address or a 0x address are errors, not beneficiaries', () => {
    const r = only(
      [
        '@alice,1',
        'alice.elrond,1',
        'ae7c2056a00abe4f3c2f5107b0862e9861b4a725cfd0f475e2997ab5f8f2e476,1',
        '0xae7c2056a00abe4f3c2f5107b0862e9861b4a725cfd0f475e2997ab5f8f2e476,1',
        `${A},1`
      ].join('\n')
    );
    expect(r.rows.map((x) => x.line)).toEqual([5]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
  });

  it('a formula, a right to left mark or a currency in the amount cell is an error for that line', () => {
    const r = only(
      [
        `${A},=1000+1`,
        `${A},‮0001`,
        `${A},1000 FOXSY`,
        `${A},$1000`,
        `${A},1000€`,
        `${A},1e3`,
        `${A},１０００`,
        `${A},1,000`,
        `${A},1000`
      ].join('\n')
    );
    expect(r.rows.map((x) => [x.line, x.amount.toString()])).toEqual([
      [9, (1000n * E18).toString()]
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('decimals beyond the token are refused line by line, not rounded', () => {
    const r = only(`${A},1.0000001\n${B},1.000000`, 6);
    expect(r.errors.map((e) => e.line)).toEqual([1]);
    expect(r.errors[0].message).toMatch(/at most 6 decimals/);
    expect(r.rows.map((x) => x.amount.toString())).toEqual(['1000000']);
  });

  it('a third column with anything in it is an error; an empty third cell is tolerated', () => {
    const r = only(`${A},1000,note\n${B},5,\n${A},5,,`);
    expect(r.errors.map((e) => e.line)).toEqual([1]);
    expect(r.rows.map((x) => x.line)).toEqual([2, 3]);
  });

  it('a semicolon file with a decimal comma amount is refused, not read 10x or 1000x', () => {
    const r = only(`${A};1,5\n${B};1,500\n${A};1500,25`);
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });

  it('a line whose separator differs from the others is still one vesting or one error', () => {
    const r = only(`${A},1000\n${B}\t2000\n${A};3000\n${B} 4000`);
    expect(r.rows.map((x) => [x.line, x.amount / E18])).toEqual([
      [1, 1000n],
      [2, 2000n],
      [3, 3000n]
    ]);
    // A space is not a separator: line 4 is an error, not "4000 to B".
    expect(r.errors.map((e) => e.line)).toEqual([4]);
  });

  it('duplicates are kept as separate vestings and reported', () => {
    const r = only(`${A},1\n${A},1\n${A},2`);
    expect(r.rows).toHaveLength(3);
    expect(r.repeated).toEqual([A]);
  });

  it('a second header-looking line is an error, not skipped', () => {
    const r = only(`address,amount\nwallet,tokens\n${A},1`);
    expect(r.errors.map((e) => e.line)).toEqual([2]);
    expect(r.rows.map((x) => x.line)).toEqual([3]);
  });

  it('a first line that is a mistyped address with an amount is an error, never a header', () => {
    // "rd1..." (the e lost) with a plain amount: not a header.
    const r = only(`${A.slice(1)},1000\n${B},1`);
    expect(r.errors.map((e) => e.line)).toEqual([1]);
    expect(r.rows.map((x) => x.line)).toEqual([2]);
  });

  it('the smart contract itself is accepted by the parser (the contract refuses it, the page warns)', () => {
    const r = only(`${SC},1`);
    expect(r.rows).toHaveLength(1);
  });

  it('5,001 lines are refused as a whole, 5,000 are read', () => {
    const lines = Array.from({ length: MAX_CSV_LINES + 1 }, () => `${A},1`);
    expect(only(lines.join('\n')).errors[0].message).toMatch(/At most 5000/);
    const ok = only(lines.slice(0, MAX_CSV_LINES).join('\n'));
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toHaveLength(MAX_CSV_LINES);
    // A header line does not count toward the limit.
    const headed = only(['address,amount', ...lines.slice(0, MAX_CSV_LINES)].join('\n'));
    expect(headed.rows).toHaveLength(MAX_CSV_LINES);
  });

  it('a zero amount, a dust amount and the smallest unit are told apart', () => {
    const r = only(`${A},0\n${A},0.0\n${A},0.000000000000000001\n${A},00001`, 18);
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([
      [1, 'The amount must be more than zero.'],
      [2, 'The amount must be more than zero.']
    ]);
    expect(r.rows.map((x) => x.amount.toString())).toEqual(['1', (1n * E18).toString()]);
  });
});

describe('audit5 DAPP: the export cannot smuggle a cell', () => {
  it('a label with every separator, quotes and a formula stays one quoted, neutralised cell', () => {
    const label = '=HYPERLINK("http://evil")\t;,"x"\r\n-1';
    const csv = toCsv(['id', 'label'], [[1, label]]);
    const lines = csv.split('\n');
    // Header, then one logical row (the quoted cell holds the line breaks).
    expect(lines[0]).toBe('id,label');
    const row = csv.slice(lines[0].length + 1);
    expect(row.startsWith('1,"')).toBe(true);
    // Every quote doubled inside, the formula prefixed with an apostrophe.
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")`);
    // A formula after a tab, a semicolon or a line break is neutralised too.
    expect(row).toMatch(/\n'-1/);
  });
});
