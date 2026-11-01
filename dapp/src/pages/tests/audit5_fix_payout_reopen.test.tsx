// Fifth audit, the merge gate's review: a Claim or Cancel closed and opened again
// on the same page. The check read when it was first opened must not stand in
// for the new one: a token frozen in between would not be caught and the person
// would reach Sign. While the new read is on its way the page says it is
// checking, and a read of an earlier opening never decides this one. None of it
// may disturb a signature already on its way.

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { usePayoutCheck } from 'hooks';
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
const plain = vesting({});
const cancelable = vesting({ cancelNonce: 9, cancelable: true });

type Answer = 'frozen' | null;

const state = {
  list: [] as unknown[],
  one: undefined as unknown,
  /** Answers for the token, in turn. */
  answers: [] as (() => Promise<Answer>)[]
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
  payoutBlock: async () => state.answers.shift()!()
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
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};
const click = async (text: string | RegExp) => {
  fireEvent.click(screen.getByText(text));
  await flush();
};

const fineNow = async (): Promise<Answer> => null;
const unread = async (): Promise<Answer> => {
  throw new Error('502');
};
/** An answer the test lets out when it wants. */
const heldBack = () => {
  let release: (value: Answer) => void = () => undefined;
  const answer = () =>
    new Promise<Answer>((resolve) => {
      release = resolve;
    });
  return {
    answer,
    release: async (value: Answer) => {
      await act(async () => {
        release(value);
      });
      await flush();
    }
  };
};

const showVesting = async () => {
  render(
    <MemoryRouter initialEntries={['/v/1']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
};
const showCreated = async () => {
  render(
    <MemoryRouter>
      <Created />
    </MemoryRouter>
  );
  await flush();
};
const showMine = async () => {
  render(
    <MemoryRouter>
      <Mine />
    </MemoryRouter>
  );
  await flush();
};

/** Checking is said, nothing can be signed; then the block holds it back. */
const expectCheckingThenBlocked = async (late: ReturnType<typeof heldBack>) => {
  expect(screen.getByText(/Checking that this can reach/)).toBeTruthy();
  expect(screen.queryByText('Sign in your wallet')).toBeNull();
  await late.release('frozen');
  expect(screen.getByText(/has frozen it for this wallet/)).toBeTruthy();
  expect(screen.queryByText('Sign in your wallet')).toBeNull();
  expect(screen.getByText('Go on anyway')).toBeTruthy();
};

beforeEach(() => {
  state.list = [];
  state.one = undefined;
  state.answers = [];
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

describe('closed and opened again, the token frozen in between', () => {
  it('a Claim on the Vesting page', async () => {
    state.one = plain;
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    await showVesting();
    await click('Claim');
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();
    await click('Not now');
    await click('Claim');
    await expectCheckingThenBlocked(late);
  });

  it('a Cancel on the Vesting page', async () => {
    state.one = cancelable;
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    await showVesting();
    await click('Cancel this vesting');
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();
    await click('Not now');
    await click('Cancel this vesting');
    await expectCheckingThenBlocked(late);
  });

  it('a Cancel on Created by me', async () => {
    state.list = [cancelable];
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    await showCreated();
    await click('Cancel');
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();
    await click('Not now');
    await click('Cancel');
    await expectCheckingThenBlocked(late);
  });

  it('a Claim on My vestings', async () => {
    state.list = [plain];
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    await showMine();
    await click('Claim');
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();
    await click('Not now');
    await click('Claim');
    await expectCheckingThenBlocked(late);
  });
});

describe('a read of an earlier opening', () => {
  it('that lands while the panel is closed does not answer for the next opening', async () => {
    state.one = plain;
    const old = heldBack();
    const late = heldBack();
    state.answers = [unread, old.answer, late.answer];
    await showVesting();
    await click('Claim');
    await click('Try again');
    await click('Not now');
    await old.release(null);
    await click('Claim');
    await expectCheckingThenBlocked(late);
  });

  it('that lands after the new answer does not overwrite it', async () => {
    state.one = plain;
    const old = heldBack();
    state.answers = [unread, old.answer, async () => 'frozen'];
    await showVesting();
    await click('Claim');
    await click('Try again');
    await click('Not now');
    await click('Claim');
    expect(screen.getByText('Go on anyway')).toBeTruthy();
    await old.release(null);
    expect(screen.getByText(/has frozen it for this wallet/)).toBeTruthy();
    expect(screen.queryByText('Sign in your wallet')).toBeNull();
  });
});

describe('another wallet connected while the panel is open', () => {
  it('the answer read for the first wallet does not answer for the second', async () => {
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    const action = 'claim';
    const { result, rerender } = renderHook(
      ({ wallet }: { wallet: string }) =>
        usePayoutCheck(wallet, ['EVIL-123456'], action),
      { initialProps: { wallet: 'first' } }
    );
    await flush();
    expect(result.current.check).toEqual({ 'EVIL-123456': null });
    rerender({ wallet: 'second' });
    expect(result.current.check).toBeNull();
    await late.release('frozen');
    expect(result.current.check).toEqual({ 'EVIL-123456': 'frozen' });
  });
});

describe('a signature on its way', () => {
  it('stays on the page while a new read is checking', async () => {
    state.one = plain;
    const late = heldBack();
    state.answers = [fineNow, late.answer];
    await showVesting();
    await click('Claim');
    await click('Sign in your wallet');
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    // The page reads again and the vesting has nothing to claim for a moment,
    // then has: the action pays nothing, then pays again, and is read anew.
    state.one = { ...plain, claimable: 0n };
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mvxvest:settled'));
    });
    await flush();
    state.one = plain;
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mvxvest:settled'));
    });
    await flush();
    expect(screen.queryByText(/Checking that this can reach/)).toBeNull();
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    await late.release('frozen');
    expect(screen.getByText(/Waiting for your wallet/)).toBeTruthy();
    expect(screen.queryByText('Go on anyway')).toBeNull();
  });
});
