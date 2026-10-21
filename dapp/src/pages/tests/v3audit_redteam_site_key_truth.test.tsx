// Audit of contract version 3 (Claude Fable 5.1, 21 Oct 2026), red team
// (V3R): what the site tells a buyer about a claim key once version 3 is
// live. Every test here FAILS on 7361158 (the dApp's words are version 2's)
// and passes once the site says what the stamp means and what it does not.
//
// Version 3 (contracts/vesting/src/keys.rs, stamp_claim_key): each claim that
// pays rewrites the returned key's name ("Vesting #7 claim key, cancelable,
// 25% claimed") and attributes (";claimed:<units>"). So, from then on:
// - the vesting page's buyer notice ("the key itself never shows what was
//   claimed or whether the vesting was cancelled", Vesting.tsx) and the
//   guide's step 9 ("The key itself never changes", Guide.tsx) are false: a
//   buyer who sees "25% claimed" on the NFT and reads "never shows" here
//   either distrusts this page or takes the key for a look-alike;
// - what stays true, and must be said instead, is the limit of the stamp
//   (v3audit_redteam_key_truth.rs pins each): it says what had been claimed at
//   the key's LAST claim, nothing about a cancel, nothing about claims made
//   while the owner had stamping off, and a key with no stamp may have paid
//   everything before version 3;
// - the owner's switch (setKeyStamping, isKeyStamping) is the one on-chain
//   sign that stamps have gone stale: the page must show it when it is off;
// - step 6 says a cancelable vesting's key "say[s] so in [its] attributes":
//   since version 3 it says so in its name, which marketplaces show.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Guide } from '../Guide';
import { VestingPage } from '../Vesting';

const T = 1_767_225_600;
const CREATOR =
  'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe';
const SELLER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const COLD = 'erd1q83m7yeunpjctjzyk6u30qfwphwvrg6ez0glcnar50s55dykcnqqr3s7j4';
const CLAIM_KEYS = 'VESTKEY-f56bea';
const CANCEL_KEYS = 'VESTCANCEL-ae94f5';
const E = 10n ** 18n;

/** What `isKeyStamping` answers; flipped by the test of the owner's switch. */
let stamping = true;

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
  tokenInfo: async () => ({
    identifier: 'FOXSY-5d5f3e',
    ticker: 'FOXSY',
    name: 'Foxsy',
    decimals: 18,
    verified: true
  }),
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
    // not cancelled: its key reads "Vesting #7 claim key, cancelable, 10%
    // claimed" on a marketplace.
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
    tokenFee: async () => 10,
    // Version 3's view: whether claims stamp the keys they return.
    isKeyStamping: async () => stamping
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

const renderVesting = async () => {
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
  return document.body.textContent ?? '';
};

describe('version 3 audit, red team: what the site says about a claim key', () => {
  it("the vesting page's buyer notice no longer says the key never shows what was claimed", async () => {
    stamping = true;
    const text = await renderVesting();
    // False since version 3: the key's name says what its claims paid.
    expect(text).not.toMatch(/key (itself |NFT )?never shows/i);
    expect(text).not.toMatch(/never changes/i);
    // True, and what a buyer needs: the name shows what had been claimed at
    // the key's last claim, not what was claimed since, and never a cancel.
    expect(
      sentenceWith(
        text,
        /name|stamp/i,
        /claimed/i,
        /last claim|as of|at its last|when it last|up to/i
      )
    ).toBe(true);
    expect(
      sentenceWith(
        text,
        /cancel/i,
        /name|stamp|key/i,
        /never|not|no\b/i,
        /show|say|tell|carr/i
      )
    ).toBe(true);
  });

  it('the vesting page says when the owner has turned the stamp off (stamps go stale)', async () => {
    stamping = false;
    const text = await renderVesting();
    expect(text).toMatch(
      /stamp\w*[^.]{0,40}\b(off|paused|stopped|not updated|no longer)/i
    );
  });

  it("the guide's step 9 no longer says the key itself never changes, and says what the name shows", async () => {
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    await settle(4);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/key itself never changes/i);
    // The stamp and its limits: the name says what was claimed at the last
    // claim; a cancel never shows on the key.
    expect(sentenceWith(text, /name/i, /claimed/i)).toBe(true);
    expect(
      sentenceWith(
        text,
        /cancel/i,
        /name|key/i,
        /never|not|no\b/i,
        /show|say|tell|carr/i
      )
    ).toBe(true);
    // Step 6: a cancelable vesting's key says so in its name, not only in
    // the attributes nobody shows.
    expect(sentenceWith(text, /cancelable/i, /\bname\b/i)).toBe(true);
  });
});
