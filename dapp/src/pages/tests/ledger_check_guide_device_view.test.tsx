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
// neither end tells contracts apart. What does is the run right after 0500.
//
// The first fix (e789974) gave 16 characters of that run and said: if the
// Ledger's screen ends before them, the site's address is the check. Its
// review found two holes. A copy of the site can pad a key's nonce or
// quantity with zeros (the protocol reads both as numbers) so that a Flex
// ends early on purpose. The guide then told the reader to accept that.
// And a cancel on a Flex shows only 14 of the 16 once the cancel key's nonce
// needs two bytes. On a Flex one key always shows 14 right after @01@, and
// several keys show the whole contract right after MultiESDTNFTTransfer@. So
// a Flex reader who does not see them must not sign; only a Nano, which never
// shows them for one key, leaves the site's address as the check.
//
// The premise passes on e789974. The guides' tests fail there and pass once
// both guides give 14 characters, say where they stand, tell a Flex reader
// not to sign without them and leave the site's address to the Nano.

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
/**
 * The characters after COMMON worth comparing: 56 bits, some 2^56 tries for
 * a look-alike contract. A Flex shows them on a claim and on a cancel.
 */
const RUN = 14;

const SENDER = 'erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx';
const DEVNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp';
const MAINNET_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu';
const MAINNET_CLAIM_KEY = 'VESTKEY-f56bea';
/** Any other contract (the owner's multisig): where a copy sends the key. */
const OTHER_CONTRACT =
  'erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3';

const hexOf = (bech32: string) => Address.newFromBech32(bech32).toHex();
const hexText = (text: string) => Buffer.from(text).toString('hex');

const keysData = async (
  contract: string,
  fn: 'claim' | 'cancel',
  key: string,
  nonces: number[]
) => {
  const client = new VestingClient(contract, {} as any, '1');
  const tx = await client[fn](SENDER, key, nonces);
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
 * on its own (COMMON before it or not), apart from the whole 64 characters,
 * and where it stands.
 */
const runGiven = (text: string, hex: string) => {
  for (const found of text.matchAll(/(?<![0-9a-f])[0-9a-f]+(?![0-9a-f])/g)) {
    const token = found[0];
    const run = token.startsWith(COMMON) ? token.slice(COMMON.length) : token;
    if (token !== hex && run.length >= RUN && hex.startsWith(COMMON + run))
      return { run, at: found.index ?? -1 };
  }
  return { run: undefined, at: -1 };
};

/** The sentences after the run, where a reader looks for what to do. */
const sentencesAfter = (text: string, at: number) =>
  text.slice(at, at + 500).split(/(?<=\.) /);

const nonces = [1, 0x2df, 0xffff];

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
    for (const nonce of nonces) {
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

  it('on a Nano a claim ends before any character that tells contracts apart', async () => {
    const hex = hexOf(contractAddress);
    for (const nonce of nonces) {
      const data = await keysData(
        contractAddress,
        'claim',
        keyCollections.claim,
        [nonce]
      );
      expect(COMMON.startsWith(contractShown(data, hex, NANO))).toBe(true);
    }
  });

  it('on a Flex one key always shows 14 characters after 0500, right after @01@', async () => {
    const hex = hexOf(contractAddress);
    const expected = `@01@${COMMON}${hex.slice(COMMON.length, COMMON.length + RUN)}`;
    for (const nonce of nonces) {
      for (const data of [
        await keysData(contractAddress, 'claim', keyCollections.claim, [nonce]),
        await keysData(contractAddress, 'cancel', keyCollections.cancel, [
          nonce
        ])
      ])
        expect(data.slice(0, FLEX)).toContain(expected);
    }
  });

  it('a cancel on a Flex shows fewer than 16 once its key nonce needs two bytes', async () => {
    const hex = hexOf(contractAddress);
    const data = await keysData(
      contractAddress,
      'cancel',
      keyCollections.cancel,
      [0x2df]
    );
    expect(contractShown(data, hex, FLEX).length - COMMON.length).toBe(14);
  });

  it('several keys name the contract first: a Flex shows it whole', async () => {
    const hex = hexOf(contractAddress);
    const data = await keysData(
      contractAddress,
      'claim',
      keyCollections.claim,
      [0x2df, 0xffff]
    );
    expect(data.slice(0, FLEX)).toContain(`MultiESDTNFTTransfer@${hex}`);
  });

  it('a copy can pad the nonce or the quantity so that a Flex ends before the contract', () => {
    // The protocol reads a key's nonce and quantity as unsigned numbers, so
    // leading zeros move the same key; only the destination differs.
    const hex = hexOf(contractAddress);
    const other = hexOf(OTHER_CONTRACT);
    const collection = hexText(keyCollections.claim);
    const zeros = '00'.repeat(20);
    for (const data of [
      `ESDTNFTTransfer@${collection}@02df@${zeros}01@${other}@636c61696d`,
      `ESDTNFTTransfer@${collection}@${zeros}02df@01@${other}@636c61696d`
    ]) {
      const shown = data.slice(0, FLEX);
      expect(shown).not.toContain(hex.slice(COMMON.length, COMMON.length + 4));
      expect(shown).not.toContain(
        other.slice(COMMON.length, COMMON.length + 4)
      );
    }
  });
});

describe('what the guides tell a Ledger reader to compare', () => {
  it('How it works gives the run a Flex shows right after @01@ on a claim and a cancel', async () => {
    const hex = hexOf(contractAddress);
    const { run } = runGiven(await guideText(), hex);
    expect(run).toBeDefined();
    for (const nonce of nonces) {
      for (const data of [
        await keysData(contractAddress, 'claim', keyCollections.claim, [nonce]),
        await keysData(contractAddress, 'cancel', keyCollections.cancel, [
          nonce
        ])
      ])
        expect(data.slice(0, FLEX)).toContain(`@01@${COMMON}${run}`);
    }
  });

  it('How it works says where the run stands for one key and for several', async () => {
    const text = await guideText();
    const { at } = runGiven(text, hexOf(contractAddress));
    expect(at).toBeGreaterThan(-1);
    const passage = text.slice(Math.max(0, at - 300), at + 300);
    expect(passage).toMatch(/Ledger[^.]*\b(start|beginning|first)\b/);
    expect(passage).toContain('@01@');
    expect(passage).toContain('MultiESDTNFTTransfer@');
  });

  it('How it works tells a Flex reader not to sign without it and leaves the site to the Nano', async () => {
    const text = await guideText();
    const { at } = runGiven(text, hexOf(contractAddress));
    expect(at).toBeGreaterThan(-1);
    const after = sentencesAfter(text, at);
    expect(text.slice(Math.max(0, at - 300), at)).toMatch(/Flex/);
    expect(after.join(' ')).toMatch(/do not sign/);
    const site = after.filter((sentence) => /site's address/.test(sentence));
    expect(site.length).toBeGreaterThan(0);
    for (const sentence of site) expect(sentence).toMatch(/Nano/);
  });

  it('the guide for beneficiaries says the same for the mainnet contract', async () => {
    const text = beneficiaryText();
    const hex = hexOf(MAINNET_CONTRACT);
    const { run, at } = runGiven(text, hex);
    expect(run).toBeDefined();
    for (const nonce of nonces) {
      const data = await keysData(
        MAINNET_CONTRACT,
        'claim',
        MAINNET_CLAIM_KEY,
        [nonce]
      );
      expect(data.slice(0, FLEX)).toContain(`@01@${COMMON}${run}`);
    }
    const passage = text.slice(Math.max(0, at - 300), at + 300);
    expect(passage).toMatch(/Ledger[^.]*\b(start|beginning|first)\b/);
    expect(passage).toContain('@01@');
    expect(passage).toContain('MultiESDTNFTTransfer@');
    const after = sentencesAfter(text, at);
    expect(text.slice(Math.max(0, at - 300), at)).toMatch(/Flex/);
    expect(after.join(' ')).toMatch(/do not sign/);
    const site = after.filter((sentence) => /site's address/.test(sentence));
    expect(site.length).toBeGreaterThan(0);
    for (const sentence of site) expect(sentence).toMatch(/Nano/);
  });
});
