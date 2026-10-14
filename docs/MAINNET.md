# mvxvest on mainnet

Launched on 12 October 2026 with [scripts/src/mainnet.ts](../scripts/src/mainnet.ts), one checked step at a time, each step approved by Sebastian. The site is https://mvxvest.io: a private beta behind a password from 12 Oct 2026, public since 13 Oct 2026.

| | |
|---|---|
| Contract | `erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu` |
| Code hash | Version 2 since 14 Oct 2026: `a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a`, the reproducible build (`multiversx/sdk-rust-contract-builder:v12.0.0`). Version 1, 12 to 14 Oct: `fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32`. |
| Code metadata | upgradeable, readable, not payable, not payable by smart contracts |
| Owner | the mvxsafe multisig `erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3`, quorum 2 of 3 |
| Claim keys | `VESTKEY-f56bea` (MvxVestClaimKey), green image `https://mvxvest.io/nft/claim-key-2.png` / `.svg` |
| Cancel keys | `VESTCANCEL-ae94f5` (MvxVestCancelKey), red image `https://mvxvest.io/nft/cancel-key.png` / `.svg` |
| Fees | Since 14 Oct 2026: 0.1% of each vesting in its own token, paid on top and sent to the multisig (`setTokenFee 10`), plus 0.1 EGLD per vesting (`setFee`). Free before. |

Both collections are owned by the contract. They cannot be frozen, wiped or paused, and the NFT create role cannot be transferred. Holders cannot burn keys.

The roles, as read on 13 Oct 2026 (audit L4):
- **The contract holds every NFT role on both collections**, because `issue_and_set_all_roles` gives them all: NFTCreate, NFTBurn, NFTUpdateAttributes, NFTAddURI, NFTRecreate, ModifyCreator, ModifyRoyalties, SetNewURI and NFTUpdate.
- **Its code uses only NFTCreate and NFTBurn.** The others could be used only by new code, which means an upgrade voted by the multisig.
- **The collections keep `canUpgrade` and `canAddSpecialRoles`.** Only their owner, the contract, can use these properties, and again only through new code.
- **What these roles cannot do:** updating attributes acts on the caller's own NFT. The contract therefore cannot add the cancelable marker (RT3) to keys its holders own, so version 2 marks new keys only.

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

## The first owner vote (14 October 2026)

The first vote of the owner multisig on mainnet, through mvxsafe.io (commit 7fda7bb), sent from wallets with guardians. It was `setFee 0`, harmless because the fee was already 0. It proved the board can propose, sign and carry out a call on the contract, and measured mainnet's gas for it.

| Step | By | Transaction | Gas |
|---|---|---|---|
| Propose (safe action #1) | `erd1u05m…gw5esx` | `5b79069670bc80bf8dda77e7f5995e90b614e27ad88ec2529848fcdce3ce9f6c` | 6.0M |
| Sign | `erd1q83m…r3s7j4` | `fe2a82328e73013108a23a224c3c947cfe462da42df366213a8fbfc2962a8d8d` | 5.2M |
| Carry out | `erd1q83m…r3s7j4` | `88019b1a43688bdb913e7317d232986b99b6f6e98c5803e674a9592feca3bd9b` | 19.25M |

The call reached the contract with 13.2M and answered `@00`; the callback came back with 9.45M. `getFee` reads 0.

Until a mainnet upgrade has been measured, upgrades are carried out with at least 118.5M gas, in mvxsafe and in `scripts/src/multisig.ts` alike.

## Version 2 (14 October 2026)

The contract was upgraded to version 2 by a vote of the owner multisig, through mvxsafe.io, from wallets with guardians, following DEPLOY.md's runbook. The version had been audited twice ([first audit](reviews/2026-10-13-fable-audit.md), [second audit](reviews/2026-10-14-fable-audit-v2.md)) and rehearsed on devnet.

| Step | By | Transaction | Gas |
|---|---|---|---|
| Source deployed: `erd1qqqqqqqqqqqqqpgqzywreqymt6j00wta43v7zvmrk4yz5xal6qls2j5m2c` (shard 1, not upgradeable) | `erd1u05m…gw5esx` | `80eca3d4d8e1aba18f2dcf9ea7d2dfbb62ad85e2d26ded6fef436ef28cb1cea7` | 108.8M, 0.0824 EGLD |
| Upgrade proposed (safe action #2) | `erd1u05m…gw5esx` | `dc2e1efb7d1f06d4213636564d8164ed970fafc40d2fc76d46591e26065cd85a` | 6.4M |
| Signed | `erd1q83m…r3s7j4` | `ac483fc8c60aa78bd7e27ec6fb48532bd78c1c1dd5015d54321dbee8ec9423b4` | 5.2M |
| Performed | `erd1q83m…r3s7j4` | `c6ef96cfc2e7318596f4e96702b80366d058dc5febbdf4380bd0a11517a34d41` | 118.55M, 0.0013 EGLD |

**The code:**
- Code hash `a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a`: the reproducible build of `main` at 1db9b1c, also built by CI.
- The source's code, read from the chain, is byte for byte the release file.

**Gas:** the upgrade itself used 8.50M and the callback 3.39M, as on devnet.

**Checked on chain against a snapshot taken before the upgrade:**
- the code hash is the release's;
- the contract is still upgradeable, readable and not payable, and the owner is still the multisig;
- vestings #1 and #2 are stored byte for byte as before, and the vesting count is still 2;
- the FOXSY and EGLD totals are unchanged and the surplus is 0, with the contract still holding 76.22 FOXSY;
- the key collections, the fee (0), the fees accrued (0) and the pause flag (off) are unchanged;
- `getLimits` answers 49 and 32, `getTokenFee` 0 and `getMaxTokenFee` 200.

### The fees voted (14 October 2026)

Proposed by `erd1q83m…r3s7j4`; signed and carried out by `erd1u05m…gw5esx`. Each perform called the contract and got `@00` back.

| Vote | Propose | Sign | Perform |
|---|---|---|---|
| `setTokenFee 10` (0.1%), safe action #3 | `3fac6dac88d8e1a50e7208f013eb733722a782311d80c5bdb4860c0b3146e6ca` | `110383cd55e0e012b86a2c0bcff9e190863dca6408fc3da351fc0e7399ac7c9e` | `e23757543026efe1e2d211f288aef2d1f0edea5fd60be42ad1ff2cfafd92c509` (19.35M) |
| `setFee 0.1` EGLD, safe action #4 | `38775712eeaa6db1b71b3649c0859264a4838961739eeb33c10d0d32215b92be` | `b9a24fcf7cd91748f0219b57e1696a49ba69348ff14844db42e6cf3648e9264d` | `15debcb51c664b19dde5a24ad96cddf14ce5380841418d112d0cdaa73335071e` (19.45M) |

Then `getTokenFee` read 10, `getFee` 100000000000000000, and `isCreationPaused` 0.

Version 1's code hash was then removed from the site's list (c64fa34, the runbook's step 8).
