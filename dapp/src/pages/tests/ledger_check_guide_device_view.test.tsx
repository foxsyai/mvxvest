// Checked on 2 Nov 2026 with a Ledger Flex on devnet (BACKLOG: look at xPortal
// and a Ledger once). For a claim the Ledger shows the reader's own address as
// the Receiver, 0 EGLD, the fee, then the data in raw form, cut short:
// "[Size: 128] ESDTNFTTransfer@564553544b45592d386632313763@02df@01@00000000
// 000000000500eda3c303c22c4cf1a240..." The contract's last 24 hexadecimal
// characters and the function's name never show. A Nano S Plus or a Nano X
// shows less: the MultiversX app keeps the data's first 64 characters there
// (MAX_DISPLAY_DATA_SIZE for BAGL devices in multiversx/mx-ledger-nano,
// src/constants.h), which on a claim ends inside the zeros every contract
// starts with. Nothing here measures a Stax or a Nano Gen5.
//
// Since the xPortal check both guides say that a wallet or device that shows
// the data shows the contract there. Both give its 64 hexadecimal characters.
// A Ledger reader cannot compare them: the end is not on the screen. Every
// contract's form starts with the same 20 characters (8 zero bytes and the
// VM type, 0500). Its last 4 come from the address that deployed it. So
// neither end tells contracts apart. What does is the run right after 0500.
//
// Three rounds of review shaped what the guides say:
// - e789974 let any screen that ends early fall back on the site's address.
//   The protocol reads a key's nonce and quantity as numbers, so a copy of
//   the site can pad them with zeros and end a Flex's screen early on purpose.
// - 01091df gave 14 characters and said a Flex always shows them. Padding the
//   nonce still sets how much of the contract shows, so a copy needs a
//   look-alike matching only 14 (56 bits, a few thousand dollars of GPUs).
//   Its fallback named any Nano; a Stax got no rule. A cancel with a
//   three-byte key nonce shows only 12. A token vesting without the EGLD fee
//   is no MultiESDTNFTTransfer at all.
// - Now: the site never writes a key number starting with 00, so the reader
//   refuses padding and compares all the screen shows. A claim shows at least
//   16 characters after 0500 (64 bits). Only the Nano S Plus and the Nano X
//   fall back on the site's address; on any other Ledger a claim that does
//   not show the 16 is not signed.
//
// The premise passes on 01091df. The guides' tests fail there and pass once
// both guides say all that.

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
const NANO = 64; // the app's source, Nano S Plus and Nano X

/** Every contract's hexadecimal form starts with this. */
const COMMON = '00000000000000000500';
/** The characters after COMMON a claim always shows on a Flex (64 bits). */
const RUN = 16;

const SENDER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const DEVNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const MAINNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const MAINNET_CLAIM_KEY = 'VESTKEY-f56bea';
const FEE = 100_000_000_000_000_000n;
const T = 1_767_225_600;
const schedule = {
  start: T,
  cliff: T,
  cliffAmount: 0n,
  end: T + 3_600,
  curve: { kind: 'linear' as const }
};

const hexOf = (bech32: string) => Address.newFromBech32(bech32).toHex();
const hexText = (text: string) => Buffer.from(text).toString('hex');
const client = (contract: string) =>
  new VestingClient(contract, {} as any, '1');

const keysData = async (
  contract: string,
  fn: 'claim' | 'cancel',
  key: string,
  nonces: number[]
) => {
  const tx = await client(contract)[fn](SENDER, key, nonces);
  return Buffer.from(tx.data).toString();
};

const tokenVesting = (fee: bigint) =>
  client(contractAddress).create(
    SENDER,
    'FOXSY-5d5f3e',
    { beneficiary: SENDER, total: 10n ** 18n, schedule },
    false,
    '',
    fee,
    10
  );

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
 * on its own (COMMON before it or not), apart from the whole 64 characters.
 */
const runGiven = (text: string, hex: string) => {
  for (const found of text.matchAll(/(?<![0-9a-f])[0-9a-f]+(?![0-9a-f])/g)) {
    const token = found[0];
    const run = token.startsWith(COMMON) ? token.slice(COMMON.length) : token;
    if (token !== hex && hex.startsWith(COMMON + run) && run.length >= 8)
      return run;
  }
  return undefined;
};

/** The sentences on a Ledger: from where it says it shows only the start. */
const ledgerPassage = (text: string) => {
  const start = text.search(/A Ledger shows only the (start|beginning)/);
  expect(start).toBeGreaterThan(-1);
  const sentences = text.slice(start).split(/(?<=\.) /);
  // Up to the sentence that ends it: the last one that says not to sign.
  let last = -1;
  sentences.slice(0, 12).forEach((sentence, i) => {
    if (/do not sign/.test(sentence)) last = i;
  });
  return sentences.slice(0, last < 0 ? 12 : last + 1);
};

const claimNonces = [1, 0x2df, 0xffff, 0x10000, 0xffffffff];

describe('Ledger, the premise (passes today): the data is cut short', () => {
  it('the Flex cut the devnet claim it was shown after 40 characters of the contract', async () => {
    const hex = hexOf(DEVNET_CONTRACT);
    const data = await keysData(
      DEVNET_CONTRACT,
      'claim',
      'VESTKEY-8f217c',
      [0x2df]
    );
    expect(data).toHaveLength(128);
    expect(contractShown(data, hex, FLEX)).toBe(
      '00000000000000000500eda3c303c22c4cf1a240'
    );
  });

  it('a claim or a cancel of one key never shows the whole contract on a Ledger', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of claimNonces) {
      for (const data of [
        await keysData(contractAddress, 'claim', keyCollections.claim, [nonce]),
        await keysData(contractAddress, 'cancel', keyCollections.cancel, [
          nonce
        ])
      ]) {
        expect(contractShown(data, hex, FLEX)).not.toBe(hex);
        expect(data.slice(0, FLEX)).not.toContain(hex.slice(-4));
      }
    }
  });

  it('on a Nano S Plus or X a claim ends before any character that tells contracts apart', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of claimNonces) {
      const data = await keysData(
        contractAddress,
        'claim',
        keyCollections.claim,
        [nonce]
      );
      expect(COMMON.startsWith(contractShown(data, hex, NANO))).toBe(true);
    }
  });

  it('on a Flex a claim shows at least 16 characters after 0500, right after @01@', async () => {
    const hex = hexOf(contractAddress);
    const expected = `@01@${COMMON}${hex.slice(COMMON.length, COMMON.length + RUN)}`;
    for (const nonce of claimNonces) {
      const data = await keysData(
        contractAddress,
        'claim',
        keyCollections.claim,
        [nonce]
      );
      expect(data.slice(0, FLEX)).toContain(expected);
    }
  });

  it('a cancel on a Flex shows 16, 14 or 12: no one figure holds', async () => {
    const hex = hexOf(contractAddress);
    const after0500 = async (nonce: number) =>
      contractShown(
        await keysData(contractAddress, 'cancel', keyCollections.cancel, [
          nonce
        ]),
        hex,
        FLEX
      ).length - COMMON.length;
    expect(await after0500(0xff)).toBe(16);
    expect(await after0500(0x2df)).toBe(14);
    expect(await after0500(0x10000)).toBe(12);
  });

  it('the site never writes a key number that starts with 00', async () => {
    for (const nonce of claimNonces) {
      for (const [fn, key] of [
        ['claim', keyCollections.claim],
        ['cancel', keyCollections.cancel]
      ] as const) {
        const data = await keysData(contractAddress, fn, key, [nonce]);
        expect(data.split('@')[2]).not.toMatch(/^00/);
      }
    }
  });

  it('several keys and a token vesting that pays the EGLD fee name the contract first', async () => {
    const hex = hexOf(contractAddress);
    const several = await keysData(
      contractAddress,
      'claim',
      keyCollections.claim,
      [0x2df, 0xffff]
    );
    const vesting = Buffer.from((await tokenVesting(FEE)).data).toString();
    for (const data of [several, vesting])
      expect(data.slice(0, FLEX)).toContain(`MultiESDTNFTTransfer@${hex}`);
  });

  it('a token vesting without the EGLD fee is a plain transfer to the contract', async () => {
    const tx = await tokenVesting(0n);
    expect(tx.receiver.toBech32()).toBe(contractAddress);
    expect(Buffer.from(tx.data).toString()).toMatch(/^ESDTTransfer@/);
  });

  it('a copy can pad the nonce so that a look-alike sharing 14 characters fills the Flex', () => {
    // The protocol reads a key's nonce as a number: leading zeros move the same
    // key. The look-alike shares the 14 characters after 0500 (about 2^56
    // tries) and differs after them.
    const hex = hexOf(contractAddress);
    const lookAlike =
      COMMON + hex.slice(COMMON.length, COMMON.length + 14) + 'f'.repeat(30);
    const data = `ESDTNFTTransfer@${hexText(keyCollections.claim)}@00000002df@01@${lookAlike}@636c61696d`;
    const shown = data.slice(0, FLEX);
    expect(shown).toContain(`@01@${COMMON}${hex.slice(20, 34)}`);
    expect(shown).not.toContain(`@01@${COMMON}${hex.slice(20, 20 + RUN)}`);
    expect(data.split('@')[2]).toMatch(/^00/);
  });
});

describe('what the guides tell a Ledger reader to compare', () => {
  it('How it works gives the 16 characters a Flex shows right after @01@ on a claim', async () => {
    const hex = hexOf(contractAddress);
    const run = runGiven(await guideText(), hex);
    expect(run).toBeDefined();
    expect(run!.length).toBeGreaterThanOrEqual(RUN);
    for (const nonce of claimNonces) {
      const data = await keysData(
        contractAddress,
        'claim',
        keyCollections.claim,
        [nonce]
      );
      expect(data.slice(0, FLEX)).toContain(`@01@${COMMON}${run}`);
    }
  });

  it('How it works says where the contract stands and that the key number never starts with 00', async () => {
    const passage = ledgerPassage(await guideText());
    expect(passage.join(' ')).toContain('@01@');
    expect(passage.join(' ')).toMatch(/never starts with 00/);
    const multi = passage.find((sentence) =>
      sentence.includes('MultiESDTNFTTransfer@')
    );
    expect(multi).toMatch(/token that pays the EGLD fee/);
  });

  it('How it works leaves the site address to the Nano S Plus and X; any other Ledger does not sign', async () => {
    const passage = ledgerPassage(await guideText());
    const site = passage.filter((sentence) => /site's address/.test(sentence));
    expect(site.length).toBeGreaterThan(0);
    for (const sentence of site) {
      expect(sentence).toMatch(/Nano S Plus/);
      expect(sentence).toMatch(/Nano X/);
    }
    expect(passage.join(' ')).toMatch(/any other Ledger[^.]*do not sign/);
  });

  it('the guide for beneficiaries says the same for the mainnet contract', async () => {
    const text = beneficiaryText();
    const hex = hexOf(MAINNET_CONTRACT);
    const run = runGiven(text, hex);
    expect(run).toBeDefined();
    expect(run!.length).toBeGreaterThanOrEqual(RUN);
    for (const nonce of claimNonces) {
      const data = await keysData(
        MAINNET_CONTRACT,
        'claim',
        MAINNET_CLAIM_KEY,
        [nonce]
      );
      expect(data.slice(0, FLEX)).toContain(`@01@${COMMON}${run}`);
    }
    const passage = ledgerPassage(text);
    expect(passage.join(' ')).toContain('@01@');
    expect(passage.join(' ')).toContain('MultiESDTNFTTransfer@');
    expect(passage.join(' ')).toMatch(/never starts with 00/);
    const site = passage.filter((sentence) => /site's address/.test(sentence));
    expect(site.length).toBeGreaterThan(0);
    for (const sentence of site) {
      expect(sentence).toMatch(/Nano S Plus/);
      expect(sentence).toMatch(/Nano X/);
    }
    expect(passage.join(' ')).toMatch(/any other Ledger[^.]*do not sign/);
  });
});
