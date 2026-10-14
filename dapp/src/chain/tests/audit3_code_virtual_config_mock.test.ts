// Third audit, test reliability: why `jest.mock('config', factory, { virtual:
// true })` applied when its test ran alone and not always in the full run
// (payouts.test.ts before 69eb614; review_history.test.ts still does it).
//
// Jest 29.7 gives each worker ONE Resolver, shared by every test file the
// worker runs (jest-runner/build/testWorker.js, setup(): `resolvers` is filled
// once per worker). The Resolver caches module ids by (from, moduleName)
// (jest-resolve/build/resolver.js, getModuleID: `_moduleIDCache`). The id of a
// module found on disk is its path; the id of a virtual mock is the bare name
// (`_getAbsolutePath` falls back to `_getVirtualMockPath`). So once any file in
// the worker has made chain/reads.ts resolve 'config' for real, the cache
// answers "src/config/index.ts" for (chain/reads.ts, 'config') for the rest of
// the worker's life, and a later file's virtual mock, registered under the id
// "config", never reaches chain/reads.ts: it loads the real config, whichever
// network's was copied last (mainnet's after a mainnet deploy). A plain
// `jest.mock('config', factory)` is registered under the path id and applies.
//
// This file plays both roles: the first require of chain/reads is the earlier
// test file in the worker. The test passes: it demonstrates the hazard.

/* eslint-disable @typescript-eslint/no-require-imports */

const FAKE = 'erd1fake';
const paths: string[] = [];
jest.mock('chain/network', () => ({
  api: async (path: string) => {
    paths.push(path);
    return [];
  },
  fresh: async () => ({ ok: false, status: 404 })
}));

/** The contract address a fresh chain/reads puts in its /events reads. */
const addressReadsUses = async (): Promise<string> => {
  let reads: any;
  jest.isolateModules(() => {
    reads = require('chain/reads');
  });
  paths.length = 0;
  await reads.historyOf(1);
  return /address=([^&]+)/.exec(paths[0] ?? '')?.[1] ?? '';
};

describe('a virtual mock of config', () => {
  it('reaches the test file but not chain/reads once the worker resolved config from it before', async () => {
    // An earlier test file in the same worker: chain/reads resolved 'config'.
    const real = await addressReadsUses();
    expect(real).toMatch(/^erd1/);

    jest.doMock('config', () => ({ contractAddress: FAKE }), { virtual: true });
    // The test file itself sees the mock...
    expect(require('config').contractAddress).toBe(FAKE);
    // ...and the module under test still reads the real config.
    expect(await addressReadsUses()).toBe(real);
  });
});
