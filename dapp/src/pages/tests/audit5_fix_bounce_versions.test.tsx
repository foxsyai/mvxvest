// Fifth audit, RT-1, what the site says after a bounce, on both contracts. The
// two fixtures are real devnet transactions read from the API, trimmed to their
// logs, and both have the API's status `fail`:
//
//  - version 3 (mainnet today), f17518c5...: one transfer carried everything,
//    so TFOX, DUST and the real claim key all came back to the contract. The
//    owners have since sent the key back.
//  - version 4 (devnet), 55b87d97...: one transfer per token and one for the
//    keys. The wallet received 50.02 TFOX and kept the real key; only 1 DUST
//    came back, and the dust key was burned because it had finished.
//
// The site must not ask which version it runs: the results show what came back.
// The single token case on version 4 is what the site itself sends: its fixture
// is a real devnet transaction too, a frozen wallet claiming one key.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import single from 'chain/tests/fixtures/audit5-bounced-claim-v4-single.json';
import v4 from 'chain/tests/fixtures/audit5-bounced-claim-v4.json';
import v3 from 'chain/tests/fixtures/audit5-bounced-claim.json';
import { TxPanel } from 'components/tx/TxPanel';
import { PayoutGate } from 'components/vesting/PayoutCheck';
import { Guide } from '../Guide';
import { Mine } from '../Mine';
import { VestingPage } from '../Vesting';

const WALLET = v4.sender;
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const chain = {
  outcomeHash: v4.txHash,
  txs: {} as Record<string, any>,
  /** Who holds a key, by its identifier; none: burned. */
  holders: {} as Record<string, string>,
  holdersFail: false,
  vesting: {} as Record<string, unknown>
};

const hexOf = (base64: string) => Buffer.from(base64, 'base64').toString('hex');

const allEvents = (tx: any) => [
  ...tx.logs.events,
  ...tx.results.flatMap((result: any) => result.logs?.events ?? [])
];

const tokenInfo = (id: string) => ({
  identifier: id,
  ticker: id.split('-')[0],
  name: id,
  decimals: 18,
  assets: {}
});

const answer = (path: string): unknown => {
  if (path.startsWith('/tokens/')) return tokenInfo(path.split('/')[2]);
  if (path.startsWith('/nfts/')) {
    if (chain.holdersFail) throw new Error('502');
    const holder = chain.holders[path.split('/')[2]];
    if (!holder) throw Object.assign(new Error('404'), { status: 404 });
    return { owner: holder };
  }
  if (path.startsWith('/accounts/') && path.includes('/transactions'))
    return Object.values(chain.txs);
  if (path.startsWith('/accounts/')) return [];
  if (path.startsWith('/transactions?hashes='))
    return Object.values(chain.txs).map(({ txHash, status }) => ({
      txHash,
      status
    }));
  if (path.startsWith('/transactions/'))
    return chain.txs[path.split('/')[2].split('?')[0]];
  if (path.startsWith('/events')) {
    const identifier = /identifier=(\w+)/.exec(path)?.[1];
    const topic = /topics=(\w+)/.exec(path)?.[1];
    return Object.values(chain.txs).flatMap((tx: any) =>
      allEvents(tx)
        .filter(
          (event: any) =>
            event.identifier === identifier &&
            hexOf(event.topics[1]) === topic &&
            event.address === CONTRACT
        )
        .map((event: any) => ({
          identifier,
          txHash: tx.txHash,
          timestamp: tx.timestamp,
          topics: event.topics.map(hexOf),
          data: hexOf(event.data)
        }))
    );
  }
  return [];
};

jest.mock('config', () => jest.requireActual('config/config.devnet'));
jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com',
  api: async (path: string) => answer(path),
  fresh: async (path: string) => {
    const hash = path.split('/transactions/')[1]?.split('?')[0];
    const tx = hash === 'sent' ? chain.txs[chain.outcomeHash] : chain.txs[hash];
    return { ok: Boolean(tx), status: tx ? 200 : 404, json: async () => tx };
  },
  freshGateway: async () => ({ ok: false, status: 502, json: async () => ({}) })
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
  send: async () => ({ hashes: ['sent'] })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    }),
    vesting: async () => chain.vesting,
    vestings: async () => [],
    isKeyStamping: async () => true,
    deficit: async () => 0n
  }
}));
jest.mock('chain/mine', () => ({ claimableVestings: async () => [] }));

const flush = async () => {
  for (let i = 0; i < 14; i++) await act(async () => undefined);
};

beforeEach(() => {
  chain.txs = { [v3.txHash]: v3, [v4.txHash]: v4, [single.txHash]: single };
  chain.outcomeHash = v4.txHash;
  chain.holdersFail = false;
  chain.holders = {
    'VESTKEY-8f217c-02e3': WALLET,
    'VESTKEY-8f217c-02e5': WALLET
  };
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const panelText = async (hash: string) => {
  chain.outcomeHash = hash;
  const shown = render(
    <MemoryRouter>
      <TxPanel
        showPayouts
        sender={WALLET}
        label='Claim'
        summary='Claims'
        build={async () => [{ data: new Uint8Array(0), gasLimit: 0n } as any]}
        onClose={() => undefined}
      />
    </MemoryRouter>
  );
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
  return (shown.container.textContent ?? '').replace(/\s+/g, ' ');
};

describe('the signing panel', () => {
  it('version 4: what arrived is said to have arrived, only the refused token is held, no key is', async () => {
    const text = await panelText(v4.txHash);
    expect(text).toMatch(/Received in this wallet: 50\.0\d*\s*TFOX/);
    expect(text).toMatch(/DUST-959a75/);
    expect(text).toMatch(/held by the contract/);
    expect(text).not.toMatch(/Nothing reached|No tokens reached/);
    expect(text).not.toMatch(/claim key #/);
    expect(text).toMatch(/No claim key came back to the contract/);
  });

  it('version 3: everything came back, the key included', async () => {
    const text = await panelText(v3.txHash);
    expect(text).toMatch(/No tokens reached this wallet/);
    expect(text).toMatch(/TFOX-d61b09/);
    expect(text).toMatch(/DUST-959a75/);
    expect(text).toMatch(/claim key #739 came back/);
    expect(text).not.toMatch(/Received in this wallet/);
  });

  it('version 4, one token: the payout came back and the key did not', async () => {
    const text = await panelText(single.txHash);
    expect(text).toMatch(/No tokens reached this wallet/);
    expect(text).toMatch(/No claim key came back to the contract/);
    expect(text).not.toMatch(/claim key #/);
    expect(text).not.toMatch(/Received in this wallet/);
  });

  it('a failure whose results do not show what came back says it cannot say', async () => {
    chain.txs.unclear = {
      ...v4,
      txHash: 'unclear',
      results: v4.results.map((result: any) => ({
        ...result,
        returnMessage: undefined
      }))
    };
    const text = await panelText('unclear');
    expect(text).toMatch(/the transaction shows which/i);
    expect(text).not.toMatch(/No tokens reached|No claim key|Received in/);
  });
});

const showMine = async () => {
  const shown = render(
    <MemoryRouter>
      <Mine />
    </MemoryRouter>
  );
  await flush();
  return (shown.container.textContent ?? '').replace(/\s+/g, ' ');
};

describe('My vestings, afterwards', () => {
  it('version 4: lists the vesting whose payout was refused, not the one that was paid', async () => {
    chain.txs = { [v4.txHash]: v4 };
    const text = await showMine();
    expect(text).toMatch(/#742/);
    expect(text).toMatch(/DUST-959a75/);
    expect(text).not.toMatch(/#741/);
    expect(text).not.toMatch(/claim key #|any key due back/);
  });

  it('version 3: lists both vestings; the owners have returned the key, so it is not called held', async () => {
    chain.txs = { [v3.txHash]: v3 };
    const text = await showMine();
    expect(text).toMatch(/#739/);
    expect(text).toMatch(/#740/);
    expect(text).toMatch(/unless the owners have sent/i);
    expect(text).not.toMatch(/claim key #739/);
  });

  it('version 3, with the key still at the contract: says so', async () => {
    chain.txs = { [v3.txHash]: v3 };
    chain.holders['VESTKEY-8f217c-02e3'] = CONTRACT;
    const text = await showMine();
    expect(text).toMatch(/claim key #739 is held by the contract/);
  });

  it('a key whose holder could not be read is never called safe or held', async () => {
    chain.txs = { [v3.txHash]: v3 };
    chain.holdersFail = true;
    const text = await showMine();
    expect(text).toMatch(/claim key #739 came back and may still be held/);
  });
});

const base = {
  creator: WALLET,
  beneficiary: WALLET,
  total: 1_000n,
  schedule: {
    start: 1,
    cliff: 1,
    cliffAmount: 0n,
    end: 1_000,
    curve: { kind: 'stepped', interval: 100 }
  },
  cancelable: false,
  createdAt: 1,
  cancelNonce: 0,
  label: '',
  claimed: 500n,
  cancelledAt: 0,
  vested: 500n,
  claimable: 0n,
  finalAmount: 1_000n,
  refunded: 0n,
  timestamp: 500
};

const showVesting = async (id: number, token: string) => {
  chain.vesting = { ...base, id, token, claimNonce: id };
  const shown = render(
    <MemoryRouter initialEntries={[`/v/${id}`]}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  return (shown.container.textContent ?? '').replace(/\s+/g, ' ');
};

describe('the Vesting page', () => {
  it('version 4: the vesting that was paid says nothing of a refusal, though its transaction failed', async () => {
    chain.txs = { [v4.txHash]: v4 };
    const text = await showVesting(741, 'TFOX-d61b09');
    expect(text).not.toMatch(/refused|never reached|not checked/);
    expect(text).toMatch(/Claimed/);
    expect(text).not.toMatch(/The contract itself holds/);
  });

  it('version 4: the vesting whose token came back says so', async () => {
    chain.txs = { [v4.txHash]: v4 };
    const text = await showVesting(742, 'DUST-959a75');
    expect(text).toMatch(/refused at the wallet/);
    expect(text).toMatch(/never reached/);
    expect(text).not.toMatch(/The contract itself holds/);
  });

  it('version 4, one token: the key is in the wallet, and nothing says it is lost', async () => {
    chain.txs = { [single.txHash]: single };
    chain.holders['VESTKEY-8f217c-02e7'] = WALLET;
    const text = await showVesting(743, 'DUST-959a75');
    expect(text).toMatch(/never reached/);
    expect(text).not.toMatch(
      /The contract itself holds|key .*held|key .*lost/i
    );
  });

  it('version 3: the same words, the key since returned', async () => {
    chain.txs = { [v3.txHash]: v3 };
    const text = await showVesting(739, 'TFOX-d61b09');
    expect(text).toMatch(/never reached/);
    expect(text).toMatch(/unless the owners have sent/i);
    expect(text).not.toMatch(/The contract itself holds/);
  });

  it('version 3, the key still at the contract', async () => {
    chain.txs = { [v3.txHash]: v3 };
    chain.holders['VESTKEY-8f217c-02e3'] = CONTRACT;
    const text = await showVesting(739, 'TFOX-d61b09');
    expect(text).toMatch(/The contract itself holds this claim key/);
  });
});

describe('the words before signing, on both versions', () => {
  const warning = (block: 'frozen' | 'paused', action: 'claim' | 'cancel') => {
    const { container } = render(
      <PayoutGate
        check={{ 'X-111111': block }}
        token='X-111111'
        action={action}
        retry={() => undefined}
        busy={false}
        onClose={() => undefined}
      >
        panel
      </PayoutGate>
    );
    return (container.textContent ?? '').replace(/\s+/g, ' ');
  };

  it('a claim: the tokens could come back and the key stays (version 4, mainnet since 1 Nov 2026)', () => {
    const text = warning('frozen', 'claim');
    expect(text).toMatch(/tokens could come back to the contract/);
    expect(text).toMatch(/claim key stays in your wallet/);
    expect(text).not.toMatch(/perhaps with the claim key/);
    expect(text).not.toMatch(/the tokens and the claim key/);
  });

  it('the guide does not say the key comes back for certain', async () => {
    const { container } = render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    await flush();
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).not.toMatch(/what it paid and the claim key can come back/);
    expect(text).toMatch(/claim key stays in your wallet/);
    expect(text).not.toMatch(/perhaps with the claim key/);
  });

  it('nor does the guide for beneficiaries', () => {
    const html = readFileSync(
      join(__dirname, '../../../docs/beneficiary-guide.html'),
      'utf8'
    ).replace(/\s+/g, ' ');
    expect(html).not.toMatch(/send your tokens and key back/);
    expect(html).toMatch(/claim key stays in your wallet/);
    expect(html).not.toMatch(/perhaps with the claim key/);
  });
});
