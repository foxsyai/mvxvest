// Main audit (Fable 5.1, 13 Oct 2026): on My vestings (and Created by me and
// the vesting page) a signing panel is re-armed by a disconnect and a
// reconnect, while the wallet prompt is still open or the send in flight.
//
// The third review fixed this on Create (T1: the page keeps a record of each
// signing and a remounted panel resumes from it). The other three pages
// hand TxPanel no `resume`: they render it only while logged in, so a
// logout (the door icon, sdk-dapp's cross-tab logout, a wallet session that
// drops) unmounts it with the prompt open; send() goes on in the background
// and POSTs what the wallet signs. On reconnect, `claiming` (Mine),
// `cancelling` (Created) or `action` (Vesting) is still set, so a fresh
// panel mounts, checks again and offers "Sign in your wallet" for the same
// keys. The second signature executes one nonce after the first: a second
// claim of a vesting on dates fails with "nothing to claim yet" (gas lost),
// of a linear one pays a few seconds' worth; a second cancel fails (the key
// is burned). The page never says the first one was sent.
//
// Expected once fixed: as on Create, the page remembers that this signing
// asked the wallet (and what it sent), and a panel mounted again resumes
// from that record instead of offering "Sign" again.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { Mine } from '../Mine';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const BENEFICIARY =
  'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';

const prepareMock = jest.fn();
const sendMock = jest.fn();

// The wallet session, switchable from a test: sdk-dapp clears the address on
// logout and sets it again on login.
const mockSession = {
  address: SENDER,
  loggedIn: true,
  listeners: new Set<() => void>(),
  set(loggedIn: boolean) {
    mockSession.loggedIn = loggedIn;
    mockSession.address = loggedIn ? SENDER : '';
    mockSession.listeners.forEach((listener) => listener());
  }
};
jest.mock('lib', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (listener: () => void) => {
    mockSession.listeners.add(listener);
    return () => mockSession.listeners.delete(listener);
  };
  return {
    useGetAccount: () => ({
      address: useSyncExternalStore(subscribe, () => mockSession.address)
    }),
    useGetIsLoggedIn: () =>
      useSyncExternalStore(subscribe, () => mockSession.loggedIn)
  };
});
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
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
  outcomeOf: async () => ({ status: 'pending' })
}));

const T = 10n ** 18n;
const monthly: Vesting = {
  id: 327,
  creator: BENEFICIARY,
  beneficiary: SENDER,
  token: 'TFOX-d61b09',
  total: 12_000n * T,
  schedule: {
    start: 1_790_000_000,
    cliff: 1_790_000_000,
    cliffAmount: 0n,
    end: 1_821_000_000,
    curve: {
      kind: 'tranches',
      tranches: [
        { time: 1_791_000_000, amount: 6_000n * T },
        { time: 1_821_000_000, amount: 6_000n * T }
      ]
    }
  },
  cancelable: false,
  createdAt: 1_790_000_000,
  claimNonce: 327,
  cancelNonce: 0,
  label: 'Team 2027',
  claimed: 0n,
  cancelledAt: 0,
  vested: 6_000n * T,
  claimable: 6_000n * T,
  finalAmount: 12_000n * T,
  refunded: 0n,
  timestamp: 1_791_500_000
};

jest.mock('chain/mine', () => ({
  claimableVestings: async () => [monthly]
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
    })
  }
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

beforeEach(() => {
  mockSession.loggedIn = true;
  mockSession.address = SENDER;
  prepareMock.mockReset();
  sendMock.mockReset();
  prepareMock.mockImplementation(async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }));
  jest.spyOn(Date, 'now').mockReturnValue(1_791_500_000_000);
});

afterEach(() => jest.restoreAllMocks());

describe('audit: My vestings, a claim whose wallet prompt is open', () => {
  it('is not offered for signing again after a disconnect and a reconnect', async () => {
    // The wallet prompt stays open (send() does not resolve).
    sendMock.mockImplementation(() => new Promise(() => undefined));
    render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(sendMock).toHaveBeenCalledTimes(1);

    // The session drops while the prompt is open, then the same wallet is
    // connected again.
    await act(async () => mockSession.set(false));
    await flush();
    expect(screen.getByText(/Connect your wallet/)).toBeTruthy();
    await act(async () => mockSession.set(true));
    await flush();

    // Today: a fresh panel checks again and offers "Sign in your wallet"
    // for the same key; a click signs the claim a second time.
    const again = screen.queryByText('Sign in your wallet');
    if (again) {
      fireEvent.click(again);
      await flush();
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  it('is not offered again when the send resolved while disconnected', async () => {
    let resolveSend: (value: unknown) => void = () => undefined;
    sendMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();

    await act(async () => mockSession.set(false));
    await flush();
    // The wallet signed and the network took it while the page showed
    // "Connect your wallet".
    await act(async () => {
      resolveSend({ hashes: ['hash-of-the-claim'], nextNonce: 43n });
    });
    await flush();
    await act(async () => mockSession.set(true));
    await flush();

    // Today: "Sign in your wallet" again, for a key that was just claimed;
    // the hash that was sent is followed by nobody.
    const again = screen.queryByText('Sign in your wallet');
    if (again) {
      fireEvent.click(again);
      await flush();
    }
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(/hash-of-the-claim|Following the result/)
    ).not.toBeNull();
  });
});
