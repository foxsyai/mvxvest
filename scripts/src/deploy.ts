// Deploys the contract (or upgrades it, with `upgrade`) on devnet or testnet.
// Mainnet deploys and upgrades are proposed through the multisig instead.
//
//   pnpm tsx src/deploy.ts            deploy a new contract
//   pnpm tsx src/deploy.ts upgrade    upgrade the one in scripts/state
//
// Code metadata: upgradeable and readable, not payable and not payable by
// smart contracts, so stray transfers without a call are refused.
//
// It deploys the reproducible build (output-docker/, from
// `sc-meta reproducible-build build`), whose code hash anyone can verify.
// Set MVXVEST_LOCAL_WASM=1 to deploy a local build instead (devnet only).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_OUTPUT, ROOT, abi, contractAddress, entrypoint, loadState, onNetwork, saveState, send, signer } from "./lib.js";

const REPRODUCIBLE = join(ROOT, "output-docker/mvxvest");
const local = process.env.MVXVEST_LOCAL_WASM === "1";
if (!local && !existsSync(join(REPRODUCIBLE, "mvxvest.wasm"))) {
  throw new Error("No reproducible build in output-docker/. Run `sc-meta reproducible-build build` (see README).");
}
const bytecode = readFileSync(join(local ? CONTRACT_OUTPUT : REPRODUCIBLE, "mvxvest.wasm"));
const codeHash = local ? "local build, not reproducible" : readFileSync(join(REPRODUCIBLE, "mvxvest.codehash.txt"), "utf8").trim();
const owner = await signer("owner");
const controller = entrypoint().createSmartContractController(abi());
const metadata = {
  isUpgradeable: true,
  isReadable: true,
  isPayable: false,
  isPayableBySmartContract: false,
};

console.log(`wasm ${bytecode.length} bytes, code hash ${codeHash}`);

if (process.argv[2] === "upgrade") {
  const tx = await controller.createTransactionForUpgrade(owner, owner.getNonceThenIncrement(), {
    contract: contractAddress(),
    bytecode,
    gasLimit: 150_000_000n,
    arguments: [],
    ...metadata,
  });
  await send("upgrade", tx, { note: `code hash ${codeHash}` });
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
  const result = await send("deploy", tx, { note: `code hash ${codeHash}` });
  const outcome = controller.parseDeploy(await onNetwork(result.hash));
  const address = outcome.contracts[0].address.toBech32();
  saveState({ ...loadState(), contract: address });
  console.log(`contract ${address}`);
}
