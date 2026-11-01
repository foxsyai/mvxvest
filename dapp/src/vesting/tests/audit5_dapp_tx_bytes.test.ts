// Fifth audit (DAPP, 1 Nov 2026): the bytes of every transaction the dApp
// builds, decoded by hand against what the review shows. The real
// VestingClient and sdk-core's real encoding, no network. A person must sign
// exactly what they read: receiver, value, token, nonce, amount, fee, label
// and every field of the schedule, for create, createBatch, claim and cancel.
//
// The schedule's nested encoding is written out here independently of the
// ABI (u64 as 8 big-endian bytes, BigUint as 4-byte length plus bytes, the
// enum as a one-byte discriminant then its fields, a list as a 4-byte count),
// so a wrong ABI copy or a wrong sdk-core mapping would show.

import { Address } from '@multiversx/sdk-core';
import { EGLD, NewVesting, VestingClient } from '../client';
import { Schedule } from '../schedule';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const SENDER = 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const BENEFICIARY =
  'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const OTHER = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const TOKEN = 'TFOX-d61b09';
const CLAIM_KEYS = 'VESTKEY-8f217c';
const CANCEL_KEYS = 'VESTCANCEL-bd731d';

const client = new VestingClient(CONTRACT, {} as any, 'D');

const hex = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString('hex');
const u64 = (n: number) => n.toString(16).padStart(16, '0');
const big = (n: bigint) => {
  if (n === 0n) return '00000000';
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  return (h.length / 2).toString(16).padStart(8, '0') + h;
};
/** A top-level BigUint argument: its bytes, empty for zero. */
const topBig = (n: bigint) => {
  if (n === 0n) return '';
  const h = n.toString(16);
  return h.length % 2 ? `0${h}` : h;
};
const utf8 = (s: string) => Buffer.from(s, 'utf8').toString('hex');
const pub = (bech32: string) => Address.newFromBech32(bech32).toHex();

const encodeSchedule = (s: Schedule) => {
  let out = u64(s.start) + u64(s.cliff) + big(s.cliffAmount) + u64(s.end);
  if (s.curve.kind === 'linear') out += '00';
  else if (s.curve.kind === 'stepped') out += `01${u64(s.curve.interval)}`;
  else {
    out += `02${s.curve.tranches.length.toString(16).padStart(8, '0')}`;
    for (const t of s.curve.tranches) out += u64(t.time) + big(t.amount);
  }
  return out;
};

const dataOf = (tx: { data: Uint8Array }) =>
  Buffer.from(tx.data).toString('utf8');

const T0 = 1_800_000_000;
const DAY = 86_400;

describe('audit5 DAPP: create bytes', () => {
  const linear: Schedule = {
    start: T0,
    cliff: T0 + 90 * DAY,
    cliffAmount: 0n,
    end: T0 + 730 * DAY,
    curve: { kind: 'linear' }
  };

  it('an ESDT create: multi transfer to self, contract named inside, total plus token fee, EGLD fee, every argument', async () => {
    const total = 123_456_789_012_345_678_901n; // ~123.46 tokens at 18 decimals
    const fee = 100_000_000_000_000_000n; // 0.1 EGLD
    const bps = 10;
    const tx = await client.create(
      SENDER,
      TOKEN,
      { beneficiary: BENEFICIARY, total, schedule: linear },
      true,
      'Team 2027 ✓',
      fee,
      bps
    );
    // An ESDT transfer goes to the sender itself; the contract is the first
    // argument. No EGLD on the transaction itself.
    expect(tx.sender.toBech32()).toBe(SENDER);
    expect(tx.receiver.toBech32()).toBe(SENDER);
    expect(tx.value.toString()).toBe('0');
    expect(tx.chainID).toBe('D');
    const tokenFee = (total * BigInt(bps)) / 10_000n;
    const expected = [
      'MultiESDTNFTTransfer',
      pub(CONTRACT),
      '02',
      utf8(TOKEN),
      '',
      topBig(total + tokenFee),
      utf8('EGLD-000000'),
      '',
      topBig(fee),
      utf8('create'),
      pub(BENEFICIARY),
      topBig(total),
      encodeSchedule(linear),
      '01',
      utf8('Team 2027 ✓')
    ].join('@');
    expect(dataOf(tx)).toBe(expected);
  });

  it('an EGLD create: straight to the contract, value = total + token fee + EGLD fee, cancelable false, empty label', async () => {
    const total = 5n * 10n ** 18n;
    const fee = 10n ** 17n;
    const tx = await client.create(
      SENDER,
      EGLD,
      { beneficiary: BENEFICIARY, total, schedule: linear },
      false,
      '',
      fee,
      10
    );
    expect(tx.receiver.toBech32()).toBe(CONTRACT);
    expect(tx.value.toString()).toBe((total + total / 1000n + fee).toString());
    expect(dataOf(tx)).toBe(
      [
        'create',
        pub(BENEFICIARY),
        topBig(total),
        encodeSchedule(linear),
        '',
        ''
      ].join('@')
    );
  });

  it('a stepped schedule with a lump cliff and a tranche schedule encode field for field', async () => {
    const stepped: Schedule = {
      start: T0,
      cliff: T0,
      cliffAmount: 100n,
      end: T0 + 12 * 30 * DAY,
      curve: { kind: 'stepped', interval: 30 * DAY }
    };
    const tranches: Schedule = {
      start: T0,
      cliff: T0,
      cliffAmount: 0n,
      end: T0 + 3 * 30 * DAY,
      curve: {
        kind: 'tranches',
        tranches: [
          { time: T0 + 30 * DAY, amount: 333n },
          { time: T0 + 60 * DAY, amount: 333n },
          { time: T0 + 90 * DAY, amount: 334n }
        ]
      }
    };
    for (const schedule of [stepped, tranches]) {
      const tx = await client.create(
        SENDER,
        TOKEN,
        { beneficiary: BENEFICIARY, total: 1000n, schedule },
        false,
        'x',
        0n,
        0
      );
      const parts = dataOf(tx).split('@');
      // No EGLD fee: a single ESDT transfer, so ESDTTransfer to the contract.
      expect(parts[0]).toBe('ESDTTransfer');
      expect(tx.receiver.toBech32()).toBe(CONTRACT);
      expect(parts[1]).toBe(utf8(TOKEN));
      expect(parts[2]).toBe(topBig(1000n));
      expect(parts[3]).toBe(utf8('create'));
      expect(parts[4]).toBe(pub(BENEFICIARY));
      expect(parts[5]).toBe(topBig(1000n));
      expect(parts[6]).toBe(encodeSchedule(schedule));
      expect(parts[7]).toBe('');
      expect(parts[8]).toBe(utf8('x'));
      expect(parts).toHaveLength(9);
    }
  });

  it('a label of 64 bytes of accents goes as its UTF-8 bytes, nothing cut or changed', async () => {
    const label = 'é'.repeat(32); // 64 bytes
    const tx = await client.create(
      SENDER,
      TOKEN,
      { beneficiary: BENEFICIARY, total: 1n, schedule: linear },
      false,
      label,
      0n,
      0
    );
    const parts = dataOf(tx).split('@');
    expect(parts[parts.length - 1]).toBe(utf8(label));
    expect(parts[parts.length - 1]).toHaveLength(128);
  });
});

describe('audit5 DAPP: createBatch bytes', () => {
  it('49 entries: the sum plus each fee rounded down on its own, 49 EGLD fees, each entry in order', async () => {
    const schedule: Schedule = {
      start: T0,
      cliff: T0 + DAY,
      cliffAmount: 0n,
      end: T0 + 400 * DAY,
      curve: { kind: 'linear' }
    };
    const entries: NewVesting[] = Array.from({ length: 49 }, (_, i) => ({
      beneficiary: i % 2 ? BENEFICIARY : OTHER,
      // Odd totals so that the per-vesting rounding differs from the sum's.
      total: 500n + BigInt(i) * 7n,
      schedule
    }));
    const fee = 10n ** 17n;
    const bps = 10;
    const tx = await client.createBatch(
      SENDER,
      TOKEN,
      entries,
      false,
      'batch',
      fee,
      bps
    );
    const sum = entries.reduce((s, e) => s + e.total, 0n);
    const tokenFee = entries.reduce(
      (s, e) => s + (e.total * BigInt(bps)) / 10_000n,
      0n
    );
    // Rounding per vesting is what the contract charges: here it is 0 for
    // every entry (500..836 at 0.1% round to 0), while the sum's 0.1% would
    // be 32.
    expect(tokenFee.toString()).toBe('0');
    expect(((sum * BigInt(bps)) / 10_000n).toString()).toBe('32');
    const parts = dataOf(tx).split('@');
    expect(parts.slice(0, 9)).toEqual([
      'MultiESDTNFTTransfer',
      pub(CONTRACT),
      '02',
      utf8(TOKEN),
      '',
      topBig(sum + tokenFee),
      utf8('EGLD-000000'),
      '',
      topBig(fee * 49n)
    ]);
    expect(parts[9]).toBe(utf8('createBatch'));
    expect(parts[10]).toBe(''); // cancelable false
    expect(parts[11]).toBe(utf8('batch'));
    const rest = parts.slice(12);
    expect(rest).toHaveLength(49 * 3);
    entries.forEach((entry, i) => {
      expect(rest[3 * i]).toBe(pub(entry.beneficiary));
      expect(rest[3 * i + 1]).toBe(topBig(entry.total));
      expect(rest[3 * i + 2]).toBe(encodeSchedule(schedule));
    });
  });

  it('a batch of one goes through createBatch with one entry, and create with the same entry pays the same', async () => {
    const schedule: Schedule = {
      start: T0,
      cliff: T0,
      cliffAmount: 0n,
      end: T0 + DAY,
      curve: { kind: 'linear' }
    };
    const entry = { beneficiary: BENEFICIARY, total: 10_000n, schedule };
    const one = await client.create(SENDER, TOKEN, entry, true, 'l', 5n, 25);
    const batch = await client.createBatch(
      SENDER,
      TOKEN,
      [entry],
      true,
      'l',
      5n,
      25
    );
    const payment = (tx: any) => dataOf(tx).split('@').slice(0, 9);
    expect(payment(one)).toEqual(payment(batch));
    // 0.25% of 10,000 is 25, on top of the total.
    expect(payment(one)[5]).toBe(topBig(10_025n));
  });
});

describe('audit5 DAPP: claim and cancel bytes', () => {
  it('one claim key: ESDTNFTTransfer of exactly one unit of that nonce to the contract, function claim, nothing else', async () => {
    const tx = await client.claim(SENDER, CLAIM_KEYS, [7]);
    expect(tx.receiver.toBech32()).toBe(SENDER);
    expect(tx.value.toString()).toBe('0');
    expect(dataOf(tx)).toBe(
      [
        'ESDTNFTTransfer',
        utf8(CLAIM_KEYS),
        '07',
        '01',
        pub(CONTRACT),
        utf8('claim')
      ].join('@')
    );
  });

  it('fifty claim keys in one call: every nonce once, one unit each, in the order given', async () => {
    const nonces = Array.from({ length: 50 }, (_, i) => 300 + i * 3);
    const tx = await client.claim(SENDER, CLAIM_KEYS, nonces);
    const parts = dataOf(tx).split('@');
    expect(parts.slice(0, 3)).toEqual([
      'MultiESDTNFTTransfer',
      pub(CONTRACT),
      '32'
    ]);
    const transfers = parts.slice(3, 3 + 150);
    nonces.forEach((nonce, i) => {
      expect(transfers[3 * i]).toBe(utf8(CLAIM_KEYS));
      const h = nonce.toString(16);
      expect(transfers[3 * i + 1]).toBe(h.length % 2 ? `0${h}` : h);
      expect(transfers[3 * i + 2]).toBe('01');
    });
    expect(parts[153]).toBe(utf8('claim'));
    expect(parts).toHaveLength(154);
  });

  it('a cancel sends the cancel key, never a claim key, to the cancel endpoint', async () => {
    const tx = await client.cancel(SENDER, CANCEL_KEYS, [4096]);
    expect(dataOf(tx)).toBe(
      [
        'ESDTNFTTransfer',
        utf8(CANCEL_KEYS),
        '1000',
        '01',
        pub(CONTRACT),
        utf8('cancel')
      ].join('@')
    );
    expect(hex(tx.data)).not.toContain(utf8(CLAIM_KEYS));
  });

  it('a key transaction carries no EGLD and no gas yet (the simulation sets it)', async () => {
    const tx = await client.claim(SENDER, CLAIM_KEYS, [1]);
    expect(tx.value.toString()).toBe('0');
    expect(tx.gasLimit.toString()).toBe('0');
  });
});
