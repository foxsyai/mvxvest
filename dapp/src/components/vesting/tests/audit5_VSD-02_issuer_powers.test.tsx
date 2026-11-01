// Audit 5 (vest-dapp, VSD-02): the issuer's powers, as the site lists them,
// leave out the two that matter most to a beneficiary.
//
// IssuerPowers (vesting, token and create pages) turns a token's flags into
// words. For a token whose issuer keeps `canAddSpecialRoles` it says the
// issuer can "add a transfer role", and the tooltip says such a role "limits
// who may move the token". Two facts of the protocol are missing:
//
// 1. While `canAddSpecialRoles` holds, the issuer can give any address,
//    itself included, the local mint role, and that address then mints any
//    amount of the token: the supply behind every vesting can be multiplied
//    at will. `canMint` being off does not stop it (that flag is the old
//    global mint). Nothing on the page says "mint".
// 2. The first address given the transfer role stops every ordinary transfer
//    of the token, for everyone, this contract's payouts included, until the
//    last such role is removed. "Limits who may move the token" reads like a
//    setting about other people.
//
// Both are the token's own settings, which the contract cannot prevent; the
// site's job is to say them. The token below is made up; its flags are a
// common kind, as the API reports them (no freeze, no wipe, pause and
// special roles kept, upgradeable). The last two tests fail on 26b0d4c.

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IssuerPowers, issuerPowers } from '../TokenTrust';

const TOKEN = {
  identifier: 'TEAMX-a1b2c3',
  ticker: 'TEAMX',
  name: 'Team X',
  verified: true,
  owner: 'erd1cn8w9h2gfks6fglhxcmfka5w98hym47s0w8r9y4nqq9syh3ddfvsr0ljwe',
  isPaused: false,
  canPause: true,
  canFreeze: false,
  canWipe: false,
  canAddSpecialRoles: true,
  canUpgrade: true,
  canChangeOwner: false,
  transferRole: false
};

describe('VSD-02, controls (pass today)', () => {
  it('a token whose issuer kept nothing has no powers and no notice', () => {
    const none = {
      ...TOKEN,
      canPause: false,
      canAddSpecialRoles: false,
      canUpgrade: false
    };
    expect(issuerPowers(none)).toEqual([]);
    const { container } = render(<IssuerPowers token={none} />);
    expect(container.textContent).toBe('');
  });

  it('pause is named as what it is', () => {
    expect(
      issuerPowers({ ...TOKEN, canAddSpecialRoles: false, canUpgrade: false })
    ).toEqual(['pause all its transfers']);
  });
});

describe('VSD-02: canAddSpecialRoles', () => {
  it('says the issuer can let any address mint the token without limit', () => {
    const words = issuerPowers(TOKEN).join(' ');
    // Today: "pause all its transfers, add a transfer role and change these
    // settings": not a word about minting.
    expect(words).toMatch(/mint/i);
    // Inside a router: the owner's address is a link. (The proof as written
    // never got this far before the fix: the line above failed first.)
    const { container } = render(
      <MemoryRouter>
        <IssuerPowers token={TOKEN} />
      </MemoryRouter>
    );
    expect(container.textContent).toMatch(/mint/i);
  });

  it('says a transfer role stops the transfers of everyone, not that it "limits who may move" it', () => {
    const power = issuerPowers(TOKEN).find((p) => /transfer role/i.test(p));
    expect(power).toBeDefined();
    expect(power).toMatch(/stop|halt|block/i);
    expect(power).toMatch(/all|every|everyone|anyone/i);
  });
});
