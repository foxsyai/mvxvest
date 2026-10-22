// Second audit: the red banner around an upgrade. The site accepts every
// code hash in `contractCodeHashes`; before an upgrade a config lists the old
// and the new build, so the banner stays silent on both sides, and shouts
// for any other code. After the upgrade it lists the new one only: since 22
// Oct 2026 version 3 (65c689b9…), on devnet (rehearsed on 21 Oct) and on
// mainnet. CI refuses a main that builds to a hash the mainnet config does
// not list, or whose live hash it lacks.

import { act, render, screen } from '@testing-library/react';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { CodeCheck } from '../CodeCheck';

// The devnet config, whichever network's config was copied last.
jest.mock('config', () => jest.requireActual('config/config.devnet'));

const mockAccount: { current: Record<string, string> } = { current: {} };
jest.mock('chain/network', () => ({
  api: async () => mockAccount.current
}));

const base64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

const shown = async () => {
  render(<CodeCheck />);
  for (let i = 0; i < 5; i++) await act(async () => undefined);
  return screen.queryByRole('alert')?.textContent ?? null;
};

describe('safe: the code check across the upgrade (devnet config)', () => {
  it('safe: knows the version devnet runs', () => {
    // Version 3, upgraded on devnet in its rehearsal of 21 Oct 2026
    // (DEPLOY.md) and read from the API afterwards.
    expect(contractCodeHashes).toContain(
      '65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d'
    );
  });

  it('safe: is silent on every version it lists', async () => {
    for (const hash of contractCodeHashes) {
      mockAccount.current = {
        address: contractAddress,
        codeHash: base64(hash),
        ownerAddress: ownerMultisig
      };
      expect(await shown()).toBeNull();
    }
  });

  it('safe: shouts for code it does not know', async () => {
    mockAccount.current = {
      address: contractAddress,
      codeHash: base64('11'.repeat(32)),
      ownerAddress: ownerMultisig
    };
    expect(await shown()).toMatch(/upgraded to code this site does not know/);
  });
});
