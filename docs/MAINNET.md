# mvxvest on mainnet

Launched on 12 October 2026 with [scripts/src/mainnet.ts](../scripts/src/mainnet.ts), one checked step at a time, each step approved by Sebastian. The site is https://mvxvest.io, behind a password during the private beta.

| | |
|---|---|
| Contract | `erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu` |
| Code hash | `fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32` (reproducible build, `multiversx/sdk-rust-contract-builder:v12.0.0`; the same code as devnet) |
| Code metadata | upgradeable, readable, not payable, not payable by smart contracts |
| Owner | the mvxsafe multisig `erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3`, quorum 2 of 3 |
| Claim keys | `VESTKEY-f56bea` (MvxVestClaimKey), green image `https://mvxvest.io/nft/claim-key-2.png` / `.svg` |
| Cancel keys | `VESTCANCEL-ae94f5` (MvxVestCancelKey), red image `https://mvxvest.io/nft/cancel-key.png` / `.svg` |
| Fee | 0 |

Both collections are owned by the contract. They cannot be frozen, wiped or paused, and the NFT create role cannot be transferred. Holders cannot burn keys.

## Transactions

| Step | Transaction |
|---|---|
| Deploy | `4a957d4fc025bed30fc75f63db3e7621132b1afd07866a81972ae72cc24f7aaf` |
| Pause creation | `b3de35e82f8575f0e3556142724c7ced2889859f799d74153aec129a1b90aeca` |
| Issue claim keys | `9dfd83ef44f4c52b635350e6c8a7e31667cbca3c23dc5663fbac1e88657fd275` |
| Issue cancel keys | `a320a152293ab2f6e05078775817abc10a01b34c146ca5cccd36353dfe796921` |
| Holders cannot burn claim keys | `a2001239ce6a9b286b02a6d1d19db96e67f6b592aba73b4a008d696f2e7859e5` (ESDTUnSetBurnRoleForAll checked) |
| Holders cannot burn cancel keys | `82732d52c1364459a48b0c58b9cdfe518be26fa82d6e4b1289f8d3018dd5b97e` (ESDTUnSetBurnRoleForAll checked) |
| Claim key image | `060dd2937c02c6dc2c6a0d21c7fdd363064820b5bf263ab689a5412597756776` |
| Cancel key image | `73e24b11107270796f2a6fa721faf7f5f0dd5251d995d8f26175ada3ed6046a7` |
| Unpause creation | `61dcc3dc8a90ed0a451f38b4015f0b7b63dbf53fdd35013ee3cc1cb7994a9bd7` |
| Ownership to the multisig | `983087ff6c4675111d21f112ad41044aedfbef8055f99615312387910d524eb7` |
| Leftover 0.114 EGLD to the multisig | `4471a3a89e27467c277c262cb7ddd9ea1c9e3a8174cc4a0485b2cd5d854ff825` |

The deployer wallet `erd17yc20n8f4crqnu9f545p89gyts60ajag2ja5g7wu8lw5gc3duc2qzvrqwa` is empty and owns nothing. Its key was deleted after the sweep (shredded on 12 Oct 2026, with Sebastian's agreement). Every owner action from now on is a vote of the multisig. That covers pausing, the fee, upgrades and returning bounced keys.

The gas each step needed is in [MEASUREMENTS.md](MEASUREMENTS.md).
