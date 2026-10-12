# Scripts

Deploy and interaction scripts for the vesting contract, in TypeScript with
`@multiversx/sdk-core` 15 (the version `sdk-dapp` 5.7 accepts, so the dApp can
reuse this code).

```sh
cd scripts
pnpm install
pnpm tsx src/deploy.ts          # deploy (or: deploy.ts upgrade)
pnpm tsx src/setup.ts           # issue key collections, key images, test tokens
pnpm tsx src/flow.ts            # milestone 1 acceptance run, checked on chain
pnpm tsx src/gas.ts             # gas and storage measurements
```

- Network: `MVXVEST_NETWORK=devnet` (default) or `testnet`. The scripts refuse
  to load a mainnet key: mainnet actions are proposed through the mvxsafe
  multisig.
- Keys: `~/.config/mvxvest/<network>/owner.pem` and `holder.pem`, outside the
  repo (or `MVXVEST_PEM`). Never commit them.
- State (contract address, collections, test tokens, every transaction with
  its gas) is written to `scripts/state/<network>.json`, which is not committed.
- Build the contract first (`sc-meta all build` in `contracts/vesting`): the
  scripts read `output/mvxvest.wasm` and `output/mvxvest.abi.json`.
