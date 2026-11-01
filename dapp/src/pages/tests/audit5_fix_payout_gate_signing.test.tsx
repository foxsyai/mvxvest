// Fifth audit, FIXR-1 in the fixer's words: the other half of the gate. A block
// holds the signature back whichever way the answer got there (the reviewer's
// proof), but once the wallet has been asked nothing may take the panel away or
// say something other than what is being signed: the page knows, from its
// signing record, whether a signature is on its way.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Created } from '../Created';
import { Mine } from '../Mine';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';

const vesting = (over: Record<string, unknown>) => ({
  id: 1,
  creator: ALICE,
  beneficiary: ALICE,
  token: 'EVIL-123456',
  total: 1_000n,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 1_000,
    curve: { kind: 'stepped', interval: 100 }
  },
  cancelable: false,
  createdAt: T,
  claimNonce: 1,
  cancelNonce: 0,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  vested: 500n,
  claimable: 500n,
  finalAmount: 1_000n,
  refunded: 0n,
  timestamp: T + 500,
  ...over
});
const evil = vesting({});
const fine = vesting({ id: 2, claimNonce: 2, token: 'FOX-a1b2c3' });
const cancelable = vesting({ id: 3, cancelNonce: 9, cancelable: true });

const state = {
  list: [] as unknown[],
  one: undefined as unknown,
  /** Answers for EVIL, in turn; a function holds the answer back until called. */
  answers: [] as (() => Promise<'frozen' | null>)[]
};

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, transactions: unknown[]) => ({
    transactions,
    problems: transactions.map(() => null)
  }),
  // The wallet's prompt stays open.
  send: () => new Promise(() => undefined)
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  keysCount: async () => 0,
  keysHeld: async () => [9],
  keyHolder: async () =>
    'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
  historyOf: async () => [],
  refusedPayouts: async () => [],
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: identifier.split('-')[0],
    name: identifier,
    decimals: 0,
    verified: true
  }),
  outcomeOf: async () => ({ status: 'pending' }),
  payoutBlock: async (_wallet: string, token: string) =>
    token === 'EVIL-123456' ? state.answers.shift()!() : null
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    vesting: async () => state.one,
    isKeyStamping: async () => true,
    deficit: async () => 0n,
    claim: async () => ({ data: new Uint8Array(0), gasLimit: 0n }),
    cancel: async () => ({ data: new Uint8Array(0), gasLimit: 0n })
  }
}));
jest.mock('chain/mine', () => ({
  claimableVestings: async () => state.list,
  createdVestings: async () => ({ list: state.list, count: state.list.length }),
  cancelKeysOfOthers: async () => []
}));

const flush = async () => {
  for (let i = 0; i < 10; i++) await act(async () => undefined);
};
const click = async (text: string | RegExp) => {
  fireEvent.click(screen.getByText(text));
  await flush();
};

const unread = async () => {
  throw new Error('502');
};
/** An answer the test lets out when it wants, and whether it was asked for. */
const heldBack = () => {
  let release: (value: 'frozen' | null) => void = () => undefined;
  const answer = () =>
    new Promise<'frozen' | null>((resolve) => {
      release = resolve;
    });
  return { answer, release: (value: 'frozen' | null) => release(value) };
};

const showMine = async () => {
  const shown = render(
    <MemoryRouter>
      <Mine />
    </MemoryRouter>
  );
  await flush();
  return shown.container;
};

beforeEach(() => {
  state.list = [];
  state.one = undefined;
  state.answers = [];
});

describe('a key of its own', () => {
  it('Try again that answers frozen before anything is signed holds the signature back', async () => {
    state.list = [evil];
    state.answers = [unread, async () => 'frozen'];
    await showMine();
    await click('Claim');
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();
    await click('Try again');
    expect(screen.queryByText('Sign in your wallet')).toBeNull();
    expect(screen.getByText('Go on anyway')).toBeTruthy();
  });

  it('Try again that answers frozen while the wallet is asked leaves the panel, and the warning is said', async () => {
    state.list = [evil];
    const late = heldBack();
    state.answers = [unread, late.answer];
    await showMine();
    await click('Claim');
    await click('Try again');
    await click('Sign in your wallet');
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    await act(async () => late.release('frozen'));
    await flush();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(screen.queryByText('Go on anyway')).toBeNull();
    expect(screen.getByText(/has frozen it for this wallet/)).toBeTruthy();
  });

  it('once the wallet is asked there is nothing left to try again', async () => {
    state.list = [evil];
    state.answers = [unread];
    await showMine();
    await click('Claim');
    await click('Sign in your wallet');
    expect(screen.getByText(/could not be checked/)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});

describe('Claim all', () => {
  it('an answer that arrives while the wallet is asked does not call a key left out that is being signed', async () => {
    state.list = [fine, evil];
    const late = heldBack();
    state.answers = [unread, late.answer];
    const container = await showMine();
    await click('Claim all (2)');
    await click('Try again');
    await click('Sign in your wallet');
    await act(async () => late.release('frozen'));
    await flush();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Left out/);
  });

  it('before anything is signed the same answer leaves it out', async () => {
    state.list = [fine, evil];
    state.answers = [unread, async () => 'frozen'];
    const container = await showMine();
    await click('Claim all (2)');
    await click('Try again');
    expect(container.textContent).toMatch(/Left out/);
  });
});

describe('the other pages tell the gate too', () => {
  it('the Vesting page', async () => {
    state.one = evil;
    state.answers = [unread];
    render(
      <MemoryRouter initialEntries={['/v/1']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    await click('Claim');
    await click('Sign in your wallet');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('Created by me', async () => {
    state.list = [cancelable];
    state.answers = [unread];
    render(
      <MemoryRouter>
        <Created />
      </MemoryRouter>
    );
    await flush();
    await click('Cancel');
    await click('Sign in your wallet');
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
