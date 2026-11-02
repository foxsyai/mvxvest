// Checked on 2 Nov 2026 with xPortal on devnet (BACKLOG: look at xPortal and a
// Ledger once). For a claim xPortal's approval screen shows the reader's own
// address as the Receiver, "1 VESTKEY-8f217c" and the network fee: no data. So
// no contract, no hexadecimal form and not even which key.
//
// Since the fifth audit (VSD-01) the guide's box "Check that it is the real
// mvxvest" and the guide for beneficiaries say: a wallet that decodes the
// transfer shows the contract as the destination; one that shows the raw
// fields shows your own address and that data. xPortal does neither. A reader
// with xPortal, the wallet the guide shows first, is told to compare something
// the screen does not show; a copy of the site sending the key elsewhere gives
// the very same screen. For these transactions the check that works in xPortal
// is the site's address, before connecting.
//
// These fail on a77d131 and pass once both guides say what xPortal shows, drop
// the decoding wallet and point xPortal users to the site's address.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 100_000_000_000_000_000n,
    tokenFee: async () => 10,
    isKeyStamping: async () => true
  }
}));

const guideText = async () => {
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
};

const beneficiaryGuide = () =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'beneficiary-guide.html'),
    'utf8'
  ).replace(/\s+/g, ' ');

// xPortal is named with what it leaves out: the data or where it goes.
const XPORTAL_NO_DATA =
  /xPortal[^.]*\bnot (the data|where)|xPortal does not show the data/;

describe('what the guides say xPortal shows for a claim', () => {
  it('How it works says xPortal does not show the data', async () => {
    const text = await guideText();
    expect(text).toMatch(XPORTAL_NO_DATA);
    expect(text).not.toMatch(/decodes the transfer/);
  });

  it('How it works makes the site address the check for xPortal', async () => {
    const text = await guideText();
    expect(text).toMatch(/bookmark/);
  });

  it('the guide for beneficiaries says the same', () => {
    const html = beneficiaryGuide();
    expect(html).toMatch(XPORTAL_NO_DATA);
    expect(html).not.toMatch(/decodes the transfer/);
    expect(html).toMatch(/bookmark/);
  });
});
