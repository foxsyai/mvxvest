# Backlog

Agreed work not done yet, roughly in order. The launch plan comes first; see [DECISIONS.md](DECISIONS.md) #7 and [MAINNET.md](MAINNET.md).

## Launch plan

1. ~~**In-house mainnet test.**~~ Done and passed on 13 Oct 2026; see [MAINNET.md](MAINNET.md#milestone-4-the-in-house-test-13-october-2026).
2. ~~**Big audit by Claude Fable 5.1 at max effort.**~~ Done on 13 Oct 2026 ([report](reviews/2026-10-13-fable-audit.md)); a second round covered version 2 on 14 Oct 2026 ([report](reviews/2026-10-14-fable-audit-v2.md)). Every finding was proven by a test, then fixed.
3. ~~**Public launch:** remove the beta password from mvxvest.io.~~ Done on 13 Oct 2026, after the big audit's dApp fixes.
4. ~~**The contract upgrade:**~~ Version 2 is live since 14 Oct 2026, audited twice and voted by the multisig. It brought the fees (0.1% + 0.1 EGLD), C1 and RT3; see [MAINNET.md](MAINNET.md#version-2-14-october-2026).
5. ~~**Make the repo public.**~~ Done on 14 Oct 2026 (Sebastian), before the announcement.
6. **One or two more large adversarial audit rounds**, then the **official announcement** on FOXSY's channels.

## Product

- ~~**A detailed "How it works" with real screenshots.**~~ Live since 14 Oct 2026: 22 pictures, eleven steps and "Worth knowing" at https://mvxvest.io/guide.
  - To retake the pictures after an interface change, run `node dapp/scripts/capture/guide.mjs` (`ONLY=` and `FROM=` select pictures). The script fills every form itself and never signs; a person connects a devnet wallet and approves four times.
  - Then run `dapp/scripts/capture/to-web.sh`.
- **Say what was received.** After a claim or a cancel, show the amounts ("Claimed 2,000 TUSD and 1,000.02 TFOX") instead of only "done". Read them from the transaction's events.
- ~~**Warn before leaving Create.**~~ Done: leaving Create with transactions half done asks first, for in-app links as well as a browser close or reload.

## mvxsafe (Sebastian's multisig app, separate repo)

- ~~**Contract-call and upgrade proposals**~~ (`proposeAsyncCall`, `proposeSCUpgradeFromSource`): live on mvxsafe.io since 14 Oct 2026. The board used them for version 2's upgrade and the fee votes. The brief was [handoff/mvxsafe-upgrade-and-calls.md](handoff/mvxsafe-upgrade-and-calls.md); [scripts/src/multisig.ts](../scripts/src/multisig.ts) builds the same transactions.
- **Add `devnet.mvxsafe.io` to the allowlist of mvxsafe's Reown project.** Without it, WalletConnect is probably refused there, as it was on devnet.mvxvest.io.
