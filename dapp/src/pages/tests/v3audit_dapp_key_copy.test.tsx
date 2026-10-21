// Version 3 audit (V3O, operations and the dApp, 21 Oct 2026): two sentences
// of the site become false the moment version 3 is live.
//
// Version 3's `claim` rewrites each claim key that paid and goes back
// (`ESDTMetaDataUpdate`, contracts/vesting/src/keys.rs stamp_claim_key): its
// name gains ", 25% claimed" and its attributes ";claimed:<units>". The site
// still says the opposite, in the two places a buyer of a key reads before
// paying:
//   - the guide, step 9 "Move a claim key": "The key itself never changes
//     either" (dapp/src/pages/Guide.tsx);
//   - the vesting page's "Cancelable" notice: "the key itself never shows
//     what was claimed or whether the vesting was cancelled"
//     (dapp/src/pages/Vesting.tsx).
// A buyer who sees "Vesting #7 claim key, cancelable, 25% claimed" in a
// wallet and reads here that keys never change and never show what was
// claimed will trust one of the two less, and the one that is wrong is the
// site. The second half of the vesting page's sentence stays true (a cancel
// cannot be written into the key: the contract does not hold it then) and
// matters more, so it must be kept.
//
// Expected once fixed: the guide says the key's name (and attributes) say
// what its claims have paid, as of its last claim; the vesting page's notice
// says the key never shows whether the vesting was cancelled, without
// claiming it never shows what was claimed. Both fail on 7361158 (the site
// has no notion of the stamp there); on 5a4711d the site reads
// `isKeyStamping` (true here: version 3 live, stamp on) and both pass. With
// the view absent (version 2 live) the old sentences stay, which is right.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { Guide } from '../Guide';
import { VestingPage } from '../Vesting';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const CREATOR =
  'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const SELLER = 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';

jest.mock('config', () => ({
  ...jest.requireActual('config'),
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
/** Cancelable, a quarter vested, a tenth claimed, still running. */
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
  claimed: 100n * T,
  cancelledAt: 0,
  vested: 246n * T,
  claimable: 146n * T,
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
  keyHolder: async (collection: string) =>
    collection.startsWith('VESTCANCEL') ? CREATOR : SELLER,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    // Mainnet's fees (the guide reads them).
    fee: async () => 100_000_000_000_000_000n,
    tokenFee: async () => 10,
    vesting: async () => vesting,
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    // Version 3 is live and stamping is on (the view exists and answers true).
    isKeyStamping: async () => true
  }
}));

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => jest.restoreAllMocks());

describe('V3O: what the site says about a claim key once version 3 stamps it', () => {
  it('the guide no longer says the key itself never changes', async () => {
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    await flush();
    const step =
      screen.getByText('Move a claim key').parentElement!.textContent!;
    // Today: "The key itself never changes either: before buying one, look
    // its vesting up here right before paying".
    expect(step).not.toMatch(/key itself never changes/i);
    expect(document.body.textContent).not.toMatch(/never changes either/i);
    // Once fixed, the step says what the key's name now carries.
    expect(step).toMatch(/\bname\b/i);
    expect(step).toMatch(/claimed/i);
  });

  it('the vesting page no longer says the key never shows what was claimed, and still says it never shows a cancel', async () => {
    render(
      <MemoryRouter initialEntries={['/v/7']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    const body = document.body.textContent!;
    expect(body).toMatch(/Cancelable\./);
    // Today: "the key itself never shows what was claimed or whether the
    // vesting was cancelled."
    expect(body).not.toMatch(/never shows what was claimed/i);
    // The true half must stay: a cancel is never written into the key.
    expect(body).toMatch(
      /never (shows|says)[^.]{0,80}cancel|cancel[^.]{0,80}(is never|cannot be|not) (written|shown|stamped)/i
    );
  });
});
