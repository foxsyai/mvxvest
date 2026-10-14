// Adversarial review: the history of a vesting misses its oldest events.
//
// historyOf(id) asks /events?address=<contract>&topics=<hex id> and stops after
// 1,000 events, newest first. The topic filter matches ANY topic: for id 1
// ("01") that is every key mint, transfer and burn of the contract (their
// quantity topic is 01). On devnet today 1,127 contract events match "01" and
// vesting #1's vestingCreated is the 1,125th (measured 12 Oct 2026 against
// https://devnet-api.multiversx.com), so devnet.mvxvest.io/v/1 shows no
// "Created" line. On mainnet every key ever moved adds to it.

import { historyOf } from '../reads';

// A virtual mock does not always reach chain/reads (third audit, C6): the
// devnet config is loaded for real instead.
jest.mock('config', () => jest.requireActual('config/config.devnet'));

const hex = (text: string) => Buffer.from(text).toString('hex');
const CREATOR =
  '048eb8f83ad06c983a64056351ef35c171eee810c9bfa9e9089bdab88a6d4eb0';
const KEY_HOLDER =
  'ae7c205a80157c9e785ea0f6c10c4ba619b4a7259fa1e8ebc532f56bf1e5c8ed';

// Newest first, as the API answers: 1,126 key transfers, then the creation.
const events = [
  ...Array.from({ length: 1126 }, (_, i) => ({
    txHash: `${i.toString(16).padStart(64, '0')}-1-0`,
    identifier: 'ESDTNFTTransfer',
    topics: [
      hex('VESTKEY-8f217c'),
      (i + 2).toString(16).padStart(4, '0'),
      '01',
      KEY_HOLDER
    ],
    timestamp: 1_791_813_317 - i
  })),
  {
    txHash: 'f302e8902e1c314c' + '0'.repeat(48) + '-0-1',
    identifier: 'create',
    topics: [
      hex('vestingCreated'),
      '01',
      CREATOR,
      KEY_HOLDER,
      hex('TFOX-d61b09')
    ],
    // total = 1000 (0x03e8) as a nested BigUint, then the rest of the struct.
    data: '0000000203e8' + '00'.repeat(20),
    timestamp: 1_791_809_588
  }
];

const apiMock = jest.fn(async (path: string) => {
  const from = Number(/from=(\d+)/.exec(path)?.[1] ?? 0);
  const size = Number(/size=(\d+)/.exec(path)?.[1] ?? 25);
  expect(path).toContain('topics=01');
  return events.slice(from, from + size);
});

jest.mock('../network', () => ({
  api: (path: string) => apiMock(path),
  apiUrl: 'https://devnet-api.multiversx.com'
}));

describe('review: history of a vesting', () => {
  it('vesting #1 shows its creation even when 1,000+ other events share its topic', async () => {
    const history = await historyOf(1);
    // Today: [] (the API was read 10 times, 1,000 events, and stopped).
    expect(history.map((event) => event.kind)).toContain('created');
  });
});
