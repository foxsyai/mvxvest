// Red team: the Guide gives a reader nothing to verify against.
//
// Phishing needs nothing more than a look-alike: a collection "MvxVestClaimKey"
// with ticker VESTKEY gets an identifier VESTKEY-xxxxxx of its own, its NFTs
// can be named "Vesting #12 claim key" and can point at the real images
// (https://mvxvest.io/nft/ is served without the beta password, on purpose).
// A clone of the site can point at a contract of its own. The only defence a
// reader has is to compare identifiers, and the Guide names none: not the
// contract address, not the two collections, not the owner multisig, its
// signers or its quorum (DECISIONS.md #3 says the site names them; the
// BACKLOG lists the owner part as not done). It also promises "a vesting
// cannot be redirected" without the one exception that exists: a key that
// bounced is sent wherever the owner decides (recoverBouncedKey(id, kind, to)).
//
// Expected once fixed: the Guide (or a "Verify" box on it) shows the contract
// address, the two collection identifiers, the owner address with its quorum,
// and tells readers that a key from any other collection is not from mvxvest.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { contractAddress } from 'config';
import { Guide } from '../Guide';

jest.mock('chain/network', () => ({
  explorerUrl: 'https://explorer.multiversx.com'
}));

describe('red team: what the Guide lets a reader verify', () => {
  beforeEach(() =>
    render(
      <MemoryRouter>
        <Guide />
      </MemoryRouter>
    )
  );

  it('names the contract', () => {
    // The whole address: every contract address starts with the same 20
    // characters, the owner multisig's included.
    expect(screen.queryAllByText(new RegExp(contractAddress))).not.toHaveLength(
      0
    );
  });

  it('names the two key collections', () => {
    // All: step 9 also shows a key's identifier as an example (fourth audit).
    expect(screen.queryAllByText(/VESTKEY-[0-9a-f]{6}/)).not.toHaveLength(0);
    expect(screen.queryAllByText(/VESTCANCEL-[0-9a-f]{6}/)).not.toHaveLength(0);
  });

  it('names the owner multisig and its quorum', () => {
    expect(screen.queryAllByText(/\b\d of \d\b|quorum/i)).not.toHaveLength(0);
  });
});
