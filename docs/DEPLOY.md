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
| upgrade from source | done: same code hash, still upgradeable, readable, not payable; 459 vestings intact | 7.5M + 106M + 5M |

Rules that follow from it:
- **A failed `perform` uses up the action**, which must then be proposed and signed again. The tool's gas budget has three parts: the multisig's own share, the call's measured need times 1.2, and **5M for the callback**. On a call to another shard, the network holds back 4M of the forwarded gas for the callback.
- **The network cannot simulate `performAction`** when its call goes to another shard ("no async context found"). That is why `perform` uses the measured budget instead of a simulation. `propose` and `sign` are simulated (×1.2, plus 50,000 for a guarded wallet).
- **An upgrade needs a source**: the new reproducible build, deployed in the **multisig's shard** (shard 1 on mainnet), because `performAction` reads the code there. Check that the source's code hash on chain equals the build's before proposing (`stage` does this on devnet). Then `proposeSCUpgradeFromSource@<contract>@@<source>@0500`. The metadata must be `0500` (upgradeable, readable, not payable): anything else changes the contract for good.
- **Deploys are charged their whole gas limit** (devnet multisig 96M of 96M, source 105.5M of 105.5M, mainnet 150M of 150M). Simulate them, and keep the margin small.

## Upgrades

`scripts/src/deploy.ts upgrade` on devnet; a multisig proposal on mainnet.

Every page compares the contract's code hash with `contractCodeHashes` in `dapp/src/config/config.<network>.ts` and shows a red banner when it is not listed. Before proposing an upgrade, add the new build's hash there and deploy the site. Once the upgrade is done, remove the old hash and deploy again. The same file names the owner multisig. The site warns when the owner differs, so a change of owner also needs a site deploy.
Same metadata as the deploy (the contract cannot check it in `upgrade`).
Storage layout must stay compatible: never reuse the old storage name
`claimKeyUsed`. Record each version's code hash in the CHANGELOG.
