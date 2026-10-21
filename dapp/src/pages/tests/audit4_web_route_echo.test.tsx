// Fourth audit, WEB: text from the URL is shown as the page's own heading.
//
// /t/:token and /v/:id put the raw path segment into the H1 (the token page's
// title, "Vesting #…") before, or instead of, anything read from the chain,
// and /a/:address shows it shortened, with the whole text in the hover title.
// Nothing checks the segment's shape first, though every identifier has a
// strict one (lookupTarget on the start page knows them). So a link such as
//
//   https://mvxvest.io/t/FOXSY%20moved%20to%20claim-foxsy.app,%20connect%20there
//
// shows "FOXSY moved to claim-foxsy.app, connect there" as a heading on the
// real domain, in the site's typography, under its own navigation bar, with a
// notice about the network under it: a phishing message that carries
// mvxvest.io's name, sent to beneficiaries as a link to the real site. React
// escapes it, so no script runs; the harm is the words.
//
// Expected once fixed: a segment that is not a vesting number, a token
// identifier or an address is never echoed. The page says what it expected
// ("Not a token identifier", "Not a vesting number", "Not a MultiversX
// address") without repeating the text.

import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Account } from '../Account';
import { Token } from '../Token';
import { VestingPage } from '../Vesting';

jest.mock('lib', () => ({
  useGetAccount: () => ({ address: '' }),
  useGetIsLoggedIn: () => false
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({ prepare: jest.fn(), send: jest.fn() }));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  // The API answers 404 for a token that does not exist.
  tokenInfo: async (identifier: string) => {
    throw Object.assign(new Error(`/tokens/${identifier} answered 404`), {
      status: 404
    });
  },
  historyOf: async () => [],
  keyHolder: async () => null,
  keysCount: async () => 0,
  outcomeOf: async () => ({ status: 'pending' })
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    vesting: async () => {
      throw new Error('unknown vesting');
    },
    collections: async () => ({
      claim: 'VESTKEY-8f217c',
      cancel: 'VESTCANCEL-bd731d'
    }),
    tokenTotals: async () => {
      throw new Error('execution failed');
    }
  }
}));
jest.mock('chain/mine', () => ({
  tokenVestings: async () => ({ list: [], count: 0 }),
  createdVestings: async () => ({ list: [], count: 0 }),
  claimableVestings: async () => []
}));

/** What an attacker writes in the link: a sentence, not an identifier. */
const MESSAGE = 'FOXSY moved to claim-foxsy.app, connect there';

const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

const open = (path: string, route: string, element: JSX.Element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>
  );

describe('audit 4, WEB: a path segment is shown as the page heading', () => {
  it('the token page does not echo a segment that is not a token identifier', async () => {
    open(`/t/${encodeURIComponent(MESSAGE)}`, '/t/:token', <Token />);
    await settle();
    expect(
      screen.queryByRole('heading', { name: new RegExp(MESSAGE) })
    ).toBeNull();
    expect(document.body.textContent).not.toContain(MESSAGE);
  });

  it('the vesting page does not echo a segment that is not a vesting number', async () => {
    open(`/v/${encodeURIComponent(MESSAGE)}`, '/v/:id', <VestingPage />);
    await settle();
    expect(
      screen.queryByRole('heading', { name: new RegExp(MESSAGE) })
    ).toBeNull();
    expect(document.body.textContent).not.toContain(MESSAGE);
  });

  it('the address page does not echo a segment that is not an address', async () => {
    open(`/a/${encodeURIComponent(MESSAGE)}`, '/a/:address', <Account />);
    await settle();
    // Shortened on the page (the first and last characters), whole in the
    // hover title and in the explorer link.
    const lower = MESSAGE.toLowerCase();
    expect(document.body.innerHTML).not.toContain(lower);
    expect(document.body.textContent).not.toContain(lower.slice(0, 10));
    expect(
      screen.queryByText(/This is not a MultiversX address/)
    ).not.toBeNull();
  });
});
