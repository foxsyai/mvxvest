// Red team: a vesting cancelled before anything vested reads "Completed".
//
// statusOf says 'done' whenever claimed equals finalAmount and the vesting
// was cancelled. Cancel before the cliff and both are 0: the beneficiary got
// nothing, the creator took everything back, and the Token page (the
// community's transparency view), the address page and the vesting page all
// badge it "Completed". A team that pulls an allocation back the day before
// its cliff shows up as a finished vesting.
//
// Expected once fixed: a cancelled vesting whose claim key paid nothing is
// "Cancelled" (and the badge says how much was returned, as the vesting page
// does in its notice).

import type { Vesting } from 'vesting/client';
import { STATUS_LABEL, statusOf } from 'vesting/describe';

const T = 1_767_225_600;
const v: Vesting = {
  id: 3,
  creator: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  beneficiary: 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd',
  token: 'FOXSY-5d5f3e',
  total: 1_000_000n,
  schedule: {
    start: T,
    cliff: T + 180 * 86_400,
    cliffAmount: 0n,
    end: T + 730 * 86_400,
    curve: { kind: 'linear' }
  },
  cancelable: true,
  createdAt: T,
  claimNonce: 3,
  cancelNonce: 2,
  label: 'Team',
  claimed: 0n,
  // Cancelled the day before the cliff: nothing had vested.
  cancelledAt: T + 179 * 86_400,
  vested: 0n,
  claimable: 0n,
  finalAmount: 0n,
  refunded: 1_000_000n,
  timestamp: T + 200 * 86_400
};

describe('red team: status of a vesting cancelled before its cliff', () => {
  it('is not "Completed"', () => {
    const status = statusOf(v, T + 200 * 86_400);
    expect(STATUS_LABEL[status]).not.toBe('Completed');
    expect(status).toBe('cancelled');
  });
});
