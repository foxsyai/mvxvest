# Backlog

Agreed work not done yet, roughly in order. The launch plan comes first; see [DECISIONS.md](DECISIONS.md) #7 and [MAINNET.md](MAINNET.md).

## Launch plan

1. ~~**In-house mainnet test.**~~ Done and passed on 13 Oct 2026; see [MAINNET.md](MAINNET.md#milestone-4-the-in-house-test-13-october-2026).
2. ~~**Big audit by Claude Fable 5.1 at max effort.**~~ Done on 13 Oct 2026 ([report](reviews/2026-10-13-fable-audit.md)); a second round covered version 2 on 14 Oct 2026 ([report](reviews/2026-10-14-fable-audit-v2.md)). Every finding was proven (by a test where one fits), then fixed or accepted as each report records.
3. ~~**Public launch:** remove the beta password from mvxvest.io.~~ Done on 13 Oct 2026, after the big audit's dApp fixes.
4. ~~**The contract upgrade:**~~ Version 2 is live since 14 Oct 2026, audited twice and voted by the multisig. It brought the fees (0.1% + 0.1 EGLD), C1 and RT3; see [MAINNET.md](MAINNET.md#version-2-14-october-2026).
5. ~~**Make the repo public.**~~ Done on 14 Oct 2026 (Sebastian), before the announcement.
6. **One or two more large adversarial audit rounds**, then the **official announcement** on FOXSY's channels. A third round covered what changed after the second, on 14 Oct 2026 ([report](reviews/2026-10-14-fable-audit-3.md)).
7. ~~**New pictures for How it works**~~ Done on 14 Oct 2026 (all 22), taken with a fresh devnet-only wallet (`WALLET=erd1... node dapp/scripts/capture/guide.mjs`), so no picture shows a wallet with a history (third audit, O1). This also retakes the pictures that still show the old wording (W5). Needs Sebastian's xPortal for the four approvals.

8. **Agent review and CI as merge gates, on mvxvest and mvxsafe** (Sebastian, 14 Oct 2026). Port foxsyai/foxleague-agent's setup:
   - CI and a Claude Code review (Opus 5.5, effort xhigh) start only when a maintainer adds the label `merge-check`, so nobody can spend tokens or CI minutes by opening pull requests;
   - the reviewer's settings, verdict script and workspace gate come from main; it only reads and comments; a pull request that changes CI or the review is checked by hand;
   - a small GitHub App posts the `ci` and `review` results; a ruleset makes main require a pull request with one approval and both results, admins may bypass; no force push or deletion for anyone;
   - the reviewer's prompt is written for each project (the vesting contract and its money paths; the multisig and signing).
   Sebastian sets `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_BACKUP` on both repos and installs the checks App. mvxvest first, then mvxsafe through a pull request, coordinated with its agent.

## Product

- ~~**A detailed "How it works" with real screenshots.**~~ Live since 14 Oct 2026: 22 pictures, eleven steps and "Worth knowing" at https://mvxvest.io/guide.
  - To retake the pictures after an interface change, run `node dapp/scripts/capture/guide.mjs` (`ONLY=` and `FROM=` select pictures). The script fills every form itself and never signs; a person connects a devnet wallet and approves four times.
  - Then run `dapp/scripts/capture/to-web.sh`, and `node dapp/scripts/make-beneficiary-pdf.mjs` to rebuild the guide for beneficiaries (`dapp/public/mvxvest-for-beneficiaries.pdf`, from `dapp/docs/beneficiary-guide.html`), which crops the same pictures.
- ~~**Say what was received.**~~ Done on 14 Oct 2026: after a claim, a Claim all or a cancel, the panel says what was received, returned or stays claimable, read from the contract's events once the result is final.
- ~~**Warn before leaving Create.**~~ Done: leaving Create with transactions half done asks first, for in-app links as well as a browser close or reload.

## mvxsafe (Sebastian's multisig app, separate repo)

- ~~**Contract-call and upgrade proposals**~~ (`proposeAsyncCall`, `proposeSCUpgradeFromSource`): live on mvxsafe.io since 14 Oct 2026. The board used them for version 2's upgrade and the fee votes. The brief was [handoff/mvxsafe-upgrade-and-calls.md](handoff/mvxsafe-upgrade-and-calls.md); [scripts/src/multisig.ts](../scripts/src/multisig.ts) builds the same transactions.
- ~~**Add `devnet.mvxsafe.io` to the allowlist of mvxsafe's Reown project.**~~ Done: on 14 Oct 2026 Reown listed `mvxsafe.io` and `devnet.mvxsafe.io` as the project's allowed origins.
