// The guide ends with the short guide for people who only claim, as
// mvxsafe.io's ends with its signer's guide; the PDF it links is in public/.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/vesting', () => ({
  vesting: { fee: async () => 0n, tokenFee: async () => 0 }
}));

it('links the guide for beneficiaries, and the file is there', async () => {
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  const link = screen
    .getByText(/guide for beneficiaries \(PDF\)/)
    .closest('a')!;
  const href = link.getAttribute('href')!;
  expect(href).toBe('/mvxvest-for-beneficiaries.pdf');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(existsSync(join(__dirname, '../../../public', href))).toBe(true);
});
