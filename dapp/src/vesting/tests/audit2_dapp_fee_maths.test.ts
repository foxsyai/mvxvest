// Second audit: the token fee maths and the payments the site builds, against
// contracts/vesting/src/create.rs (`token_fee_of`: `total * bps / 10_000`
// rounded down, per vesting; `settle_payment`: the payment must equal the
// totals plus the fees to the unit). Every rate the owner can set (0 to 200
// bps), every usual number of decimals, and the two shapes of payment.

import { Address } from '@multiversx/sdk-core';
import { splitIntoBatches } from '../batches';
import { VestingClient } from '../client';
import { BPS, percentOf, tokenFeeOf, tokenFeeOfAll } from '../fees';

const client = new VestingClient(
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
  {} as any,
  '1'
);
const sender = 'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
const beneficiary = Address.newFromBech32(
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
).toBech32();
const entry = (total: bigint) => ({
  beneficiary,
  total,
  schedule: {
    start: 1_800_000_000,
    cliff: 1_800_000_000,
    cliffAmount: 0n,
    end: 1_800_086_400,
    curve: { kind: 'linear' as const }
  }
});

/** The "@"-separated parts of a transaction's data. */
const partsOf = (data: Uint8Array) => new TextDecoder().decode(data).split('@');

// Amounts that round awkwardly, in units of tokens with 0, 6, 8 and 18 decimals.
const AMOUNTS = [
  1n,
  7n,
  99n,
  101n,
  12_345n,
  999_999n,
  1_000_001n,
  123_456_789n,
  10n ** 18n + 7n,
  100n * 10n ** 18n + 3n * 10n ** 16n + 7n,
  (10n ** 18n * 12_345n) / 7n,
  10n ** 30n - 1n
];

describe('safe: the token fee of one vesting is the floor the contract computes', () => {
  it('safe: for every rate 0..200 bps and awkward amounts', () => {
    for (let bps = 0; bps <= 200; bps++) {
      for (const total of AMOUNTS) {
        const fee = tokenFeeOf(total, bps);
        const exact = total * BigInt(bps);
        // floor: fee * 10000 <= total * bps < (fee + 1) * 10000
        expect(fee * BPS <= exact).toBe(true);
        expect((fee + 1n) * BPS > exact).toBe(true);
        expect(fee >= 0n).toBe(true);
      }
    }
  });

  it('safe: the examples of DECISIONS.md #10 and v2_fees_test.rs', () => {
    // 0.1% of 1,000 FOXSY is 1 FOXSY: the creator pays 1,001.
    expect(tokenFeeOf(1_000n * 10n ** 18n, 10)).toBe(10n ** 18n);
    // 1% of 150, 99 and 1 units: 1, 0 and 0.
    expect(tokenFeeOf(150n, 100)).toBe(1n);
    expect(tokenFeeOf(99n, 100)).toBe(0n);
    expect(tokenFeeOf(1n, 100)).toBe(0n);
    // The cap, 2%.
    expect(tokenFeeOf(12_345n, 200)).toBe(246n);
  });
});

describe('safe: the fee of a batch is the sum of per-vesting floors', () => {
  it('safe: never the floor of the sum (which could be larger)', () => {
    // 1% of 150 + 99 + 1 = 250 would be 2; per vesting it is 1 + 0 + 0.
    expect(tokenFeeOfAll([150n, 99n, 1n], 100)).toBe(1n);
    expect(tokenFeeOf(250n, 100)).toBe(2n);
  });

  it('safe: splitting into transactions never changes what is paid in all', () => {
    const totals = Array.from(
      { length: 120 },
      (_, i) => 100n * 10n ** 18n + BigInt(i) * 10n ** 16n + 7n
    );
    for (const bps of [1, 10, 33, 100, 200]) {
      const whole = tokenFeeOfAll(totals, bps);
      for (const cancelable of [false, true]) {
        const batches = splitIntoBatches(totals, cancelable);
        const split = batches.reduce(
          (sum, batch) => sum + tokenFeeOfAll(batch, bps),
          0n
        );
        expect(split).toBe(whole);
      }
    }
  });

  it('safe: the fallback limits are the ones version 2 enforces, which version 1 accepts', () => {
    expect(
      splitIntoBatches(Array.from({ length: 50 }), false).map((b) => b.length)
    ).toEqual([25, 25]);
    expect(
      splitIntoBatches(Array.from({ length: 33 }), true).map((b) => b.length)
    ).toEqual([17, 16]);
    expect(
      splitIntoBatches(Array.from({ length: 49 }), false).map((b) => b.length)
    ).toEqual([49]);
    expect(
      splitIntoBatches(Array.from({ length: 32 }), true).map((b) => b.length)
    ).toEqual([32]);
  });
});

describe('safe: the rate reads as the percentage it is', () => {
  it('safe: for every rate 0..200 bps, with no floating point artefact', () => {
    for (let bps = 0; bps <= 200; bps++) {
      const whole = Math.floor(bps / 100);
      const fraction = String(bps % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
      const expected = `${whole}${fraction ? `.${fraction}` : ''}%`;
      expect(percentOf(bps)).toBe(expected);
    }
    expect(percentOf(10)).toBe('0.1%');
    expect(percentOf(1)).toBe('0.01%');
    expect(percentOf(199)).toBe('1.99%');
    expect(percentOf(200)).toBe('2%');
  });
});

describe('safe: the payments the site builds', () => {
  it('safe: with no token fee (version 1) a creation is built exactly as before', async () => {
    // The rate is a required argument since the second audit: 0 for version 1.
    const before = await client.create(
      sender,
      'FOXSY-5d5f3e',
      entry(1_000n),
      false,
      'team',
      0n,
      0
    );
    const now = await client.create(
      sender,
      'FOXSY-5d5f3e',
      entry(1_000n),
      false,
      'team',
      0n,
      0
    );
    expect(Buffer.from(now.data)).toEqual(Buffer.from(before.data));
    expect(now.value).toBe(before.value);
    // One plain ESDT transfer of the total, no multi-transfer.
    expect(partsOf(now.data)[0]).toBe('ESDTTransfer');
    expect(BigInt(`0x${partsOf(now.data)[2]}`)).toBe(1_000n);
  });

  it('safe: an ESDT vesting with a token fee and no EGLD fee: one transfer of total + fee', async () => {
    const tx = await client.create(
      sender,
      'FOXSY-5d5f3e',
      entry(1_000n * 10n ** 18n),
      false,
      'team',
      0n,
      10
    );
    const parts = partsOf(tx.data);
    expect(parts[0]).toBe('ESDTTransfer');
    expect(BigInt(`0x${parts[2]}`)).toBe(1_001n * 10n ** 18n);
    expect(tx.value).toBe(0n);
    // The total argument is still 1,000: the fee is on top.
    expect(Buffer.from(parts[3], 'hex').toString()).toBe('create');
    expect(BigInt(`0x${parts[5]}`)).toBe(1_000n * 10n ** 18n);
  });

  it('safe: an EGLD vesting pays total + token fee + EGLD fee as plain value, nothing else', async () => {
    const total = 999n * 10n ** 18n;
    const tx = await client.create(
      sender,
      'EGLD-000000',
      entry(total),
      true,
      'egld',
      10n ** 17n,
      10
    );
    expect(tx.value).toBe(total + tokenFeeOf(total, 10) + 10n ** 17n);
    expect(partsOf(tx.data)[0]).toBe('create');
  });

  it('safe: the largest batch (49) pays the sum plus each fee, and 32 cancelable too', async () => {
    for (const [count, cancelable] of [
      [49, false],
      [32, true]
    ] as const) {
      const entries = Array.from({ length: count }, (_, i) =>
        entry(100n * 10n ** 18n + BigInt(i) * 10n ** 16n + 7n)
      );
      const tx = await client.createBatch(
        sender,
        'FOXSY-5d5f3e',
        entries,
        cancelable,
        'v2',
        10n ** 17n,
        10
      );
      const parts = partsOf(tx.data);
      expect(parts[0]).toBe('MultiESDTNFTTransfer');
      expect(parts[2]).toBe('02');
      const sum = entries.reduce((s, e) => s + e.total, 0n);
      const fee = tokenFeeOfAll(
        entries.map((e) => e.total),
        10
      );
      expect(BigInt(`0x${parts[5]}`)).toBe(sum + fee);
      expect(BigInt(`0x${parts[8]}`)).toBe(BigInt(count) * 10n ** 17n);
      expect(tx.value).toBe(0n);
    }
  });
});
