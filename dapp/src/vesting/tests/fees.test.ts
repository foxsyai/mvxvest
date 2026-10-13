// The token fee as the contract charges it (contracts/vesting/tests/
// v2_fees_test.rs): per vesting, rounded down, on top of the total. The
// payment must match to the unit, or the contract refuses the creation.

import { Address } from '@multiversx/sdk-core';
import { VestingClient } from '../client';
import { percentOf, tokenFeeOf, tokenFeeOfAll } from '../fees';

const EGLD_UNIT = 10n ** 18n;

describe('the token fee', () => {
  it('is rounded down per vesting, as the contract computes it', () => {
    expect(tokenFeeOf(1_000n, 100)).toBe(10n);
    // 1% of 150, 99 and 1: 1, 0 and 0; the batch pays 1.
    expect(tokenFeeOfAll([150n, 99n, 1n], 100)).toBe(1n);
    // 1.5% of 2 EGLD is 0.03 EGLD.
    expect(tokenFeeOf(2n * EGLD_UNIT, 150)).toBe((3n * EGLD_UNIT) / 100n);
    expect(tokenFeeOf(1_000n, 0)).toBe(0n);
  });
  it('reads as a percentage', () => {
    expect(percentOf(100)).toBe('1%');
    expect(percentOf(150)).toBe('1.5%');
    expect(percentOf(25)).toBe('0.25%');
  });
});

describe('a creation pays the fees on top', () => {
  const client = new VestingClient(
    'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
    {} as any,
    'D'
  );
  const sender =
    'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
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
  /** The data field's "MultiESDTNFTTransfer@..." arguments as bigints where numeric. */
  const transferredOf = (data: Uint8Array) => {
    const parts = new TextDecoder().decode(data).split('@');
    return { fn: parts[0], parts };
  };

  it('in the vested token for an ESDT vesting, and the EGLD fee in EGLD', async () => {
    const tx = await client.createBatch(
      sender,
      'FOXSY-5d5f3e',
      [entry(150n), entry(99n), entry(1n)],
      false,
      'team',
      10n ** 17n,
      100
    );
    const { fn, parts } = transferredOf(tx.data);
    expect(fn).toBe('MultiESDTNFTTransfer');
    // Two transfers: FOXSY 250 + 1, then EGLD 3 x 0.1.
    expect(parts[2]).toBe('02');
    expect(Buffer.from(parts[3], 'hex').toString()).toBe('FOXSY-5d5f3e');
    expect(BigInt(`0x${parts[5]}`)).toBe(251n);
    expect(Buffer.from(parts[6], 'hex').toString()).toBe('EGLD-000000');
    expect(BigInt(`0x${parts[8]}`)).toBe(3n * 10n ** 17n);
  });

  it('all in EGLD for an EGLD vesting', async () => {
    const tx = await client.create(
      sender,
      'EGLD-000000',
      entry(2n * EGLD_UNIT),
      false,
      'egld',
      EGLD_UNIT / 10n,
      150
    );
    expect(tx.value).toBe(
      2n * EGLD_UNIT + (3n * EGLD_UNIT) / 100n + EGLD_UNIT / 10n
    );
  });
});
