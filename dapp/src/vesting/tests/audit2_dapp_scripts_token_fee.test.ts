// Second audit: the scripts that create vestings through the dApp's own
// client (scripts/src). `VestingClient.create` and `createBatch` take the
// token fee rate as an optional last argument that defaults to 0, so a
// caller that does not pass it silently builds a version 1 payment. Against
// version 2 with a fee set (devnet since 13 Oct 2026: 10 bps) the contract
// refuses it ("payment must equal the vested total plus the fee").
//
// scripts/src/csv120.ts (the milestone 2 check of 120 vestings from a CSV)
// reads the limits and the EGLD fee, but not the token fee, and calls
// createBatch without it. scripts/src/v2-batches.ts does it right.

import { readFileSync } from 'fs';
import { join } from 'path';
import { VestingClient } from '../client';
import { tokenFeeOfAll } from '../fees';

const scripts = join(__dirname, '..', '..', '..', '..', 'scripts', 'src');
const source = (name: string) => readFileSync(join(scripts, name), 'utf8');

/** The arguments of each `client.createBatch(` call in a script's source. */
const batchCalls = (text: string) =>
  [...text.matchAll(/client\.createBatch\(([^;]*?)\);/gs)].map((match) =>
    match[1].split(',').map((part) => part.trim())
  );

describe('scripts creating vestings through the dApp client', () => {
  it('csv120.ts reads the token fee and pays it, as v2-batches.ts does', () => {
    const text = source('csv120.ts');
    expect(text).toMatch(/client\.tokenFee\(\)/);
    for (const args of batchCalls(text)) {
      // sender, token, entries, cancelable, label, EGLD fee, token fee bps
      expect(args).toHaveLength(7);
    }
  });

  it('safe: v2-batches.ts reads the token fee and pays it', () => {
    const text = source('v2-batches.ts');
    expect(text).toMatch(/client\.tokenFee\(\)/);
    for (const args of batchCalls(text)) expect(args).toHaveLength(7);
  });

  it('safe: what a call without the rate builds is a version 1 payment, short of the fee', async () => {
    const client = new VestingClient(
      'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
      {} as any,
      'D'
    );
    const beneficiary =
      'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
    const entries = Array.from({ length: 3 }, (_, i) => ({
      beneficiary,
      total: (100n + BigInt(i)) * 10n ** 18n + 5n * 10n ** 15n,
      schedule: {
        start: 1_800_000_000,
        cliff: 1_800_000_000,
        cliffAmount: 0n,
        end: 1_800_086_400,
        curve: { kind: 'linear' as const }
      }
    }));
    const sender =
      'erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd';
    // As csv120.ts called it, without the rate (now a required argument:
    // a caller that pays no token fee has to say 0).
    const tx = await client.createBatch(
      sender,
      'TFOX-d61b09',
      entries,
      true,
      'csv 120',
      0n,
      0
    );
    const parts = new TextDecoder().decode(tx.data).split('@');
    const sum = entries.reduce((total, entry) => total + entry.total, 0n);
    expect(parts[0]).toBe('ESDTTransfer');
    expect(BigInt(`0x${parts[2]}`)).toBe(sum);
    // Devnet's contract (10 bps) wants more: the call is refused.
    const owed =
      sum +
      tokenFeeOfAll(
        entries.map((entry) => entry.total),
        10
      );
    expect(owed).toBeGreaterThan(sum);
  });
});
