// Found on 2 Nov 2026 while checking xPortal on devnet: after a claim on My
// vestings had its final result ("done" with what was received), every other
// card still had no Claim and "Claim all" was gone. They came back only with
// Close or a reload of the page; Created by me does the same with Cancel.
//
// The page hides every other action while a claim or a cancel is under way,
// so nothing is signed on top of a transaction still in flight. Once every
// transaction has its final result that reason is gone: the result stays on
// screen and the other actions are offered again. A transaction not found on
// the network ("missing") is not final: its warning says to sign nothing else,
// so the actions stay hidden. An action started from there opens a fresh
// panel for what was chosen.
//
// The tests that offer the actions again fail on a77d131; the ones that keep
// them hidden pass today and after.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { Created } from '../Created';
import { Mine } from '../Mine';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const OTHER = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

const prepareMock = jest.fn();
const sendMock = jest.fn();
// What the network says of each sent transaction, set by each test.
let mockStatus: 'pending' | 'success' | 'missing' = 'pending';

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: SENDER }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/missing', () => ({ MISSING_AFTER_MS: -1 }));
jest.mock('chain/send', () => ({
  prepare: (...args: unknown[]) => prepareMock(...args),
  send: (...args: unknown[]) => sendMock(...args)
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'TFOX-d61b09',
    ticker: 'TFOX',
    name: 'TFOX',
    decimals: 18
  }),
  payoutBlock: async () => null,
  refusedPayouts: async () => [],
  keysCount: async () => 0,
  keysHeld: async () => [11, 12],
  outcomeOf: async () =>
    mockStatus === 'missing'
      ? { status: 'pending', unknown: true }
      : { status: mockStatus }
}));
jest.mock('components/tx/Payouts', () => ({
  Payouts: () => <p>Received in this wallet</p>
}));

const T = 10n ** 18n;
const vesting = (id: number): Vesting => ({
  id,
  creator: SENDER,
  beneficiary: OTHER,
  token: 'TFOX-d61b09',
  total: 100n * T,
  schedule: {
    start: 1_790_000_000,
    cliff: 1_790_000_000,
    cliffAmount: 0n,
    end: 1_800_000_000,
    curve: { kind: 'linear' }
  },
  cancelable: true,
  createdAt: 1_790_000_000,
  claimNonce: id,
  cancelNonce: id - 10,
  label: 'Community 2026',
  claimed: 0n,
  cancelledAt: 0,
  vested: 50n * T,
  claimable: 50n * T,
  finalAmount: 100n * T,
  refunded: 0n,
  timestamp: 1_795_000_000
});

jest.mock('chain/mine', () => ({
  claimableVestings: async () => [vesting(21), vesting(22)],
  createdVestings: async () => ({ list: [vesting(21), vesting(22)], count: 2 }),
  cancelKeysOfOthers: async () => []
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    }),
    claim: async () => ({
      data: new Uint8Array(40),
      gasLimit: 10_000_000n,
      nonce: 0n
    }),
    cancel: async () => ({
      data: new Uint8Array(40),
      gasLimit: 10_000_000n,
      nonce: 0n
    })
  }
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

beforeEach(() => {
  mockStatus = 'pending';
  prepareMock.mockReset();
  sendMock.mockReset();
  prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }));
  sendMock.mockResolvedValue({ hashes: ['hash-1'], nextNonce: 43n });
  jest.spyOn(Date, 'now').mockReturnValue(1_795_000_000_000);
});

afterEach(() => jest.restoreAllMocks());

const signFirst = async (page: JSX.Element, button: string) => {
  render(<MemoryRouter>{page}</MemoryRouter>);
  await flush();
  expect(screen.getAllByText(button)).toHaveLength(2);
  fireEvent.click(screen.getAllByText(button)[0]);
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  expect(sendMock).toHaveBeenCalledTimes(1);
};

describe('My vestings, after a claim', () => {
  it('offers Claim and Claim all again once the result is final', async () => {
    mockStatus = 'success';
    await signFirst(<Mine />, 'Claim');
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByText('Received in this wallet')).toBeTruthy();
    // Today: no button until Close or a reload.
    expect(screen.queryAllByText('Claim')).toHaveLength(2);
    expect(screen.queryByText(/^Claim all/)).not.toBeNull();
  });

  it('a claim started from there opens a fresh panel for that vesting', async () => {
    mockStatus = 'success';
    await signFirst(<Mine />, 'Claim');
    const next = screen.queryAllByText('Claim')[1];
    expect(next).toBeTruthy();
    fireEvent.click(next);
    await flush();
    expect(screen.queryByText(/Following the result/)).toBeNull();
    expect(screen.getByText(/on vesting #22 to this wallet/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('keeps every other claim hidden while the result is pending', async () => {
    await signFirst(<Mine />, 'Claim');
    expect(screen.getByText('processing')).toBeTruthy();
    expect(screen.queryAllByText('Claim')).toHaveLength(0);
    expect(screen.queryByText(/^Claim all/)).toBeNull();
  });

  it('keeps them hidden while a transaction is missing', async () => {
    mockStatus = 'missing';
    await signFirst(<Mine />, 'Claim');
    expect(screen.getByText(/not found on the network/)).toBeTruthy();
    expect(screen.queryAllByText('Claim')).toHaveLength(0);
  });
});

describe('Created by me, after a cancel', () => {
  it('offers Cancel on the other vestings once the result is final', async () => {
    mockStatus = 'success';
    await signFirst(<Created />, 'Cancel');
    expect(screen.getByText('done')).toBeTruthy();
    // Today: no button until Close or a reload.
    expect(screen.queryAllByText('Cancel').length).toBeGreaterThan(0);
  });

  it('keeps them hidden while the result is pending', async () => {
    await signFirst(<Created />, 'Cancel');
    expect(screen.getByText('processing')).toBeTruthy();
    expect(screen.queryAllByText('Cancel')).toHaveLength(0);
  });
});
