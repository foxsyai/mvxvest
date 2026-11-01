// Fifth audit (DAPP, 1 Nov 2026): the banner that compares the contract's
// owner with the multisig named in the guide.
//
// The fourth audit (DT-3) made the code hash check say when it could not
// check instead of looking like a pass. The owner half of the same banner
// still fails open: CodeCheck.tsx reads `account.ownerAddress ?? ''` and
// then `ownerChanged = ... && data.owner !== '' && ...`, so an answer that
// carries the right code hash but no owner field at all is read as "owner
// unchanged" and the page shows nothing. The code hash alone does not cover
// it: changeOwnerAddress moves the owner without touching the code, and the
// new owner sets fees up to the caps, pauses creations and collects fees.
//
// Expected once fixed: an answer with no owner is "could not be checked",
// like an answer with no code hash.

import { act, render, screen } from '@testing-library/react';
import { CodeCheck } from '../CodeCheck';

const OWNER = 'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';
const HASH = '65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d';

const answer: { codeHash?: string; ownerAddress?: string } = {};

// Literals: the factory runs when CodeCheck imports config, before the
// constants above exist.
jest.mock('config', () => ({
  contractAddress:
    'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu',
  contractCodeHashes: [
    '65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d'
  ],
  ownerMultisig: 'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3'
}));
jest.mock('chain/network', () => ({
  api: async () => answer
}));

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => undefined);
};
const hashB64 = Buffer.from(HASH, 'hex').toString('base64');

describe('audit5 DAPP: the owner check with an answer that has no owner', () => {
  it('says the contract could not be checked, never nothing', async () => {
    answer.codeHash = hashB64;
    delete answer.ownerAddress;
    render(<CodeCheck />);
    await flush();
    // Today: no banner at all (the right code, and an owner read as "").
    expect(screen.queryByRole('status') ?? screen.queryByRole('alert')).not.toBeNull();
  });

  it('for the record: an answer with both fields right shows nothing, a wrong owner warns', async () => {
    answer.codeHash = hashB64;
    answer.ownerAddress = OWNER;
    const { unmount } = render(<CodeCheck />);
    await flush();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    answer.ownerAddress =
      'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
    render(<CodeCheck />);
    await flush();
    expect(screen.getByRole('alert').textContent).toMatch(/owner is no longer/);
  });
});
