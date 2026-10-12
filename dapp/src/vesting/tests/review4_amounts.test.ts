// Fourth adversarial review: the dot-group refusal in vesting/format.ts after
// 2223f82 (T8).
//
// "1.000.000" is refused (fine: it can only be a million, written with dots),
// but the hint offers two spellings and the second is "1.000.0000 if you mean
// 1.000.000", which is itself refused ("not a positive number"). A reader who
// follows the hint is refused again. Every spelling the hint offers should be
// one the form accepts.

import { amountProblem } from '../format';

// (Adapted after the fix: for "1.000.000" the hint now offers one spelling,
// "write 1000000"; for "10.000" two. Every one offered must be accepted.)
const hintedSpellings = (problem: string) =>
  [...problem.matchAll(/\b(?:write|or) ([0-9][0-9.]*)/g)].map((m) => m[1]);

describe('review4: the hint for a dot-grouped amount', () => {
  it('offers only spellings that are accepted (1.000.000)', () => {
    const problem = amountProblem('1.000.000', 18);
    expect(problem).not.toBeNull();
    const spellings = hintedSpellings(problem as string);
    expect(spellings.length).toBeGreaterThan(0);
    expect(hintedSpellings(amountProblem('10.000', 18) as string)).toEqual([
      '10000',
      '10.0000'
    ]);
    // Today: ["1000000", "1.000.0000"], and the second is refused.
    expect(
      spellings.filter((spelling) => amountProblem(spelling, 18) !== null)
    ).toEqual([]);
  });
});
