// What a finished claim or cancel paid, read from the contract's events.
// The fixtures are two real devnet transactions of the guide's captures
// (14 Oct 2026), trimmed to their logs: a Claim all of 33 vestings in TFOX
// and TUSD, and a cancel. The caller's address was replaced by one nobody
// holds (the third audit's O1); the contract's events are untouched. The
// expected sums were computed separately from the same raw data.

import { payoutsOf } from '../reads';
import cancelTx from './fixtures/payouts-cancel.json';
import claimTx from './fixtures/payouts-claim.json';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

// The fixtures come from the devnet contract.
jest.mock('config', () => jest.requireActual('config/config.devnet'));

const transactions: Record<string, unknown> = {};
jest.mock('../network', () => ({
  fresh: async (path: string) => {
    const hash = path.split('/transactions/')[1].split('?')[0];
    const tx = transactions[hash];
    return { ok: Boolean(tx), status: tx ? 200 : 404, json: async () => tx };
  }
}));

const b64 = (bytes: Uint8Array | string) =>
  Buffer.from(bytes as any).toString('base64');

/** Amounts as strings: a failing BigInt comparison cannot be reported by Jest's workers. */
const shown = (payouts: Awaited<ReturnType<typeof payoutsOf>>) =>
  payouts.map((payout) => ({
    token: payout.token,
    claimed: String(payout.claimed),
    refunded: String(payout.refunded),
    vestedAtCancel: String(payout.vestedAtCancel),
    cancelledIds: payout.cancelledIds
  }));

beforeEach(() => {
  for (const key of Object.keys(transactions)) delete transactions[key];
  transactions[claimTx.txHash] = claimTx;
  transactions[cancelTx.txHash] = cancelTx;
});

describe('payoutsOf', () => {
  it('sums a Claim all per token', async () => {
    expect(shown(await payoutsOf([claimTx.txHash]))).toEqual(
      expect.arrayContaining([
        {
          token: 'TFOX-d61b09',
          claimed: '2055895995566669082637',
          refunded: '0',
          vestedAtCancel: '0',
          cancelledIds: []
        },
        {
          token: 'TUSD-8e71cb',
          claimed: '1000000000',
          refunded: '0',
          vestedAtCancel: '0',
          cancelledIds: []
        }
      ])
    );
  });

  it('reads a cancel: refunded, and an empty vested part as 0', async () => {
    expect(shown(await payoutsOf([cancelTx.txHash]))).toEqual([
      {
        token: 'TFOX-d61b09',
        claimed: '0',
        refunded: '3000000000000000000000',
        vestedAtCancel: '0',
        cancelledIds: [543]
      }
    ]);
  });

  it('adds several transactions together', async () => {
    const payouts = shown(await payoutsOf([claimTx.txHash, cancelTx.txHash]));
    const tfox = payouts.find((payout) => payout.token === 'TFOX-d61b09');
    expect(tfox).toEqual({
      token: 'TFOX-d61b09',
      claimed: '2055895995566669082637',
      refunded: '3000000000000000000000',
      vestedAtCancel: '0',
      cancelledIds: [543]
    });
  });

  it('reads the vested part of a cancel', async () => {
    // refund 600, vested 400 (nested BigUints).
    const data = Buffer.concat([
      Buffer.from([0, 0, 0, 2, 0x02, 0x58]),
      Buffer.from([0, 0, 0, 2, 0x01, 0x90])
    ]);
    transactions.made = {
      results: [
        {
          logs: {
            events: [
              {
                address: CONTRACT,
                identifier: 'cancel',
                topics: [
                  b64('vestingCancelled'),
                  b64(Uint8Array.from([7])),
                  b64(Uint8Array.from([1])),
                  b64('FOXSY-5d5f3e')
                ],
                data: b64(data)
              }
            ]
          }
        }
      ]
    };
    expect(shown(await payoutsOf(['made']))).toEqual([
      {
        token: 'FOXSY-5d5f3e',
        claimed: '0',
        refunded: '600',
        vestedAtCancel: '400',
        cancelledIds: [7]
      }
    ]);
  });

  it('ignores the same event named by another contract, and repeats', async () => {
    const event = (address: string) => ({
      address,
      identifier: 'claim',
      topics: [
        b64('vestingClaimed'),
        b64(Uint8Array.from([9])),
        b64(Uint8Array.from([1])),
        b64('TFOX-d61b09')
      ],
      data: b64(Buffer.from([0, 0, 0, 1, 50, 0, 0, 0, 1, 50, 0]))
    });
    transactions.forged = {
      logs: {
        events: [
          event(
            'erd1qqqqqqqqqqqqqpgqzywreqymt6j00wta43v7zvmrk4yz5xal6qls2j5m2c'
          ),
          event(CONTRACT)
        ]
      },
      // The same event again in a result's logs counts once.
      results: [{ logs: { events: [event(CONTRACT)] } }]
    };
    expect(shown(await payoutsOf(['forged']))).toEqual([
      {
        token: 'TFOX-d61b09',
        claimed: '50',
        refunded: '0',
        vestedAtCancel: '0',
        cancelledIds: []
      }
    ]);
  });

  it('with a caller, counts only what was paid to that caller', async () => {
    // The real Claim all was the creator's (its address replaced in the
    // fixture): with another wallet as the caller, nothing counts.
    expect(
      await payoutsOf(
        [claimTx.txHash],
        'erd1z5pcfwjrl97y8dyrw4d77g27mp2kweryjkm79n56fvcr5lyl6x6sdd0sdp'
      )
    ).toEqual([]);
    const caller = claimTx.logs.events.find(
      (event) => event.identifier === 'MultiESDTNFTTransfer'
    )!.address;
    expect(
      shown(await payoutsOf([claimTx.txHash], caller)).map(
        (payout) => payout.claimed
      )
    ).toEqual(['2055895995566669082637', '1000000000']);
  });

  it('fails rather than report nothing when a transaction cannot be read', async () => {
    await expect(payoutsOf(['unknown'])).rejects.toThrow(/not readable/);
  });
});
