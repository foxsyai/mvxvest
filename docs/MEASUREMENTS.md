# Measurements

Gas and storage of the vesting contract. A transaction may carry at most 600M
gas. At the minimum gas price (1,000,000,000 per unit, with smart contract
execution priced at 1%), 100M gas of execution costs about 0.001 EGLD.

## Go VM (mx-scenario-go 5.1.0, its default gas schedule), 2026-10-12

`createBatch` with linear schedules, 10 FOX each, beneficiaries in the same
shard. Measured on the code after the third review.

| Vestings | Cancelable | Gas used |
|---:|---|---:|
| 1 | yes | 10.1M |
| 1 | no | 8.3M |
| 10 | yes | 63.8M |
| 10 | no | 46.0M |
| 25 | yes | 155.7M |
| 25 | no | 110.9M |
| 50 | yes | 314.1M |
| 50 | no | 224.4M |
| 75 | yes | 479.0M |
| 75 | no | 344.3M |
| 100 | yes | over 600M: does not fit |
| 100 | no | 470.8M |

About 6.4M gas per cancelable vesting and 4.7M per non-cancelable one, linear.
Gas turned out not to be the limit on the real chain: see the devnet section
(at most 33 cancelable or 50 non-cancelable vestings per batch).

From the third review (same VM): a claim of 80 keys where one pays costs about
92M.

## Devnet, 2026-10-12 (the authoritative figures)

Contract `erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp`
(shard 0), reproducible build `fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32`.
Beneficiaries alternate between shard 0 and shard 1. Every transaction had its
gas limit set to 1.2 times the network's simulation; the fee is what was paid.
Script: `scripts/src/gas.ts`; every hash is in `scripts/state/devnet.json`.

| Operation | Gas used | Fee (xEGLD) |
|---|---:|---:|
| `create`, non-cancelable, linear | 10.5M | 0.00048 |
| `create`, cancelable, linear | 13.5M | 0.00052 |
| `create`, cancelable, 120 tranches | 132.1M | 0.00886 |
| `createBatch` 1 cancelable | 13.6M | 0.00053 |
| `createBatch` 10 cancelable | 87.5M | 0.00316 |
| `createBatch` 25 cancelable | 211.7M | 0.00754 |
| `createBatch` 33 cancelable (the maximum) | 279.2M | 0.00989 |
| `createBatch` 50 non-cancelable (the maximum) | 283.6M | 0.01349 |
| `claim`, 1 key, across shards | 6.3M | 0.00030 |
| `claim`, 10 keys at once, across shards | 72.8M | 0.00144 |
| `cancel`, 1 key | 6.0M | 0.00031 |
| `disableKeyBurnByHolders` (once per collection) | 100M limit | 0.00109 |
| `issueClaimKey` / `issueCancelKey` (once) | 100M limit | 0.05 EGLD issue cost |

- **Storage:** 315 bytes per cancelable vesting with a linear schedule
  (vesting record, indexes by creator and token, nonce mappings).
- **Batch limits:** gas is not the limit. The network allows about 100
  built-in calls (NFT mints and transfers) per transaction: 33 cancelable or
  50 non-cancelable vestings fit, 34 and 51 are refused ("max calls reached:
  too many built-in functions calls"), found by simulation. The contract
  enforces these limits (`getLimits`).
- **Claim or cancel many keys:** about 7M gas per key. The dApp should send at
  most 50 keys per `claim` or `cancel` (each finished key is a burn, so built-in
  calls also add up).
- **Too much gas is charged in full:** a limit far above the gas used is not
  refunded ("too much gas provided for processing"). The first devnet run, with
  fixed limits of 30M, paid for 30M on calls that used 10M. Scripts and the
  dApp set the limit from a simulation.
- **How keys look** (API, `VESTKEY-8f217c-c9`): name `Vesting #201 claim
  key`, tags `mvxvest, vesting` parsed from the attributes
  (`tags:mvxvest,vesting;vesting:201;token:TFOX-d61b09`), creator the
  contract, media PNG and SVG from devnet.mvxvest.io. The API marks that
  storage `isWhitelistedStorage: false`: wallets and the explorer may not show
  images from hosts that are not whitelisted, so mainnet key images go on IPFS.
  Checking xPortal and the DeFi Wallet extension is part of milestone 2.

The first devnet deployment (`58fcdb51…`) was upgraded to `fd32f4e1…`
(batch limits, `disableKeyBurnByHolders`); storage and all 46 existing
vestings were kept.
