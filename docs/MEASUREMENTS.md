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
`MAX_BATCH` is therefore 75 (`go_vm_test::batch_max` proves 75 cancelable
fit). Explicit tranche schedules cost more per vesting (more argument data and
storage); the dApp simulates each transaction and splits a CSV accordingly.

From the third review (same VM): a claim of 80 keys where one pays costs about
92M.

## Devnet

To be filled by `scripts/src/gas.ts` after the devnet deployment: create
(cancelable and not), 120 tranches, batches of 1 to 75, claim of 1 and of 10
keys across shards, cancel, and storage bytes per vesting.
