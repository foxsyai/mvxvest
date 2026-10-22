# Deploying

How the contract goes on a network, in order. On devnet and testnet the
scripts in [scripts/](../scripts/) do it with a local key.

**On mainnet** a single-purpose deployer wallet does the one-time deploy and
setup with [scripts/src/mainnet.ts](../scripts/src/mainnet.ts). The script runs
one step per invocation and checks each on chain. It then hands ownership to
the mvxsafe multisig and keeps no power; every later owner action is a
multisig proposal. Nothing on mainnet runs before Sebastian says so. Each
step is shown to him first. Without `MVXVEST_MAINNET_GO=yes` a step only says
what it would do.

```sh
export MVXVEST_NETWORK=mainnet
pnpm tsx src/mainnet.ts status                                  # read only
MVXVEST_MAINNET_GO=yes pnpm tsx src/mainnet.ts deploy           # then pause, collections, noburn,
                                                                # display, unpause
MVXVEST_MAINNET_GO=yes MVXVEST_MULTISIG=erd1... MVXVEST_MULTISIG_CONFIRM=<last 6> \
  pnpm tsx src/mainnet.ts handover                              # then sweep
```

The key is in `~/.config/mvxvest/mainnet/deployer.pem` (mode 600, never in the
repo). Its only job ends with the sweep.

## 1. Build

```sh
sc-meta reproducible-build build --docker-image multiversx/sdk-rust-contract-builder:v12.0.0 \
  --project . --contract mvxvest --no-docker-interactive --no-docker-tty --overwrite
cat output-docker/mvxvest/mvxvest.codehash.txt
```

Deploy only `output-docker/mvxvest/mvxvest.wasm`. Record the code hash.

## 2. Deploy, then pause creation

Deploy with code metadata **upgradeable, readable, not payable, not payable
by smart contracts** (`scripts/src/deploy.ts` on devnet, `scripts/src/mainnet.ts`
on mainnet). On mainnet a single-purpose deployer wallet deploys and sets the
contract up, then hands ownership to the multisig and is swept (DECISIONS #9,
MAINNET.md). The deploy's gas is simulated: a deploy is charged its whole limit.
Check on the explorer or API that the
account's code hash is the one recorded and that `isPayable` and
`isPayableBySmartContract` are false.

Call `pauseCreation` right away: nobody should create a vesting before the
collections are fully set up (step 4).

## 3. Issue the key collections

`issueClaimKey("MvxVestClaimKey", "VESTKEY")` and
`issueCancelKey("MvxVestCancelKey", "VESTCANCEL")`, each paying 0.05 EGLD,
with 75M gas (an asynchronous call to the metachain, which charges a fixed 50M;
the mainnet launch used 100M and was charged all of it). Check that
`getClaimKeyCollection` and `getCancelKeyCollection` return the new ids and
that the contract holds `ESDTRoleNFTCreate` and `ESDTRoleNFTBurn` on both.

## 4. Stop holders from burning keys

`disableKeyBurnByHolders(Claim)` and `disableKeyBurnByHolders(Cancel)`, each
with **75M gas** (60M fails: the system contract charges 50M and then notifies
every shard). Each transaction must show the system contract's
`ESDTUnSetBurnRoleForAll` event for the collection; the API's collection roles
can lag behind, so do not rely on them. Calling it twice fails harmlessly.

## 5. Key images

The images live in `dapp/public/nft/` and are served from
https://mvxvest.io/nft/, without a password and cached for a day
(`scripts/server/nginx-mvxvest.io.conf`). The API marks that storage as not
whitelisted, but it still lists the images and makes thumbnails of the PNG; the
explorer shows them. Call `setKeyDisplay(Claim, metadata, png, svg)` and the
same for `Cancel`, PNG first. A new image gets a new file name (as
`claim-key-2.png` did), because wallets cache by URL.

## 6. Fee, then open

`setFee` (at most 1 EGLD; see DECISIONS #10 for the fee agreed for after the
next upgrade; until then creating is free), then `unpauseCreation`. Run the
acceptance flow with small amounts before announcing anything.

## Owner actions through the multisig (rehearsed on devnet, 13 Oct 2026)

On mainnet the owner is the legacy mx-contracts-rs multisig `erd1…ul78u3` (2 of 3). Its code is byte-identical to `mvxsafe/app/public/contracts/multisig.wasm` (hash `f5658529…`). Since 14 Oct 2026 mvxsafe.io proposes contract calls and upgrades too; its card decodes them for the signers. [scripts/src/multisig.ts](../scripts/src/multisig.ts) builds the same owner actions from a terminal; a board member sends what it prints from their wallet: to the multisig, 0 EGLD, with the printed data and gas.

Every action is three transactions from board members:
1. `propose`, which also counts as the proposer's signature;
2. `sign` by a second member;
3. `perform` by any member.

```sh
export MVXVEST_NETWORK=mainnet MVXVEST_MULTISIG=erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3
MVXVEST_FROM=<board member> pnpm tsx src/multisig.ts propose pause   # or unpause, fee <egld>, claimfees,
                                                                      # display <Claim|Cancel> <png> <svg>,
                                                                      # recover-bounced <id> <kind> <to>,
                                                                      # recover-surplus <token> <to>
MVXVEST_FROM=<board member> pnpm tsx src/multisig.ts propose-upgrade <source erd1>
pnpm tsx src/multisig.ts status            # board, quorum, pending actions and their signatures
MVXVEST_FROM=<another member> pnpm tsx src/multisig.ts sign <id>
MVXVEST_FROM=<any member> pnpm tsx src/multisig.ts perform <id>
```

What the devnet rehearsal established. The devnet contract is owned by a 2-of-2 multisig with the same code, in another shard, like mainnet; see [scripts/src/devnet-multisig.ts](../scripts/src/devnet-multisig.ts).

| Action | Result | Gas of `perform` |
|---|---|---|
| pause | creation paused | 26M used (5.9M multisig, 3.78M the call, the rest held for the callback) |
| unpause, 14M | **failed, "not enough gas"; the action was used up** and had to be proposed again | 14M |
| unpause, 17.1M | done | 7.5M + 4.6M + 5M |
| setKeyDisplay | done | 7.5M + 6.1M + 5M |
| upgrade from source | done: same code hash, still upgradeable, readable, not payable; 459 vestings intact | 7.5M + 106M + 5M (about 5 times too much: see below) |

mvxsafe's own devnet rehearsal measured further on 13 Oct 2026 (its docs list the transactions):
- **An upgrade from source** used 8,264,045 gas in the contract's shard for the 26,540-byte release (about 300 gas a byte). Performs of 23.3M and 25.3M worked.
- **The callback** came back with 6,458,200 gas; a perform with 5M for it ran out.

`scripts/src/multisig.ts` now budgets 7M for the callback and (300 × the source's bytes + 1M) × 1.2 for an upgrade.

Rules that follow from it:
- **A failed `perform` uses up the action**, which must then be proposed and signed again. The tool's gas budget has three parts: the multisig's own share, the call's measured need times 1.2 and **7M for the callback**.
- **The network cannot simulate `performAction`** when its call goes to another shard ("no async context found"). That is why `perform` uses the measured budget instead of a simulation. `propose` and `sign` are simulated (×1.2, plus 50,000 for a guarded wallet).
- **An upgrade needs a source**: the new reproducible build, deployed in the **multisig's shard** (shard 1 on mainnet), because `performAction` reads the code there. Check that the source's code hash on chain equals the build's before proposing (`stage` does this on devnet). Then `proposeSCUpgradeFromSource@<contract>@@<source>@0500`. The metadata must be `0500` (upgradeable, readable, not payable): anything else changes the contract for good.
- **Deploys are charged their whole gas limit** (devnet multisig 96M of 96M, source 105.5M of 105.5M, mainnet 150M of 150M). Simulate them and keep the margin small.

## Version 2 rehearsed on devnet (13 Oct 2026)

The upgrade of [CONTRACT_SPEC.md](CONTRACT_SPEC.md) version 2 (branch `upgrade-v2` at 505f424) was rehearsed end to end on devnet, twice, with two independent toolchains.

**The build:** reproducible, `multiversx/sdk-rust-contract-builder:v12.0.0`, 27,332 bytes, code hash `a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a`.

**mvxvest's own devnet contract, through its 2-of-2 multisig, with `scripts/src/multisig.ts`:**

| Step | Transaction | Gas |
|---|---|---|
| Source deployed in shard 1 (not upgradeable), hash checked | `ea69573ad4e5b147fbda42f88317a8b582f6d26180b1c056ce1853f4ca88db42` | 108.7M, charged in full |
| Propose the upgrade | `7418cab23536ac287dbb500cfa851add4e978d1ce4784fb673ad75dbc846d330` | 6.2M |
| Perform it | `3ab0d78d2f57e864122709f925676cb39893013b0d653f3b9fcb2cc26369d163` | 25.5M (7.5M + 11.0M + 7M) |
| `setTokenFee` 100 (1%), then `setFee` 0.1, later 0.01 | three votes | 19.1M per perform |
| `createBatch` of 49, both fees | `9163c695ff999e0a0e00d6a7cca3dbb2b6db2ca0e8af35d7766d0af4c808b973` | 292M |
| `createBatch` of 32 cancelable, both fees | `fa970c78e784f95796a0f0e71cb99884bde0ec508c3c0d9f48213fb09e83e504` | 286M |

After the upgrade:
- the code hash is the build's;
- the contract is still upgradeable, readable and not payable, with the same owner;
- every total, the vesting count and every surplus are unchanged;
- the largest batches fit the network's 100 built-in calls;
- each 1% reached the multisig;
- the EGLD fees were booked;
- new claim keys say `cancelable:0` or `cancelable:1`.

`scripts/src/v2-batches.ts` repeats the batch check.

**mvxsafe's own builders and gas, against its devnet copy `erd1…l9dzg` (2-of-3 safe):**
- the same source, upgrade performed with 25.6M; the upgrade used 8.50M;
- then `setTokenFee@64` voted and carried out.

**From a wallet with a guardian (14 Oct 2026, mvxsafe):** wallet `erd1wdqwnz…7fspw` (shard 1), with a guardian, ran the whole path on the same copy, every transaction co-signed by the guardian:
- deploy a source;
- propose and perform `pauseCreation`;
- sign and perform `unpauseCreation`;
- propose and perform the version 2 upgrade (25.65M);
- propose, unsign and discard a `setFee`.

Every simulation was accepted with the guardian applied first. Two of the three mainnet signers have guardians.

The simulation of a guarded transaction already counts the guardian's 50,000 gas. The site and `scripts/src/multisig.ts` add another 50,000 after it, which is redundant but a harmless margin.

mvxsafe's docs/upgrade-and-calls.md lists those transactions.

## Version 2 on mainnet: the runbook

Every step is a mainnet action and needs Sebastian's go. Done so far: the first harmless owner vote, `setFee 0`, on 14 Oct 2026 (MAINNET.md). It proved the guarded signers and mainnet's gas for a call.

Before step 3, mvxsafe.io must run the card fixed in mvxsafe PR #3 (merge and deploy need Sebastian's go):
- built-in calls such as `upgradeContract` or `ChangeOwnerAddress` are shown in red and refused;
- an upgrade of the safe itself is red.

**The release.** Its code hash comes from the reproducible build of the merged commit: `sc-meta reproducible-build build --docker-image multiversx/sdk-rust-contract-builder:v12.0.0`. CI's "Reproducible build matches a known mainnet code hash" job prints it too. A plain `sc-meta all build` gives another hash: never use that one.

- Version 2 as audited: `a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a`, 27,332 bytes.
- If the contract changes, this changes and the devnet rehearsal is repeated first.

1. **Merge and deploy the site.** Merge `upgrade-v2` into `main`. Add the release hash to `contractCodeHashes` in `dapp/src/config/config.mainnet.ts`, next to version 1's. CI must be green. Then `./deploy.sh mainnet`. The site works with both versions: no token fee on version 1, the fee shown and paid on version 2.
2. **Deploy the source.** Use erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx (shard 1, Sebastian's choice), with mvxsafe.io's "Deploy a source" and the release's `.wasm` (`output-docker/mvxvest/mvxvest.wasm`). The source must be:
   - not upgradeable, so nobody can change its code before the perform;
   - deployed without arguments;
   - in shard 1, the multisig's shard; any other shard makes the perform fail and uses the action up.

   Then read the source's code hash back from the chain: it must equal the release hash.
3. **Propose the upgrade:** `proposeSCUpgradeFromSource`, in mvxsafe.io. With `scripts/src/multisig.ts`, set `MVXVEST_EXPECT_HASH=<release hash>`: the tool refuses a source whose hash differs, that is upgradeable or that is in another shard.
4. **Each signer checks, then signs.** In mvxsafe.io's card, with the release hash pasted into "expected code hash", check:
   - the target is the vesting contract `erd1…gmllsu`;
   - the source hash matches the pasted release hash (green);
   - the metadata stays 0500 (upgradeable, readable, not payable);
   - the source is not upgradeable and is in shard 1.

   An upgrade only ever comes as an `SCUpgradeFromSource` action. A plain call to `upgradeContract` or `ChangeOwnerAddress` is refused. `multisig.ts sign` and `perform` decode the action, say it in words and refuse anything else.
5. **Perform.** Version 2's upgrade used 118.5M, the mainnet floor until an upgrade had been measured there. It measured the same as devnet, so later upgrades get the measured budget (about 25M for this size). If the perform fails, the action is used up: propose and sign it again.
6. **Verify on chain:**
   - the contract's code hash is the release hash;
   - the metadata is 0500 and the owner is still the multisig;
   - `getLimits` answers 49/32 and `getTokenFee` answers 0;
   - `getVesting(1)` and `getVesting(2)` are unchanged;
   - `getTokenTotals` and `getSurplus` are unchanged for FOXSY and EGLD (surplus 0).

   Record the transactions in MAINNET.md and the version in CHANGELOG.md.
7. **Vote the fees:** `setTokenFee 10` (0.1%; the card reads "setTokenFee(10)"), then `setFee 0.1` EGLD. Each is propose, sign, perform at about 19M. Then check that `getTokenFee` answers 10 and `getFee` answers 10^17.
8. **Afterwards:** remove version 1's hash from `contractCodeHashes` and deploy the site again.

**Operations after version 2:**
- The token fee is sent to the owner in the same transaction as each creation.
- If a token cannot reach the multisig (its issuer froze the multisig for it or the token has a transfer role), the fee comes back to the vesting contract as surplus. The `tokenFeePaid` event says only that it was sent. Check `getSurplus` for fee tokens now and then. Return such a surplus with `recoverSurplus(token, to, amount)`.
- Any new owner must stay payable by smart contracts. Otherwise every fee bounces; in the owner's own shard every fee-paying creation fails.

## Version 3 on mainnet: the runbook

Carried out on 22 Oct 2026 up to step 6 (MAINNET.md, "Version 3"); step 7, the first stamp on mainnet, waits for a test vesting. Every step on mainnet needs Sebastian's go. Every signing step works from a phone: mvxsafe.io in the phone's browser, signed with xPortal. The rehearsal on devnet came first (below).

**The release:** the reproducible build of the merged commit, 29,327 bytes, code hash `65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d` (CHANGELOG.md). Each signer can rebuild it with the command in "Version 2 on mainnet" or take it from CI's "Reproducible build" job of the merged commit; never from a message alone. A plain `sc-meta all build` gives another hash.

1. **Merge and deploy the site.** Both configs list version 3's hash next to version 2's; CI's reproducible build must print the release hash. Then `./deploy.sh mainnet`. The site works with both versions: before the upgrade it reads no `isKeyStamping` and says what it said for version 2.
2. **Deploy the source** with mvxsafe.io's "Deploy a source" from a shard 1 wallet (erd1u05m…gw5esx, as for version 2): the release's `mvxvest.wasm`, not upgradeable, no arguments. Read back `/accounts/<source>?fields=codeHash,shard,isUpgradeable`: the release hash, shard 1, not upgradeable. A deploy is charged its whole gas limit: simulate it.
3. **Propose the upgrade** in mvxsafe.io (`proposeSCUpgradeFromSource@<contract>@@<source>@0500`). From a terminal the same is `MVXVEST_EXPECT_HASH=<release> pnpm tsx src/multisig.ts propose-upgrade <source>`.
4. **Each signer checks, then signs:** the target is `erd1…gmllsu`, the metadata stays 0500, the source's hash is green against the pasted release hash, the source is not upgradeable and is in shard 1.
5. **Perform** with the measured budget: 7.5M for the multisig, about 11.8M for the upgrade of 29,327 bytes and 7M for the callback, about 26M in all (version 2 used 8.50M for its upgrade). A failed perform uses the action up.
6. **Verify on chain:** the code hash is the release's; the owner is still the multisig, the contract upgradeable, readable and not payable; `getLimits` 49/32, `getTokenFee` 10, `getFee` 10^17, `isCreationPaused` false; `getVesting(1)` and `getVesting(2)` unchanged; `getTokenTotals` and `getSurplus` unchanged for FOXSY-5d5f3e and EGLD, `getDeficit` 0 for both; `isKeyStamping` true; `getClaimKeyStatus(1)` equals `getVesting(1)`. Record the transactions in MAINNET.md and the date in CHANGELOG.md.
7. **The first stamp on mainnet.** Mainnet's one live claim key (vesting #1) is fully vested, so its next claim pays the rest and burns it: no stamp. Create a small vesting of a few minutes for a wallet in another shard than the contract's (shard 0), claim it once before the end and read `/nfts/VESTKEY-f56bea-<nonce>` and the holder's own copy (`/accounts/<holder>/nfts?identifiers=...`): the name ends `, <p>% claimed`, the attributes `;claimed:<units>`, the URIs are the two mvxvest.io images, the creator is the contract. If that claim fails on the stamp, vote `setKeyStamping` off (`pnpm tsx src/multisig.ts propose stamping off`, about 19M to perform, like a fee vote): claims then work as in version 2 while the cause is found.
8. **Afterwards:** remove version 2's hash from both configs and deploy the sites again; README and CONTRACT_SPEC say version 3 is live.

## Version 3 rehearsed on devnet (21 Oct 2026)

The upgrade to version 3 (branch `v3`, the release above: 29,327 bytes, `65c689b9…6101d`) went end to end through mvxvest's devnet contract and its 2-of-2 multisig, with `scripts/src/multisig.ts` and `scripts/src/v3-rehearsal.ts`:

| Step | Transaction | Gas |
|---|---|---|
| Source deployed in shard 1 (not upgradeable), hash checked from the chain | `026fe80b4b5caabc05f3c8809d8c48b38a4249b28dc721e7534965b26e87c42a` | 116.6M, charged in full |
| Propose the upgrade (action #13) | `7a374c9f4feb802a449124300c614945ac5cec8cb00f58796769ffe2a9719187` | 5.2M |
| Sign | `dc9e68d23e4c2dab6a5bf72bc03005ae482b74beb9c5227caa0dd5b64c456794` | 4.2M |
| Perform | `bb2eed378633434bc6a8312f064c698a222482432b3498086e0f7391cf1940ae` | 26.26M (7.5M + 11.76M + 7M) |
| Claim #539, same shard as the contract: a key minted by version 2, now `Vesting #539 claim key, cancelable, 26% claimed` | `983db234b8927151df3d566280d8f0d15be9b87f58ddcc6cafb5d23c693b455b` | 8.57M |
| Claim #540 from shard 1: the holder's own copy shows the stamp | `3cb32592c3aff55aa95fe3355eb70da5ccf256ae214cde59bd563710fab38d63` | 8.42M |
| `setKeyStamping` off (action #14), perform | `35820db4ec01c5bf146404c19f7ea731260ae386847802d3d2f0a5001bdb82f0` | 19.1M |
| Claim #539 with the stamp off: paid, key unchanged | `51405298b5b2247fd1ba179014825ade064f816b9ed28c2e425590c50f0def4b` | 6.73M |
| `setKeyStamping` on (action #15), perform | `e5b4c0a608785e05ac48fd6d22e18fb3f7b2f828bee4de4552c47ddf5269d686` | 19.1M |
| Claim #539 again: stamped again (`claimed` moved) | `726b5d9376399fc80edd8414ee72df2a1740eb78180e644a7b6a1974bc5e601a` | 8.11M |

After the upgrade:
- the code hash is the release's; owner, upgradeable, readable and not payable unchanged;
- fees, token fee, limits, pause, accrued fees, the vesting count, the totals and the surplus of TFOX and EGLD byte for byte as before; every vesting view the same but for the time it was read;
- `isKeyStamping` answered true, false after the vote, true again; `getDeficit` 0;
- a stamp keeps the key's URIs (the two devnet.mvxvest.io images), creator (the contract) and owner;
- one stamped key costs about 1.8M gas more than an unstamped claim (8.6M against 6.7M).

## Upgrades

`scripts/src/deploy.ts upgrade` on devnet; a multisig proposal on mainnet.

Every page compares the contract's code hash with `contractCodeHashes` in `dapp/src/config/config.<network>.ts` and shows a red banner when it is not listed. Before proposing an upgrade, add the new build's hash there and deploy the site. Once the upgrade is done, remove the old hash and deploy again. The same file names the owner multisig. The site warns when the owner differs, so a change of owner also needs a site deploy.
Same metadata as the deploy (the contract cannot check it in `upgrade`).
Storage layout must stay compatible: never reuse the old storage name
`claimKeyUsed`. Record each version's code hash in the CHANGELOG.
