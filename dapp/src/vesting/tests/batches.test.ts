import { splitIntoBatches, splitKeys } from '../batches';

describe('batches', () => {
  it('splits 120 cancelable vestings into even transactions within the limit', () => {
    const batches = splitIntoBatches(
      Array.from({ length: 120 }, (_, i) => i),
      true
    );
    expect(batches.map((batch) => batch.length)).toEqual([30, 30, 30, 30]);
    expect(batches.flat()).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });
  it('uses 50 when not cancelable', () => {
    expect(
      splitIntoBatches(Array.from({ length: 120 }), false).map((b) => b.length)
    ).toEqual([40, 40, 40]);
    expect(
      splitIntoBatches(Array.from({ length: 50 }), false).map((b) => b.length)
    ).toEqual([50]);
    expect(splitIntoBatches([], false)).toEqual([]);
  });
  it('keys per call', () => {
    expect(splitKeys(Array.from({ length: 120 })).map((b) => b.length)).toEqual(
      [50, 50, 20]
    );
  });
});
