// The real client and sdk-core's real argument encoding, with a network that
// records the query instead of answering it. A read must never change the
// arguments it was given: My vestings reads the vestings of the claim keys a
// wallet holds, then looks up by the same list any key that did not match.

import { VestingClient } from '../client';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';

const recording = () => {
  const queries: any[] = [];
  const provider: any = {
    queryContract: async (query: any) => {
      queries.push(query);
      throw new Error('not answered in this test');
    }
  };
  return { queries, client: new VestingClient(CONTRACT, provider, 'D') };
};

describe('vesting client: arguments', () => {
  it('reading several vestings leaves the list of ids as it was', async () => {
    const { client, queries } = recording();
    const ids = [326, 327, 328];
    await client.vestings(ids).catch(() => undefined);
    expect(ids).toEqual([326, 327, 328]);
    expect(queries).toHaveLength(1);
  });

  it('encodes each id as its own argument', async () => {
    const { client, queries } = recording();
    await client.vestings([326, 327, 328]).catch(() => undefined);
    const args = queries[0].arguments.map((arg: Uint8Array) =>
      Buffer.from(arg).toString('hex')
    );
    expect(args).toEqual(['0146', '0147', '0148']);
  });
});
