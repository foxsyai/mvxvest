// The banner on every page: silent while the contract runs the code and has
// the owner this build knows, loud when either changes (red team RT5).

import { act, render, screen } from '@testing-library/react';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { CodeCheck } from '../CodeCheck';

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

it('says nothing when code and owner are the known ones', async () => {
  mockAccount.current = {
    address: contractAddress,
    codeHash: base64(contractCodeHashes[0]),
    ownerAddress: ownerMultisig
  };
  expect(await shown()).toBeNull();
});

it('warns when the owner changed', async () => {
  mockAccount.current = {
    address: contractAddress,
    codeHash: base64(contractCodeHashes[0]),
    ownerAddress:
      'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx'
  };
  expect(await shown()).toMatch(/owner is no longer the multisig/);
});
