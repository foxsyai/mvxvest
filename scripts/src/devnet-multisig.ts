// Devnet only: a 2-of-2 owner multisig for the devnet contract, built like the
// mainnet one (the same legacy multisig code as mvxsafe deploys, owning
// itself, in another shard than the contract), so every owner action can be
// rehearsed through it with src/multisig.ts before it is ever needed on
// mainnet.
//
//   pnpm tsx src/devnet-multisig.ts
//
// Board: the devnet "owner" (shard 0) and "holder" (shard 1) keys. Deployed
// from the holder, so the multisig is in shard 1 and the contract in shard 0,
// as on mainnet. Recorded in scripts/state/devnet.json as ownerMultisig.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Address, AddressValue, Transaction, U32Value } from "@multiversx/sdk-core";
import { api, contractAddress, entrypoint, loadState, network, onNetwork, saveState, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("devnet-multisig.ts is for devnet only.");
const WASM = join(homedir(), "FOXSY/mvxsafe/app/public/contracts/multisig.wasm");

const owner = await signer("owner");
const holder = await signer("holder");
const state = loadState() as ReturnType<typeof loadState> & { ownerMultisig?: string };

const setOwner = async (who: typeof owner, contract: Address, to: Address, label: string) => {
  const tx = new Transaction({
    sender: who.address,
    receiver: contract,
    value: 0n,
    gasLimit: 0n,
    chainID: "D",
    nonce: who.getNonceThenIncrement(),
    data: new TextEncoder().encode(`ChangeOwnerAddress@${to.toHex()}`),
  });
  const cost = BigInt((await entrypoint().createNetworkProvider().estimateTransactionCost(tx)).gasLimit);
  tx.gasLimit = (cost * 12n) / 10n;
  tx.signature = await who.signTransaction(tx);
  await send(label, tx);
};
const ownerOf = async (address: Address) =>
  ((await (await fetch(`${api()}/accounts/${address.toBech32()}`)).json()) as { ownerAddress?: string }).ownerAddress;

let multisig = state.ownerMultisig ? Address.newFromBech32(state.ownerMultisig) : undefined;
if (!multisig) {
  const tx = await entrypoint()
    .createSmartContractTransactionsFactory()
    .createTransactionForDeploy(holder.address, {
      bytecode: readFileSync(WASM),
      arguments: [new U32Value(2), new AddressValue(owner.address), new AddressValue(holder.address)],
      isUpgradeable: true,
      isReadable: true,
      isPayable: true,
      isPayableBySmartContract: true,
    });
  tx.nonce = holder.getNonceThenIncrement();
  tx.signature = await holder.signTransaction(tx);
  const result = await send("deploy the devnet owner multisig (2 of 2)", tx);
  multisig = entrypoint().createSmartContractController().parseDeploy(await onNetwork(result.hash)).contracts[0].address;
  saveState({ ...loadState(), ownerMultisig: multisig.toBech32() } as never);
  console.log(`multisig ${multisig.toBech32()}`);
}
// It owns itself, as on mainnet: changing it needs its own quorum.
if ((await ownerOf(multisig)) !== multisig.toBech32()) {
  await setOwner(holder, multisig, multisig, "the multisig owns itself");
}
// The devnet contract goes to it.
if ((await ownerOf(contractAddress())) !== multisig.toBech32()) {
  await setOwner(owner, contractAddress(), multisig, "the devnet contract to the multisig");
}
console.log(`devnet contract ${contractAddress().toBech32()} is owned by ${await ownerOf(contractAddress())}`);
