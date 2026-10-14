# Backlog

Agreed work not done yet, roughly in order. The launch plan comes first; see [DECISIONS.md](DECISIONS.md) #7 and [MAINNET.md](MAINNET.md).

## Launch plan

1. ~~**In-house mainnet test.**~~ Done and passed on 13 Oct 2026; see [MAINNET.md](MAINNET.md#milestone-4-the-in-house-test-13-october-2026).
2. **Big audit by Claude Fable 5.1 at max effort.** It covers the contract, the dApp, the deployment and the funds, and tries every malicious action: stealing or locking funds, corrupting state, edge cases. Each finding is proven by a failing test, then fixed. A contract fix is an upgrade, voted by the multisig.
3. ~~**Public launch:** remove the beta password from mvxvest.io.~~ Done on 13 Oct 2026, after the big audit's dApp fixes.
4. **The contract upgrade:** the audit's two contract fixes (C1 `recoverSurplus` with an amount, RT3 the cancelable marker on new keys) and the platform fee of [DECISIONS.md](DECISIONS.md) #10 (0.1% in the token to the multisig, plus 0.1 EGLD per vesting). The site shows the fee before signing. It is staged and voted by the multisig after the audit rounds have reviewed it.
5. **Two or three more clean audit rounds**, around the week of 19 Oct 2026. Then **make the repo public**, after asking Sebastian.

## Product

- **A detailed "How it works" for users, with real screenshots** (asked for by Sebastian on 13 Oct 2026). Model it on mvxsafe.io's guide:
  - **Source:** `~/FOXSY/mvxsafe/app/src/pages/Guide/Guide.tsx`, plus its capture script `scripts/capture/guide.mjs`.
  - **The capture script:** a Playwright script opens the live site. It fills every form, waits for each state and photographs it into `public/shots/`; a person only signs in the wallet. It never signs anything itself, and every person and wallet in it has a neutral name, because the guide is public.
  - **Layout:** numbered steps with a picture each, then a short "Worth knowing" section.

  Steps to cover:
  - what a vesting and its two keys are;
  - connecting a wallet;
  - creating vestings one by one and from a CSV;
  - every schedule: linear, every N days, every N months, set dates, the two cliff styles;
  - cancelable or not;
  - review and sign, including several transactions under one wallet prompt;
  - My vestings, Claim, Claim all, "grows every second";
  - moving a claim key to another wallet;
  - Created by me: cancel, cancel keys received from another wallet, export to CSV;
  - looking up a vesting, a token or an address without a wallet.

  "Worth knowing" covers:
  - fees;
  - what the owner multisig can and cannot do, and upgradeability;
  - smart contracts as beneficiaries and bounced keys;
  - tokens whose issuer can freeze them;
  - what to do if a transaction is not found.

  Take the shots on devnet with play money, or on mainnet with small amounts. They are retaken by running the script again whenever the interface changes.
- **Say what was received.** After a claim or a cancel, show the amounts ("Claimed 2,000 TUSD and 1,000.02 TFOX") instead of only "done". Read them from the transaction's events.
- **Warn before leaving Create.** In-app navigation away from it with transactions half done still loses the record; only a browser close or reload warns today.

## mvxsafe (Sebastian's multisig app, separate repo)

- **Contract-call and upgrade proposals** (`proposeAsyncCall`, `proposeSCUpgradeFromSource`), so the multisig can manage mvxvest from mvxsafe: pause, fee, `recoverBouncedKey`, `recoverSurplus`, `claimFees`, upgrade. The full brief for mvxsafe's agent is [handoff/mvxsafe-upgrade-and-calls.md](handoff/mvxsafe-upgrade-and-calls.md). Until it exists, [scripts/src/multisig.ts](../scripts/src/multisig.ts) builds these transactions.
- **Add `devnet.mvxsafe.io` to the allowlist of mvxsafe's Reown project.** Without it, WalletConnect is probably refused there, as it was on devnet.mvxvest.io.
