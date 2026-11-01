// Fifth audit, RT-1, layers 1 and 2: before signing, the page reads whether this
// wallet can receive what the transaction pays. A frozen or paused token is
// left out of Claim all; its own Claim, and a Cancel that pays it, warn first.
// A failed read says so and never reads as fine.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MAX_KEYS_PER_CALL, claimBatches } from 'vesting/batches';
import { Created } from '../Created';
import { Mine } from '../Mine';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const ALICE = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';

const vesting = (over: Record<string, unknown>) => ({
  id: 1,
  creator: ALICE,
  beneficiary: ALICE,
  token: 'FOX-a1b2c3',
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
const salary = vesting({ id: 1, claimNonce: 1 });
const bonus = vesting({ id: 2, claimNonce: 2 });
const evil = vesting({ id: 3, claimNonce: 3, token: 'EVIL-123456' });
const other = vesting({ id: 4, claimNonce: 4, token: 'USD-654321' });
const cancelable = vesting({
  id: 5,
  claimNonce: 5,
  cancelNonce: 9,
  cancelable: true
});
/** Cancelled and fully claimed: its claim only burns the key and pays nothing. */
const spentEvil = vesting({
  id: 6,
  claimNonce: 6,
  token: 'EVIL-123456',
  cancelledAt: T + 1,
  claimed: 10n,
  finalAmount: 10n,
  claimable: 0n
});

const state = {
  list: [] as unknown[],
  one: undefined as unknown,
  blocks: {} as Record<string, 'frozen' | 'paused' | 'unread' | null>,
  claims: [] as number[][],
  cancels: [] as number[][],
  reads: [] as string[]
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
  send: jest.fn()
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  keysCount: async () => 3,
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
  payoutBlock: async (_wallet: string, token: string) => {
    state.reads.push(token);
    const block = state.blocks[token] ?? null;
    if (block === 'unread') throw new Error('502');
    return block;
  }
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
    claim: async (_address: string, _collection: string, nonces: number[]) => {
      state.claims.push([...nonces]);
      return { data: new Uint8Array(0), gasLimit: 0n };
    },
    cancel: async (_address: string, _collection: string, nonces: number[]) => {
      state.cancels.push([...nonces]);
      return { data: new Uint8Array(0), gasLimit: 0n };
    }
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
const showMine = async () => {
  const shown = render(
    <MemoryRouter>
      <Mine />
    </MemoryRouter>
  );
  await flush();
  return shown.container;
};
const showVesting = async () => {
  const shown = render(
    <MemoryRouter initialEntries={['/v/5']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  return shown.container;
};
const click = async (text: string | RegExp) => {
  fireEvent.click(screen.getByText(text));
  await flush();
};

beforeEach(() => {
  state.list = [];
  state.one = undefined;
  state.blocks = {};
  state.claims = [];
  state.cancels = [];
  state.reads = [];
});

describe('claimBatches', () => {
  const keys = (token: string, from: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      token,
      claimNonce: from + i
    }));

  it('never mixes tokens, and keeps the size cap', () => {
    const batches = claimBatches([
      ...keys('A-111111', 1, MAX_KEYS_PER_CALL + 1),
      ...keys('B-222222', 100, 2)
    ]);
    expect(batches.map((batch) => batch.length).sort((a, b) => a - b)).toEqual([
      1,
      2,
      MAX_KEYS_PER_CALL
    ]);
    expect(batches.flat().sort((a, b) => a - b)).toHaveLength(
      MAX_KEYS_PER_CALL + 3
    );
    for (const batch of batches)
      expect(batch.every((nonce) => nonce >= 100) || batch.every((n) => n < 100)).toBe(true);
  });
});

describe('Claim all', () => {
  it('builds one claim per token and says how many transactions will be signed', async () => {
    state.list = [salary, bonus, other];
    const container = await showMine();
    await click('Claim all (3)');
    expect(state.claims.map((nonces) => [...nonces].sort())).toEqual(
      expect.arrayContaining([[1, 2], [4]])
    );
    expect(state.claims).toHaveLength(2);
    expect(container.textContent).toMatch(/You will sign 2 transactions/);
    expect(container.textContent).toMatch(/one per token/);
  });

  it('one token needs no words about transactions', async () => {
    state.list = [salary, bonus];
    const container = await showMine();
    await click('Claim all (2)');
    expect(state.claims).toEqual([[1, 2]]);
    expect(container.textContent).not.toMatch(/You will sign/);
  });

  it('leaves out a token this wallet is frozen for, and says why', async () => {
    state.list = [salary, bonus, evil];
    state.blocks = { 'EVIL-123456': 'frozen' };
    const container = await showMine();
    await click('Claim all (3)');
    expect(state.claims).toEqual([[1, 2]]);
    expect(container.textContent).toMatch(/Left out/);
    expect(container.textContent).toMatch(/#3/);
    expect(container.textContent).toMatch(/frozen/);
    expect(container.textContent).toMatch(/come back to the contract/);
  });

  it('leaves out a paused token', async () => {
    state.list = [salary, bonus, evil];
    state.blocks = { 'EVIL-123456': 'paused' };
    const container = await showMine();
    await click('Claim all (3)');
    expect(state.claims).toEqual([[1, 2]]);
    expect(container.textContent).toMatch(/paused/);
  });

  it('a spent key pays nothing, so it needs no check and is never left out', async () => {
    state.list = [salary, spentEvil];
    state.blocks = { 'EVIL-123456': 'frozen' };
    const container = await showMine();
    await click('Claim all (2)');
    expect(state.reads).toEqual(['FOX-a1b2c3']);
    expect(state.claims.map(([nonce]) => nonce).sort()).toEqual([1, 6]);
    expect(container.textContent).not.toMatch(/Left out/);
  });

  it('with every key blocked, offers nothing to sign', async () => {
    state.list = [
      evil,
      vesting({ id: 7, claimNonce: 7, token: 'EVIL-123456' })
    ];
    state.blocks = { 'EVIL-123456': 'frozen' };
    const container = await showMine();
    await click('Claim all (2)');
    expect(state.claims).toEqual([]);
    expect(container.textContent).not.toMatch(/Sign in your wallet/);
    expect(container.textContent).toMatch(/Left out/);
  });

  it('a failed read says so, and the key still goes alone in its own transaction', async () => {
    state.list = [salary, evil];
    state.blocks = { 'EVIL-123456': 'unread' };
    const container = await showMine();
    await click('Claim all (2)');
    expect(container.textContent).toMatch(/could not be checked/i);
    expect(container.textContent).toMatch(/EVIL/);
    expect(state.claims).toHaveLength(2);
  });
});

describe('a Claim of its own', () => {
  it('warns before signing and offers no signature until the reader insists', async () => {
    state.list = [evil];
    state.blocks = { 'EVIL-123456': 'frozen' };
    const container = await showMine();
    await click('Claim');
    expect(container.textContent).toMatch(/refused/);
    expect(container.textContent).toMatch(/come back to the contract/);
    expect(container.textContent).toMatch(/owners/);
    expect(container.textContent).not.toMatch(/Sign in your wallet/);
    expect(state.claims).toEqual([]);
    await click('Go on anyway');
    await flush();
    expect(state.claims).toEqual([[3]]);
    expect(container.textContent).toMatch(/refused/);
  });

  it('a fine token goes straight to signing', async () => {
    state.list = [salary];
    const container = await showMine();
    await click('Claim');
    expect(container.textContent).toMatch(/Sign in your wallet/);
    expect(container.textContent).not.toMatch(/refused|could not be checked/);
  });

  it('a failed read says so and offers to try again', async () => {
    state.list = [evil];
    state.blocks = { 'EVIL-123456': 'unread' };
    const container = await showMine();
    await click('Claim');
    expect(container.textContent).toMatch(/could not be checked/i);
    state.blocks = {};
    await click('Try again');
    expect(container.textContent).not.toMatch(/could not be checked/i);
  });
});

describe('the Vesting page', () => {
  it('a Claim warns when the token cannot reach this wallet', async () => {
    state.one = evil;
    state.blocks = { 'EVIL-123456': 'frozen' };
    const container = await showVesting();
    await click('Claim');
    expect(container.textContent).toMatch(/come back to the contract/);
    expect(container.textContent).not.toMatch(/Sign in your wallet/);
    await click('Go on anyway');
    expect(container.textContent).toMatch(/Sign in your wallet/);
  });

  it('a Cancel that pays the wallet warns too', async () => {
    state.one = cancelable;
    state.blocks = { 'FOX-a1b2c3': 'frozen' };
    const container = await showVesting();
    await click('Cancel this vesting');
    expect(container.textContent).toMatch(/refund would be refused/);
    expect(container.textContent).toMatch(/come back to the contract/);
    expect(container.textContent).not.toMatch(/Sign in your wallet/);
  });

  it('a Cancel that pays nothing reads nothing', async () => {
    state.one = { ...cancelable, vested: 1_000n };
    state.blocks = { 'FOX-a1b2c3': 'frozen' };
    const container = await showVesting();
    await click('Cancel this vesting');
    expect(state.reads).toEqual([]);
    expect(container.textContent).toMatch(/Sign in your wallet/);
  });

  it('a failed read says so', async () => {
    state.one = cancelable;
    state.blocks = { 'FOX-a1b2c3': 'unread' };
    const container = await showVesting();
    await click('Claim');
    expect(container.textContent).toMatch(/could not be checked/i);
  });
});

describe('Created by me', () => {
  it('a Cancel warns when the refund cannot reach this wallet', async () => {
    state.list = [cancelable];
    state.blocks = { 'FOX-a1b2c3': 'paused' };
    const shown = render(
      <MemoryRouter>
        <Created />
      </MemoryRouter>
    );
    await flush();
    await click('Cancel');
    expect(shown.container.textContent).toMatch(/refund would be refused/);
    expect(shown.container.textContent).not.toMatch(/Sign in your wallet/);
  });
});
