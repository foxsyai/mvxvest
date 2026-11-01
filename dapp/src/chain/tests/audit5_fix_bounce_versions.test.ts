// Fifth audit, RT-1, the reads on both contracts: what came back is worked out
// per token from the transfer that bounced, never assumed for every vesting of a
// failed transaction. The fixtures are real devnet transactions, all `fail`:
// version 3's everything came back; version 4's only 1 DUST did, and the wallet
// received its 50.02 TFOX and kept its key.

import { historyOf, outcomeOf, payoutsOf, refusedPayouts } from '../reads';
import single from './fixtures/audit5-bounced-claim-v4-single.json';
import v4 from './fixtures/audit5-bounced-claim-v4.json';
import v3 from './fixtures/audit5-bounced-claim.json';

jest.mock('config', () => jest.requireActual('config/config.devnet'));

const WALLET = v4.sender;
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const COLLECTION = 'VESTKEY-8f217c';

const net = {
  txs: {} as Record<string, any>,
  holders: {} as Record<string, string>,
  holdersFail: false,
  detailsFail: false
};

const hexOf = (base64: string) => Buffer.from(base64, 'base64').toString('hex');
const allEvents = (tx: any) => [
  ...tx.logs.events,
  ...tx.results.flatMap((result: any) => result.logs.events)
];

jest.mock('../network', () => ({
  fresh: async (path: string) => {
    const tx = net.txs[path.split('/transactions/')[1].split('?')[0]];
    return { ok: Boolean(tx), status: tx ? 200 : 404, json: async () => tx };
  },
  api: async (path: string) => {
    if (path.startsWith('/nfts/')) {
      if (net.holdersFail) throw new Error('502');
      const holder = net.holders[path.split('/')[2]];
      if (!holder) throw Object.assign(new Error('404'), { status: 404 });
      return { owner: holder };
    }
    if (path.startsWith('/accounts/')) return Object.values(net.txs);
    if (path.startsWith('/transactions?hashes='))
      return Object.values(net.txs).map(({ txHash, status }) => ({
        txHash,
        status
      }));
    if (path.startsWith('/transactions/')) {
      if (net.detailsFail) throw new Error('502');
      return net.txs[path.split('/')[2].split('?')[0]];
    }
    const identifier = /identifier=(\w+)/.exec(path)?.[1];
    const topic = /topics=(\w+)/.exec(path)?.[1];
    return Object.values(net.txs).flatMap((tx: any) =>
      allEvents(tx)
        .filter(
          (event: any) =>
            event.identifier === identifier &&
            event.address === CONTRACT &&
            hexOf(event.topics[1]) === topic
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
}));

beforeEach(() => {
  net.txs = { [v3.txHash]: v3, [v4.txHash]: v4 };
  net.holders = {};
  net.holdersFail = false;
  net.detailsFail = false;
});

describe('outcomeOf', () => {
  it('version 4, one token, a real transaction: the payout came back and the key did not', async () => {
    net.txs = { [single.txHash]: single };
    const outcome = await outcomeOf(single.txHash);
    expect(outcome.status).toBe('fail');
    expect(outcome.bounced).toBe('claimed');
    expect(outcome.refusal).toEqual({
      tokens: [{ token: 'DUST-959a75', ids: [743] }],
      keys: [],
      paid: []
    });
  });

  it('version 4: only the token that came back is refused, and no key', async () => {
    const outcome = await outcomeOf(v4.txHash);
    expect(outcome.status).toBe('fail');
    expect(outcome.bounced).toBe('claimed');
    expect(outcome.refusal).toEqual({
      tokens: [{ token: 'DUST-959a75', ids: [742] }],
      keys: [],
      paid: [{ token: 'TFOX-d61b09', ids: [741] }]
    });
  });

  it('version 3: every token came back, and the key that was due back', async () => {
    const outcome = await outcomeOf(v3.txHash);
    expect(outcome.refusal).toEqual({
      tokens: [
        { token: 'TFOX-d61b09', ids: [739] },
        { token: 'DUST-959a75', ids: [740] }
      ],
      keys: [{ collection: COLLECTION, nonce: 739 }],
      paid: []
    });
  });

  it('no refusal is made up when the results do not show what came back', async () => {
    net.txs.unclear = {
      ...v4,
      results: v4.results.map((result: any) => ({
        ...result,
        returnMessage: undefined
      }))
    };
    const outcome = await outcomeOf('unclear');
    expect(outcome.bounced).toBe('claimed');
    expect(outcome.refusal).toBeUndefined();
  });
});

describe('payoutsOf', () => {
  const amounts = (payouts: Awaited<ReturnType<typeof payoutsOf>>) =>
    payouts.map(({ token, claimed }) => [token, String(claimed)]);

  it('version 4: reports the real payout, and not the one that came back', async () => {
    const paid = await payoutsOf([v4.txHash], WALLET);
    expect(amounts(paid)).toEqual([
      ['TFOX-d61b09', String(BigInt('0x02b63c1730cb2d997b'))]
    ]);
  });

  it('version 3: nothing was paid', async () => {
    const paid = await payoutsOf([v3.txHash], WALLET);
    expect(amounts(paid)).toEqual([]);
  });

  it('a failure whose results do not show what came back is not reported as paid', async () => {
    net.txs.unclear = {
      ...v4,
      results: v4.results.map((result: any) => ({
        ...result,
        returnMessage: undefined
      }))
    };
    expect(amounts(await payoutsOf(['unclear'], WALLET))).toEqual([]);
  });
});

describe('historyOf', () => {
  const refusedOf = async (id: number) =>
    (await historyOf(id)).map((event) => event.refused);

  it('version 4: the vesting that was paid is not refused, though its transaction failed', async () => {
    expect(await refusedOf(741)).toEqual([false]);
  });

  it('version 4: the vesting whose token came back is', async () => {
    expect(await refusedOf(742)).toEqual([true]);
  });

  it('version 3: both are', async () => {
    expect(await refusedOf(739)).toEqual([true]);
    expect(await refusedOf(740)).toEqual([true]);
  });

  it('a failed transaction it could not read is unknown, never fine', async () => {
    net.detailsFail = true;
    expect(await refusedOf(741)).toEqual([null]);
  });
});

describe('refusedPayouts', () => {
  const only = (tx: any) => {
    net.txs = { [tx.txHash]: tx };
    return refusedPayouts(WALLET);
  };

  it('version 4: names the refused token’s vesting only, and no key', async () => {
    const [entry, ...others] = await only(v4);
    expect(others).toEqual([]);
    expect(entry.tokens).toEqual([{ token: 'DUST-959a75', ids: [742] }]);
    expect(entry.keys).toEqual([]);
  });

  it.each([
    ['the owners sent it back', WALLET, false],
    ['still at the contract', CONTRACT, true]
  ])('version 3: its key, %s', async (_name, holder, held) => {
    net.holders[`${COLLECTION}-02e3`] = holder;
    const [entry] = await only(v3);
    expect(entry.tokens.flatMap((token) => token.ids)).toEqual([739, 740]);
    expect(entry.keys).toEqual([{ nonce: 739, held }]);
  });

  it('a key that was burned since is not held', async () => {
    const [entry] = await only(v3);
    expect(entry.keys).toEqual([{ nonce: 739, held: false }]);
  });

  it('a key that could not be located is unknown', async () => {
    net.holdersFail = true;
    const [entry] = await only(v3);
    expect(entry.keys).toEqual([{ nonce: 739, held: null }]);
  });

  it('a failure whose results do not show what came back names only what it was for', async () => {
    const [entry] = await only({
      ...v4,
      results: v4.results.map((result: any) => ({
        ...result,
        returnMessage: undefined
      }))
    });
    expect(entry.tokens).toEqual([]);
    expect(entry.keys).toEqual([]);
    expect(entry.ids).toEqual([741, 742]);
  });
});
