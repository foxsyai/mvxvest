// Fourth audit, WEB: what a reader can check against a clone of the site.
//
// The site is static files (and a reproducible build: this audit rebuilt the
// live bundle byte for byte from the commit in the footer). A clone on another
// domain, with the config pointing at a contract of its own, looks identical:
// the red code-hash banner is the clone's own code and stays green, the
// "Check that it is the real mvxvest" box shows the clone's values. Only two
// things survive a clone: the domain in the browser's address bar, and the
// receiver that the wallet shows before a signature (a Ledger shows it on the
// device). A creator who signs on a clone sends every beneficiary's tokens
// and the EGLD fee to the clone's contract; a beneficiary sends the claim key.
//
// The PDF for beneficiaries says "Check the address in your browser: only
// mvxvest.io". The guide on the site, which creators read, never names the
// domain, and neither text says what the wallet must show as the receiver.
//
// Expected once fixed: the guide names the only real domain, and the Verify
// box (or step 7, "Review, check and sign") says that the receiver shown by
// the wallet must be the contract address listed there.

import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 100000000000000000n,
    tokenFee: async () => 10
  }
}));

describe('audit 4, WEB: the guide against a clone of the site', () => {
  const text = async () => {
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    );
    // The live fee line settles.
    for (let i = 0; i < 3; i++) await act(async () => undefined);
    return document.body.textContent ?? '';
  };

  it('names the only real domain', async () => {
    expect(await text()).toMatch(/mvxvest\.io/);
  });

  it('says what the wallet must show as the receiver before a signature', async () => {
    expect(await text()).toMatch(/receiver|recipient/i);
  });
});
