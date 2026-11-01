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

- Network: `MVXVEST_NETWORK=devnet` (default), `testnet` or `mainnet`. On mainnet
  the only key that loads is the single-purpose `deployer`, only with
  `MVXVEST_MAINNET_GO=yes` for that run (`src/mainnet.ts`). Every later owner
  action is proposed through the multisig and never signed here: `src/multisig.ts`
  prints the transaction for a board member's wallet.
- The mainnet contract's address is in `src/lib.ts`: `src/multisig.ts` needs no
  state file there. One that names another contract stops the tool.
- Keys: `~/.config/mvxvest/<network>/owner.pem` and `holder.pem`, outside the
  repo (or `MVXVEST_PEM`). Never commit them.
- State (contract address, collections, test tokens, every transaction with
  its gas) is written to `scripts/state/<network>.json`, which is not committed.
- Build the contract first (`sc-meta all build` in `contracts/vesting`): the
  scripts read `output/mvxvest.wasm` and `output/mvxvest.abi.json`.
