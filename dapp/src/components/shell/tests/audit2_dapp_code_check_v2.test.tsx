// Second audit: the red banner around the upgrade. The site accepts every
// code hash in `contractCodeHashes`; the devnet config lists version 1 and
// the rehearsed version 2 build (a7acbf22…), so the banner stays silent on
// both sides of the upgrade, and shouts for any other code. (The mainnet
// config listed version 1 only until DEPLOY.md's step 1 added version 2's
// hash; since the upgrade it lists version 2 only. CI refuses a main that
// builds to a hash the config does not list, or whose live hash it lacks.)

import { act, render, screen } from '@testing-library/react';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { CodeCheck } from '../CodeCheck';

// The devnet config, whichever network's config was copied last (a mainnet
// deploy leaves mainnet's in place, which lists version 2 only since the
// upgrade of 14 Oct 2026).
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
  it('safe: knows both versions', () => {
    expect(contractCodeHashes).toContain(
      'fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32'
    );
    // The build rehearsed on devnet on 13 Oct 2026 (DEPLOY.md), which the
    // devnet contract runs (read from the API on 14 Oct 2026).
    expect(contractCodeHashes).toContain(
      'a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a'
    );
  });

  it('safe: is silent on version 1 and on version 2', async () => {
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
