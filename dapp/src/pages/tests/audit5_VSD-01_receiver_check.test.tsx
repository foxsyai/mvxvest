// Audit 5 (vest-dapp, VSD-01): the one check the site teaches against a clone
// cannot be made as written for most of the site's transactions.
//
// Since the fourth audit (WEB-2) the guide's step 7, the Verify box and the
// PDF for beneficiaries say: before approving, check that your wallet shows
// the vesting contract as the receiver. That is true of an EGLD vesting only.
// A claim and a cancel send an NFT (ESDTNFTTransfer, MultiESDTNFTTransfer for
// several keys), and a token vesting at today's fees sends the token plus the
// EGLD fee (MultiESDTNFTTransfer): the protocol routes every such transfer
// through the sender's own account, so the transaction's receiver field is
// the signer's own address and the contract appears only inside the data, as
// 64 hexadecimal characters. A wallet that decodes the transfer (xPortal, the
// web wallet) shows the destination; a device that shows the transaction's
// fields (a Ledger, which the guide offers) shows the signer's own address.
// A reader following the guide on a claim either learns to ignore the check
// or has nothing to compare; a clone's transaction would show the same
// receiver as the real site's.
//
// The first four tests pin the premise and pass today. The last three fail
// on 26b0d4c and pass once the guide (step 7 or the Verify box) and the
// beneficiaries' guide say that for a claim, a cancel or a token vesting the
// receiver shown is the reader's own address, and give the contract's
// hexadecimal form so the data shown by a device can be compared.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address } from '@multiversx/sdk-core';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { contractAddress } from 'config';
import { EGLD, VestingClient } from 'vesting/client';
import { Guide } from '../Guide';

const SENDER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const MAINNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const FEE = 100_000_000_000_000_000n; // 0.1 EGLD, the live fee
const T = 1_767_225_600;
const schedule = {
  start: T,
  cliff: T,
  cliffAmount: 0n,
  end: T + 3_600,
  curve: { kind: 'linear' as const }
};

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

const client = new VestingClient(contractAddress, {} as any, '1');
const contractHex = Address.newFromBech32(contractAddress).toHex();

const guideText = async () => {
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  return document.body.textContent ?? '';
};

describe('VSD-01, the premise (passes today): whose address is the receiver', () => {
  it('an EGLD vesting names the contract as the receiver', async () => {
    const tx = await client.create(
      SENDER,
      EGLD,
      { beneficiary: SENDER, total: 10n ** 18n, schedule },
      false,
      '',
      FEE,
      10
    );
    expect(tx.receiver.toBech32()).toBe(contractAddress);
  });

  it('a token vesting at the live fees names the signer as the receiver', async () => {
    const tx = await client.create(
      SENDER,
      'FOXSY-5d5f3e',
      { beneficiary: SENDER, total: 10n ** 18n, schedule },
      false,
      '',
      FEE,
      10
    );
    expect(tx.receiver.toBech32()).toBe(SENDER);
    const data = Buffer.from(tx.data).toString();
    expect(data).toMatch(/^MultiESDTNFTTransfer@/);
    expect(data).toContain(contractHex);
  });

  it('a claim names the signer as the receiver; the contract is only in the data', async () => {
    const tx = await client.claim(SENDER, 'VESTKEY-f56bea', [3]);
    expect(tx.receiver.toBech32()).toBe(SENDER);
    const data = Buffer.from(tx.data).toString();
    expect(data).toMatch(/^ESDTNFTTransfer@/);
    expect(data).toContain(contractHex);
  });

  it('a cancel names the signer as the receiver too', async () => {
    const tx = await client.cancel(SENDER, 'VESTCANCEL-ae94f5', [3]);
    expect(tx.receiver.toBech32()).toBe(SENDER);
  });
});

describe('VSD-01: what the site tells the reader to compare', () => {
  it('the guide says that a claim, a cancel or a token vesting shows the reader as the receiver', async () => {
    const text = await guideText();
    // Today: "check that your wallet shows the contract address ... as the
    // receiver", with no word that a claim or a token vesting shows the
    // reader's own address instead.
    expect(text).toMatch(
      /your own (wallet )?address|yourself as the receiver|the receiver is you|you(rself)? as (the )?receiver/i
    );
  });

  it('the guide gives the contract in the form the data shows (64 hex characters)', async () => {
    const text = await guideText();
    // What a device shows inside the data of an ESDTNFTTransfer, and the only
    // thing left to compare on such a transaction.
    expect(text).toContain(contractHex);
  });

  it('the guide for beneficiaries (claims only) says the same and gives the hex form', () => {
    const html = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'beneficiary-guide.html'),
      'utf8'
    );
    // Every claim is an ESDTNFTTransfer: no claim ever shows the contract as
    // the transaction's receiver.
    expect(html).toMatch(
      /your own (wallet )?address|yourself as the receiver|the receiver is you|you(rself)? as (the )?receiver/i
    );
    expect(html).toContain(Address.newFromBech32(MAINNET_CONTRACT).toHex());
  });
});
