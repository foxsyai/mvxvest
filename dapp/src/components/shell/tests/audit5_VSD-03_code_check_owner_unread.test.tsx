// Audit 5 (vest-dapp, VSD-03): the code-check banner fails open on its
// second half.
//
// Since the fourth audit (DT-3) CodeCheck says "could not be checked" when
// the read fails or when the answer carries no code hash. The owner half of
// the same check has no such guard: `ownerChanged` requires `data.owner`
// to be non-empty before it compares, so an answer that names the right code
// hash but no `ownerAddress` at all renders nothing, exactly like a contract
// whose owner was checked and found to be the multisig. The guide promises
// "Every page compares the contract's code and owner with these and warns at
// the top if they differ."
//
// The third test (control) passes today; the first two fail on 26b0d4c and
// pass once an answer without an owner is reported as not checked.

import { act, render, screen } from '@testing-library/react';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { CodeCheck } from '../CodeCheck';

const mockApi = jest.fn();
jest.mock('chain/network', () => ({
  api: (...args: unknown[]) => mockApi(...args)
}));

const base64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

/** The banner, or any text that says the contract could not be checked. */
const bannerText = () =>
  screen.queryByRole('alert')?.textContent ??
  screen.queryByRole('status')?.textContent ??
  null;

afterEach(() => mockApi.mockReset());

describe('VSD-03: an answer with the right code but no owner', () => {
  it('is reported as not checked, not as checked and right', async () => {
    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64(contractCodeHashes[0])
      // no ownerAddress
    });
    render(<CodeCheck />);
    await flush();
    // Today: null, the same as an owner checked and found right.
    expect(bannerText()).toMatch(/could not|not (be )?checked|unable/i);
  });

  it('an empty owner is reported the same way', async () => {
    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64(contractCodeHashes[0]),
      ownerAddress: ''
    });
    render(<CodeCheck />);
    await flush();
    expect(bannerText()).toMatch(/could not|not (be )?checked|unable/i);
  });

  it('control: code and owner right shows nothing; another owner is red', async () => {
    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64(contractCodeHashes[0]),
      ownerAddress: ownerMultisig
    });
    const { unmount } = render(<CodeCheck />);
    await flush();
    expect(bannerText()).toBeNull();
    unmount();

    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64(contractCodeHashes[0]),
      ownerAddress:
        'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp'
    });
    render(<CodeCheck />);
    await flush();
    expect(screen.queryByRole('alert')?.textContent).toMatch(
      /owner is no longer the multisig/
    );
  });
});
