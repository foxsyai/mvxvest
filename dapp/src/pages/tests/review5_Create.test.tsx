// Fifth adversarial review: the Create page after 99e5aa2 ("never sign a
// possibly-lost send again"), end to end with the chain mocked out, as in
// review3_Create (one vesting per transaction).
//
// The rule of 99e5aa2: while a send of the creation is unconfirmed or
// "missing" (not seen for 2 minutes), nothing more of that creation is
// signed; the page offers the lines not created as a CSV instead. The page
// knows a send is missing only through `results`, which TxPanel fills with
// onFinished, and enforces the rule only on its own "Sign the remaining"
// block. Two ways past it:
//
// 1. An attempt opened ("Sign the remaining 2") before an earlier send went
//    missing keeps its "Sign in your wallet" button. The lost notice says
//    "nothing more of this creation is signed here" and hands out the file of
//    the lines not created, which lists that attempt's lines; the button
//    right above it then signs them (behind the lost nonce). A creator who
//    downloads, signs, reconnects and creates again from the file creates
//    those lines twice once the gap is filled.
// 2. TxPanel reports nothing while any hash of its send is pending, so a
//    missing hash followed by one still pending (a later nonce of the same
//    send, waiting behind the lost one) never reaches `results`: the panel
//    says "not found ... Do not sign it again ... before signing anything
//    else, disconnect and connect your wallet again", while the page offers
//    "Sign the remaining 1" and no file.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Create } from '../Create';

const A = 'erd14e7zqk5qz47fu7z75rmvzrzt5cvmffe9n7s73679xt6khu09erksehgl4u';
const B = 'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const C = 'erd1knjjk9nvl6tey3k0w0wfq964zpfu3gdm84ex6nqmz7plvq69je5sgkalrf';
const TOKEN = 'TFOX-d61b09';

const prepareMock = jest.fn();
const sendMock = jest.fn();
const createMock = jest.fn();
const outcomeMock = jest.fn();
/** Files the page handed to the reader. */
const mockDownloads: { name: string; text: string }[] = [];

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
  prepare: (...args: unknown[]) => prepareMock(...args),
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
  createdIdsOf: async () => [],
  outcomeOf: (hash: string) => outcomeMock(hash)
}));
jest.mock('chain/vesting', () => ({
  vesting: {
    fee: async () => 0n,
    creationPaused: async () => false,
    limits: async () => ({
      maxBatch: 1,
      maxBatchCancelable: 1,
      maxTranches: 120,
      maxLabelLen: 64,
      maxHorizon: 30 * 365 * 86_400,
      maxPage: 100
    }),
    create: (...args: unknown[]) => createMock(...args),
    createBatch: () => {
      throw new Error('unused: one vesting per transaction');
    }
  }
}));
jest.mock('vesting/csv', () => ({
  ...jest.requireActual('vesting/csv'),
  downloadFile: (name: string, text: string) =>
    mockDownloads.push({ name, text })
}));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

/** Results by hash; anything else is pending (and known to the API). */
let outcomes: Record<string, any> = {};
/** The sender's account nonce on the network (for the emulated prepare). */
let accountNonce = 42n;
/** Added to Date.now(), to pass TxPanel's 2-minute "missing" mark. */
let skew = 0;

beforeEach(() => {
  outcomes = {};
  accountNonce = 42n;
  skew = 0;
  mockDownloads.length = 0;
  prepareMock.mockReset();
  sendMock.mockReset();
  createMock.mockReset();
  outcomeMock.mockReset();
  const realNow = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
  // As chain/send's prepare(): nonces from the account's nonce, or from
  // firstNonce when that is higher.
  prepareMock.mockImplementation(
    async (_sender: string, txs: any[], firstNonce?: bigint) => {
      const start =
        firstNonce !== undefined && firstNonce > accountNonce
          ? firstNonce
          : accountNonce;
      txs.forEach((tx, index) => {
        tx.nonce = start + BigInt(index);
      });
      return { transactions: txs, problems: txs.map(() => null) };
    }
  );
  createMock.mockImplementation(
    async (sender: string, _token: string, entry: any) => ({
      sender,
      beneficiaries: [entry.beneficiary],
      data: new Uint8Array(100),
      gasLimit: 50_000_000n,
      nonce: 0n
    })
  );
  outcomeMock.mockImplementation(
    async (hash: string) => outcomes[hash] ?? { status: 'pending' }
  );
});

afterEach(() => jest.restoreAllMocks());

const fillForm = async (lines: [string, string][]) => {
  render(
    <MemoryRouter>
      <Create />
    </MemoryRouter>
  );
  await flush();
  fireEvent.change(screen.getByDisplayValue('Choose a token'), {
    target: { value: TOKEN }
  });
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
};

const checkAndSign = async () => {
  fireEvent.click(screen.getByText('Check and sign'));
  await flush();
  fireEvent.click(screen.getByText('Sign in your wallet'));
  await flush();
};

/** TxPanel's poll sees `outcomes`, then the clock passes 2 minutes. */
const twoMinutesLater = async () => {
  await wait(3_500);
  skew = 121_000;
  await wait(3_500);
  await flush();
};

/** Everything the page signed after the first send, by beneficiary. */
const signedLater = () =>
  sendMock.mock.calls
    .slice(1)
    .flatMap((call) => call[0].flatMap((tx: any) => tx.beneficiaries));

describe('review5: an attempt opened before a send went missing', () => {
  it('is not signed once the page says nothing more of the creation is signed', async () => {
    await fillForm([
      [A, '1000'],
      [B, '2000'],
      [C, '3000']
    ]);
    // A@42 is accepted; B is refused (rate limit), so B and C are not sent.
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A'],
      stopped: { at: 1, reason: 'Too Many Requests' },
      nextNonce: 43n
    });
    await checkAndSign();

    // A is pending, so the rest may be signed (by design): the creator opens
    // it, it is checked, and the panel waits for "Sign in your wallet".
    fireEvent.click(screen.getByText('Sign the remaining 2'));
    await flush();
    expect(screen.getByText('Sign in your wallet')).toBeTruthy();

    // A vanishes: the API has not heard of it for two minutes.
    outcomes = { 'hash-A': { status: 'pending', unknown: true } };
    await twoMinutesLater();
    expect(
      screen.getByText(/nothing more of this creation is signed here/)
    ).toBeTruthy();

    // The file of the lines not created lists B and C (true: not sent).
    fireEvent.click(screen.getByText('Download the lines not created (CSV)'));
    expect(mockDownloads).toHaveLength(1);
    expect(mockDownloads[0].text).toContain(B);
    expect(mockDownloads[0].text).toContain(C);

    // The panel opened before still offers "Sign in your wallet".
    const sign = screen.queryByText('Sign in your wallet');
    if (sign) {
      sendMock.mockResolvedValueOnce({
        hashes: ['hash-B', 'hash-C'],
        nextNonce: 45n
      });
      fireEvent.click(sign);
      await flush();
    }

    // Nothing more of this creation is signed while A's fate is unknown.
    // Today: B and C are signed (behind A's nonce), after a file listing
    // them as not created was handed out: created again from that file once
    // the reader reconnects, they are created twice when the gap fills.
    expect(signedLater()).toEqual([]);
  }, 40_000);
});

describe('review5: a missing send followed by one still pending', () => {
  it('stops the rest from being signed, as a missing send alone does', async () => {
    await fillForm([
      [A, '1000'],
      [B, '2000'],
      [C, '3000']
    ]);
    // A@42 and B@43 are accepted; C is refused (rate limit), not sent.
    sendMock.mockResolvedValueOnce({
      hashes: ['hash-A', 'hash-B'],
      stopped: { at: 2, reason: 'Too Many Requests' },
      nextNonce: 44n
    });
    await checkAndSign();

    // A vanishes; B, one nonce after it, waits behind it in the pool: the
    // API calls it pending, for as long as it stays there.
    outcomes = {
      'hash-A': { status: 'pending', unknown: true },
      'hash-B': { status: 'pending' }
    };
    await twoMinutesLater();
    expect(
      screen.getByText(/not found on the network for 2 minutes/)
    ).toBeTruthy();
    expect(
      screen.getByText(/Before signing anything else, disconnect/)
    ).toBeTruthy();

    // The page should not offer the rest while A's fate is unknown.
    const offered = screen.queryByText('Sign the remaining 1');
    if (offered) {
      fireEvent.click(offered);
      await flush();
      const sign = screen.queryByText('Sign in your wallet');
      if (sign) {
        sendMock.mockResolvedValueOnce({ hashes: ['hash-C'], nextNonce: 45n });
        fireEvent.click(sign);
        await flush();
      }
    }

    // Today: TxPanel reports nothing while B is pending, so the page never
    // learns that A is missing: no lost notice, no file, and C is signed
    // (behind A's nonce) through "Sign the remaining 1".
    expect(signedLater()).toEqual([]);
  }, 40_000);
});
