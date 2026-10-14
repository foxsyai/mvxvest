# Second audit: version 2 and its upgrade (Claude Fable 5.1, max effort, 14 October 2026)

Three reviewers worked in parallel on branch `upgrade-v2` at 00c0071: the contract, the site's fee code and a red team covering the upgrade procedure end to end. Each proved its findings with tests or with exact evidence where a test does not fit. The proofs are the `audit2_*` files.

**Bottom line:**
- No reviewer found a way to take, lose or lock vested funds through version 2 itself.
- The upgrade from the live version 1 keeps every old vesting, key, total and setting. Two Go VM scenarios prove it from mainnet's own bytecode, the most complete being `audit2_contract_safe_upgrade_keeps_v1_state.scen.json`.
- The fee is exact-match and never enters the books.
- The serious findings were in the signing tool and the runbook, where one compromised signer or a board mistake could do harm. All are fixed.

## Red team: upgrade procedure and tooling

| # | Severity | Finding | Fix |
|---|---|---|---|
| H1 | High | `scripts/src/multisig.ts` let the second signer sign blind: `sign` never read the action; `status` showed only its kind number; nothing checked the source hash, the target or the metadata on mainnet. | The tool decodes every pending action and says it in words. `sign` and `perform` refuse anything but one of mvxvest's owner calls or an upgrade of mvxvest with metadata 0500 from a non-upgradeable source in the multisig's shard whose code hash equals `MVXVEST_EXPECT_HASH`. `propose-upgrade` checks the same before proposing. |
| M1 | Medium | The tool named an action by searching its raw bytes, so a plain call to the built-in `upgradeContract` carrying new code was labelled "pauseCreation" and `unpauseCreation` as `pauseCreation`. | Actions are decoded field by field. Endpoints outside the owner list are refused, `upgradeContract` and `ChangeOwnerAddress` included. |
| M2 | Medium | `propose tokenfee 0.1` (meaning 0.1%) proposed a fee of 0. | Whole basis points only, at most 200. The tool prints the rate: "setTokenFee(10) = 0.1%". `fee` is parsed exactly, with no floating point. |
| M3 | Medium, by design | The fee transfer is in `create`'s path. A token's issuer can stop the fee for its own token from reaching the multisig (by freezing the multisig or with a transfer role); on mainnet, across shards, the fee then comes back to the contract as surplus. An owner that is not payable by contracts would bounce every fee. | Kept: Sebastian wants the fee sent to the multisig at once. Users are never harmed: claims and cancels are untouched, the creation stands and the surplus is recoverable by amount. The spec and the runbook now say so. |
| M4 | Medium | The runbook's version 2 sequence was incomplete. | DEPLOY.md now has a full runbook: where the release hash comes from, the source deploy and its checks, what each signer checks on the card, the gas floor, a failed perform, verification after the upgrade, the fee votes, removing the old hash and operations. |
| L1 | Low | After a partial send, a batch split by the old limits (50) keeps failing on version 2. | See the dApp section's finding 2. |
| L2 | Low | The tool could not pass `recoverSurplus`'s new amount. | `recover-surplus <token> <to> [amount]`. |
| L3 | Info | At 0.1%, a vesting under 1,000 units pays no token fee, which matters only for tokens with 0 decimals. | Accepted; the EGLD fee per vesting is the brake. |

The red team also noted two points for mvxsafe's card, which belongs to the mvxsafe repo and was passed to its agent. A plain call to `upgradeContract` shows with a green "the safe owns the contract". An upgrade of the safe itself shows the same green ownership line.

## dApp

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Low | A Create page opened before the upgrade or before a fee vote keeps the old settings: every creation it builds is refused; nothing reads them again. | Closing a review that sent nothing reads the contract's settings again. The refusal notice says to close and check again if the fees or limits changed. |
| 2 | Low | After a partial send and a fee change, the review showed the new rate while "Sign the remaining" paid the old one; the lines that failed got no file. | The review shows the fees it was checked at. When the fees or limits have changed, "Sign the remaining" gives way to a notice. The CSV of the lines not created is always offered. |
| 3 | Low | `scripts/src/csv120.ts` created batches without the token fee. The root cause was the client's optional rate, which defaulted to 0. | The rate is a required argument; csv120 reads and pays it. |

Checked sound:
- telling version 1 from version 2 against the real API: only "function not found" reads as no fee and a transient failure is never read as 0;
- rounding identical to the contract's for every rate and decimals;
- payments byte-identical to version 1's when the fee is 0;
- the code-hash banner around the upgrade;
- the guide's promises.

## Contract

No bug found. Nine `safe_*` tests and two Go VM scenarios pin what the verdict rests on:
- EGLD paid as `EGLD-000000` entries;
- per-entry rounding;
- fee changes in flight never overcharge;
- the legacy `EGLD` aliases cannot turn locked EGLD into surplus;
- a bounced fee is a recoverable surplus;
- the built-in call budget for EGLD batches;
- the cancelable marker with a key display;
- every piece of version 1's state surviving the upgrade.

Two informational notes:
- `tokenFeePaid` is emitted before the transfer, so it means "sent", not "received". The spec now says so.
- In one case the total paid can stay equal while the split between the two fees changes: the owner lowers the token fee and raises the EGLD fee at the same moment. It is still the owner's money either way.

## Verified

- Contract: `cargo test -p mvxvest`, all 40 targets pass, the Go VM included; `cargo clippy --all-targets -D warnings` and `cargo fmt --check` are clean.
- dApp: 187 tests pass; lint and types are clean.
- Signing tool: the red team's five tests pass against the fixed tool.
- Devnet:
  - a same-code upgrade ran through the fixed tool: the action was described, checked against `MVXVEST_EXPECT_HASH`, signed and performed;
  - a proposal with the wrong expected hash was refused.
- The contract's code did not change in this round: version 2's hash is still `a7acbf22…`, so the devnet rehearsal stands.
