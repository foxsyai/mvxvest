// Fifth audit, RT-1: the reads under the fix. The fixture is the real devnet
// transaction of the rehearsal (f17518c5...), trimmed to its logs: the contract
// booked two claims, the payout was refused at the wallet ("account is frozen
// for this esdt token") and came back to the contract. The API calls it `fail`.
//
// What a gateway answers, measured on devnet the same day for the frozen wallet:
//   DUST-959a75 {"balance":"3","properties":"0100"}
//   TFOX-d61b09 {"balance":"77525...","properties":""}
//   NOPE-111111 {"balance":"0","properties":""}
// The format is the protocol's: mx-chain-go api/groups/addressGroup.go hex
// encodes esdtData.Properties, and mx-chain-vm-common-go esdtMetaData.go reads
// two bytes, bit 0 of the first being MetadataFrozen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  historyOf,
  outcomeOf,
  payoutBlock,
  payoutsOf,
  refusedPayouts
} from '../reads';
import bounced from './fixtures/audit5-bounced-claim.json';

jest.mock('config', () => jest.requireActual('config/config.devnet'));

const WALLET = bounced.sender;
const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const net = {
  gateway: {} as Record<string, unknown>,
  gatewayStatus: 200,
  token: {} as Record<string, unknown>,
  tokenStatus: 200,
  tx: {} as Record<string, unknown>,
  api: (async () => []) as (path: string) => Promise<unknown>
};

jest.mock('../network', () => ({
  api: (path: string) => net.api(path),
  fresh: async (path: string) => {
    if (path.startsWith('/tokens/'))
      return {
        ok: net.tokenStatus === 200,
        status: net.tokenStatus,
        json: async () => net.token
      };
    const hash = path.split('/transactions/')[1].split('?')[0];
    const tx = net.tx[hash];
    return { ok: Boolean(tx), status: tx ? 200 : 404, json: async () => tx };
  },
  freshGateway: async () => ({
    ok: net.gatewayStatus === 200,
    status: net.gatewayStatus,
    json: async () => net.gateway
  })
}));

const gatewayAnswer = (properties: unknown) => ({
  code: 'successful',
  error: '',
  data: { tokenData: { balance: '3', properties, tokenIdentifier: 'X-111111' } }
});

beforeEach(() => {
  net.gateway = gatewayAnswer('');
  net.gatewayStatus = 200;
  net.token = { isPaused: false };
  net.tokenStatus = 200;
  net.tx = { [bounced.txHash]: bounced };
  net.api = async () => [];
});

describe('payoutBlock: can this token reach this wallet', () => {
  it.each([
    ['0100', 'frozen'],
    ['0101', 'frozen'],
    ['', null],
    ['0000', null],
    ['0200', null]
  ])('reads properties %j as %j', async (properties, expected) => {
    net.gateway = gatewayAnswer(properties);
    await expect(payoutBlock(WALLET, 'X-111111')).resolves.toBe(expected);
  });

  it('says paused from the API', async () => {
    net.token = { isPaused: true };
    await expect(payoutBlock(WALLET, 'X-111111')).resolves.toBe('paused');
  });

  it('EGLD has neither', async () => {
    net.gatewayStatus = 500;
    net.tokenStatus = 500;
    await expect(payoutBlock(WALLET, 'EGLD-000000')).resolves.toBeNull();
  });

  it.each([
    ['the gateway answers 502', () => (net.gatewayStatus = 502)],
    ['the API answers 502', () => (net.tokenStatus = 502)],
    [
      'the gateway says it failed',
      () => (net.gateway = { code: 'internal_issue', error: 'x', data: null })
    ],
    [
      'the answer has no properties',
      () => (net.gateway = { code: 'successful', data: { tokenData: {} } })
    ],
    ['the properties are not hex', () => (net.gateway = gatewayAnswer('01zz'))],
    ['the properties are too short', () => (net.gateway = gatewayAnswer('01'))],
    ['the API has no isPaused', () => (net.token = {})]
  ])('a failed read is thrown, never fine: %s', async (_name, arrange) => {
    arrange();
    await expect(payoutBlock(WALLET, 'X-111111')).rejects.toThrow();
  });
});

describe('outcomeOf: failed, yet booked', () => {
  it('the real bounced claim says what the contract booked and why it came back', async () => {
    const outcome = await outcomeOf(bounced.txHash);
    expect(outcome.status).toBe('fail');
    expect(outcome.bounced).toBe('claimed');
    expect(outcome.reason).toMatch(/frozen/);
  });

  const failedWith = (name: string, address = CONTRACT) => ({
    status: 'fail',
    logs: { events: [] },
    results: [
      {
        logs: {
          events: [
            {
              address,
              identifier: 'x',
              topics: [Buffer.from(name).toString('base64')]
            }
          ]
        }
      }
    ]
  });

  it('a cancel', async () => {
    net.tx.h = failedWith('vestingCancelled');
    await expect(outcomeOf('h')).resolves.toMatchObject({
      status: 'fail',
      bounced: 'cancelled'
    });
  });

  it('a create whose key could not be delivered', async () => {
    net.tx.h = failedWith('vestingCreated');
    await expect(outcomeOf('h')).resolves.toMatchObject({
      status: 'fail',
      bounced: 'created'
    });
  });

  it('a failure that booked nothing stays a plain failure (the keys stayed in the wallet)', async () => {
    net.tx.h = {
      status: 'fail',
      logs: {
        events: [
          {
            address: WALLET,
            identifier: 'signalError',
            topics: ['', Buffer.from('frozen').toString('base64')]
          }
        ]
      },
      results: []
    };
    const outcome = await outcomeOf('h');
    expect(outcome.status).toBe('fail');
    expect(outcome.bounced).toBeUndefined();
  });

  it('only the contract’s own events count', async () => {
    net.tx.h = failedWith('vestingClaimed', WALLET);
    expect((await outcomeOf('h')).bounced).toBeUndefined();
  });

  it('a success is never called bounced', async () => {
    net.tx.h = { ...failedWith('vestingClaimed'), status: 'success' };
    await expect(outcomeOf('h')).resolves.toEqual({ status: 'success' });
  });
});

describe('payoutsOf', () => {
  it('a bounced claim paid nothing, whatever the contract booked', async () => {
    await expect(payoutsOf([bounced.txHash], WALLET)).resolves.toEqual([]);
  });
});

describe('historyOf', () => {
  const hex = (text: string) => Buffer.from(text).toString('hex');
  const caller =
    'ae7c205a80157c9e785ea0f6c10c4ba619b4a7259fa1e8ebc532f56bf1e5c8ed';
  const claimedEvent = (txHash: string) => ({
    txHash,
    identifier: 'claim',
    topics: [hex('vestingClaimed'), '07', caller, hex('X-111111')],
    data: '0000000203e8',
    timestamp: 1_791_809_588
  });
  const eventsThenStatuses =
    (statuses: () => unknown) => async (path: string) =>
      path.startsWith('/events')
        ? path.includes('identifier=claim')
          ? [claimedEvent('refusedtx'), claimedEvent('paidtx')]
          : []
        : statuses();

  it('marks a claim the wallet refused, and only that one', async () => {
    net.api = eventsThenStatuses(() => [
      { txHash: 'refusedtx', status: 'fail' },
      { txHash: 'paidtx', status: 'success' }
    ]);
    const history = await historyOf(7);
    expect(
      Object.fromEntries(history.map((e) => [e.txHash, e.refused]))
    ).toEqual({ refusedtx: true, paidtx: false });
  });

  it('a status it could not read is unknown, never fine', async () => {
    net.api = eventsThenStatuses(() => {
      throw new Error('502');
    });
    const history = await historyOf(7);
    expect(history.map((e) => e.refused)).toEqual([null, null]);
  });
});

describe('refusedPayouts', () => {
  it('lists this wallet’s bounced claims with their vestings', async () => {
    const paths: string[] = [];
    net.api = async (path) => {
      paths.push(path);
      return [bounced];
    };
    const refused = await refusedPayouts(WALLET);
    expect(paths[0]).toContain(`/accounts/${WALLET}/transactions`);
    expect(paths[0]).toContain('status=fail');
    expect(paths[0]).toContain('function=claim,cancel');
    expect(refused).toEqual([
      {
        txHash: bounced.txHash,
        timestamp: bounced.timestamp,
        kind: 'claimed',
        ids: [739, 740]
      }
    ]);
  });

  it('leaves out a failure the contract did not book', async () => {
    net.api = async () => [{ txHash: 'h', status: 'fail', results: [] }];
    await expect(refusedPayouts(WALLET)).resolves.toEqual([]);
  });
});

describe('the site lets the browser read it', () => {
  it('the CSP allows the gateway of each network', () => {
    const conf = readFileSync(
      join(__dirname, '../../../../scripts/server/nginx-mvxvest.io.conf'),
      'utf8'
    );
    const connect = [...conf.matchAll(/connect-src ([^;]*);/g)].map(
      (m) => m[1]
    );
    expect(connect.join(' ')).toContain('https://gateway.multiversx.com');
    expect(connect.join(' ')).toContain(
      'https://devnet-gateway.multiversx.com'
    );
    const network = readFileSync(join(__dirname, '../network.ts'), 'utf8');
    expect(network).toContain('https://gateway.multiversx.com');
    expect(network).toContain('https://devnet-gateway.multiversx.com');
  });
});
