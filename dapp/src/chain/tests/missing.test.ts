// A send the network has not seen blocks new signings while the wallet
// session (sdk-dapp's store) still counts it and its nonce is not used yet: a
// short wait first, then "reconnect" once it is missing. It stops blocking
// once the wallet is reconnected (logout clears the session), once it turns
// up, or once its nonce is used. The clock is the session's own, so it holds
// after a reload and with no page following the send (main audit D1).

import { logoutAction } from '@multiversx/sdk-dapp/out/store/actions/sharedActions/sharedActions';
import { createTransactionsSession } from '@multiversx/sdk-dapp/out/store/actions/transactions/transactionsActions';
import { lostSend } from '../missing';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const OTHER = 'erd1u05mmf0dj4wmjgx5mk7zcs2fkxx8wmlh0wlwlsxwdtvwr8rk0n5qgw5esx';
const LOST = 'ab'.repeat(32);

const mockApi = jest.fn();
jest.mock('../network', () => ({
  api: (path: string) => mockApi(path)
}));

const notFound = () => {
  const error: any = new Error('answered 404');
  error.status = 404;
  return error;
};

let skew = 0;
beforeEach(() => {
  skew = 0;
  const realNow = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  mockApi.mockReset();
  mockApi.mockImplementation(async () => {
    throw notFound();
  });
});
afterEach(() => {
  logoutAction();
  jest.restoreAllMocks();
});

const track = (hash = LOST, sender = SENDER, nonce = 42) =>
  createTransactionsSession({
    transactions: [{ hash, nonce, sender, status: 'sent' } as any],
    transactionsDisplayInfo: {},
    status: 'sent' as any
  });

describe('a send the network has not seen', () => {
  it('is missing after 2 minutes', async () => {
    track();
    skew = 150_000;
    expect(await lostSend(SENDER, 42n)).toEqual({ hash: LOST, missing: true });
    expect(mockApi).toHaveBeenCalledWith(`/transactions/${LOST}?fields=status`);
  });

  it('asks for a wait before that', async () => {
    track();
    skew = 45_000;
    expect(await lostSend(SENDER, 42n)).toEqual({ hash: LOST, missing: false });
  });

  it('does not block in its first seconds (the API lists it a little later)', async () => {
    track();
    skew = 5_000;
    expect(await lostSend(SENDER, 42n)).toBeUndefined();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('does not block once it turns up', async () => {
    track();
    skew = 150_000;
    mockApi.mockResolvedValue({ status: 'pending' });
    expect(await lostSend(SENDER, 42n)).toBeUndefined();
  });

  it('does not block once its nonce is used', async () => {
    track();
    skew = 150_000;
    expect(await lostSend(SENDER, 43n)).toBeUndefined();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("does not block another wallet's signing", async () => {
    track(LOST, OTHER);
    skew = 150_000;
    expect(await lostSend(SENDER, 42n)).toBeUndefined();
  });

  it('does not block when the API cannot say (only a 404 counts)', async () => {
    track();
    skew = 150_000;
    mockApi.mockRejectedValue(
      Object.assign(new Error('answered 503'), { status: 503 })
    );
    expect(await lostSend(SENDER, 42n)).toBeUndefined();
  });

  it('no longer blocks once the wallet is reconnected', async () => {
    track();
    skew = 150_000;
    logoutAction();
    expect(await lostSend(SENDER, 42n)).toBeUndefined();
  });
});
