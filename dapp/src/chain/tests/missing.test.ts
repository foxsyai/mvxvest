// A send the network has not seen for minutes blocks new signings while the
// wallet session (sdk-dapp's store) still counts it, and no longer once the
// wallet is reconnected (logout clears the session) or it turns up.

import { logoutAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { createTransactionsSession } from '@multiversx/sdk-dapp/out/store/actions/transactions/transactionsActions';
import { markMissing, stillCounted } from '../missing';

const LOST = 'ab'.repeat(32);

const track = (hash: string) =>
  createTransactionsSession({
    transactions: [{ hash, nonce: 42, status: 'sent' } as any],
    transactionsDisplayInfo: {},
    status: 'sent' as any
  });

afterEach(() => markMissing(LOST, false));

describe('a missing send', () => {
  it('is reported while the wallet session still counts it', () => {
    track(LOST);
    markMissing(LOST, true);
    expect(stillCounted()).toBe(LOST);
  });

  it('no longer blocks once the wallet is reconnected', () => {
    track(LOST);
    markMissing(LOST, true);
    logoutAction();
    expect(stillCounted()).toBeUndefined();
  });

  it('no longer blocks once it turns up', () => {
    track(LOST);
    markMissing(LOST, true);
    markMissing(LOST, false);
    expect(stillCounted()).toBeUndefined();
  });
});
