// Fourth audit, red team (RT1): the path of someone about to buy a claim key
// on a marketplace, from the NFT they see there to the truth on mvxvest.io.
//
// Outside this site a claim key is only its name and attributes, written once
// at mint and never changed ("Vesting #7 claim key",
// "tags:mvxvest,vesting;vesting:7;token:FOXSY-5d5f3e;cancelable:1"). The
// contract test audit4_redteam_marketplace_sale.rs walks the sale: the seller
// claims what has vested, lists the key, and whoever holds the cancel key
// (parked in a third wallet) cancels the moment the sale settles. Everything
// the buyer needed to know was on this site, and only here. Today:
//
// 1. The start page's box does not take what a marketplace shows: the NFT
//    identifier "VESTKEY-f56bea-07". It answers "Enter an erd1 address, a token
//    identifier such as FOXSY-123abc or a vesting number." (lookupTarget
//    returns null for it, for a cancel key too).
// 2. Pasting the collection "VESTKEY-f56bea" instead lands on the token page,
//    which reads /tokens/VESTKEY-f56bea, gets a 404 (it is a collection, not
//    a token) and says "the network did not answer" with a Try again button:
//    a dead end that looks like an outage.
// 3. The vesting page shows who holds the cancel key but never says what that
//    means to a buyer: that this holder can stop the vesting at any moment and
//    take everything not vested by then, and that the key itself never shows
//    what was claimed or whether the vesting was cancelled.
// 4. The guide's step 9 tells buyers to look the vesting up "here: it says
//    whether someone holds a cancel key", and nothing about what was claimed
//    or that the NFT's own attributes never change.
//
// Expected once fixed: the box resolves a key identifier to its vesting
// (claim keys: nonce = vesting number; cancel keys: getVestingByCancelNonce);
// the token page says that a 404 is "no such token", not an outage; the
// vesting page carries a notice for buyers of a cancelable vesting that is
// not cancelled; the guide says that claimed, claimable and the cancel key
// must be checked right before paying, because the key itself never changes.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Guide } from '../Guide';
import { lookupTarget } from '../Home';
import { Token } from '../Token';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const CREATOR =
  'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
/** The seller: the beneficiary, a wallet of the creator's. */
const SELLER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
/** The cold wallet the cancel key was parked in. */
const COLD = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const CLAIM_KEYS = 'VESTKEY-f56bea';
const CANCEL_KEYS = 'VESTCANCEL-ae94f5';
const E = 10n ** 18n;

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/missing', () => ({
  MISSING_AFTER_MS: 120_000,
  lostSend: async () => undefined
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async (identifier: string) => {
    if (identifier === 'VESTKEY-f56bea') {
      // What /tokens/VESTKEY-f56bea answers: it is a collection, not a token.
      const failure: any = new Error('/tokens/VESTKEY-f56bea answered 404');
      failure.status = 404;
      failure.retryable = false;
      throw failure;
    }
    return {
      identifier: 'FOXSY-5d5f3e',
      ticker: 'FOXSY',
      name: 'Foxsy',
      decimals: 18,
      verified: true
    };
  },
  historyOf: async () => [],
  keysCount: async () => 0,
  keyHolder: async (collection: string) =>
    collection === 'VESTCANCEL-ae94f5' ? COLD : SELLER,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/mine', () => ({
  tokenVestings: async () => ({ list: [], count: 0 })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    // A cancelable vesting of 10,000 FOXSY, a tenth claimed by the seller,
    // not cancelled (yet): what the page shows at the moment of the sale.
    vesting: async () => ({
      id: 7,
      creator: CREATOR,
      beneficiary: SELLER,
      token: 'FOXSY-5d5f3e',
      total: 10_000n * E,
      schedule: {
        start: T,
        cliff: T,
        cliffAmount: 0n,
        end: T + 1_000,
        curve: { kind: 'linear' }
      },
      cancelable: true,
      createdAt: T,
      claimNonce: 7,
      cancelNonce: 7,
      label: 'Advisors',
      claimed: 1_000n * E,
      cancelledAt: 0,
      vested: 2_000n * E,
      claimable: 1_000n * E,
      finalAmount: 10_000n * E,
      refunded: 0n,
      timestamp: T + 200
    }),
    collections: async () => ({ claim: CLAIM_KEYS, cancel: CANCEL_KEYS }),
    vestingCount: async () => 7,
    tokenTotals: async () => ({ deposited: 0n, claimed: 0n, refunded: 0n }),
    fee: async () => 100_000_000_000_000_000n,
    tokenFee: async () => 10
  }
}));

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await act(async () => undefined);
};

/** A sentence of the page (text between full stops) that matches every part. */
const sentenceWith = (text: string, ...parts: RegExp[]) =>
  text
    .split(/[.!]\s/)
    .some((sentence) => parts.every((part) => part.test(sentence)));

describe('audit 4, red team: a buyer of a claim key', () => {
  it('can look a key up by the NFT identifier a marketplace shows', () => {
    // The claim key of vesting #7 and the cancel key with nonce 7: neither is
    // a dead end.
    expect(lookupTarget(`${CLAIM_KEYS}-07`)).not.toBeNull();
    expect(lookupTarget(`${CANCEL_KEYS}-07`)).not.toBeNull();
    // What works today still works.
    expect(lookupTarget('7')).toBe('/v/7');
    expect(lookupTarget('FOXSY-5d5f3e')).toBe('/t/FOXSY-5d5f3e');
  });

  it('is not told "the network did not answer" when a collection is pasted as a token', async () => {
    jest.spyOn(Date, 'now').mockReturnValue((T + 200) * 1000);
    render(
      <MemoryRouter initialEntries={[`/t/${CLAIM_KEYS}`]}>
        <Routes>
          <Route path='/t/:token' element={<Token />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    // A 404 is the API's answer, not an outage: no "try again" dead end.
    expect(screen.queryByText(/network did not answer/i)).toBeNull();
    expect(
      screen.queryByText(
        /no such token|not a (fungible )?token|is a collection/i
      )
    ).not.toBeNull();
  });

  it('is warned on the vesting page about the cancel key before buying', async () => {
    jest.spyOn(Date, 'now').mockReturnValue((T + 200) * 1000);
    render(
      <MemoryRouter initialEntries={['/v/7']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    expect(screen.getByText('Keys and people')).toBeTruthy();
    const text = document.body.textContent ?? '';
    // Today: the cancel key's holder is named and nothing more. Expected: a
    // sentence for buyers that whoever holds the cancel key can stop the
    // vesting at any moment and keep what has not vested by then.
    expect(
      sentenceWith(
        text,
        /\bbuy/i,
        /cancel key/i,
        /stop|cancel|not vested|unvested/i
      )
    ).toBe(true);
    // And that the NFT itself never shows what was claimed or a cancel: only
    // this page does, so it is read right before paying, not the day before.
    expect(
      sentenceWith(
        text,
        /key (itself|NFT)|attributes|on the NFT/i,
        /claimed|cancel/i
      )
    ).toBe(true);
  });

  it('is told by the guide that the key itself never shows what was claimed', async () => {
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    await settle(4);
    const text = document.body.textContent ?? '';
    // Step 9 today: "Before buying a claim key, look the vesting up here: it
    // says whether someone holds a cancel key." Expected: also that the key's
    // attributes never change, so what was claimed, what is claimable and a
    // cancel show only here, and must be checked right before paying.
    expect(
      sentenceWith(text, /\bbuy/i, /claimed|attributes|never change/i)
    ).toBe(true);
  });
});
