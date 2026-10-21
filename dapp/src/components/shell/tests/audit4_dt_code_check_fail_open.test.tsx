// Fourth audit (DT, 20 Oct 2026): the code-check banner fails open, and it
// checks once.
//
// CodeCheck reads /accounts/<contract> once per page load (useAsync with no
// dependencies) and shows its red banner only when the answer names a code
// hash or an owner this build does not know. When the read fails (the public
// API allows a visitor about two requests a second, a page start makes a
// dozen, and after four retries `api` throws), `data` stays undefined and the
// component renders nothing: the page then looks exactly like one whose
// contract was checked and found right. The guide promises "Every page
// compares the contract's code and owner with these and warns at the top if
// they differ." An answer without a code hash is silent the same way.
//
// And the check is never repeated. A tab left open (a treasury's dashboard,
// a Create page filled in the morning and signed in the afternoon) keeps
// preparing and signing against whatever the multisig has upgraded the
// contract to in the meantime, with no banner until a reload or until one of
// this tab's own transactions settles. The banner is the site's only answer
// to an upgrade (red team RT5); prepare() simulates against the live code.
//
// Expected once fixed: a failed read says the contract could not be checked
// right now (a quieter banner); the check is repeated every few minutes.

import { act, render, screen } from '@testing-library/react';
import { contractAddress, contractCodeHashes, ownerMultisig } from 'config';
import { CodeCheck } from '../CodeCheck';

const mockApi = jest.fn();
jest.mock('chain/network', () => ({
  api: (...args: unknown[]) => mockApi(...args)
}));

const base64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
};

/** The banner, or any text that says the contract could not be checked. */
const bannerText = () =>
  screen.queryByRole('alert')?.textContent ??
  screen.queryByRole('status')?.textContent ??
  screen.queryByText(/could not (be )?(check|verif|read)|not (been )?checked/i)
    ?.textContent ??
  null;

afterEach(() => {
  jest.useRealTimers();
  mockApi.mockReset();
});

describe('audit4 DT: the code-check banner', () => {
  it('says so when the contract could not be checked (the read failed)', async () => {
    mockApi.mockRejectedValue(
      new Error(`/accounts/${contractAddress} answered 429`)
    );
    render(<CodeCheck />);
    await flush();
    // Today: null, the same as a contract checked and found right.
    expect(bannerText()).toMatch(/could not|not (be )?checked|unable/i);
  });

  it('says so when the answer carries no code hash', async () => {
    mockApi.mockResolvedValue({
      address: contractAddress,
      ownerAddress: ownerMultisig
    });
    render(<CodeCheck />);
    await flush();
    // Today: null.
    expect(bannerText()).toMatch(/could not|not (be )?checked|unable/i);
  });

  it('notices an upgrade while the tab stays open', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64(contractCodeHashes[0]),
      ownerAddress: ownerMultisig
    });
    render(<CodeCheck />);
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();

    // The multisig upgrades the contract to code this build does not know.
    mockApi.mockResolvedValue({
      address: contractAddress,
      codeHash: base64('ab'.repeat(32)),
      ownerAddress: ownerMultisig
    });
    // Ten minutes pass with the tab open; nothing of this tab's was sent.
    for (let minute = 0; minute < 10; minute++) {
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      await flush();
    }
    // Today: still null; the page keeps preparing transactions for the new
    // code without a word.
    expect(screen.queryByRole('alert')?.textContent).toMatch(
      /upgraded to code this site does not know/
    );
  });
});
