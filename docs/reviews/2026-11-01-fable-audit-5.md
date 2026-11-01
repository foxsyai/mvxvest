# Fifth audit: everything, before the announcement (Claude Fable 5.1, 1 November 2026)

Eight reviewers worked in parallel on `main` at 26b0d4c, each on one area of the whole system:
- **AUTH**, who can call what: every entry point against every kind of caller and payment;
- **MONEY**, the contract's money paths and its books;
- **KEYS**, keys, schedules, labels and version 3's stamp;
- **PROTO**, what the MultiversX protocol itself allows against the contract;
- **DAPP**, whether what people sign is what they read;
- **WEB**, the site as a target and its supply chain;
- **OPS**, the owner's tool, the merge gates, the release path and the docs against the chain;
- **RT**, a red team that plays whole attacks across those areas.

A separate audit by the session that looks after mvxsafe read this repository at the same time, with its own tests: its VSD and OPZ findings are below.

The rule of every round: a finding is a test that fails on the audited code or exact evidence where a test does not fit. Then Claude Opus 5.5 writes the fix and the same test passes. What could not be proven is listed as such and was not fixed. Two more Fable 5.1 reviewers then attacked the fixes: V4C the contract, FIXR all the rest. The merge gate's Claude review read them too.

**Bottom line:**
- **Nobody can take funds and no wallet can call what it should not.** AUTH ran 72 unauthorized calls on the owner's endpoints and every payment shape on claim and cancel: all refused. A random walk of 2,000 steps over every money path keeps the books exact after every step. Mainnet's books were read again on 1 Nov: balance and debts match to the last unit, surplus and deficit 0. A clean rebuild gives the exact code hash mainnet runs.
- **One High, RT-1: a griefer could disturb a running vesting.** For about 0.15 EGLD a griefer could send a victim's real claim keys and payout back into the contract. Nothing was lost, but only votes of the owner's multisig could return them. It was proven on devnet with real transactions, then fixed in the site and in a contract version 4. The same attack on devnet now moves only the griefer's own dust.
- **Two Medium findings about what the Token page says** (RT-2, RT-3) and the deploy script's missing gates (OPZ-01), all fixed.
- **Version 4 is live on mainnet since 1 November 2026,** by a vote of the owner's multisig ([MAINNET.md](../MAINNET.md)).

## RT-1 in detail

The griefer issues a token that can be frozen (0.05 EGLD), makes a 1 unit vesting of it to the victim (0.1 EGLD fee) and freezes the victim for that token. The site's Claim all put that dust key in one claim with the victim's real keys. For a victim in another shard than the contract:

1. the site's simulation passes, because the simulator runs only the first hop;
2. the contract books every claim and sends one `MultiESDTNFTTransfer` with every token and the returned keys;
3. the victim's shard refuses it: "account is frozen for this esdt token";
4. all of it returns to the contract.

Played on devnet, in order:

| | Transaction | Result |
|---|---|---|
| Version 3 | `f17518c55f103050e1ea5510223341ec41509222da3a186580c505f874fc9d64` | The real key in the contract, 50.03 TFOX in surplus, deficit 0. Two multisig votes returned both. |
| Version 4, the same claim | `55b87d9788f07cd21a0655e72475193e946cb2c58f9292b17413e17eeb52f050` | The victim received 50.02 TFOX and kept the key. Only 1 unit of the griefer's token came back. |
| Version 4, one key of the frozen token | `6134e264ea1c947bbd5d3a2203ed900e96759250014f472ead517887427bd588` | 50 units came back. The key stayed with its holder, stamped "50% claimed". |

The API calls all three `fail`, whatever arrived. The rehearsal is `scripts/src/audit5-bounce-rehearsal.ts`.

The token's own issuer can still have a holder's payout refused, by freezing that holder or by a transfer role. On version 4 that bounces only the payout: the holder keeps the key and the owners can return the money. Nobody else can do this to a token they did not issue. Same shard as the contract, a refused transfer still reverts the whole claim, with nothing booked.

## Contract

| # | Severity | Finding | Fix |
|---|---|---|---|
| RT-1 | High | One transfer carried every token and every key of a claim, so one refused token took all the others back with it. | **Version 4:** `claim` and `cancel` send each token and the returned keys apart. Gas of one stamped claim +1.3%. `audit5_contract_separate_transfers.rs`, `audit5_contract_go_vm.rs`, `audit5_redteam_bounced_claim_all.rs` and the devnet runs above. |
| PROTO-1 | Low | The same root reached by the token's issuer: a frozen holder's key came back with the refused payout. | Same fix; the third run above. |
| KEYS-1 | Info | The stamp's 256 byte window lost a key's minted metadata once `claimed` had about 160 digits. No real key is near that; mainnet's display metadata is empty. | Window of 512 bytes, the bound in a comment. `audit5_keys_stamp_metadata_window.rs` |
| PROTO-2 | Info | The spec said a wallet never bounces and that a contract holder must accept tokens from other contracts: wrong on both counts. | Spec and comments corrected, version 3's behaviour marked as live until an upgrade. |

Version 4's own audit (V4C) found no defect. It rebuilt the release independently and got the same hash; exports and imports equal version 3's; and an upgrade from the real version 3 code keeps every storage key and every balance byte for byte, with vestings in every state (`audit5review_contract_go_vm.rs`). A version 1 layout key still claims and stamps.

## dApp

| # | Severity | Finding | Fix |
|---|---|---|---|
| RT-1 | High | Claim all mixed tokens in one claim, the simulation gave no warning and the site had no words for a claim that was booked and then refused. | One claim per token; a read before signing leaves out a key of a token this wallet is frozen for or that is paused; each claim or cancel of one warns and asks first; after a bounce the site says per token what came back and what arrived on either contract version and that only the owners can return it. `audit5_redteam_bounce_claim_all`, `audit5_fix_*` |
| RT-2 | Medium | The Token page counted a cancelable vesting as a lock and never said so. A team could show a 24 month lock and pull it back. | A mark per row and how much cancel key holders can still pull back. `audit5_redteam_token_lock_cancelable` |
| RT-3 | Medium | An issuer who wipes the contract's balance leaves the books unchanged: the pages kept showing the lock and "Claimable now". | The site reads `getDeficit` and says the contract holds that much less than it owes. `audit5_redteam_token_wiped` |
| VSD-01 | Low | The guide told people to check that the wallet shows the contract as the receiver. Only an EGLD vesting does: a claim, a cancel and a token vesting name the signer as the receiver, with the contract inside the data. | The guide, the Verify box and the beneficiaries' PDF say what each kind of wallet shows and give the contract's hexadecimal form. |
| VSD-02 | Low | The list of an issuer's powers left out that special roles can mint any amount and stop every transfer. | Words built from each token's own flags. |
| DAPP-1 | Low | A card said "grows every second" before the cliff. | Guard added. |
| DAPP-2, VSD-03 | Low | The owner check said nothing when the API's answer had no owner. | "Could not be checked". |
| VSD-04 | Low | A failed guardian read showed a guarded wallet's valid transaction as refused. | The session's guardian or Check again. |
| VSD-05 | Low | The read timeout did not cover the body: three stalled answers stopped every read in the tab. | The whole read is timed. |
| VSD-06 | Low | A clock stepped backwards stalled reads. | A monotonic clock. |
| VSD-09 | Low | A simulation that could not run read as the network refusing the transaction. | Retried, then Check again. |
| FIXR-1 | Low | After Try again, a frozen answer no longer held the signature back. | Found in the fixes, fixed. `audit5review_fixr_payout_gate_retry` |
| Reopen | Low | A Claim or Cancel opened again showed the previous read's answer until the new one came, so a token frozen since then was not caught. Found by the merge gate's review of the fixes. | Closing forgets the answer, and the page says it is checking until the new read. `audit5_fix_payout_reopen` |
| Create | Low | A create whose key delivery bounced read as failed and offered to sign again, which would lock the money twice. | It says the vestings exist. |
| DAPP-3 | Info | The guide's list of owner powers left out `setKeyDisplay`. | Added. |

## Web and supply chain

| # | Severity | Finding | Fix |
|---|---|---|---|
| WEB-2 | Low | The owner's signing tool had none of the dApp's supply chain policy and CI never tested it. | `packageManager` pinned, release age, build scripts off, a CI job. |
| WEB-1, OPZ-08 | Info | Two new advisories under `axios` and `qs`, neither reachable in the bundle. | Overrides raised. |

Sound: live headers equal the repository's file; no way found to run code on the site; a clean build of 26b0d4c equals the live files byte for byte, 47 of 47 on each site; every locked package has an integrity hash.

## Operations

| # | Severity | Finding | Fix |
|---|---|---|---|
| OPZ-01, VSD-07 | Medium | `deploy.sh` could ship a file git ignores, a commit behind `origin/main` and a skip-worktree change, without a word. The upload was not atomic and no audit ran. | Gates ported, atomic upload, audit gate. A rollback names itself with `OLD_COMMIT=1`. `audit5_ops_deploy_gates.mjs`, `audit5_VSD-07_deploy_gate` |
| OPZ-07 | Low | An ignored env file could ship a development build as mainnet. | Refused. |
| OPS-1, OPS-3, VSD-08 | Low | The owner's tool accepted recoveries the contract refuses (each wastes an action) and showed a surplus recovery with no amount. | Read from the chain and refused before signing. `audit5_ops_multisig_signer`, `audit5_VSD-08_recover_surplus` |
| OPS-2 | Low | Control bytes in an action's arguments could forge the line a signer reads. | Refused or printed safely. |
| OPS-4 | Low | The tool's idea of the mainnet contract came from a local file. | A constant; a disagreeing file is refused. |
| OPS-5 | Low | The reproducible build's image was named by a tag that can move. | Named by digest. |
| OPS-6 | Low | `deploy.sh` never compared the site's list of hashes with what the chain runs. | It refuses. |
| OPZ-06 | Low | The review installed its CLI through an unpinned script. | Pinned by hash. |
| OPZ-05 | Low | `/version.txt` had no cache header. | Added. |
| OPS-8 | Info | No plan for a bug found after the announcement. | [Incident runbook](../DEPLOY.md#incident-runbook), including that each signer derives the release hash on their own. |
| OPS-7, OPS-9, FIXR-2, FIXR-3 | Info | Small drift between the docs and the facts; a wallet address in a comment, which also stays in the public history. | Corrected; history is not rewritten. |

## Not proven, so not fixed

- What each wallet displays for a token transfer: the transaction's fields are proven, a device's screen is not. The guide's words go by kind of wallet.
- A claim of 98 stamped keys on a live network: the built-in call budget rests on the protocol's source and a count, since neither test VM enforces it. The site sends at most 50.
- That a paused token bounces rather than fails whole: the words say "could".
- Whether the Claude review can be talked into passing by a pull request: a model question. The owner's reading remains the gate.
- A lying API about a token's decimals: the site has no second source. Accepted by its architecture.

## Checked sound

- **Authorization:** the live code's 45 exports equal the build's; `init`, `upgrade` and `callBack` cannot be called directly; a look-alike collection, nonce 0, an amount of 2 and a key next to other payments are refused; after a sale the old holder and a creator with a sold cancel key get nothing.
- **Owner:** without an upgrade the owner cannot touch a running vesting. Pause, both fee caps, the key display and the stamp's switch together leave claims and cancels paying exactly what they should. The owner's recoveries reach only what bounced.
- **Keys:** both live collections cannot be frozen, wiped or paused and cannot change owner; the contract alone holds their roles; holders cannot burn or rewrite a key. A label written like attributes reaches neither the key's name nor its attributes.
- **Schedules:** every curve at every edge, checked from a hand worked table in both the contract and the dApp.
- **Money:** every second of eight schedule shapes cancelled from before the start to past the end; 1e30 units over 30 years; EGLD as both asset and fee at both caps; a wiped token never touches another token's books.
- **Signing:** the bytes of every transaction the dApp builds match the review; amounts in other digits, hidden characters in addresses and crafted CSV files are refused.
- **Gates:** no secret in the history; a fork's pull request reaches no secret; results come only from the checks App.

## For the owner to decide

- **SPF, DMARC, null MX and HSTS preload:** as decided on 21 Oct, for later.

## Running the proofs

- Contract: `cargo test -p mvxvest` (the `audit5*` files); the Go VM tests need `sc-meta all build --path contracts/vesting` first.
- dApp: `cd dapp && pnpm test`.
- Owner's tool: `cd scripts && pnpm test`.
- Deploy and docs: `python3 scripts/ci/audit5_ops_release_path_test.py`, `python3 scripts/ci/audit5_ops_docs_test.py`, `node scripts/ci/audit5_ops_deploy_gates.mjs`.
- The devnet attack: `MVXVEST_NETWORK=devnet pnpm tsx src/audit5-bounce-rehearsal.ts` in `scripts/`, with devnet keys of your own.
