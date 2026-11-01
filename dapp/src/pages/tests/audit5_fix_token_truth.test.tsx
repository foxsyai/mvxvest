// Fifth audit, RT-2 and RT-3 in the fixer's words: what the red team's proofs
// leave open. "cancelable" alone would satisfy RT-2's proof, so this pins the
// sum and the marks. RT-3's proof pins the danger words, so this pins that the
// figures go, that a buyer is told and that a failed read never reads as fine.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VestingClient } from 'vesting/client';
import { Token } from '../Token';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const TEAM = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';

const base = {
  creator: TEAM,
  beneficiary: TEAM,
  token: 'FOXSY-5d5f3e',
  total: 1_000n,
  schedule: {
    start: T,
    cliff: T,
    cliffAmount: 0n,
    end: T + 730 * 86_400,
    curve: { kind: 'stepped', interval: 30 * 86_400 }
  },
  createdAt: T,
  label: '',
  claimed: 0n,
  cancelledAt: 0,
  finalAmount: 1_000n,
  refunded: 0n,
  timestamp: T + 86_400
};
// 300 can still be pulled back, 2,000 cannot, and the cancelled one no longer.
const pullable = {
  ...base,
  id: 1,
  claimNonce: 1,
  cancelNonce: 1,
  cancelable: true,
  vested: 700n,
  claimable: 700n
};
const firm = {
  ...base,
  id: 2,
  claimNonce: 2,
  cancelNonce: 0,
  cancelable: false,
  total: 2_000n,
  finalAmount: 2_000n,
  vested: 0n,
  claimable: 0n
};
const cancelled = {
  ...base,
  id: 3,
  claimNonce: 3,
  cancelNonce: 3,
  cancelable: true,
  cancelledAt: T + 10,
  vested: 100n,
  claimable: 100n,
  finalAmount: 100n,
  refunded: 900n
};

const state: {
  list: unknown[];
  count?: number;
  deficit: () => Promise<bigint | null>;
} = { list: [], deficit: async () => 0n };

jest.mock('config', () => ({
  get contractAddress() {
    return 'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
  },
  get keyCollections() {
    return { claim: 'VESTKEY-f56bea', cancel: 'VESTCANCEL-ae94f5' };
  }
}));
jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'Foxsy',
    decimals: 0,
    verified: true
  }),
  historyOf: async () => [],
  keyHolder: async () =>
    'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => state.list[0],
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    isKeyStamping: async () => true,
    tokenTotals: async () => ({ deposited: 4_000n, claimed: 0n, refunded: 0n }),
    deficit: () => state.deficit()
  }
}));
jest.mock('chain/mine', () => ({
  tokenVestings: async () => ({
    list: state.list,
    count: state.count ?? state.list.length
  })
}));

const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};
const showToken = async () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/t/FOXSY-5d5f3e']}>
      <Routes>
        <Route path='/t/:token' element={<Token />} />
      </Routes>
    </MemoryRouter>
  );
  await settle();
  return container;
};
const showVesting = async () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/v/1']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await settle();
  return container;
};
const factOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('dt')].find((dt) => dt.textContent === label)
    ?.nextSibling?.textContent ?? '';

beforeEach(() => {
  state.list = [pullable, firm, cancelled];
  state.count = undefined;
  state.deficit = async () => 0n;
});

describe('RT-2: a lock that can be undone on the Token page', () => {
  it('says how much can still be pulled back: the cancelable and running ones, total less vested', async () => {
    const container = await showToken();
    expect(factOf(container, 'Still in the contract')).toMatch(
      /300\s*FOXSY can still be pulled back by cancel key holders/
    );
  });

  it('marks each cancelable row, and only those', async () => {
    const container = await showToken();
    const row = (id: number) =>
      [...container.querySelectorAll('tbody tr')].find((tr) =>
        tr.textContent?.startsWith(`#${id}`)
      )?.textContent ?? '';
    expect(row(1)).toMatch(/cancelable/);
    expect(row(2)).not.toMatch(/cancelable/);
    expect(row(3)).not.toMatch(/cancelable/);
  });

  it('the calendar does not read as a promise', async () => {
    await showToken();
    expect(
      screen.getByText(/this calendar counts .* as if it will vest/i)
    ).toBeTruthy();
  });

  it('a lock nobody can undo carries none of it', async () => {
    state.list = [firm];
    const container = await showToken();
    expect(container.textContent).not.toMatch(/cancelable|pulled back/);
  });

  it('with more vestings than are read, the sum is a lower bound', async () => {
    state.count = 5_000;
    const container = await showToken();
    expect(factOf(container, 'Still in the contract')).toMatch(
      /at least 300\s*FOXSY can still be pulled back/
    );
  });
});

describe('RT-3: the contract holds less than it owes', () => {
  beforeEach(() => {
    state.deficit = async () => 1_500n;
  });

  it('the Token page replaces the lock figure and names the shortfall', async () => {
    const container = await showToken();
    expect(factOf(container, 'Still in the contract')).not.toMatch(/4,000/);
    expect(container.textContent).toMatch(
      /holds 1,500\s*FOXSY less than it owes/
    );
  });

  it('the Vesting page replaces the claimable figures and tells a buyer of the key', async () => {
    const container = await showVesting();
    expect(factOf(container, 'Claimable now')).not.toMatch(/700/);
    expect(container.textContent).not.toMatch(/700 claimable/);
    expect(container.textContent).toMatch(
      /holds 1,500\s*FOXSY less than it owes/
    );
    expect(container.textContent).toMatch(
      /Before you buy its claim key: it may pay nothing now/
    );
  });

  it('nothing is said when the books balance', async () => {
    state.deficit = async () => 0n;
    const container = await showVesting();
    expect(container.textContent).not.toMatch(/less than it owes|be checked/);
    expect(factOf(container, 'Claimable now')).toMatch(/700/);
  });

  it('nothing is said when the contract has no such view', async () => {
    state.deficit = async () => null;
    const container = await showToken();
    expect(container.textContent).not.toMatch(/less than it owes|be checked/);
    expect(factOf(container, 'Still in the contract')).toMatch(/4,000/);
  });

  it.each([
    ['Token', showToken],
    ['Vesting', showVesting]
  ])(
    'a failed read on the %s page says it could not be checked',
    async (_page, show) => {
      state.deficit = async () => {
        throw new Error('502');
      };
      const container = await show();
      expect(container.textContent).toMatch(
        /could not be checked whether the contract still holds/i
      );
    }
  );
});

describe('client.deficit', () => {
  const client = (query: (args: any) => Promise<unknown[]>) => {
    const made = new VestingClient(
      'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
      {} as any,
      'D'
    );
    (made as any).controller = { query };
    return made;
  };

  it('reads getDeficit for the token', async () => {
    const query = jest.fn(async () => [5n]);
    await expect(client(query).deficit('FOXSY-5d5f3e')).resolves.toBe(5n);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        function: 'getDeficit',
        arguments: ['FOXSY-5d5f3e']
      })
    );
  });

  it('is null when the view is missing, as isKeyStamping', async () => {
    const query = async () => {
      throw new Error('invalid function (not found)');
    };
    await expect(client(query).deficit('FOXSY-5d5f3e')).resolves.toBeNull();
  });

  it('throws any other failure, even one that names the view', async () => {
    const query = async () => {
      throw new Error('getDeficit timed out');
    };
    await expect(client(query).deficit('FOXSY-5d5f3e')).rejects.toThrow(
      /timed out/
    );
  });
});
