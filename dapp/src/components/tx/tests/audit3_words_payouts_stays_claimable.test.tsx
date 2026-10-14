// Third audit (Fable 5.1, 14 Oct 2026), words: the new "what was paid" panel
// after a cancel says "Stays claimable by the beneficiary: X", where X is the
// contract's vestingCancelled `vested` field (events.rs, CancelledEvent). That
// field is everything vested at the cancel, claimed or not. What stays
// claimable with the claim key is vested minus what the beneficiary had
// already claimed (claim.rs: a claim pays vested_with_cancel - claimed). So
// whenever the beneficiary claimed before the cancel, the panel overstates
// what is left for them.
//
// The case: a 100 TFOX vesting, 60 vested at the cancel, 40 of it claimed
// earlier by the beneficiary. The cancel refunds 40 (not vested) and the
// contract logs {refund: 40, vested: 60}. 20 stays claimable, not 60.
//
// Expected once fixed: the panel says 20 TFOX stays claimable, or says "had
// vested" instead of "stays claimable" (as the contract field means).

import { act, render, screen } from '@testing-library/react';
import { Payouts } from '../Payouts';

const CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const T = 10n ** 18n;

jest.mock('config', () => jest.requireActual('config/config.devnet'));

/** A BigUint as the contract nests it in event data: 4-byte length, then bytes. */
const nestedBigUint = (value: bigint) => {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, 'hex');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
};
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64');

// The cancel of vesting #7, as the API returns it (the shape of the real
// devnet fixture payouts-cancel.json): one vestingCancelled event logged by
// the contract, data = CancelledEvent {refund, vested}.
const cancelTx = {
  txHash: 'cancel7',
  status: 'success',
  logs: {
    address: CONTRACT,
    events: [
      {
        address: CONTRACT,
        identifier: 'cancel',
        topics: [
          b64('vestingCancelled'),
          b64(Buffer.from('07', 'hex')),
          b64(Buffer.alloc(32, 1)),
          b64('TFOX-d61b09')
        ],
        data: b64(
          Buffer.concat([nestedBigUint(40n * T), nestedBigUint(60n * T)])
        )
      }
    ]
  }
};

jest.mock('chain/network', () => ({
  fresh: async (path: string) => {
    const ok = path.startsWith('/transactions/cancel7?');
    return { ok, status: ok ? 200 : 404, json: async () => cancelTx };
  },
  api: async () => ({
    identifier: 'TFOX-d61b09',
    ticker: 'TFOX',
    name: 'TFOX',
    decimals: 18,
    assets: {}
  })
}));

describe('audit 3, words: what a cancel leaves claimable', () => {
  it('does not call the whole vested part "stays claimable" when part of it was claimed before', async () => {
    render(<Payouts hashes={['cancel7']} />);
    for (let i = 0; i < 8; i++) await act(async () => undefined);

    const returned = screen.getByText(/Returned to this wallet/);
    expect(returned.textContent).toMatch(/40\s*TFOX/);

    // The beneficiary had claimed 40 of the 60 vested: 20 stays claimable.
    const stays = screen.queryByText(/Stays claimable by the beneficiary/);
    if (stays) expect(stays.textContent).not.toMatch(/\b60\s*TFOX/);
  });
});
