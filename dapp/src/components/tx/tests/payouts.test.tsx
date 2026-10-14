// After a claim or a cancel, the panel says what was paid, from the contract's
// events, once the network has the final result; never before, and never for
// a transaction that failed.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { TxPanel } from '../TxPanel';

const outcomes: Record<string, { status: string }> = {};
const payoutsMock = jest.fn();

jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }),
  send: async () => ({ hashes: ['h1', 'h2'] })
}));
jest.mock('chain/reads', () => ({
  outcomeOf: async (hash: string) => outcomes[hash] ?? { status: 'pending' },
  payoutsOf: (hashes: string[], caller?: string) => payoutsMock(hashes, caller),
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: identifier.split('-')[0],
    name: identifier,
    decimals: identifier.startsWith('TUSD') ? 6 : 18
  })
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/missing', () => ({ MISSING_AFTER_MS: 120_000 }));
const vestingsMock = jest.fn();
jest.mock('chain/vesting', () => ({
  vesting: { vestings: (ids: number[]) => vestingsMock(ids) }
}));

const fakeTx = () =>
  ({ data: new Uint8Array(10), gasLimit: 10_000_000n }) as any;

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

const open = async (showPayouts: boolean) => {
  render(
    <TxPanel
      showPayouts={showPayouts}
      sender='erd1sender'
      label='Claim all'
      summary={<p>Claims everything vested.</p>}
      build={() => Promise.resolve([fakeTx(), fakeTx()])}
      onClose={() => undefined}
    />
  );
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  for (const key of Object.keys(outcomes)) delete outcomes[key];
  payoutsMock.mockReset();
  vestingsMock.mockReset();
  vestingsMock.mockResolvedValue([]);
  payoutsMock.mockResolvedValue([
    {
      token: 'TFOX-d61b09',
      claimed: 2055895995566669082637n,
      refunded: 0n,
      vestedAtCancel: 0n,
      cancelledIds: []
    },
    {
      token: 'TUSD-8e71cb',
      claimed: 1000000000n,
      refunded: 0n,
      vestedAtCancel: 0n,
      cancelledIds: []
    }
  ]);
});
afterEach(() => jest.useRealTimers());

const poll = async () => {
  await act(async () => {
    jest.advanceTimersByTime(3_000);
  });
  await flush();
};

describe('what a claim paid', () => {
  it('shows the amounts once every transaction is final, from the successful ones only', async () => {
    await open(true);
    expect(screen.queryByText(/Received in this wallet/)).toBeNull();

    outcomes.h1 = { status: 'success' };
    await poll();
    // h2 still pending: nothing yet.
    expect(payoutsMock).not.toHaveBeenCalled();

    outcomes.h2 = { status: 'fail' };
    await poll();
    // Only the successful transaction, and only what was paid to this wallet.
    expect(payoutsMock).toHaveBeenCalledWith(['h1'], 'erd1sender');
    const notice = screen.getByText(/Received in this wallet/);
    expect(notice.textContent).toMatch(
      /Received in this wallet: 2,055\.895995\s*TFOX TFOX-d61b09 and 1,000\s*TUSD TUSD-8e71cb\./
    );
  });

  it('says what a cancel returned and what the beneficiary can still claim', async () => {
    // 100 FOXSY, 39.72 vested at the cancel, 30 of it claimed before: the
    // event says 39.72 vested, the vesting says 9.72 is still claimable.
    payoutsMock.mockResolvedValue([
      {
        token: 'FOXSY-5d5f3e',
        claimed: 0n,
        refunded: 60277778000000000000n,
        vestedAtCancel: 39722222000000000000n,
        cancelledIds: [2]
      }
    ]);
    vestingsMock.mockResolvedValue([
      { id: 2, claimable: 9722222000000000000n }
    ]);
    await open(true);
    outcomes.h1 = { status: 'success' };
    outcomes.h2 = { status: 'success' };
    await poll();
    expect(screen.getByText(/Returned to this wallet/).textContent).toMatch(
      /60\.277778\s*FOXSY FOXSY-5d5f3e\./
    );
    expect(vestingsMock).toHaveBeenCalledWith([2]);
    expect(
      screen.getByText(/Still claimable by the beneficiary/).textContent
    ).toMatch(/9\.722222\s*FOXSY FOXSY-5d5f3e\./);
    expect(screen.queryByText(/39\.72/)).toBeNull();
    expect(screen.queryByText(/Received in this wallet/)).toBeNull();
  });

  it('shows nothing when every transaction failed', async () => {
    await open(true);
    outcomes.h1 = { status: 'fail' };
    outcomes.h2 = { status: 'invalid' };
    await poll();
    expect(payoutsMock).not.toHaveBeenCalled();
  });

  it('is off unless asked for (Create)', async () => {
    await open(false);
    outcomes.h1 = { status: 'success' };
    outcomes.h2 = { status: 'success' };
    await poll();
    expect(payoutsMock).not.toHaveBeenCalled();
  });
});
