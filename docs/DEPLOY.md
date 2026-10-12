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
by smart contracts** (`scripts/src/deploy.ts`). On mainnet the deployer is the
multisig, which becomes the owner. Check on the explorer or API that the
account's code hash is the one recorded and that `isPayable` and
`isPayableBySmartContract` are false.

Call `pauseCreation` right away: nobody should create a vesting before the
collections are fully set up (step 4).

## 3. Issue the key collections

`issueClaimKey("MvxVestClaimKey", "VESTKEY")` and
`issueCancelKey("MvxVestCancelKey", "VESTCANCEL")`, each paying 0.05 EGLD,
with 100M gas (asynchronous call to the metachain). Check
`getClaimKeyCollection` and `getCancelKeyCollection` return the new ids, and
that the contract holds `ESDTRoleNFTCreate` and `ESDTRoleNFTBurn` on both.

## 4. Stop holders from burning keys

`disableKeyBurnByHolders(Claim)` and `disableKeyBurnByHolders(Cancel)`, each
with **100M gas** (60M fails: the system contract charges 50M and then notifies
every shard). Each transaction must show the system contract's
`ESDTUnSetBurnRoleForAll` event for the collection; the API's collection roles
can lag behind, so do not rely on them. Calling it twice fails harmlessly.

## 5. Key images

Pin the final images (PNG first, SVG second) and the metadata JSON on IPFS:
the API only trusts whitelisted storage, and wallets may hide other images.
`setKeyDisplay(Claim, metadata, png, svg)` and the same for `Cancel`.

## 6. Fee, then open

`setFee` (0 for the beta; at most 1 EGLD), then `unpauseCreation`. Run the
acceptance flow with small amounts before announcing anything.

## Upgrades

`scripts/src/deploy.ts upgrade` on devnet; a multisig proposal on mainnet.
Same metadata as the deploy (the contract cannot check it in `upgrade`).
Storage layout must stay compatible: never reuse the old storage name
`claimKeyUsed`. Record each version's code hash in the CHANGELOG.
