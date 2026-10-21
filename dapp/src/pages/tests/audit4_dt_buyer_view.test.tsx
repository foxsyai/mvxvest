// Fourth audit (DT, 20 Oct 2026): what a buyer of a claim key learns here.
//
// The sales email's first two claims are about keys sold on a marketplace:
// the NFT's attributes never change, and with a cancelable vesting the holder
// of the cancel key can stop it right after a sale and keep the unvested
// rest. The site is the buyer's only live view. The guide (step 9) says:
// "Before buying a claim key, look the vesting up here: it says whether
// someone holds a cancel key."
//
// What the vesting page says today, for a cancelable vesting that is still
// running: the badge reads "Vesting", the lead reads "1,000 FOXSY of
// FOXSY-5d5f3e, linear over 1 year", and the fourth card, "Keys and people",
// lists "Cancel key (VESTCANCEL-ae94f5 #7)" with a shortened address. Nowhere
// does the page say in words that this vesting can be cancelled, by whom,
// or that the unvested part would then go to that holder and not to the
// buyer. A non-cancelable vesting does get the words ("none: this vesting
// can never be cancelled"), so a reader who has seen one of each might infer
// it. The cards on the address, token, My vestings and Created pages say
// nothing about it at all: a buyer looking up the seller's address sees
// "Vesting" and the progress, and cannot tell a cancelable vesting from one
// that cannot be stopped without opening each.
//
// Expected once fixed: a cancelable vesting says so in words on its page,
// near the top (who holds the cancel key and what a cancel does to the
// buyer), and its card carries a mark ("cancelable").

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VestingCard } from 'components/vesting/VestingCard';
import type { Vesting } from 'vesting/client';
import { VestingPage } from '../Vesting';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const CREATOR =
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const SELLER = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';

jest.mock('config', () => ({
  get contractAddress() {
    return CONTRACT;
  }
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
/** Cancelable, a quarter vested, nothing claimed, still running. */
const vesting: Vesting = {
  id: 7,
  creator: CREATOR,
  beneficiary: SELLER,
  token: 'FOXSY-5d5f3e',
  total: 1_000n * T,
  schedule: {
    start: NOW - 90 * 86_400,
    cliff: NOW - 90 * 86_400,
    cliffAmount: 0n,
    end: NOW + 275 * 86_400,
    curve: { kind: 'linear' }
  },
  cancelable: true,
  createdAt: NOW - 90 * 86_400,
  claimNonce: 7,
  cancelNonce: 7,
  label: 'Seed round',
  claimed: 0n,
  cancelledAt: 0,
  vested: 246n * T,
  claimable: 246n * T,
  finalAmount: 1_000n * T,
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
  // The claim key is with the seller, the cancel key with the creator.
  keyHolder: async (collection: string) =>
    collection.startsWith('VESTCANCEL') ? CREATOR : SELLER,
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

const SAYS_CANCELABLE = /can (still )?be cancelled|cancelable|cancellable/i;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => jest.restoreAllMocks());

describe('audit4 DT: a buyer looking at a cancelable vesting', () => {
  it('reads on its page, in words, that it can be cancelled', async () => {
    render(
      <MemoryRouter initialEntries={['/v/7']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    // Today: "Cancel key (VESTCANCEL-ae94f5 #7)" and "erd1u05m7s…gw5esx", and
    // not a word about what that means for whoever holds the claim key.
    expect(screen.queryByText(SAYS_CANCELABLE)).not.toBeNull();
  });

  it('sees it marked on its card (address, token, My vestings, Created pages)', async () => {
    render(
      <MemoryRouter>
        <VestingCard vesting={vesting} now={NOW} />
      </MemoryRouter>
    );
    await flush();
    // Today: "#7 Seed round, 1,000 FOXSY, Vesting" and the figures; nothing
    // tells it from a vesting that cannot be stopped.
    expect(screen.queryByText(SAYS_CANCELABLE)).not.toBeNull();
  });
});
