// Fourth audit (DT, 20 Oct 2026): after a partial send and a fee vote, the
// review box disagrees with itself: "Fees" shows the rate the creation was
// frozen at, "You pay in TFOX" is computed at the contract's new rate.
//
// The second audit (dApp finding 2) made the review show the fees it was
// checked at once anything was sent: `shownFee`, `shownBps` and
// `shownTokenFeeTotal` come from the frozen review. The row right under
// them, "You pay in <ticker>", still adds the LIVE `tokenFeeTotal` and
// `feeTotal` (Create.tsx, the dd of "You pay in"), which the page reads again
// as soon as a transaction of the creation settles. Three vestings of 1,000,
// 2,000 and 3,000 TFOX at 0.1%: the first executes, the multisig votes 0.2%,
// the other two fail for their payment, the page reads the settings again
// and shows "Fees: 6 TFOX (0.1% of each vesting)" next to "You pay in TFOX:
// 6,012 TFOX". What was signed, and what "Sign the remaining" would sign,
// pays 6,006. Harmless to funds (the remaining transactions are withheld
// when the fees changed, audit 2), but a figure on the review screen that
// is not what is signed, which the review exists to prevent.
//
// Expected once fixed: every figure of the review is computed from the
// frozen fees once anything of it was sent.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const C = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const TOKEN = 'TFOX-d61b09';
const WRONG_DEPOSIT = 'payment must equal the vested total plus the fee';

const contract = { bps: 10 };
const sendMock = jest.fn();
const outcomeMock = jest.fn();

jest.mock('lib', () => ({
  useGetAccount: () => ({
    address: 'erd1qj8t37p66pkfswnyq434rme4c9c7a6qsexl6n6ggn0dt3zndf6cqr9lekl'
  }),
  useGetIsLoggedIn: () => true
}));
jest.mock('chain/network', () => ({
  explorerUrl: 'https://devnet-explorer.multiversx.com'
}));
jest.mock('chain/send', () => ({
  prepare: async (_sender: string, txs: any[], firstNonce?: bigint) => {
    const start = firstNonce ?? 42n;
    txs.forEach((tx, index) => {
      tx.nonce = start + BigInt(index);
    });
    return { transactions: txs, problems: txs.map(() => null) };
  },
  send: (...args: unknown[]) => sendMock(...args)
}));
jest.mock('chain/reads', () => ({
  balancesOf: async () => [
    {
      identifier: 'EGLD-000000',
      ticker: 'EGLD',
      name: 'EGLD',
      decimals: 18,
      balance: 10n ** 21n
    },
    {
      identifier: 'TFOX-d61b09',
      ticker: 'TFOX',
      name: 'TFOX',
      decimals: 18,
      balance: 10n ** 30n
    }
  ],
  tokenInfo: async () => ({
    identifier: 'TFOX-d61b09',
    ticker: 'TFOX',
    name: 'TFOX',
    decimals: 18
  }),
  createdIdsOf: async () => [],
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    tokenFee: async () => contract.bps,
    creationPaused: async () => false,
    // One vesting per transaction.
    limits: async () => ({
      maxBatch: 1,
      maxBatchCancelable: 1,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: async (sender: string, _token: string, entry: any) => ({
      sender,
      beneficiaries: [entry.beneficiary],
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    }),
    createBatch: () => {
      throw new Error('unused: one vesting per transaction');
    }
  }
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

let outcomes: Record<string, any> = {};

beforeEach(() => {
  contract.bps = 10;
  outcomes = {};
  sendMock.mockReset();
  outcomeMock.mockReset();
  outcomeMock.mockImplementation(
    async (hash: string) => outcomes[hash] ?? { status: 'pending' }
  );
  jest.spyOn(document, 'hasFocus').mockImplementation(() => true);
});
afterEach(() => jest.restoreAllMocks());

const row = (label: string) =>
  (screen.getByText(label).nextSibling as HTMLElement).textContent ?? '';

describe('audit4 DT: the review after a partial send and a fee vote', () => {
  it('"You pay in" agrees with the frozen "Fees" row', async () => {
    render(
      <MemoryRouter>
        <Create />
      </MemoryRouter>
    );
    await flush();
    fireEvent.change(screen.getByDisplayValue('Choose a token'), {
      target: { value: TOKEN }
    });
    const lines: [string, string][] = [
      [A, '1000'],
      [B, '2000'],
      [C, '3000']
    ];
    lines.forEach(([address, amount], index) => {
      if (index > 0) fireEvent.click(screen.getByText('Add a beneficiary'));
      fireEvent.change(
        screen.getAllByPlaceholderText('erd1... beneficiary address')[index],
        { target: { value: address } }
      );
      fireEvent.change(screen.getAllByPlaceholderText(/^Amount/)[index], {
        target: { value: amount }
      });
    });
    fireEvent.click(screen.getByText('Cannot be cancelled'));
    await flush();
    expect(row('Fees')).toMatch(/0\.1% of each vesting/);
    expect(row('You pay in TFOX')).toMatch(/6,006/);

    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A', 'hash-B', 'hash-C'],
      nextNonce: 45n
    });
    fireEvent.click(screen.getByText('Check and sign'));
    await flush();
    fireEvent.click(screen.getByText('Sign in your wallet'));
    await flush();

    // A executes; the multisig votes 0.2%; B and C fail for their payment.
    contract.bps = 20;
    outcomes = {
      'hash-A': { status: 'success' },
      'hash-B': { status: 'fail', reason: WRONG_DEPOSIT },
      'hash-C': { status: 'fail', reason: WRONG_DEPOSIT }
    };
    await wait(3_500);
    await flush();
    // The settings were read again: the Fees row stays frozen (audit 2)...
    expect(row('Fees')).toMatch(/0\.1% of each vesting/);
    // ...and the row under it must say the same creation's figure. Today:
    // "6,012 TFOX" (0.2% of 6,000 on top), next to "6 TFOX (0.1% ...)".
    expect(row('You pay in TFOX')).not.toMatch(/6,012/);
    expect(row('You pay in TFOX')).toMatch(/6,006/);
  }, 20_000);
});
