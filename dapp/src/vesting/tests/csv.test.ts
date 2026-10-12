import { parseBeneficiaries, toCsv } from '../csv';

const A = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const B = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

describe('CSV of beneficiaries', () => {
  it('reads lines, skips a header and blank lines', () => {
    const { rows, errors } = parseBeneficiaries(
      `address,amount\n${A},1000\n\n${B};2.5\n`,
      6
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, address: A, amount: 1_000_000_000n },
      { line: 4, address: B, amount: 2_500_000n }
    ]);
  });

  it('reports every bad line with its number', () => {
    const typo = A.slice(0, -1) + (A.endsWith('l') ? 'm' : 'l');
    const { rows, errors } = parseBeneficiaries(
      `${typo},1\n${B},0\n${B},1.5\n${A},abc\n${A},1,extra`,
      0
    );
    expect(rows).toEqual([]);
    expect(errors.map((error) => error.line)).toEqual([1, 2, 3, 4, 5]);
    expect(errors[0].message).toMatch(/Not a valid MultiversX address/);
  });

  it('accepts quoted amounts with thousands separators', () => {
    expect(parseBeneficiaries(`${A},"1,234.5"`, 2).rows[0].amount).toBe(
      123_450n
    );
  });

  it('flags repeated addresses', () => {
    expect(parseBeneficiaries(`${A},1\n${A},2`, 0).repeated).toEqual([A]);
  });

  it('writes CSV back', () => {
    expect(toCsv(['a', 'b'], [['x,y', 1]])).toBe('a,b\n"x,y",1\n');
  });
});
