// Deploys the contract (or upgrades it, with `upgrade`) on devnet or testnet.
// Mainnet deploys and upgrades are proposed through the multisig instead.
//
//   pnpm tsx src/deploy.ts            deploy a new contract
//   pnpm tsx src/deploy.ts upgrade    upgrade the one in scripts/state
//
// Code metadata: upgradeable and readable, not payable and not payable by
// smart contracts, so stray transfers without a call are refused.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { CONTRACT_OUTPUT, abi, contractAddress, entrypoint, loadState, saveState, send, signer } from "./lib.js";

const bytecode = readFileSync(join(CONTRACT_OUTPUT, "mvxvest.wasm"));
const codeHash = createHash("sha256").update(bytecode).digest("hex");
const owner = await signer("owner");
const controller = entrypoint().createSmartContractController(abi());
const metadata = {
  isUpgradeable: true,
  isReadable: true,
  isPayable: false,
  isPayableBySmartContract: false,
};

console.log(`wasm ${bytecode.length} bytes, sha256 ${codeHash}`);

if (process.argv[2] === "upgrade") {
  const tx = await controller.createTransactionForUpgrade(owner, owner.getNonceThenIncrement(), {
    contract: contractAddress(),
    bytecode,
    gasLimit: 150_000_000n,
    arguments: [],
    ...metadata,
  });
  await send("upgrade", tx, { note: `code sha256 ${codeHash}` });
} else {
  const state = loadState();
  if (state.contract) {
    throw new Error(`A contract is already recorded (${state.contract}); use "upgrade" or clear scripts/state.`);
  }
  const tx = await controller.createTransactionForDeploy(owner, owner.getNonceThenIncrement(), {
    bytecode,
    gasLimit: 150_000_000n,
    arguments: [],
    ...metadata,
  });
  const result = await send("deploy", tx, { note: `code sha256 ${codeHash}` });
  const outcome = await controller.awaitCompletedDeploy(result.hash);
  const address = outcome.contracts[0].address.toBech32();
  saveState({ ...loadState(), contract: address });
  console.log(`contract ${address}`);
}
