// Second audit: the red banner around an upgrade. The site accepts every
// code hash in `contractCodeHashes`; before an upgrade a config lists the old
// and the new build, so the banner stays silent on both sides, and shouts
// for any other code. After the upgrade it lists the new one only: version 4
// (0e9ebff7…) on both networks since 1 Nov 2026. CI refuses a main that builds to a hash the mainnet config does
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
    // Version 4, upgraded on devnet in its rehearsal of 1 Nov 2026
    // (DEPLOY.md) and read from the API afterwards.
    expect(contractCodeHashes).toContain(
      '0e9ebff7c674c9fa4fb7c950a6edfb239a63ba688e88663b2f606ab45db04246'
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
