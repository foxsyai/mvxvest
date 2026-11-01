// Fifth audit (DAPP, 1 Nov 2026): the guide's "What the owner can and
// cannot do" against the contract's own list of owner endpoints.
//
// The guide names: set the fees, pause the creation of new vestings, turn
// off the stamp, return bounced keys or tokens, upgrade. The ABI
// (vesting/mvxvest.abi.json, copied from the contract) also gives the owner
// setKeyDisplay, which sets the pictures and the metadata of every key
// minted from then on (keys.rs: mint_key takes uris and metadata from
// key_display). A buyer who compares a key's picture with the guide's
// pictures is not told that the owner can change what new keys look like.
// Nothing about money moves; the paragraph reads as the full list and is
// not.
//
// Expected once fixed: the paragraph says the owner can also change how new
// keys look (their pictures and metadata), or the paragraph says it is not
// the full list and points to the ABI.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import abi from 'vesting/mvxvest.abi.json';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 10n ** 17n,
    tokenFee: async () => 10,
    isKeyStamping: async () => true
  }
}));

it('the contract gives the owner setKeyDisplay, and the guide says what it does', async () => {
  const ownerOnly = (abi as any).endpoints
    .filter((e: any) => e.onlyOwner)
    .map((e: any) => e.name);
  expect(ownerOnly).toContain('setKeyDisplay');
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  const paragraph = screen.getByText(/What the owner can and cannot do/)
    .parentElement!.textContent!;
  expect(paragraph).toMatch(/set the fees/);
  expect(paragraph).toMatch(/pause the creation/);
  // Today: nothing about the look of the keys.
  expect(paragraph).toMatch(/look|picture|metadata|setKeyDisplay/i);
});
