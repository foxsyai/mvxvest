// Fourth audit (WEB-9): a label is anyone's 64 bytes, written by whoever
// created the vesting, and it was shown as plain prose: in bold at the top of
// the vesting page and next to the number on every card. A dust vesting
// labelled "Your FOXSY vesting moved: claim at …" read like a notice from the
// site in My vestings.
//
// Expected once fixed: a label is always in quotes and marked as the
// creator's words, on the page in words and on a card by its title.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VestingCard } from 'components/vesting/VestingCard';
import type { Vesting } from 'vesting/client';
import { VestingPage } from '../Vesting';

const LABEL = 'Your FOXSY vesting moved: claim at mvxvest-claim.example';

jest.mock('config', () => ({
  contractAddress:
    'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu'
}));
jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));

const T = 10n ** 18n;
const NOW = 1_792_000_000;
const vesting: Vesting = {
  id: 9,
  creator: 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx',
  beneficiary: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  token: 'FOXSY-5d5f3e',
  total: 1n * T,
  schedule: {
    start: NOW - 86_400,
    cliff: NOW - 86_400,
    cliffAmount: 0n,
    end: NOW + 86_400,
    curve: { kind: 'linear' }
  },
  cancelable: false,
  createdAt: NOW - 86_400,
  claimNonce: 9,
  cancelNonce: 0,
  label: LABEL,
  claimed: 0n,
  cancelledAt: 0,
  vested: T / 2n,
  claimable: T / 2n,
  finalAmount: 1n * T,
  refunded: 0n,
  timestamp: NOW
};

jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'FOXSY',
    decimals: 18,
    verified: true
  }),
  historyOf: async () => [],
  keyHolder: async () =>
    'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => vesting,
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    })
  }
}));

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

/** The label's own element, and the text and title around it. */
const shownLabel = () => {
  const own = screen.getByText(LABEL);
  return {
    quoted: own.parentElement?.textContent,
    title: own.closest('[title]')?.getAttribute('title') ?? ''
  };
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => jest.restoreAllMocks());

it('a card quotes the label and marks it as the creator’s', async () => {
  render(
    <MemoryRouter>
      <VestingCard vesting={vesting} now={NOW} />
    </MemoryRouter>
  );
  await flush();
  const { quoted, title } = shownLabel();
  expect(quoted).toBe(`“${LABEL}”`);
  expect(title).toMatch(/creator/i);
});

it('the vesting page quotes it and says in words whose it is', async () => {
  render(
    <MemoryRouter initialEntries={['/v/9']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  expect(shownLabel().quoted).toBe(`“${LABEL}”`);
  expect(screen.getByText(/the creator's label/)).toBeTruthy();
});
