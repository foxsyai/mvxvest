# Big audit, Claude Fable 5.1 at max effort (13 October 2026)

Four reviewers worked in parallel on the code that runs on mainnet: the contract, the dApp, deployment and operations, and a red team across all layers. Each proved its findings with a failing test, or with exact evidence where a test does not fit. The proofs are the `audit_fable_*` and `audit_redteam_*` files.

**Bottom line:**
- No reviewer found a way for anyone to take, lose or lock funds through the contract.
- The site's promises about the owner hold in the code as it stands.
- The findings below are about what users are shown, cheap griefing, and operations.

## Contract (needs a multisig-voted upgrade)

| # | Severity | Finding | Plan |
|---|---|---|---|
| C1 | Low | `recoverSurplus` always moves the whole surplus, so two bounced payouts cannot be returned to their owners separately. | `recoverSurplus(token, to, amount)`. Upgrade-compatible. |
| RT3 | Medium | A cancelable claim key carries no marker: its attributes are the same as the cancel key's. Someone can sell a claim key and then cancel the vesting. | New keys get `cancelable`, `total` and `end` in their attributes. The site shows it now. |

Upgrade constraints, pinned by `audit_fable_accounting.rs`:
- the stored layouts and storage keys stay unchanged;
- EGLD is stored as `EGLD-000000`;
- the metadata is `0500`;
- the storage name `claimKeyUsed` is never reused.

## dApp

| # | Severity | Finding |
|---|---|---|
| D1 | High | The guard against signing behind a possibly-lost send works only while a signing panel is open. After navigating away, Close or a reload, the next creation can be signed behind the lost send, and both execute if it turns up. |
| RT1 | Medium | Dust-key spam: past 10,000 keys the API refuses to page, so My vestings and the address page fail. Below that, real vestings are buried, and 2,000 dust vestings push them off the Token page. |
| RT2 | Medium | A look-alike token, such as a fake "FOXSY", shows as FOXSY on the cards. |
| RT4 | Medium | The token issuer's powers are never shown (FOXSY can be paused by its issuer). "Nobody can stop it" overstates this. |
| RT5 | Medium | Nothing tells a user that the contract was upgraded to unknown code. The owner multisig and its signers are not named. |
| RT6 | Medium | A vesting cancelled before anything vested shows "Completed". |
| D2 | Low | My vestings, Created by me and the vesting page can offer "Sign" again after a disconnect and reconnect while a signature is in flight. Create was fixed in round 3. |
| D3 | Low | A wallet that hands back nothing is reported as "sent". |
| D4 | Low | A key the contract holds after a bounce is shown as an ordinary holder. |
| RT7 | Low | One hostile dust key, for example of a frozen token, makes "Claim all" fail, and the page cannot say which key. |
| RT8 | Low | The guide gives readers nothing to verify against: no contract address, collections, owner or quorum, and no mention of the bounce exception. |
| RT9 | Low | A smart contract as beneficiary passes without a warning. |
| info | Info | `deploy.sh` defaults to mainnet; the shown fee ignores the guardian's 50,000 gas; there is no timeout on `createdIdsOf`; outcome polls bypass the rate limiter; the claim-key list can miss a key minted in the last 2 minutes. |

## Deployment and operations

| # | Severity | Finding | Status |
|---|---|---|---|
| H1 | High | The emergency path (a pause or upgrade by multisig vote) had never been exercised, and there was no tool for it. | **Done:** `scripts/src/multisig.ts`, rehearsed on devnet (pause, unpause, key images, upgrade); runbook in [DEPLOY.md](../DEPLOY.md). Board members still lack a wallet-friendly way to send the transactions (a page). |
| H2 | High | The deploy account on the shared droplet is passwordless root, and a GitHub Actions key can log in as it. | Later, with Sebastian: a separate deploy user without root. |
| M1 | Medium | Certificate renewals never reload nginx for the webroot sites, so mvxsafe.io would serve an expired certificate from 4 Jan 2027 and mvxvest.io around 10 Jan. | **Done 13 Oct:** `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` runs `nginx -t && systemctl reload nginx`; `certbot renew --dry-run` passes for every certificate. |
| M2 | Medium | The site promises checks the public cannot make yet (the repo is private) and does not name the owner. | Guide: a verify box. |
| M3 | Medium | CI does not prove that `main` still reproduces the deployed code hash. | A CI job. |
| L1–L8 | Low | Docs out of date; internal details to trim before the repo goes public; repo hygiene (SECURITY.md, package.json, branch protection); the collections' unused roles to be documented; a guard for the key images; confirm the three signers are distinct people. | With the fixes, and before the repo goes public. |

Verified clean:
- the mainnet state matches the records;
- the code hash is reproduced from a clean clone;
- no secrets in the 59 commits;
- the GPL text is stock;
- no Pulsar code was copied;
- the accounting holds (deposited = claimed + refunded + owed);
- the gas of the worst cases leaves every vesting claimable and cancelable.
