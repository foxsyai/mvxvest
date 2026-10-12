# Deploying

How the contract goes on a network, in order. On devnet and testnet the
scripts in [scripts/](../scripts/) do it with a local key. On mainnet every
owner action is a proposal in the mvxsafe multisig, and nothing is done
before Sebastian says so.

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
