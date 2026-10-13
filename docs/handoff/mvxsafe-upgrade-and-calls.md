# Handoff to mvxsafe.io: upgrade a contract the safe owns, and call it

From the mvxvest side, 13 October 2026. For the agent working on `~/FOXSY/mvxsafe/app`.

## Why

mvxvest's contract on mainnet is owned by an mvxsafe safe. Every owner action, an upgrade included, is a vote of that safe. Today mvxsafe can show a pending upgrade (`describe.ts` decodes `SCUpgradeFromSource`) but cannot propose one, and it performs every action with a flat 60M gas, which is too little for an upgrade. A failed perform uses the action up, so the board would have to propose and sign it all over again.

We may need an upgrade soon (two contract fixes are queued for the next audit rounds), so mvxsafe should be able to do the whole flow from the board members' wallets, guardians included.

**Priority:**
1. Upgrade from source: propose, show, sign, perform.
2. Deploy an upgrade's source from a `.wasm` file.
3. A contract call on a contract the safe owns. mvxvest needs this for the fee vote (0.01 EGLD, wanted soon), pause, unpause and the rest.

**Rules:**
- Nothing is signed on mainnet without Sebastian.
- The mvxvest upgrade itself waits for the next audit rounds; this work only makes it possible.
- Do not change the mvxvest repo; ask its side for anything you need there.

## The facts on mainnet

| | |
|---|---|
| Safe (owner of mvxvest) | `erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3`, 2 of 3, **shard 1**. It owns itself. Code hash `f5658529c51ccc2985e8b2977374c909417ed07efb92b1deaf800137f5c25861`, the same bytes as `app/public/contracts/multisig.wasm`. |
| mvxvest contract | `erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu`, **shard 0**. |
| Its code hash now | `fd32f4e161653fe2f5c5b673dc8f2786d718a21f4ec25b663c365afcf5a67d32` (reproducible build, `multiversx/sdk-rust-contract-builder:v12.0.0`) |
| Its code metadata | `0500`: upgradeable, readable, not payable, not payable by smart contracts |
| Its constructor and `upgrade` | no arguments |

Hex of the two addresses, for reading raw data:
- safe: `00000000000000000500cfa5b23936bfab8eecfc04d7ed2b14a8b8040743d03f`;
- mvxvest: `00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614`.

The safe and the contract are in **different shards**. Every perform is therefore a cross-shard async call, and that drives the gas rules below.

## 1. Upgrade from source

### The endpoint

Add the endpoint to `src/abi/multisig-legacy.abi.json`. The contract has it; the ABI file lists only the `SCUpgradeFromSource` variant (8) of `Action`:

```json
{
  "name": "proposeSCUpgradeFromSource",
  "mutability": "mutable",
  "inputs": [
    { "name": "sc_address", "type": "Address" },
    { "name": "amount", "type": "BigUint" },
    { "name": "source", "type": "Address" },
    { "name": "code_metadata", "type": "CodeMetadata" },
    { "name": "arguments", "type": "variadic<bytes>", "multi_arg": true }
  ],
  "outputs": [{ "type": "u32" }]
}
```

The wire format, proven on devnet against the same multisig bytecode (transaction `d753689bcbf90e0eea8e4654d1159029401512512b43465b01f6cc631a37d024`):

```
proposeSCUpgradeFromSource@<contract hex>@@<source hex>@0500
```

- The amount is empty (0 EGLD).
- There are no arguments, because mvxvest's `upgrade` takes none.
- Use `VariadicValue.fromItems` for the arguments, never `fromItemsCounted`; the same trap as in `buildProposeEgld`.

### What the form shows before anyone signs

The proposer picks the target (a contract the safe owns, so check `ownerAddress === safe`) and the source.

**The source:**
- **It must be in the safe's shard.** `performAction` reads the source's code in its own shard. A source in another shard fails at perform, after the signatures, and uses the action up. Refuse it.
- **Its code hash:** the API's `codeHash` is base64; show it as hex. Show it next to the target's current code hash, and next to a field "expected code hash" where the signer pastes the hash from the release. Green when they match, red when they do not.
- The source must be a contract with code (`codeHash` present).

**The code metadata**, in words, defaulting to the target's current flags (`isUpgradeable`, `isReadable`, `isPayable`, `isPayableBySmartContract` from `/accounts/<target>`). The encoding is two bytes:
- first byte: `0x01` upgradeable, `0x04` readable;
- second byte: `0x02` payable, `0x04` payable by smart contracts.

So `0500` means upgradeable and readable. Warn in red:
- when "upgradeable" is off: the contract can never be changed again, by anyone;
- when any flag differs from the target's current one.

**For the pending action (`describe.ts`):** the description already says "Upgrade the contract X, replacing its code with the code of Y". Add:
- the metadata in words;
- the source's code hash, with the target's current one;
- the shard check.

A signer must be able to verify everything on that card without leaving the page.

### Perform: the gas

> **Superseded by mvxsafe's measurements, 13 Oct 2026.** The callback needs about 7M, not 5M. An upgrade needs about 300 gas a byte of the source (8.26M for mvxvest), so a perform is about 25M, not 118.5M. The figures below are kept as first written.

The network **cannot simulate** a `performAction` whose call goes to another shard: it answers "no async context found". So the gas is a budget, not a simulation:

```
perform gas = 7.5M (the multisig's own part)
            + what the call itself needs
            + 5M (callback)
```

The callback part exists because on a cross-shard call the network holds back 4M of the forwarded gas for the multisig's callback. Without it, the call runs out and the action is used up. Devnet proved this: `ebc77b1cec8f4f3978f761881fbcc074ea8e9837b6d09514b2dad779155f4b16`, an unpause performed with 14M, failed with "not enough gas", and the action had to be proposed and signed again.

Measured on devnet, same contracts, same shard layout:

| What the action does | Perform gas that worked | Example |
|---|---|---|
| upgrade mvxvest from source (26.5 KB wasm) | **118,500,000** (7.5M + 106M + 5M) | `460afe67706dae357e7a0ba84d02eb30acbcb007f784acfcecbfdbe172e24aef` |
| `pauseCreation`, `unpauseCreation`, `setFee` | 17,100,000 | `a131d7eb69ccfbbee799c82943440b19ed080a9199d6ddd87534f703f1501008` |
| `setKeyDisplay` | 18,600,000 | `4321ed1707e575bea47fdc8e7d07a063cf6ebbcb81ec2da4ef92876775a4d4ec` |
| `claimFees` | 18,500,000 | budget, not yet run |
| `recoverBouncedKey`, `recoverSurplus` | 22,500,000 | budget, not yet run |

Every `performAction` on devnet shows `gasUsed = gasLimit` in the API, so keep the budget tight.

Sebastian's rule: **never more than about 1.5x what is needed.** A big flat limit is charged in full. Take the call's own need, measured or simulated, times 1.2, then add 7.5M and the 5M callback.

For an upgrade of other code, the need grows with the wasm size; 26.5 KB needed about 88M. Let the performer see and edit the figure, with the measured default above.

`propose` and `sign` can be simulated (`estimateTransactionCost`), times 1.2: about 6M and 5M on devnet. The flat 60M `DEFAULT_GAS` is about 10 times too much.

### Guardians

`actions.ts` already applies the guardian before signing. If you add simulation, apply the guardian **before** simulating. The network refuses even to simulate a guarded account's transaction that does not name its guardian ("not allowed to bypass guardian"). mvxvest hit this on mainnet on 13 Oct. Add 50,000 gas for the guardian after the simulation.

## 2. Deploy an upgrade's source

Someone has to deploy the new build in the safe's shard (shard 1 on mainnet). mvxsafe already deploys safes from a wasm, so add a small "Deploy a source" panel:

- **Pick a `.wasm` file** and compute its code hash in the browser: **blake2b-256** of the bytes. That is MultiversX's code hash; `@noble/hashes` has blake2b. Show it, and the expected hash field again.
- **Check the connected wallet's shard** equals the safe's shard. If it does not, say which shard is needed.
- **Deploy it.** Not upgradeable, readable, not payable; no arguments, because mvxvest's constructor takes none.
- **Gas:** simulate it, times 1.2. A deploy is charged its whole limit: the devnet source cost 105.5M of 105.5M.
- **After the deploy,** read the new address's `codeHash` from the API and compare it with the file's hash. Then offer "Propose the upgrade with this source".

If this panel is not ready in time, a board member or a fresh shard-1 wallet can deploy the source another way. Proposing, showing, signing and performing still come first.

## 3. A call on a contract the safe owns

`proposeAsyncCall(to, egld_amount, function_and_arguments...)`. The function name is the first item of the variadic list, not its own argument, as in `buildProposeToken`. The arguments are top-encoded hex, as the target's ABI encodes them. This is the same multisig as yours, with no gas-limit argument.

mvxvest's owner endpoints. Its ABI is at `~/FOXSY/mvxvest/output-docker/mvxvest/mvxvest.abi.json`, and `KeyKind` is `Claim` = 0, `Cancel` = 1:

| Endpoint | Arguments |
|---|---|
| `setFee` | `fee_per_vesting: BigUint` (EGLD units, 18 decimals) |
| `pauseCreation`, `unpauseCreation`, `claimFees` | none |
| `setKeyDisplay` | `kind: KeyKind`, `metadata: bytes`, `uris: variadic<bytes>` |
| `recoverBouncedKey` | `id: u64`, `kind: KeyKind`, `to: Address` |
| `recoverSurplus` | `token: TokenId`, `to: Address` |

The fee vote we need, 0.01 EGLD = 10^16 = `2386f26fc10000`:

```
proposeAsyncCall@00000000000000000500f882d8136db7846cdb650b16134bb5424da58ddfe614@@736574466565@2386f26fc10000
```

A generic form (endpoint name plus typed arguments, or an ABI the proposer loads) fits mvxsafe better than mvxvest-specific buttons. Either way, the pending-action card must show the call in words: "Call setFee(0.01 EGLD) on erd1…gmllsu".

## How to rehearse it on devnet

mvxvest's own devnet copy is owned by a 2-of-2 safe whose keys live in mvxvest's scripts, not in wallets. For your test, build your own:

1. **Create a devnet safe** in mvxsafe, with Sebastian's devnet wallets as the board. Note its shard.
2. **Deploy a devnet copy of mvxvest** (`~/FOXSY/mvxvest/output-docker/mvxvest/mvxvest.wasm`, no arguments, metadata `0500`) from any devnet wallet in **another** shard than the safe, so the perform is cross-shard as on mainnet. Then hand it to the safe: `ChangeOwnerAddress@<safe hex>`, sent from the deployer to the contract, gas simulated.
3. **Through mvxsafe:**
   - propose `setFee` 0.01 EGLD, sign, perform; then read `getFee`;
   - deploy a source in the safe's shard from the same wasm, propose the upgrade, sign, perform.
4. **Check afterwards:**
   - the code hash is unchanged (same wasm);
   - the metadata is still `0500`;
   - `getFee` still answers.
5. **Show the failure paths:** a source in the wrong shard, metadata without "upgradeable", and a mismatched expected hash are all refused or shown in red before signing.

Ask the mvxvest side if you would rather use its devnet contract `erd1qqqqqqqqqqqqqpgqak3uxq7z93x0rgjq5e47xvcmeuauukytf6cq26xfrp`. It can be handed to your safe by a vote of its current safe.

## Done when

- A board member can:
  - propose an upgrade from source;
  - see the source's and target's code hashes, the shard check and the metadata in words;
  - sign it, and perform it with a gas budget that works.

  All of this from a wallet with a guardian too.
- `setFee` and the other calls can be proposed and read back in words.
- Every limit follows the 1.5x rule; no flat 60M or 250M limits remain on these paths.
- The devnet rehearsal above passes, and its transaction hashes are written down in mvxsafe's docs.
- Tests prove:
  - the encoding (the two data strings in this file, byte for byte);
  - the wrong-shard and non-upgradeable refusals.
