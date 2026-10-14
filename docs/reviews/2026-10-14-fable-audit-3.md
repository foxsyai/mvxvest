# Third audit: what changed after the second (Claude Fable 5.1, max effort, 14 October 2026)

Three reviewers worked in parallel on `main` at 69eb614, covering everything after the second audit's report (532740f):
- the words: the "How it works" guide and its 22 pictures, every text change on the site, the public Markdown;
- the code: the new "what was received" panel, the guide's code, the code-hash list and CI, the multisig tool's gas, test reliability;
- operations: the screenshot script, the build and deploy path, what the public repository exposes.

Each proved its findings with a test that fails on 69eb614 or with exact evidence where a test does not fit. The proofs are the `audit3_*` files.

**Bottom line:**
- Nothing in this round can take, lose or lock funds; the contract did not change.
- The serious findings were about what people read. The new panel and the vesting page overstated what stays claimable after a cancel. The guide had lost its caveat that the owner's limits hold for the code as it stands. Pictures and test data showed full addresses of real wallets.
- All are fixed except the pictures, which need a new set taken with a fresh devnet wallet (see O1).

## Words

| # | Severity | Finding | Fix |
|---|---|---|---|
| W1 | Medium | After a cancel the new panel said "Stays claimable by the beneficiary: X" with the event's vested part, which counts what was claimed before the cancel. | Same as C1. |
| W2 | Medium | The guide's owner paragraph had lost "in the code as it stands" and "an upgrade replaces the code; the rest is trust in the multisig and its signers". | Restored in the guide; the README's owner bullet says the same. |
| W3 | Low | Picture 11 still showed devnet's old 0.01 EGLD fee. | Cropped above the review box. |
| W4 | Low | Pictures 20 and 21 show two different vestings under "The vesting afterwards". | Caption 21 reads "A cancelled vesting". |
| W5 | Low | Pictures 1, 5, 18 and 20 were taken before the copy change and show a comma before "and"/"or". | With the new set of pictures (O1). |
| W6 | Low | "One prompt for several transactions" is true for xPortal, not for a Ledger, which confirms each one. | The guide, caption 16, the panel and Create say so. |
| W7 | Low | README still gave version 1's batch limits (50 and 33) and no token fee. | 49 and 32; the fees named with their caps. |
| W8 | Low | SECURITY.md said every finding was proven by a test and fixed; some were proven by evidence, some accepted. | "proven (by a test where one fits) and then fixed or accepted, as each report records". Same in the backlog. |
| W9 | Low | MAINNET.md still prescribed the 118.5M upgrade floor. | Past tense, with the measurement that ended it. |
| W10 | Low | The guide promised a CSV "of any length"; the parser takes 5,000 lines. | "up to 5,000 lines". |
| W11 | Low | The vesting page's cancelled notice said the whole vested part "stays claimable", also after it was claimed. | It says what had vested and how much of it is still claimable (or that it has been claimed). |
| W12 | Info | Picture 22 is from mainnet, not the test network; captions 2, 4 and 19 described parts outside the picture; DECISIONS #7 predated the repo going public. | All three corrected. |

The guide also lost "Check every address: a vesting cannot be redirected" in the rewrite; it is back in step 4.

## Code

| # | Severity | Finding | Fix |
|---|---|---|---|
| C1 | Medium | The cancel event's `vested` counts what was claimed before. The new panel and the vesting page's cancel summary presented it as what stays claimable. A real devnet case, #202: 1,000.32 TFOX shown, 0.06 claimable. | The panel reads the cancelled vestings afterwards and shows "Still claimable by the beneficiary" from their `claimable`. The summary before signing shows what is claimable now and what was already claimed. The guide, Home and Created by me say what has vested "stays the beneficiary's". |
| C2 | Low | The panel named tokens by ticker only, so a look-alike's dust read like the real token. | Each amount carries the token identifier and "unverified" mark, as every other page does. Only events whose caller is the connected wallet count. |
| C3 | Low | The multisig tool budgets an upgrade's gas from the source's size but never checked that the API returned the code. Without it the budget would fall to about 15.7M. | The tool refuses a source whose code did not come back. |
| C4 | Low | CI compared the build only with the listed hashes. A hash commented out inside the list still counted. Pull requests were not checked. | CI also reads the hash mainnet runs and requires it in the list, ignores comments and runs on pull requests. |
| C5 | Info | A failed or early read left the panel silently empty. | One retry after 5 seconds, then "Could not read what was paid: the explorer link above shows it". |
| C6 | Info | Today's flaky test is explained: Jest caches module ids per worker, so a `virtual` config mock may never reach `chain/reads`. One test still used the pattern, harmlessly. | That test loads the devnet config for real; `pnpm test` copies a config on a fresh clone. |
| C7 | Info | A test's header still described the mainnet config before the upgrade. | Updated. |

## Operations

| # | Severity | Finding | Fix |
|---|---|---|---|
| O1 | Medium | Pictures 7 and 15 and the new test fixtures showed full wallet addresses. The capture wallet is also a mainnet account with a personal herotag, so the guide tied a person to a wallet. Pictures 4 and the header show it shortened. | Pictures 7 and 15 are blurred; the fixtures use an address nobody holds. The script now needs `WALLET=` (a fresh devnet-only wallet) and uses unowned addresses for the other beneficiaries. **Open:** retake the pictures with a fresh wallet. The old files remain in the git history. |
| O2 | Low | The capture script had no network guard: pointed at mvxvest.io, later phases would ask for a real claim or cancel. | It refuses any site but devnet (or a local build). It also stops on a page without the test network's strip. |
| O3 | Low | `ONLY=17` asked for a Claim all approval no picture needed. | Only when picture 18 is wanted. |
| O4 | Low | The deploy gate missed untracked files; Vite ships all of `public/`. | Any changed or untracked file in `dapp/` refuses the deploy. |
| O5 | Low | Devnet deploys were not gated. | The same checks for every network. |
| O6 | Low | Pictures from different runs contradicted each other (11 and 12; 20 and 21). | See W3 and W4. |
| O7 | Info | The deploy's tests ran against whichever config a previous deploy left. | The network's config is copied before the tests. |
| O8 | Info | The script's output folder depended on where it was started. | Resolved from the script's own location. |
| O9 | Info | `deploy.sh` names the droplet's user and IP. | Accepted: the IP is the sites' public DNS record and the user name alone grants nothing. |
| O10 | Info | Secret scanning and push protection were off on the public repo. | Both enabled on 14 Oct 2026. |
| O11 | Info | The private beta's password file was still in the session's scratch folder (not in the repo). | Deleted. |

## Checked sound

- The "Check that it is the real mvxvest" box against mainnet:
  - contract, code hash, owner, both collections, quorum 2 of 3;
  - the three signers equal `getAllBoardMembers`.
- Fees: caps of 1 EGLD and 2% in the code; live 0.1 EGLD and 0.1%; the guide's live line; "Claiming and cancelling pay only the network fee".
- The promises in the guide about claims, cancels, keys, bounced keys, issuer powers and lost transactions, checked against the contract and the site's code paths.
- `payoutsOf` against `events.rs`, including mainnet's own milestone 4 transactions (13.666667, 10.111111 and 39.722222 FOXSY claimed; 60.277778 refunded).
- The multisig tool's budgets from the chain:
  - upgrade: about 17.7M needed, 25.5M budgeted (1.44x);
  - plain calls: 1.2x over the simulation.
- The capture script never signs or sends. Playwright is pinned, a dev dependency only and absent from the built site.
- The deploy gate's other checks; no keys, mnemonics or `.env` files anywhere in the repo.

## Verified

- dApp: 213 tests pass, lint and types clean. Each `audit3_*` test failed on 69eb614 and passes now, except `audit3_code_virtual_config_mock`, which demonstrates C6 and passes by design.
- Signing tool: its 5 tests pass. CI's new hash check was run against the real config and mainnet.
- The contract did not change in this round: version 2's hash is still `a7acbf22…`.
