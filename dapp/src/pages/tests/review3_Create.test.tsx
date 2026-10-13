// Third adversarial review: the Create page after eb66702 (the fixes of R2 to
// R5), end to end with the chain mocked out. One vesting per transaction (the
// contract's batch limit is mocked to 1), so N lines make N transactions.
//
// 1. A panel that already sent is mounted again from scratch, and offers
//    "Sign in your wallet" for the same transactions. TxPanel keeps "sent" and
//    its lock in its own state; Create keeps only the attempt. Any unmount
//    loses it:
//    a. a disconnect (Create renders "Connect your wallet" instead of the
//       panels) and a reconnect of the same account: what the page itself
//       asks for after an account switch ("connect that account again");
//    b. an account switch while the wallet is asked: `!attempt.sent &&
//       !sameAccount` unmounts the busy panel; when the send resolves the
//       attempt is `sent`, the panel mounts again and checks again.
//    The remounted panel builds the same vestings with the next nonce, and
//    "Sign in your wallet" creates them a second time.
// 2. Attempt numbers are reused (`n: review.attempts.length` after a closed
//    attempt was removed), and buildFor() caches the build by that number.
//    "Sign the remaining 1" (C), "Not now", then "Sign the remaining 2" (B, C,
//    after B failed on chain) gets the cached build of the closed attempt: it
//    shows "Locks 5,000 TFOX in 2 vestings" and signs C alone; onSent then
//    records C's hash as B's. B is never created, the page reports it done,
//    and C is offered again and created twice.
// 3. A "not found" transaction is signed again with a nonce read from the
//    network, but in batch order: a lower batch that failed on chain is
//    signed first and takes the lost one's nonce, and the lost one's copy gets
//    the next. If the lost one turns up after all (the case this nonce reuse
//    is there for), both execute.
// 4. The ids a panel of an earlier review created arrive after "Start a new
//    creation" and show as "Created 1 vesting: #101" in the new review, before
//    it is signed.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const OTHER = 'erd1sdslvlxvfnnflzj42l8czrcngq3xjjzkjp3rgul4ttk6hntr4qdsv6sets';
const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const C = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const TOKEN = 'TFOX-d61b09';

const prepareMock = jest.fn();
const sendMock = jest.fn();
const createMock = jest.fn();
const outcomeMock = jest.fn();
const createdIdsMock = jest.fn();

// The wallet session, switchable from a test: the address and whether one is
// connected at all.
const mockSession = {
  address: SENDER,
  loggedIn: true,
  listeners: new Set<() => void>(),
  set(patch: { address?: string; loggedIn?: boolean }) {
    Object.assign(mockSession, patch);
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
  balancesOf: async () => [
    {
      identifier: 'EGLD-000000',
      ticker: 'EGLD',
      name: 'EGLD',
      decimals: 18,
      balance: 10n ** 21n
    },
    {
      identifier: 'TFOX-d61b09',
      ticker: 'TFOX',
      name: 'TFOX',
      decimals: 18,
      balance: 10n ** 30n
    }
  ],
  createdIdsOf: (hash: string) => createdIdsMock(hash),
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => 0,
    creationPaused: async () => false,
    limits: async () => ({
      maxBatch: 1,
      maxBatchCancelable: 1,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: (...args: unknown[]) => createMock(...args),
    createBatch: () => {
      throw new Error('unused: one vesting per transaction');
    }
  }
}));

const fakeTx = (sender: string, beneficiaries: string[]) =>
  ({
    sender,
    beneficiaries,
    data: new Uint8Array(100),
    gasLimit: 50_000_000n,
    nonce: 0n
  }) as any;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Final results by hash; anything else is still pending. */
let outcomes: Record<string, any> = {};
/** The sender's account nonce on the network (for the emulated prepare). */
let accountNonce = 42n;

beforeEach(() => {
  mockSession.address = SENDER;
  mockSession.loggedIn = true;
  outcomes = {};
  accountNonce = 42n;
  prepareMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
  outcomeMock.mockReset();
  createdIdsMock.mockReset();
  // As chain/send's prepare(): nonces from the account's nonce, or from
  // firstNonce when that is higher.
  prepareMock.mockImplementation(
    async (_sender: string, txs: any[], firstNonce?: bigint) => {
      const start =
        firstNonce !== undefined && firstNonce > accountNonce
          ? firstNonce
          : accountNonce;
      txs.forEach((tx, index) => {
        tx.nonce = start + BigInt(index);
      });
      return { transactions: txs, problems: txs.map(() => null) };
    }
  );
  createMock.mockImplementation(
    async (sender: string, _token: string, entry: any) =>
      fakeTx(sender, [entry.beneficiary])
  );
  outcomeMock.mockImplementation(
    async (hash: string) => outcomes[hash] ?? { status: 'pending' }
  );
  createdIdsMock.mockImplementation(async () => []);
});

afterEach(() => jest.restoreAllMocks());

const fillRows = (lines: [string, string][]) =>
  lines.forEach(([address, amount], index) => {
    if (index > 0) fireEvent.click(screen.getByText('Add a beneficiary'));
    fireEvent.change(
      screen.getAllByPlaceholderText('erd1... beneficiary address')[index],
      { target: { value: address } }
    );
    fireEvent.change(screen.getAllByPlaceholderText(/^Amount/)[index], {
      target: { value: amount }
    });
  });

const fillForm = async (lines: [string, string][]) => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: TOKEN }
  });
  fillRows(lines);
  fireEvent.click(screen.getByText('Cannot be cancelled'));
  await flush();
};

const checkAndSign = async () => {
  fireEvent.click(screen.getByText('Check and sign'));
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
};

/** Who each call to send() signed for, in order. */
const signedBeneficiaries = () =>
  sendMock.mock.calls.flatMap((call) =>
    call[0].flatMap((tx: any) => tx.beneficiaries)
  );

/** Clicks "Sign in your wallet" if the page offers it again. */
const signAgainIfOffered = async () => {
  const again = screen.queryByText('Sign in your wallet');
  if (again) {
    sendMock.mockResolvedValueOnce({ hashes: ['hash-again'], nextNonce: 99n });
    fireEvent.click(again);
    await flush();
  }
};

describe('review3: a panel that already sent, mounted again', () => {
  it('a disconnect and reconnect of the same account does not offer the sent vesting again', async () => {
    await fillForm([[A, '1000']]);
    sendMock.mockResolvedValueOnce({ hashes: ['hash-1'], nextNonce: 43n });
    await checkAndSign();
    expect(screen.getByText(/Sent\. Following the result/)).toBeTruthy();

    // The creator disconnects (the door icon) and connects the same wallet
    // again, as the page asks after an account switch.
    await act(async () => mockSession.set({ loggedIn: false, address: '' }));
    await flush();
    await act(async () => mockSession.set({ loggedIn: true, address: SENDER }));
    await flush();

    // Today: the panel is back at "Checked with the network: it would go
    // through" with "Sign in your wallet", and A is signed a second time.
    await signAgainIfOffered();
    expect(signedBeneficiaries()).toEqual([A]);
  });

  it('an account switch while the wallet is asked does not offer the sent vesting again', async () => {
    await fillForm([[A, '1000']]);
    let release!: (sent: unknown) => void;
    sendMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve))
    );
    await checkAndSign();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();

    // The wallet reports another account while its prompt is open; the
    // prompt is then signed and the transaction accepted.
    await act(async () => mockSession.set({ address: OTHER }));
    await flush();
    await act(async () => release({ hashes: ['hash-1'], nextNonce: 43n }));
    await flush();
    await act(async () => mockSession.set({ address: SENDER }));
    await flush();

    // Today: the busy panel was unmounted, mounted again once the attempt was
    // sent, checked again and offers "Sign in your wallet" for A.
    await signAgainIfOffered();
    expect(signedBeneficiaries()).toEqual([A]);
  });
});

describe('review3: "Sign the remaining" after closing an earlier one', () => {
  it('signs what its summary shows, and records each hash on its own batch', async () => {
    await fillForm([
      [A, '1000'],
      [B, '2000'],
      [C, '3000']
    ]);
    // The network takes the first two; the third is refused (rate limit).
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-1', 'hash-2'],
      stopped: { at: 2, reason: 'Too Many Requests' },
      nextNonce: 44n
    });
    await checkAndSign();

    // The creator opens the remaining one (C), then waits ("Not now").
    fireEvent.click(screen.getByText('Sign the remaining 1'));
    await flush();
    fireEvent.click(screen.getByText('Not now'));
    await flush();

    // Meanwhile on chain: A is created, B fails.
    outcomes = {
      'hash-1': { status: 'success' },
      'hash-2': { status: 'fail', reason: 'out of gas' }
    };
    await wait(3_500);
    await flush();

    fireEvent.click(screen.getByText('Sign the remaining 2'));
    await flush();
    const summary = screen.getByText(/The remaining 2 of 3 transactions/)
      .textContent as string;
    expect(summary).toMatch(/5,000/);
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-3', 'hash-4'],
      nextNonce: 46n
    });
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();

    // It shows B and C, 5,000 TFOX. Today it signs [C] only (the cached build
    // of the closed attempt n=1): B is never created and C's hash is recorded
    // as B's, so C is offered again ("Sign the remaining 1").
    expect(
      sendMock.mock.calls[1][0].flatMap((tx: any) => tx.beneficiaries)
    ).toEqual([B, C]);
  });
});

describe('review3 (revised in round 4): a "not found" transaction', () => {
  it('is never signed again, and the rest waits until its fate is known', async () => {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);

    await fillForm([
      [A, '1000'],
      [B, '2000'],
      [C, '3000']
    ]);
    // Signed as A@42, B@43, C@44. A is accepted; B's POST timed out every
    // time (unconfirmed), so C was not sent.
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A', 'hash-B'],
      unconfirmed: ['hash-B'],
      stopped: {
        at: 2,
        reason:
          'the network did not confirm transaction 2; check it before signing the rest'
      },
      nextNonce: 44n
    });
    await checkAndSign();
    const nonceOf = (call: number, who: string) =>
      sendMock.mock.calls[call][0].find(
        (tx: any) => tx.beneficiaries[0] === who
      ).nonce;
    expect(String(nonceOf(0, B))).toBe('43');

    // A fails on chain (nonce 42 used); the API has never heard of B.
    outcomes = {
      'hash-A': { status: 'fail', reason: 'out of gas' },
      'hash-B': { status: 'pending', unknown: true }
    };
    accountNonce = 43n;
    await wait(3_500);
    skew = 121_000;
    await wait(3_500);
    await flush();
    expect(screen.getByText(/not found on the network/)).toBeTruthy();

    // Revised in round 4: a "not found" send is never signed again (its copy
    // and the original could both execute), and nothing more of this
    // creation is signed while its fate is unknown. The page offers the lines
    // not created as a file instead, and keeps looking.
    expect(screen.queryByText(/Sign the remaining/)).toBeNull();
    expect(
      screen.getByText('Download the lines not created (CSV)')
    ).toBeTruthy();
    const signedAgain = sendMock.mock.calls
      .slice(1)
      .flatMap((call) => call[0])
      .map((tx: any) => tx.beneficiaries[0]);
    expect(signedAgain).toEqual([]);

    // If it turns up after all, the rest (A failed, C never sent) can be
    // signed: B is created and is not among them.
    outcomes = {
      'hash-A': { status: 'fail', reason: 'out of gas' },
      'hash-B': { status: 'success' }
    };
    // (A missing hash is looked at again every 6 s.)
    await wait(6_500);
    await flush();
    fireEvent.click(screen.getByText('Sign the remaining 2'));
    await flush();
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A2', 'hash-C2'],
      nextNonce: 46n
    });
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
    expect(
      sendMock.mock.calls[1][0].map((tx: any) => tx.beneficiaries[0])
    ).toEqual([A, C]);
  }, 40_000);
});

describe('review3: "Start a new creation"', () => {
  it('does not show the vestings of the earlier review as created by the new one', async () => {
    await fillForm([[A, '1000']]);
    let releaseIds!: (ids: number[]) => void;
    createdIdsMock.mockImplementationOnce(
      () => new Promise((resolve) => (releaseIds = resolve))
    );
    outcomes = { 'hash-1': { status: 'success' } };
    sendMock.mockResolvedValueOnce({ hashes: ['hash-1'], nextNonce: 43n });
    await checkAndSign();

    // Done on chain; the ids are still being read (a slow API).
    fireEvent.click(screen.getByText('Start a new creation'));
    await flush();
    fillRows([[B, '500']]);
    await flush();
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();

    await act(async () => releaseIds([101]));
    await flush();
    // Today: "Created 1 vesting: #101" above the new review's "Sign in your
    // wallet", for a vesting of the review that was closed.
    expect(screen.queryByText(/Created 1 vesting/)).toBeNull();
  });
});
