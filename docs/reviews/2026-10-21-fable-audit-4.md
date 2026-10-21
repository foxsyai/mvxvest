# Fourth audit: the whole system again (Claude Fable 5.1, max effort, 20 to 21 October 2026)

Six reviewers worked in parallel on `main` at 322cb43, each on one area of the whole system:
- **SCM**, the contract's money paths: create, claim, cancel, the fees, the surplus, the owner's endpoints;
- **SCK**, keys, schedules and views: the claim and cancel NFTs, every curve at its edges, labels, paging;
- **DT**, the dApp's truth: does each page show what the chain says and build exactly what it shows;
- **WEB**, the site's security and its supply chain: routes, headers, a clone of the site, dependencies;
- **OPS**, the merge gates, the owner's multisig tool, secrets and the live configuration;
- **RT**, a red team that attacks end to end as a buyer, a seller, a creator, a signer and a contributor.

The round was planned for this week. An unsolicited email from a security firm (19 Oct 2026) made four claims about mvxvest; each was checked inside the audit (below).

Each finding was proven by a test that fails on 322cb43 or by exact evidence where a test does not fit. Then it was fixed and the test passes; otherwise it was accepted or left for a decision, as the tables say. The proofs are the `audit4_*` files.

**Bottom line:**
- Nothing found can take, lose or lock funds. No path pays anyone but the holder of a key. A random walk over every money path keeps the books exact after every step. Mainnet's books were checked by hand on 20 Oct: 76.222222222222222223 FOXSY owed, the same balance held, surplus 0.
- The two Medium findings were about what people read: a marketplace buyer of a claim key had no clear path to the truth (RT1); the Token page's unlock calendar put releases under the wrong month west of UTC (DT-1).
- 43 test cases failed on 322cb43 (34 in the dApp, 8 in the owner's tool, 1 for the secret scan); all 43 pass now. The contract did not change, so no upgrade is needed for this round.
- One finding (SCK-1) needs a contract version 3. Its test is in the repo, ignored until then. Four other items are decisions for the owner, listed at the end.

## The email's four claims

1. **"A claim key's attributes never change, so a drained key can be sold as untouched."** True, by design and recorded since the first review. The protocol lets only the holder of a non-dynamic NFT rewrite it, so the contract can stamp a key only while it holds it, during `claim` (SCK-1, version 3). Until then the site is the buyer's live view; this round made it say so (RT1).
2. **"A creator holding both keys can cancel right after a sale."** True: `cancel` pays whoever sends the cancel key what has not vested. That is what a cancelable vesting is. The tests pin that a cancel in the same second as a sale, before or after it, leaves the buyer exactly what had vested. The vesting page now says it in words before anyone buys (RT1).
3. **"The contract is upgradeable and the key collections keep `canUpgrade` and `canAddSpecialRoles`."** True and already public: README, the guide and MAINNET.md say the owner (a 2 of 3 multisig) can upgrade. Every page compares the live code hash and owner with the release.
4. **"The token fee rounds down per vesting."** True and accepted in the second audit (L3): the EGLD fee per vesting is the brake. At mainnet's fees, 49 vestings of 999 units of a token without decimals pay no token fee and 4.9 EGLD; the same tokens in one vesting pay 48 units and 0.1 EGLD (`audit4_contract_token_fee_rounding.rs`).

## Contract and keys

| # | Severity | Finding | Fix |
|---|---|---|---|
| SCK-1 | Low | A claim key comes back from `claim` byte for byte as minted. A holder can claim everything vested and sell the key as untouched; only the contract's views know. | Open: version 3 would add what was paid to the key's attributes at claim (`ESDTNFTUpdateAttributes`, a role the contract already holds; one built-in call per key, so 99 keys still fit). Proof `audit4_sck_market_stale_key.rs`, ignored until then. The site covers buyers meanwhile (RT1). |
| SCK-2 | Info | The `cancelable` marker of version 2's keys sits only in the raw attributes, which marketplaces do not show. Mainnet's one live claim key, `VESTKEY-f56bea-01`, was minted by version 1 and has none. | Open with SCK-1 (a marker in the key's name for new keys, a one call status view). The guide says keys made before 14 Oct 2026 carry no marker; the vesting page says it in words. |
| SCM-1 | Info | `getSurplus` stops at 0, so a deficit would read like balanced books. No path in the code can cause one. | Open with version 3 (a deficit view). Mainnet's books were checked from outside: exact. |
| SCM-2 | Info | CONTRACT_SPEC.md still called version 2 "not deployed yet"; the original brief lacked the upgrade caveat. | Both corrected. |

## dApp

| # | Severity | Finding | Fix |
|---|---|---|---|
| DT-1 | Medium | The Token page's unlock calendar counted months in local time and labelled them in UTC: read from New York, November and February went missing and three months showed twice; a 30 November release counted under October. | Months are counted in UTC. `audit4_dt_calendar.test.ts` |
| DT-2 | Low | A linear vesting longer than about 27 years showed a table that stopped at 90% with no note. | Two and five year steps; the end row is always there. `audit4_dt_linear_checkpoints.test.ts` |
| DT-3 | Low | The banner that compares the contract's code with the release showed nothing when the read failed, like a contract found right; a tab left open never checked again. | It says the code could not be checked and checks again every five minutes and when the tab comes back. `audit4_dt_code_check_fail_open.test.tsx` |
| DT-4 | Low | With the fee read failed, Create's review said "Fees: none" and disabled signing without a word; a failed wallet read showed "Reading your wallet" for ever. | "Could not read the fees: try again" and the same for the wallet. `audit4_dt_create_settings_failed.test.tsx` |
| DT-5 | Low | A cancelable vesting was never called cancelable in words; cards did not mark it. | Same fix as RT1. `audit4_dt_buyer_view.test.tsx` |
| DT-6 | Low | Claim all splits by count. Keys of long tranche lists can exceed the transaction's gas together while each passes alone; the page then said each was refused on its own and offered the same claim again. | It says each passes on its own and offers to claim the first half. `audit4_dt_blocking_keys.test.tsx` |
| DT-7 | Low | After a fee vote during a creation in parts, "You pay" added the new fee while the rows above it showed the frozen one. | "You pay" uses the frozen fees. `audit4_dt_create_you_pay.test.tsx` |
| DT-8 | Info | A label under 64 characters but over 64 bytes (accents, emoji) disabled signing with only a counter under the field. | A notice in step 5 names it. `audit4_dt_label_bytes.test.tsx` |

## Web

| # | Severity | Finding | Fix |
|---|---|---|---|
| WEB-1 | Low | `/t/`, `/v/` and `/a/` showed any text in the address as the page's heading: a link to the real domain could carry someone else's message. A missing token read as "the network did not answer". | Each page checks the shape of the identifier before it reads or shows anything; text of another shape is called not a token identifier, a vesting number or an address and is never repeated; a missing token reads "No such token on this network". `audit4_web_route_echo.test.tsx` |
| WEB-2 | Low | A copy of the site looks the same, the Verify box included. What a copy cannot fake is the receiver the wallet shows; nothing told people to check it. | The Verify box, step 7 and the guide for beneficiaries (PDF) name mvxvest.io as the only site and say the wallet must show the contract address as the receiver. `audit4_web_guide_clone_checks.test.tsx` |
| WEB-3 | Low | No Cross-Origin-Opener-Policy: a page that opened the site kept a handle on its tab and could later send it to a copy. | `same-origin-allow-popups` on both sites; the web wallet's popup still works. `audit4_ops_site_headers.test.ts` |
| WEB-4 | Low | mvxvest.io has no SPF, DMARC or MX record, so mail can pretend to come from it. | For the owner: three DNS records (below). |
| WEB-5 | Info | follow-redirects 1.16.0 (two advisories) under axios, in Node only. | Overridden to 1.16.1. `audit4_web_supply_lock_advisories.test.ts` |
| WEB-6 | Info | Nothing pinned the package manager: an older pnpm would run the install scripts the workspace disables. | `packageManager` with its hash and `engines` in `dapp/package.json`. `audit4_web_supply_package_manager.test.ts` |
| WEB-7 | Info | The CSP allowed two hosts the site never calls and WalletConnect's telemetry. | All three removed; the telemetry's failures are caught. `audit4_ops_site_headers.test.ts` |
| WEB-8 | Info | HSTS without preload. | For the owner (preload is slow to undo). |
| WEB-9 | Info | Labels are the creator's free text but read as plain prose: "Your FOXSY vesting moved: claim at …" looked like a notice from the site. | Labels are in quotes everywhere and marked as the creator's. `audit4_web_label_marked.test.tsx` |
| WEB-10 | Info | Three CI actions and the secret scanner's image were pinned by tags that can move. | Same fix as OPS-5. |

## Operations

| # | Severity | Finding | Fix |
|---|---|---|---|
| OPS-1 | Low | The multisig tool described a recovery of a bounced key without reading its vesting: a second signer could not see that the recipient was a stranger. | It names the beneficiary (claim key) or the creator (cancel key) and warns when the recipient is someone else. `audit4_ops_multisig_signer.test.ts` |
| OPS-2 | Low | `sign` and `perform` accepted calls the contract refuses (a fee over its cap, an argument an endpoint does not take); a failed perform uses the action up. | Refused before anyone signs. Same file. |
| OPS-3 | Low | An upgrade source whose API answer did not say whether it is upgradeable passed as frozen. | Refused until the answer says. Same file. |
| OPS-4 | Low | The secret scan's exception for token identifiers hid any secret that merely started like one. | The pattern must match the whole secret; all 113 commits still scan clean. `scripts/ci/audit4_ops_gitleaks_allowlist_test.py` |
| OPS-5 | Low | Three actions in CI were pinned by tag. | Pinned by commit, the scanner's image by digest. |
| OPS-6 | Low | With one maintainer the "one approval" rule cannot be met, so every merge uses the admin bypass, which also skips both required results. | For the owner (below). |
| OPS-7 | Info | The review workflow asked for an OIDC token it never uses. | Removed. |
| OPS-8 | Info | Required results are not strict: a pull request tested against an older main can merge after main moved. | For the owner (below). |
| OPS-9 | Info | CI reads the secret scan's settings from the pull request itself. | A change to `.gitleaks.toml` or `.gitleaksignore` is now checked by hand, like a change to CI. |
| OPS-10 | Info | Any label added to a pull request ran the review again (billed) and CI. | The review runs only for `merge-check` and another label no longer cancels it. CI keeps running on any label: a run whose jobs were all skipped would read as passed, which is worse than spent minutes. |
| OPS-11 | Info | The sites had no `/.well-known/security.txt`. | Added; it points to private reporting and SECURITY.md. `audit4_ops_site_headers.test.ts` |

## Red team

| # | Severity | Finding | Fix |
|---|---|---|---|
| RT1 | Medium | A buyer of a claim key on a marketplace had four dead ends: the start page refused a key's identifier as shown by wallets (`VESTKEY-f56bea-07`); the collection's identifier landed on a token page that called a 404 a network failure; the vesting page never said that whoever holds the cancel key can stop it and keep what has not vested; the guide only said "it says whether someone holds a cancel key". The sale itself is played end to end in `audit4_redteam_marketplace_sale.rs`. | The start page and `/k/` take a key's identifier and open its vesting; a key of any other collection reads "Not an mvxvest key". The collection's page says it holds keys, not a token. A cancelable vesting carries a notice: who holds the cancel key, what a cancel would keep now and that the key itself never shows what was claimed. Cards carry a "cancelable" mark. Step 9 of the guide says to read the vesting right before paying. `audit4_redteam_key_buyer.test.tsx` |
| RT2 | Low | The multisig tool checked an upgrade's source by the code hash the API states, never by hashing the code it had already downloaded. | It hashes the code (blake2b-256) and refuses when the hash differs from the API's or from the release's. `scripts/src/audit4_redteam_source_code_not_hashed.test.ts`. mvxsafe.io's upgrade card reads the same field; passed to mvxsafe's own audit. |
| RT3 | Low | The merge gates are not strict; the maintainer's own merges bypass them. | As OPS-5, OPS-6 and OPS-8. |
| RT4 | Info | The key pictures can be shown by a look-alike collection. | Accepted: anyone can copy a picture. The identifier is the proof; the Verify box names it and a key's identifier pasted on the site says whether it is mvxvest's. |
| RT5 | Info | Mainnet's one live claim key predates the `cancelable` marker. | As SCK-2. |

## For the owner to decide

- **Contract version 3** (SCK-1, SCK-2, SCM-1): stamp what a claim paid into the returned key, mark cancelable keys in their name, a status view and a deficit view. It needs the code, an audit of its own, a devnet rehearsal and a multisig vote. Version 3 must not add fields to the stored structures (`Vesting`, `TokenTotals`, `KeyDisplay`, `Schedule`): old entries would stop decoding.
- **Merge rules** (OPS-6, OPS-8, RT3): either a second maintainer who approves or no required approval while both results stay required (then the owner's own pull requests merge without the bypass). Strict results cost a new `merge-check` after each update of main.
- **DNS** (WEB-4): `v=spf1 -all`, a DMARC record with `p=reject` and a null MX, in the domain's DNS at DigitalOcean.
- **HSTS preload** (WEB-8): add `preload` and submit the domain; leaving the list later takes months.

## Checked sound

- **Money:** settlement is an exact match of the three sums (total, token fee, EGLD fee); a unit off either way, a missing fee, a fee not due or a key among the payments is refused with nothing kept. A random walk (12 seeds of 160 steps, three tokens, every fee rate, pauses, bounces and recoveries) keeps balance = deposited − claimed − refunded + fees + bounces after every step. Claim and cancel in every state and order end with the holder owning exactly what vested and the cancel key's sender the rest.
- **Owner:** every admin endpoint is owner only, the caps hold at their limits, a pause stops only creations, the key collections cannot be swapped; an upgrade keeps every stored vesting readable (layouts pinned by tests).
- **Keys and schedules:** a look-alike collection is refused, a key sent to the wrong endpoint comes back, labels of any 64 bytes are stored and shown safely, every curve's edges match between the contract and the dApp.
- **dApp:** what is signed is what the review shows (the transactions' bytes checked); amounts and addresses are parsed strictly; failed reads never answer zero (the two exceptions were DT-3 and DT-4).
- **Web:** no injected HTML or scripts anywhere; the CSV export guards formulas; WalletConnect's relay refuses other origins, so a copy cannot use the project; a local build of the deployed commit reproduces the live files byte for byte.
- **Operations:** the review gate held against about 60 new escape probes (`audit4_ops_review_gate_test.py`); results are posted only by the checks App from main; no secret in the history; the multisig tool never signs on mainnet; the live owner, board, quorum, fees and limits match MAINNET.md.

## The agent review of the fixes

The merge gate's Claude review passed the fixes and found two more gaps, both Low, fixed with a test each:
- the start page still sent "#07" and "0" to the vesting page, which now refuses them: "#07" opens vesting 7 and 0 gets the start page's own message (`audit4_redteam_key_buyer.test.tsx`);
- the notice of a key that blocks Claim all still put a label inside the site's sentence: it is quoted there too (`audit4_web_label_marked.test.tsx`).

## Noted while fixing

- `pnpm typecheck` in `scripts/` fails on three devnet helpers (`csv120.ts`, `fund-demo.ts`, `v2-batches.ts`) that import the dApp's code with a second copy of sdk-core. CI does not type check the scripts; the owner's tool and the tests are clean. In the backlog.
- An earlier test of the guide (`audit_redteam_guide.test.tsx`) expected one key collection identifier on the page; step 9 now shows a key's identifier as an example, so it looks for at least one.

## Running the proofs

- Contract: `cargo test -p mvxvest` (SCK-1: `cargo test -p mvxvest --test audit4_sck_market_stale_key -- --ignored`, fails until version 3).
- dApp: `cd dapp && pnpm test` (the `audit4_*` files).
- Owner's tool: `cd scripts && node --import tsx --test src/audit4_ops_multisig_signer.test.ts src/audit4_redteam_source_code_not_hashed.test.ts`.
- Secret scan: `python3 scripts/ci/audit4_ops_gitleaks_allowlist_test.py` (needs docker); review gate: `python3 scripts/ci/audit4_ops_review_gate_test.py`.
