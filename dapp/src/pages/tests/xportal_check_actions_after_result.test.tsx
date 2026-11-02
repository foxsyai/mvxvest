// Found on 2 Nov 2026 while checking xPortal on devnet: after a claim on My
// vestings had its final result ("done" with what was received), every other
// card still had no Claim and "Claim all" was gone. They came back only with
// Close or a reload of the page; Created by me does the same with Cancel.
//
// The page hides every other action while a claim or a cancel is under way,
// so nothing is signed on top of a transaction still in flight. Once every
// transaction has its final result and the list has been read again, that
// reason is gone: the result stays on screen and the other actions are
// offered again. A transaction not found on the network ("missing") is not
// final: its warning says to sign nothing else, so the actions stay hidden.
// An action started from there opens a fresh panel for what was chosen.
//
// The tests that offer the actions again fail on a77d131; the ones that keep
// them hidden pass today and after.
//
// The agent review of PR #17 (46f543f) found two more, proven by the tests
// marked "review": the actions came back one render early, on the list read
// before the claim. They also went away during every later reload of the list.
// The "fresh panel" tests pin the key that keeps an old panel (a "Go on anyway"
// already pressed, a result already shown) from carrying over.

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
// What the chain holds, read by the pages; a test changes it when it sends.
let mockMine: Vesting[] = [];
let mockCreated: Vesting[] = [];
// A read of the list waits for this, when a test holds it.
let mockHold: Promise<void> | null = null;
let mockFrozen = false;
// Every card drawn: which vesting, its state and whether it had an action.
let mockCards: {
  id: number;
  claimable: bigint;
  cancelledAt: number;
  offered: boolean;
}[] = [];

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
  payoutBlock: async () => (mockFrozen ? 'frozen' : null),
  refusedPayouts: async () => [],
  keysCount: async () => 0,
  keysHeld: async () => [11, 12, 13],
  outcomeOf: async () =>
    mockStatus === 'missing'
      ? { status: 'pending', unknown: true }
      : { status: mockStatus }
}));
jest.mock('components/tx/Payouts', () => ({
  Payouts: () => <p>Received in this wallet</p>
}));
jest.mock('components/vesting/VestingCard', () => {
  const actual = jest.requireActual('components/vesting/VestingCard');
  return {
    ...actual,
    VestingCard: (props: any) => {
      mockCards.push({
        id: props.vesting.id,
        claimable: props.vesting.claimable,
        cancelledAt: props.vesting.cancelledAt,
        offered: Boolean(props.actions)
      });
      return <actual.VestingCard {...props} />;
    }
  };
});

const T = 10n ** 18n;
const vesting = (id: number, more: Partial<Vesting> = {}): Vesting => ({
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
  timestamp: 1_795_000_000,
  ...more
});

jest.mock('chain/mine', () => ({
  claimableVestings: async () => {
    if (mockHold) await mockHold;
    return mockMine;
  },
  createdVestings: async () => {
    if (mockHold) await mockHold;
    return { list: mockCreated, count: mockCreated.length };
  },
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

// What the chain holds once the next send has gone through.
let mockAfterSend: () => void = () => undefined;
let sentAt = 0;

beforeEach(() => {
  mockStatus = 'pending';
  mockMine = [vesting(21), vesting(22), vesting(23)];
  mockCreated = [vesting(21), vesting(22), vesting(23)];
  mockHold = null;
  mockFrozen = false;
  mockCards = [];
  mockAfterSend = () => undefined;
  sentAt = 0;
  prepareMock.mockReset();
  sendMock.mockReset();
  prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }));
  sendMock.mockImplementation(async () => {
    mockAfterSend();
    sentAt = mockCards.length;
    return { hashes: [`hash-${sendMock.mock.calls.length}`], nextNonce: 43n };
  });
  jest.spyOn(Date, 'now').mockReturnValue(1_795_000_000_000);
});

afterEach(() => jest.restoreAllMocks());

const open = async (page: JSX.Element) => {
  render(<MemoryRouter>{page}</MemoryRouter>);
  await flush();
};

const signFirst = async (page: JSX.Element, button: string) => {
  await open(page);
  expect(screen.getAllByText(button)).toHaveLength(3);
  fireEvent.click(screen.getAllByText(button)[0]);
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  expect(sendMock).toHaveBeenCalledTimes(1);
};

// Vesting #21's key is burned by the claim: the list read after it has
// #22 and #23 only.
const claimTakes21 = () => {
  mockAfterSend = () => {
    mockMine = [vesting(22), vesting(23)];
  };
};
const cancelTakes21 = () => {
  mockAfterSend = () => {
    mockCreated = [
      vesting(21, { cancelledAt: 1_795_000_000 }),
      vesting(22),
      vesting(23)
    ];
  };
};

describe('My vestings, after a claim', () => {
  it('offers Claim and Claim all again once the result is final', async () => {
    mockStatus = 'success';
    claimTakes21();
    await signFirst(<Mine />, 'Claim');
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByText('Received in this wallet')).toBeTruthy();
    // Today: no button until Close or a reload.
    expect(screen.queryAllByText('Claim')).toHaveLength(2);
    expect(screen.queryByText('Claim all (2)')).not.toBeNull();
  });

  it('review: never offers an action on the list read before the claim', async () => {
    mockStatus = 'success';
    claimTakes21();
    await signFirst(<Mine />, 'Claim');
    expect(screen.queryAllByText('Claim')).toHaveLength(2);
    // On 46f543f one render had the result settled and the old list: #21,
    // whose key was just burned, with its Claim.
    const after = mockCards.slice(sentAt);
    expect(
      after.filter((card) => card.offered && card.id === 21).map((c) => c.id)
    ).toEqual([]);
  });

  it('review: keeps the actions while the list is read again later', async () => {
    mockStatus = 'success';
    claimTakes21();
    await signFirst(<Mine />, 'Claim');
    expect(screen.queryAllByText('Claim')).toHaveLength(2);
    // send() fires "mvxvest:settled" again 8 and 18 seconds after sending.
    let release: () => void = () => undefined;
    mockHold = new Promise((resolve) => {
      release = resolve;
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mvxvest:settled'));
    });
    await flush();
    expect(screen.queryAllByText('Claim')).toHaveLength(2);
    release();
    await flush();
  });

  it('a claim started from there opens a fresh panel for that vesting', async () => {
    mockStatus = 'success';
    claimTakes21();
    await signFirst(<Mine />, 'Claim');
    fireEvent.click(screen.getAllByText('Claim')[0]);
    await flush();
    expect(screen.queryByText(/Following the result/)).toBeNull();
    expect(screen.getByText(/on vesting #22 to this wallet/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('asks "Go on anyway" again for the next frozen claim', async () => {
    mockStatus = 'success';
    mockFrozen = true;
    claimTakes21();
    await open(<Mine />);
    fireEvent.click(screen.getAllByText('Claim')[0]);
    await flush();
    fireEvent.click(screen.getByText('Go on anyway'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(screen.getByText('done')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Claim')[0]);
    await flush();
    expect(screen.getByText('Go on anyway')).toBeTruthy();
    expect(screen.queryByText('Sign in your wallet')).toBeNull();
  });

  it('Claim all after Claim all opens a fresh panel', async () => {
    mockStatus = 'success';
    await open(<Mine />);
    fireEvent.click(screen.getByText('Claim all (3)'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(screen.getByText('done')).toBeTruthy();
    fireEvent.click(screen.getByText('Claim all (3)'));
    await flush();
    expect(screen.queryByText(/Following the result/)).toBeNull();
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
    cancelTakes21();
    await signFirst(<Created />, 'Cancel');
    expect(screen.getByText('done')).toBeTruthy();
    // Today: no button until Close or a reload.
    expect(screen.queryAllByText('Cancel')).toHaveLength(2);
  });

  it('review: never offers Cancel on the list read before the cancel', async () => {
    mockStatus = 'success';
    cancelTakes21();
    await signFirst(<Created />, 'Cancel');
    const after = mockCards.slice(sentAt);
    expect(
      after
        .filter(
          (card) => card.offered && card.id === 21 && card.cancelledAt === 0
        )
        .map((c) => c.id)
    ).toEqual([]);
  });

  it('a cancel that refunds nothing, started from there, opens a fresh panel', async () => {
    mockStatus = 'success';
    // Fully vested: nothing comes back, so no payout check stands in front.
    const done = { vested: 100n * T, claimable: 100n * T };
    mockCreated = [vesting(21, done), vesting(22, done), vesting(23, done)];
    mockAfterSend = () => {
      mockCreated = [
        vesting(21, { ...done, cancelledAt: 1_795_000_000 }),
        vesting(22, done),
        vesting(23, done)
      ];
    };
    await signFirst(<Created />, 'Cancel');
    expect(screen.getByText('done')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Cancel')[0]);
    await flush();
    expect(screen.queryByText(/Following the result/)).toBeNull();
    expect(screen.getByText(/Stops vesting #22/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('keeps them hidden while the result is pending', async () => {
    await signFirst(<Created />, 'Cancel');
    expect(screen.getByText('processing')).toBeTruthy();
    expect(screen.queryAllByText('Cancel')).toHaveLength(0);
  });
});
