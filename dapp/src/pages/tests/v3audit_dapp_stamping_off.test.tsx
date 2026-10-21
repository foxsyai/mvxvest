// Version 3 audit (V3O, operations and the dApp, 21 Oct 2026): the owner's
// switch makes old stamps lie, and the site does not know.
//
// Version 3 gives the owner `setKeyStamping(off)` (contracts/vesting/src/
// admin.rs), the emergency brake for the day the protocol's
// `ESDTMetaDataUpdate` changes. While it is off, `claim` pays as before but
// returns every key as it was: a key stamped "25% claimed" by an earlier
// claim keeps that name after a claim that took it to 90%. That is worse than
// no stamp: a marketplace buyer now reads a figure that looks exact and is
// stale. The contract says so in one view, `isKeyStamping` (views.rs), and
// the dApp reads nothing of it: dapp/src/vesting/client.ts has no
// isKeyStamping, and no page mentions the stamp or the switch. The site is
// "the buyer's live view" (fourth audit, RT1), so it is the place to say that
// the stamps are not being updated.
//
// Expected once fixed: the vesting page (for every vesting whose claim key
// is still out there, cancelable or not) reads `isKeyStamping` and, when it is off,
// says that the key's name is not being updated and may be stale, pointing at
// the live figures on the page. On version 2 the view does not exist, so the
// read must fail quietly (no notice, no error) until the upgrade. Fails on
// 7361158: the page shows nothing about stamping. On 5a4711d the cancelable
// case passes (the "Cancelable" notice carries the sentence) and the
// non-cancelable case still fails: that page has no such notice.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
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
/** 90% claimed: a key last stamped at a lower figure. Cancelable or not. */
const vestingOf = (cancelable: boolean): Vesting => ({
  id: 7,
  creator: CREATOR,
  beneficiary: SELLER,
  token: 'FOXSY-5d5f3e',
  total: 1_000n * T,
  schedule: {
    start: NOW - 300 * 86_400,
    cliff: NOW - 300 * 86_400,
    cliffAmount: 0n,
    end: NOW + 30 * 86_400,
    curve: { kind: 'linear' }
  },
  cancelable,
  createdAt: NOW - 300 * 86_400,
  claimNonce: 7,
  cancelNonce: cancelable ? 7 : 0,
  label: 'Seed round',
  claimed: 900n * T,
  cancelledAt: 0,
  vested: 909n * T,
  claimable: 9n * T,
  finalAmount: 1_000n * T,
  refunded: 0n,
  timestamp: NOW
});

let stamping: boolean | Error = false;
let vesting = vestingOf(false);

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
    vesting: async () => vesting,
    collections: async () => ({
      claim: 'VESTKEY-f56bea',
      cancel: 'VESTCANCEL-ae94f5'
    }),
    // Version 3's view; on version 2 the query fails ("function not found").
    isKeyStamping: async () => {
      if (stamping instanceof Error) throw stamping;
      return stamping;
    }
  }
}));

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

const page = async () => {
  render(
    <MemoryRouter initialEntries={['/v/7']}>
      <Routes>
        <Route path='/v/:id' element={<VestingPage />} />
      </Routes>
    </MemoryRouter>
  );
  await flush();
  return document.body.textContent!;
};

const STAMPS_OFF =
  /stamp[^.]{0,120}(off|not (being )?updated|no longer|stale|out of date)|(not (being )?updated|no longer updated|stale|out of date)[^.]{0,120}(name|key)/i;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => jest.restoreAllMocks());

describe('V3O: the owner turned the key stamping off', () => {
  it('the vesting page of a cancelable vesting says the key names are not being updated', async () => {
    stamping = false;
    vesting = vestingOf(true);
    const body = await page();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    // On 7361158: not a word about the stamp or the switch. On 5a4711d: the
    // "Cancelable" notice says the owner turned the stamp off.
    expect(body).toMatch(STAMPS_OFF);
  });

  it('the vesting page of a vesting that cannot be cancelled says so too', async () => {
    stamping = false;
    vesting = vestingOf(false);
    const body = await page();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    // Its claim key is sold on the same marketplaces and its stale name
    // misleads a buyer just the same. On 5a4711d the sentence lives only in
    // the "Cancelable" notice, so this page says nothing.
    expect(body).toMatch(STAMPS_OFF);
  });

  it('says nothing of it while stamping is on', async () => {
    stamping = true;
    vesting = vestingOf(false);
    const body = await page();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    expect(body).not.toMatch(STAMPS_OFF);
  });

  it('says nothing of it when the view does not exist (version 2) and still shows the vesting', async () => {
    stamping = new Error('invalid function (not found)');
    vesting = vestingOf(true);
    const body = await page();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    expect(body).not.toMatch(STAMPS_OFF);
    expect(body).not.toMatch(/Could not read this vesting/);
  });
});
