// Fifth audit (DAPP, 1 Nov 2026): on the vesting page and on My vestings,
// the transaction handed to the wallet against the words next to "Sign in
// your wallet". The real VestingClient builds the transactions; the
// network's simulation (chain/send.prepare) is replaced by a recorder.
// A person must sign exactly the key, and only the key, the page talks
// about: claim for the claim key of this vesting, cancel for its cancel
// key, Claim all for the keys of the vestings it counts.

import { Address } from '@multiversx/sdk-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Vesting } from 'vesting/client';
import { Mine } from '../Mine';
import { VestingPage } from '../Vesting';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const HOLDER = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const CREATOR =
  'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl';
const CLAIM_KEYS = 'VESTKEY-8f217c';
const CANCEL_KEYS = 'VESTCANCEL-bd731d';
const T = 10n ** 18n;
const NOW = 1_792_000_000;
const DAY = 86_400;

const prepared: any[][] = [];

jest.mock('config', () => ({
  contractAddress:
    'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
  keyCollections: { claim: 'VESTKEY-8f217c', cancel: 'VESTCANCEL-bd731d' }
}));
jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[]) => {
    prepared.push(txs);
    return { transactions: txs, problems: txs.map(() => null) };
  },
  send: jest.fn()
}));
jest.mock('chain/reads', () => ({
  EGLD_INFO: {
    identifier: 'EGLD-000000',
    ticker: 'EGLD',
    name: 'EGLD',
    decimals: 18
  },
  tokenInfo: async () => ({
    identifier: 'TFOX-d61b09',
    ticker: 'TFOX',
    name: 'TFOX',
    decimals: 18,
    verified: true
  }),
  historyOf: async () => [],
  // The holder has the claim key and, for this test, the cancel key too.
  keyHolder: async () =>
    'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u',
  keysCount: async () => 0,
  outcomeOf: async () => ({ status: 'pending' })
}));

const vestings: Record<number, Vesting> = {};
const mineList: Vesting[] = [];
jest.mock('chain/mine', () => ({
  claimableVestings: async () => mineList
}));
jest.mock('chain/vesting', () => {
  const { VestingClient } = jest.requireActual('vesting/client');
  const real = new VestingClient(
    'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp',
    {},
    'D'
  );
  return {
    vesting: {
      vesting: async (id: number) => vestings[id],
      collections: async () => ({
        claim: 'VESTKEY-8f217c',
        cancel: 'VESTCANCEL-bd731d'
      }),
      isKeyStamping: async () => true,
      claim: (...args: any[]) => real.claim(...args),
      cancel: (...args: any[]) => real.cancel(...args)
    }
  };
});

const utf8 = (s: string) => Buffer.from(s, 'utf8').toString('hex');
const pub = (bech32: string) => Address.newFromBech32(bech32).toHex();
const dataOf = (tx: any) => Buffer.from(tx.data).toString('utf8');

const make = (
  id: number,
  claimNonce: number,
  cancelNonce: number,
  extra: Partial<Vesting> = {}
): Vesting => ({
  id,
  creator: CREATOR,
  beneficiary: HOLDER,
  token: 'TFOX-d61b09',
  total: 1_000n * T,
  schedule: {
    start: NOW - 100 * DAY,
    cliff: NOW - 100 * DAY,
    cliffAmount: 0n,
    end: NOW + 265 * DAY,
    curve: { kind: 'linear' }
  },
  cancelable: cancelNonce > 0,
  createdAt: NOW - 100 * DAY,
  claimNonce,
  cancelNonce,
  label: '',
  claimed: 100n * T,
  cancelledAt: 0,
  vested: 273n * T,
  claimable: 173n * T,
  finalAmount: 1_000n * T,
  refunded: 0n,
  timestamp: NOW,
  ...extra
});

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined);
};

beforeEach(() => {
  prepared.length = 0;
  jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});
afterEach(() => jest.restoreAllMocks());

describe('audit5 DAPP: vesting page, claim and cancel bytes', () => {
  // Vesting 41 whose keys are nonces 39 (claim) and 12 (cancel): the ids and
  // the nonces differ on purpose, so a key built from the id would show.
  beforeEach(() => {
    vestings[41] = make(41, 39, 12);
  });

  it("Claim sends this vesting's claim key (its nonce, not its id) and says the claimable amount", async () => {
    render(
      <MemoryRouter initialEntries={['/v/41']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim'));
    await flush();
    expect(screen.getByText(/Claims what has vested/).textContent).toMatch(
      /about 173\s?TFOX now/
    );
    expect(prepared).toHaveLength(1);
    const [tx] = prepared[0];
    expect(prepared[0]).toHaveLength(1);
    expect(tx.sender.toBech32()).toBe(HOLDER);
    expect(dataOf(tx)).toBe(
      [
        'ESDTNFTTransfer',
        utf8(CLAIM_KEYS),
        '27',
        '01',
        pub(CONTRACT),
        utf8('claim')
      ].join('@')
    );
    expect(tx.value.toString()).toBe('0');
  });

  it("Cancel sends this vesting's cancel key only, and the words give the split the contract makes", async () => {
    render(
      <MemoryRouter initialEntries={['/v/41']}>
        <Routes>
          <Route path='/v/:id' element={<VestingPage />} />
        </Routes>
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Cancel this vesting'));
    await flush();
    const words = screen.getByText(/Stops vesting #41/).textContent ?? '';
    // claimable 173 stays, 100 was claimed, 727 (total - vested) comes back.
    expect(words).toMatch(/about 173\s?TFOX now is still claimable/);
    expect(words).toMatch(/100\s?TFOX was claimed before/);
    expect(words).toMatch(/about 727\s?TFOX/);
    const [tx] = prepared[0];
    expect(dataOf(tx)).toBe(
      [
        'ESDTNFTTransfer',
        utf8(CANCEL_KEYS),
        '0c',
        '01',
        pub(CONTRACT),
        utf8('cancel')
      ].join('@')
    );
    expect(dataOf(tx)).not.toContain(utf8(CLAIM_KEYS));
  });
});

describe('audit5 DAPP: My vestings, Claim all bytes', () => {
  it('sends exactly the claim keys of the vestings it counts, in one transaction, nothing else', async () => {
    const worth = make(5, 500, 0);
    const alsoWorth = make(6, 600, 0, {
      schedule: {
        start: NOW - 100 * DAY,
        cliff: NOW - 100 * DAY,
        cliffAmount: 0n,
        end: NOW + 265 * DAY,
        curve: {
          kind: 'tranches',
          tranches: [{ time: NOW + 265 * DAY, amount: 1_000n * T }]
        }
      },
      claimable: 1n
    });
    // A linear vesting with a few seconds' worth claimable: not worth a fee.
    const dust = make(7, 700, 0, { claimable: 10n ** 15n, claimed: 272n * T });
    mineList.splice(0, mineList.length, worth, alsoWorth, dust);
    render(
      <MemoryRouter>
        <Mine />
      </MemoryRouter>
    );
    await flush();
    fireEvent.click(screen.getByText('Claim all (2)'));
    await flush();
    expect(screen.getByText(/Claims what has vested on/).textContent).toMatch(
      /2 vestings/
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toHaveLength(1);
    const data = dataOf(prepared[0][0]);
    expect(data).toBe(
      [
        'MultiESDTNFTTransfer',
        pub(CONTRACT),
        '02',
        utf8(CLAIM_KEYS),
        '01f4',
        '01',
        utf8(CLAIM_KEYS),
        '0258',
        '01',
        utf8('claim')
      ].join('@')
    );
    // The dust key (700 = 0x2bc) is not among them.
    expect(data).not.toContain('@02bc@');
  });
});
