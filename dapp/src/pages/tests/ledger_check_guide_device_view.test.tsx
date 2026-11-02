// Checked on 2 Nov 2026 with a Ledger Flex on devnet (BACKLOG: look at xPortal
// and a Ledger once). For a claim the Ledger shows the reader's own address as
// the Receiver, 0 EGLD, the fee, then the data in raw form, cut short:
// "[Size: 128] ESDTNFTTransfer@564553544b45592d386632313763@02df@01@00000000
// 000000000500eda3c303c22c4cf1a240..." The contract's last 24 hexadecimal
// characters and the function's name never show. A Nano S Plus or a Nano X
// shows less: the MultiversX app keeps the data's first 64 characters there
// (MAX_DISPLAY_DATA_SIZE for BAGL devices in multiversx/mx-ledger-nano,
// src/constants.h), which on a claim ends inside the zeros every contract
// starts with.
//
// Since the xPortal check both guides say that a wallet or device that shows
// the data shows the contract there. Both give its 64 hexadecimal characters.
// A Ledger reader cannot compare them: the end is not on the screen. Every
// contract's form starts with the same 20 characters (8 zero bytes and the
// VM type, 0500). Its last 4 come from the address that deployed it. So
// neither end tells contracts apart. What does is the run right after 0500,
// which a Flex shows on a claim.
//
// The premise passes today. The guides' tests fail on a1a41f9 and pass once
// both guides give that run, say a Ledger shows only the start of the data and
// make the site's address the check when the screen ends before the run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address } from '@multiversx/sdk-core';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { contractAddress, keyCollections } from 'config';
import { VestingClient } from 'vesting/client';
import { Guide } from '../Guide';

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

/** Characters of the data a Ledger shows, "[Size: n]" aside. */
const FLEX = 93; // photographed on 2 Nov 2026
const NANO = 64; // the app's source

/** Every contract's hexadecimal form starts with this. */
const COMMON = '00000000000000000500';
/** The fewest characters after COMMON worth comparing (64 bits). */
const RUN = 16;

const SENDER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const DEVNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const MAINNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const MAINNET_CLAIM_KEY = 'VESTKEY-f56bea';

const hexOf = (bech32: string) => Address.newFromBech32(bech32).toHex();

const claimData = async (contract: string, key: string, nonce: number) => {
  const client = new VestingClient(contract, {} as any, '1');
  const tx = await client.claim(SENDER, key, [nonce]);
  return Buffer.from(tx.data).toString();
};

const cancelData = async (contract: string, key: string, nonce: number) => {
  const client = new VestingClient(contract, {} as any, '1');
  const tx = await client.cancel(SENDER, key, [nonce]);
  return Buffer.from(tx.data).toString();
};

/** What of the contract a device showing `chars` characters of the data shows. */
const contractShown = (data: string, hex: string, chars: number) => {
  const at = data.indexOf(`@${hex}`) + 1;
  return data.slice(at, Math.max(at, chars));
};

const guideText = async () => {
  render(
    <MemoryRouter>
      <Guide />
    </MemoryRouter>
  );
  for (let i = 0; i < 4; i++) await act(async () => undefined);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
};

const beneficiaryText = () =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'docs', 'beneficiary-guide.html'),
    'utf8'
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\s+/g, ' ');

/**
 * The run of the contract's hexadecimal form after COMMON that a text gives
 * on its own, apart from the whole 64 characters.
 */
const runGiven = (text: string, hex: string) =>
  (text.match(/(?<![0-9a-f])[0-9a-f]+(?![0-9a-f])/g) ?? []).find(
    (run) => run !== hex && run.length >= RUN && hex.startsWith(COMMON + run)
  );

/** Where the run stands on its own, not inside the whole 64 characters. */
const runAt = (text: string, run: string) =>
  text.search(new RegExp(`(?<![0-9a-f])${run}(?![0-9a-f])`));

const nonces = [1, 0x2df, 0xffff];

describe('Ledger, the premise (passes today): the data is cut short', () => {
  it('the Flex cut the devnet claim it was shown after 40 characters of the contract', async () => {
    const hex = hexOf(DEVNET_CONTRACT);
    const data = await claimData(DEVNET_CONTRACT, 'VESTKEY-8f217c', 0x2df);
    expect(data).toHaveLength(128);
    expect(contractShown(data, hex, FLEX)).toBe(
      '00000000000000000500eda3c303c22c4cf1a240'
    );
  });

  it('a claim or a cancel never shows the whole contract on a Ledger', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of nonces) {
      for (const data of [
        await claimData(contractAddress, keyCollections.claim, nonce),
        await cancelData(contractAddress, keyCollections.cancel, nonce)
      ]) {
        expect(contractShown(data, hex, FLEX)).not.toBe(hex);
        expect(data.slice(0, FLEX)).not.toContain(hex.slice(-4));
      }
    }
  });

  it('on a Nano a claim ends before any character that tells contracts apart', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of nonces) {
      const data = await claimData(
        contractAddress,
        keyCollections.claim,
        nonce
      );
      expect(COMMON.startsWith(contractShown(data, hex, NANO))).toBe(true);
    }
  });

  it('on a Flex a claim shows at least 16 characters after 0500', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of nonces) {
      const data = await claimData(
        contractAddress,
        keyCollections.claim,
        nonce
      );
      expect(contractShown(data, hex, FLEX)).toContain(
        COMMON + hex.slice(COMMON.length, COMMON.length + RUN)
      );
    }
  });
});

describe('what the guides tell a Ledger reader to compare', () => {
  it('How it works gives the run after 0500 that a Flex shows on a claim', async () => {
    const hex = hexOf(contractAddress);
    const run = runGiven(await guideText(), hex);
    expect(run).toBeDefined();
    for (const nonce of nonces) {
      const data = await claimData(
        contractAddress,
        keyCollections.claim,
        nonce
      );
      expect(data.slice(0, FLEX)).toContain(COMMON + run);
    }
  });

  it('How it works says a Ledger shows only the start and what counts past it', async () => {
    const text = await guideText();
    const run = runGiven(text, hexOf(contractAddress)) ?? '(none)';
    const at = runAt(text, run);
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(Math.max(0, at - 300), at)).toMatch(
      /Ledger[^.]*\b(start|beginning|first)\b/
    );
    expect(text.slice(at, at + 300)).toMatch(/site's address/);
  });

  it('the guide for beneficiaries gives the same for the mainnet contract', async () => {
    const text = beneficiaryText();
    const hex = hexOf(MAINNET_CONTRACT);
    const run = runGiven(text, hex);
    expect(run).toBeDefined();
    for (const nonce of nonces) {
      const data = await claimData(MAINNET_CONTRACT, MAINNET_CLAIM_KEY, nonce);
      expect(data.slice(0, FLEX)).toContain(COMMON + run);
    }
    const at = runAt(text, run ?? '(none)');
    expect(text.slice(Math.max(0, at - 300), at)).toMatch(
      /Ledger[^.]*\b(start|beginning|first)\b/
    );
    expect(text.slice(at, at + 300)).toMatch(/site's address/);
  });
});
