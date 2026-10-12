// Third adversarial review: vesting/builder.ts, the horizon check of R6.
//
// The contract refuses a schedule whose END is more than 30 years after the
// block that creates it (create.rs: schedule.end <= now + MAX_HORIZON); the
// start may be in the past, and the form says so ("It may be in the past: what
// has vested since is claimable at once"). planProblem() measures the 30 years
// from the plan's START instead (tooLong: end - plan.start <= MAX_HORIZON), and
// says "the contract refuses longer". A plan that started 5 years ago and ends
// 28 years from now is accepted by the contract and refused by the form, with
// a reason that is not true. (A start in the future is caught a second time by
// Create's entryIssues, which does measure from now.)

import { DAY, planProblem } from '../builder';

const YEAR = 365 * DAY;

describe('review3: the 30-year horizon', () => {
  it('a plan that started in the past and ends within 30 years from now is not refused', () => {
    const now = Math.floor(Date.now() / 1000);
    const problem = planProblem({
      start: now - 5 * YEAR,
      shape: { kind: 'linear', end: now + 28 * YEAR }
    });
    // Today: "A schedule can last at most 30 years (the contract refuses
    // longer)."
    expect(problem).toBeNull();
  });
});
