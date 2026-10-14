/**
 * @jest-environment node
 */
// Third audit, operations (14 Oct 2026): scripts/capture/guide.mjs drives a
// real Chrome with a persistent profile that can hold a connected wallet
// session, and tells the person at the keyboard when to approve in xPortal.
// Its header promises that everything happens on devnet and that a person
// approves exactly four times. Two guards are missing; the script's text is
// checked because it cannot run under Jest (it opens a browser).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '..', '..', 'scripts', 'capture', 'guide.mjs'),
  'utf8'
);

/** The script between two of its own landmarks. */
const between = (from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0)
    throw new Error(`guide.mjs no longer has "${from}" .. "${to}"`);
  return src.slice(a, b);
};

describe('guide.mjs asks for no approval it does not need, and never on mainnet', () => {
  test('a SITE other than the devnet site is refused before any wallet phase runs', () => {
    // SITE comes from the environment (line 22) and is only ever used by
    // go(). A wallet keeps the same address on every network, so the
    // "connected as erd1eg8s…" check passes on mainnet too. With
    // SITE=https://mvxvest.io FROM=17, the script opens My vestings, presses
    // "Claim all (N)", waits for the network check and tells the person to
    // approve in xPortal: a real claim. FROM=19 does the same for a real
    // cancel when a card matches "Team 2027" and CANCEL_AMOUNT. The header
    // says "Everything happens on devnet"; nothing enforces it.
    const setup = between('const SITE', '// --- 1. Connect');
    const refusesOtherSites = /if\s*\(.*SITE[\s\S]*?(throw|process\.exit)/.test(
      setup
    );
    expect(refusesOtherSites).toBe(true);
  });

  test('phase 4 asks for the Claim all approval only when picture 18 is wanted', () => {
    // Phases 2, 3 and 5 press "Not now" when the signed picture is not wanted
    // (lines 322, 368 and 413). Phase 4 opens the Claim all panel and tells
    // the person to approve it whatever ONLY or TO say: ONLY=17 signs a claim
    // no picture needs.
    const phase4 = between('// --- 4. My vestings', '// --- 5. Created by me');
    expect(/wanted\(18\)/.test(phase4)).toBe(true);
  });
});
