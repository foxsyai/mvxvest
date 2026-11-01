// Fifth audit, RT-1, layer 3, and the same bounce at `create` (a parallel
// review's addition): what the site says once it has happened. A person whose
// key came back must see the truth: the contract holds it, the money is safe,
// only the owners' multisig can send it back and how to reach them. A creator
// whose vesting exists must not be invited to create it again.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TxPanel } from 'components/tx/TxPanel';
import { Create } from '../Create';
import { Guide } from '../Guide';
import { Mine } from '../Mine';
import { VestingPage } from '../Vesting';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const TOKEN = 'TFOX-d61b09';
const T = 1_767_225_600;

const sendMock = jest.fn();
const createdIdsMock = jest.fn();
const payoutsMock = jest.fn();

const chain = {
  outcome: { status: 'pending' } as Record<string, unknown>,
  claimHolder: A as string | null,
  history: [] as unknown[],
  refused: (async () => []) as () => Promise<unknown[]>,
  vesting: {} as Record<string, unknown>
};

// The devnet config, whichever network's config was copied last: deploy.sh runs
// this suite against the network's own.
jest.mock('config', () => jest.requireActual('config/config.devnet'));

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[]) => ({
    transactions: txs,
    problems: txs.map(() => null)
  }),
  send: (...args: unknown[]) => sendMock(...args)
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
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
      balance: 1_500n * 10n ** 18n
    }
  ],
  tokenInfo: async (identifier: string) => ({
    identifier,
    ticker: identifier.split('-')[0],
    name: identifier,
    decimals: 0,
    verified: true
  }),
  createdIdsOf: (hash: string) => createdIdsMock(hash),
  payoutsOf: (...args: unknown[]) => payoutsMock(...args),
  outcomeOf: async () => chain.outcome,
  keyHolder: async (collection: string) =>
    collection.startsWith('VESTKEY') ? chain.claimHolder : null,
  keysCount: async () => 0,
  historyOf: async () => chain.history,
  refusedPayouts: () => chain.refused(),
  payoutBlock: async () => null
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => 10,
    creationPaused: async () => false,
    isKeyStamping: async () => true,
    deficit: async () => 0n,
    limits: async () => ({
      maxBatch: 49,
      maxBatchCancelable: 32,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    }),
    vesting: async () => chain.vesting,
    create: async (sender: string) =>
      ({ sender, data: new Uint8Array(100), gasLimit: 50_000_000n }) as any,
    createBatch: async (sender: string) =>
      ({ sender, data: new Uint8Array(100), gasLimit: 50_000_000n }) as any
  }
}));
jest.mock('chain/mine', () => ({ claimableVestings: async () => [] }));

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  chain.outcome = { status: 'pending' };
  chain.claimHolder = A;
  chain.history = [];
  chain.refused = async () => [];
  chain.vesting = {
    id: 7,
    creator: A,
    beneficiary: A,
    token: TOKEN,
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
    claimNonce: 7,
    cancelNonce: 0,
    label: '',
    claimed: 500n,
    cancelledAt: 0,
    vested: 500n,
    claimable: 0n,
    finalAmount: 1_000n,
    refunded: 0n,
    timestamp: T + 500
  };
  sendMock.mockReset();
  sendMock.mockResolvedValue({ hashes: ['hash-1'] });
  createdIdsMock.mockReset();
  payoutsMock.mockReset();
  payoutsMock.mockResolvedValue([]);
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const signPanel = async (extra: Record<string, unknown> = {}) => {
  const shown = render(
    <MemoryRouter>
      <TxPanel
        showPayouts
        sender={A}
        label='Claim'
        summary='Claims'
        build={async () => [{ data: new Uint8Array(0), gasLimit: 0n } as any]}
        onClose={() => undefined}
        {...extra}
      />
    </MemoryRouter>
  );
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  return shown.container;
};

describe('the signing panel after a bounce', () => {
  it('a claim: nothing arrived, the contract holds it, only the owners can send it back and how to ask', async () => {
    chain.outcome = {
      status: 'fail',
      bounced: 'claimed',
      reason: 'account is frozen for this esdt token for token DUST-959a75',
      refusal: {
        tokens: [
          { token: 'TFOX-d61b09', ids: [739] },
          { token: 'DUST-959a75', ids: [740] }
        ],
        keys: [{ collection: 'VESTKEY-8f217c', nonce: 739 }],
        paid: []
      }
    };
    const container = await signPanel();
    const text = container.textContent ?? '';
    expect(text).toMatch(/No tokens reached this wallet/);
    expect(text).toMatch(/held by the contract/);
    expect(text).toMatch(/safe/);
    expect(text).toMatch(/only the owners' multisig can send/i);
    expect(text).toMatch(/frozen/);
    expect(
      screen.getByRole('link', { name: /issue/ }).getAttribute('href')
    ).toMatch(/github\.com\/foxsyai\/mvxvest\/issues$/);
    expect(text).not.toMatch(/Received in this wallet/);
  });

  it('a cancel: stopped, and the refund is what came back', async () => {
    chain.outcome = {
      status: 'fail',
      bounced: 'cancelled',
      reason: 'frozen',
      refusal: {
        tokens: [{ token: 'TFOX-d61b09', ids: [7] }],
        keys: [],
        paid: []
      }
    };
    const container = await signPanel({ label: 'Cancel' });
    const text = container.textContent ?? '';
    expect(text).toMatch(/is cancelled/);
    expect(text).toMatch(/refund/);
    expect(text).toMatch(/held by the contract/);
  });

  it('a plain failure says nothing of the kind', async () => {
    chain.outcome = { status: 'fail', reason: 'frozen' };
    const container = await signPanel();
    const text = container.textContent ?? '';
    expect(text).toMatch(/failed: frozen/);
    expect(text).not.toMatch(/held by the contract/);
  });
});

describe('Create after a key bounced', () => {
  const createOne = async () => {
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: TOKEN }
    });
    fireEvent.change(
      screen.getByPlaceholderText('erd1... beneficiary address'),
      { target: { value: A } }
    );
    fireEvent.change(screen.getByPlaceholderText(/^Amount/), {
      target: { value: '1000' }
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    await flush();
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();
  };

  it('counts it as created, never offers to sign it again and says where the key is', async () => {
    chain.outcome = {
      status: 'fail',
      bounced: 'created',
      reason: 'sending value to non payable contract'
    };
    createdIdsMock.mockResolvedValue([101]);
    await createOne();
    await wait(50);
    await flush();

    expect(screen.getByText(/Created 1 vesting/)).toBeTruthy();
    expect(screen.queryByText(/Sign the remaining/)).toBeNull();
    expect(screen.queryByText(/created nothing/)).toBeNull();
    expect(screen.queryByText(/lines not created/)).toBeNull();
    const line = screen.getByText(/Transaction 1:/).parentElement!.textContent;
    expect(line).not.toMatch(/failed/);
    expect(line).toMatch(/created/);
    expect(document.body.textContent).toMatch(/Do not create/);
    expect(document.body.textContent).toMatch(/held by the contract/);
  });

  it('a plain failure can still be signed again', async () => {
    chain.outcome = { status: 'fail', reason: 'insufficient funds' };
    createdIdsMock.mockResolvedValue([]);
    await createOne();
    await wait(50);
    await flush();
    expect(screen.getByText(/Sign the remaining 1/)).toBeTruthy();
  });
});

const showVesting = async () => {
  const shown = render(
    <MemoryRouter initialEntries={['/v/7']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  return shown.container;
};

describe('the Vesting page', () => {
  it('a claim key the contract holds: the truth, at the top, and how to reach the owners', async () => {
    chain.claimHolder = CONTRACT;
    const container = await showVesting();
    const text = container.textContent ?? '';
    expect(text).toMatch(/The contract itself holds this claim key/);
    expect(text).toMatch(/safe/);
    expect(text).toMatch(/only the owners' multisig/i);
    expect(
      screen.getByRole('link', { name: /issue/ }).getAttribute('href')
    ).toMatch(/\/issues$/);
    // Not only a smart contract: a wallet can refuse a payout too.
    expect(text).toMatch(/wallet/);
  });

  const claimedEvent = (refused: boolean | null) => ({
    kind: 'claimed',
    txHash: 'h1',
    timestamp: T + 1,
    address: A,
    amount: 500n,
    refused
  });

  it('a claim that was refused is not called claimed, in its history or at the top', async () => {
    chain.history = [claimedEvent(true)];
    chain.claimHolder = null;
    const container = await showVesting();
    const text = container.textContent ?? '';
    expect(text).toMatch(/refused at the wallet/);
    expect(text).toMatch(/500\s*TFOX of what this page counts as claimed/);
    expect(text).toMatch(/never reached/);
  });

  it('a history it could not check says so', async () => {
    chain.history = [claimedEvent(null)];
    const container = await showVesting();
    expect(container.textContent).toMatch(/not checked whether it arrived/);
  });

  it('a claim that arrived says nothing more', async () => {
    chain.history = [claimedEvent(false)];
    const container = await showVesting();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/refused|not checked|counts as claimed/);
  });

  it('a refund that was refused is not said to have gone back', async () => {
    chain.vesting = {
      ...chain.vesting,
      cancelable: true,
      cancelledAt: T + 5,
      refunded: 500n,
      finalAmount: 500n
    };
    chain.history = [{ ...claimedEvent(true), kind: 'cancelled' }];
    const container = await showVesting();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/went back to whoever cancelled/);
    expect(text).toMatch(/refund was refused/i);
  });
});

describe('My vestings, afterwards', () => {
  const showMine = async () => {
    const shown = render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    return shown.container;
  };

  it('a key that left this wallet in a refused claim does not vanish without a word', async () => {
    chain.refused = async () => [
      {
        txHash: 'h1',
        timestamp: T,
        kind: 'claimed',
        tokens: [
          { token: 'TFOX-d61b09', ids: [739] },
          { token: 'DUST-959a75', ids: [740] }
        ],
        keys: [{ nonce: 739, held: true }],
        ids: [739, 740]
      }
    ];
    const container = await showMine();
    const text = container.textContent ?? '';
    expect(text).toMatch(/#739/);
    expect(text).toMatch(/#740/);
    expect(text).toMatch(/held by the contract/);
    expect(
      screen.getByRole('link', { name: /issue/ }).getAttribute('href')
    ).toMatch(/\/issues$/);
  });

  it('nothing refused, nothing said', async () => {
    const container = await showMine();
    expect(container.textContent).not.toMatch(/held by the contract|refused/);
  });

  it('a failed read says so', async () => {
    chain.refused = async () => {
      throw new Error('502');
    };
    const container = await showMine();
    expect(container.textContent).toMatch(/could not be checked/i);
  });
});

describe('what the guides promise', () => {
  it('the guide says Claim all goes token by token, and what a frozen wallet means', async () => {
    const shown = render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    await flush();
    const text = shown.container.textContent ?? '';
    expect(text).not.toMatch(/Claim all takes it from every key at once/);
    expect(text).toMatch(/one transaction per token/);
    expect(text).toMatch(/frozen for your wallet/);
    expect(text).toMatch(/only the owner multisig can send/i);
  });

  it('the beneficiary guide says the same', () => {
    const html = readFileSync(
      join(__dirname, '../../../docs/beneficiary-guide.html'),
      'utf8'
    ).replace(/\s+/g, ' ');
    expect(html).not.toMatch(/collects from every vesting at once/);
    expect(html).toMatch(/one transaction per token/);
    expect(html).toMatch(/frozen for your wallet/);
  });
});
