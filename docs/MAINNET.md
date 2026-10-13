# mvxvest on mainnet

Launched on 12 October 2026 with [scripts/src/mainnet.ts](../scripts/src/mainnet.ts), one checked step at a time, each step approved by Sebastian. The site is https://mvxvest.io: a private beta behind a password from 12 Oct 2026, public since 13 Oct 2026.

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

The roles, as read on 13 Oct 2026 (audit L4):
- **The contract holds every NFT role on both collections**, because `issue_and_set_all_roles` gives them all: NFTCreate, NFTBurn, NFTUpdateAttributes, NFTAddURI, NFTRecreate, ModifyCreator, ModifyRoyalties, SetNewURI and NFTUpdate.
- **Its code uses only NFTCreate and NFTBurn.** The others could be used only by new code, which means an upgrade voted by the multisig.
- **The collections keep `canUpgrade` and `canAddSpecialRoles`.** Only their owner, the contract, can use these properties, and again only through new code.
- **One useful case:** the planned upgrade can use NFTUpdateAttributes to give existing keys the cancelable marker (RT3), not only new ones.

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

## Milestone 4: the in-house test (13 October 2026)

Done by Sebastian on https://mvxvest.io with real wallets, then checked on chain. Wallets:
- creator `erd16pe7…zvjwd`;
- first beneficiary `erd1u05m…gw5esx`, a wallet with a guardian;
- second wallet `erd1q83m…r3s7j4`, also guarded.

| Step | On chain |
|---|---|
| Create 2 × 100 FOXSY (`FOXSY-5d5f3e`), cancelable, linear over 1 hour, one transaction | #1 for `erd1u05m…`, #2 for `erd1q83m…` |
| Claim from #1 | 13.666667 FOXSY to `erd1u05m…` |
| Move #1's claim key (`VESTKEY-f56bea-01`) to `erd1q83m…` and claim there | 10.111111 FOXSY to `erd1q83m…` |
| Cancel #2 with its cancel key | 60.277778 FOXSY back to the creator; the vested 39.722222 stays for the beneficiary |
| Claim #2's vested part | 39.722222 FOXSY to `erd1q83m…`; #2's claim and cancel keys are burned |

The contract then held exactly 76.222222 FOXSY, which is what #1 still owes (100 − 23.777778). Its FOXSY surplus was 0.

The test found two problems, both fixed and live the same day:

- **f955bf6:** copying an address from another window made the form judge the line.
- **7a0114d:** a guarded wallet (2FA) could not create anything. The network refuses even to simulate a guarded account's transaction that does not name its guardian, and the page only named the guardian after the simulation.

The page also explains its figures now (d4ce0d7): "vested = claimed + claimable · not vested yet".
