# Deploying

How the contract goes on a network, in order. On devnet and testnet the
scripts in [scripts/](../scripts/) do it with a local key.

**On mainnet** a single-purpose deployer wallet does the one-time deploy and
setup with [scripts/src/mainnet.ts](../scripts/src/mainnet.ts). The script runs
one step per invocation and checks each on chain. It then hands ownership to
the mvxsafe multisig and keeps no power; every later owner action is a
multisig proposal. Nothing on mainnet runs before Sebastian says so, and each
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
the mainnet launch used 100M and was charged all of it). Check
`getClaimKeyCollection` and `getCancelKeyCollection` return the new ids, and
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
whitelisted, but it still lists the images and makes thumbnails of the PNG, and
the explorer shows them. Call `setKeyDisplay(Claim, metadata, png, svg)` and the
same for `Cancel`, PNG first. A new image gets a new file name (as
`claim-key-2.png` did), because wallets cache by URL.

## 6. Fee, then open

`setFee` (at most 1 EGLD; see DECISIONS #10 for the fee agreed for after the
next upgrade; until then creating is free), then `unpauseCreation`. Run the
acceptance flow with small amounts before announcing anything.

## Owner actions through the multisig (rehearsed on devnet, 13 Oct 2026)

On mainnet the owner is the legacy mx-contracts-rs multisig `erd1…ul78u3` (2 of 3). Its code is byte-identical to `mvxsafe/app/public/contracts/multisig.wasm` (hash `f5658529…`). mvxsafe cannot propose contract calls or upgrades yet, and the old MultiversX multisig site is gone. Until a page for this exists, [scripts/src/multisig.ts](../scripts/src/multisig.ts) builds every owner action, and a board member sends it from their wallet: to the multisig, 0 EGLD, with the printed data and gas.

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
- **An upgrade from source** used 8,264,045 gas in the contract's shard for the 26,540-byte release, about 300 gas a byte, and performs of 23.3M and 25.3M worked.
- **The callback** came back with 6,458,200 gas, and a perform with 5M for it ran out.

`scripts/src/multisig.ts` now budgets 7M for the callback, and for an upgrade (300 × the source's bytes + 1M) × 1.2.

Rules that follow from it:
- **A failed `perform` uses up the action**, which must then be proposed and signed again. The tool's gas budget has three parts: the multisig's own share, the call's measured need times 1.2, and **7M for the callback**.
- **The network cannot simulate `performAction`** when its call goes to another shard ("no async context found"). That is why `perform` uses the measured budget instead of a simulation. `propose` and `sign` are simulated (×1.2, plus 50,000 for a guarded wallet).
- **An upgrade needs a source**: the new reproducible build, deployed in the **multisig's shard** (shard 1 on mainnet), because `performAction` reads the code there. Check that the source's code hash on chain equals the build's before proposing (`stage` does this on devnet). Then `proposeSCUpgradeFromSource@<contract>@@<source>@0500`. The metadata must be `0500` (upgradeable, readable, not payable): anything else changes the contract for good.
- **Deploys are charged their whole gas limit** (devnet multisig 96M of 96M, source 105.5M of 105.5M, mainnet 150M of 150M). Simulate them, and keep the margin small.

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

**Before the mainnet upgrade:**
1. The audit rounds review this code. If they change it, the hash changes and this rehearsal is repeated.
2. Add the new hash to `contractCodeHashes` in `config.mainnet.ts` and deploy the site.
3. Deploy the source in shard 1.
4. A first harmless mainnet vote (`setFee 0`) proves the guarded signers on mainnet and shows how mainnet's callback gas compares with devnet's. Until then an upgrade on mainnet is performed with at least 118.5M gas (Sebastian, 14 Oct 2026); `scripts/src/multisig.ts` and mvxsafe both apply this floor.
5. Then propose, sign and perform the upgrade.
6. Then vote the fees: `setTokenFee 100` and `setFee 0.1`.

## Upgrades

`scripts/src/deploy.ts upgrade` on devnet; a multisig proposal on mainnet.

Every page compares the contract's code hash with `contractCodeHashes` in `dapp/src/config/config.<network>.ts` and shows a red banner when it is not listed. Before proposing an upgrade, add the new build's hash there and deploy the site. Once the upgrade is done, remove the old hash and deploy again. The same file names the owner multisig. The site warns when the owner differs, so a change of owner also needs a site deploy.
Same metadata as the deploy (the contract cannot check it in `upgrade`).
Storage layout must stay compatible: never reuse the old storage name
`claimKeyUsed`. Record each version's code hash in the CHANGELOG.
