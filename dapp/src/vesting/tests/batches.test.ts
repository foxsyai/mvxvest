import { maxPerBatch, splitIntoBatches, splitKeys } from '../batches';

describe('batches', () => {
  it('splits 120 cancelable vestings into even transactions within the limit', () => {
    const batches = splitIntoBatches(
      Array.from({ length: 120 }, (_, i) => i),
      true
    );
    expect(batches.map((batch) => batch.length)).toEqual([30, 30, 30, 30]);
    expect(batches.flat()).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });
  it('uses 49 when not cancelable (the fallback when the contract cannot be read)', () => {
    expect(
      splitIntoBatches(Array.from({ length: 120 }), false).map((b) => b.length)
    ).toEqual([40, 40, 40]);
    expect(
      splitIntoBatches(Array.from({ length: 49 }), false).map((b) => b.length)
    ).toEqual([49]);
    expect(
      splitIntoBatches(Array.from({ length: 50 }), false).map((b) => b.length)
    ).toEqual([25, 25]);
    expect(splitIntoBatches([], false)).toEqual([]);
  });
  it('keys per call', () => {
    expect(splitKeys(Array.from({ length: 120 })).map((b) => b.length)).toEqual(
      [50, 50, 20]
    );
  });
});

describe('batches of vestings with many tranches', () => {
  it('carries fewer per transaction as tranches grow', () => {
    expect(maxPerBatch(true, 0)).toBe(32);
    expect(maxPerBatch(true, 12)).toBe(32);
    // One cancelable create of 120 tranches measured 132M on devnet.
    expect(maxPerBatch(true, 120)).toBe(3);
    expect(maxPerBatch(false, 120)).toBe(3);
    expect(maxPerBatch(false, 0)).toBe(49);
  });
  it('splits 120 vestings of 120 tranches into transactions of at most 3', () => {
    const batches = splitIntoBatches(
      Array.from({ length: 120 }),
      true,
      undefined,
      120
    );
    expect(batches.length).toBe(40);
    expect(Math.max(...batches.map((b) => b.length))).toBe(3);
  });
});
