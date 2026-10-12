// The mainnet launch, one step per run, each checked on chain before the next.
// Signed by the single-purpose deployer wallet, which hands the contract to
// the multisig at the end and keeps no power. Nothing is sent without
// MVXVEST_MAINNET_GO=yes; without it a step only says what it would do.
//
//   MVXVEST_NETWORK=mainnet pnpm tsx src/mainnet.ts status
//   MVXVEST_NETWORK=mainnet MVXVEST_MAINNET_GO=yes pnpm tsx src/mainnet.ts <step>
//
// Steps, in order (see docs/DEPLOY.md):
//   deploy       the reproducible build; code hash and metadata checked
//   pause        no vesting can be created before the setup is complete
//   collections  the claim and cancel key collections (0.05 EGLD each)
//   noburn       holders cannot burn keys (ESDTUnSetBurnRoleForAll checked)
//   display      key images from mvxvest.io (green claim, red cancel)
//   unpause      creation open (fee stays 0)
//   handover     ownership to the multisig: MVXVEST_MULTISIG=erd1... and
//                MVXVEST_MULTISIG_CONFIRM=<its last 6 characters>
//   sweep        the deployer's leftover EGLD to the multisig

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Address, Transaction } from "@multiversx/sdk-core";
import { EGLD, ROOT, abi, api, contractAddress, entrypoint, loadState, network, onNetwork, saveState, send, signer } from "./lib.js";

if (network() !== "mainnet") throw new Error("mainnet.ts is for mainnet: set MVXVEST_NETWORK=mainnet.");
const GO = process.env.MVXVEST_MAINNET_GO === "yes";
const SITE = "https://mvxvest.io";
const REPRODUCIBLE = join(ROOT, "output-docker/mvxvest");
const ISSUE_COST = EGLD / 20n;
const step = process.argv[2] ?? "status";
const controller = entrypoint().createSmartContractController(abi());

const account = async (address: string) => {
  const response = await fetch(`${api()}/accounts/${address}`);
  if (!response.ok) throw new Error(`${api()}/accounts/${address} answered ${response.status}`);
  return (await response.json()) as {
    balance: string;
    codeHash?: string;
    ownerAddress?: string;
    isUpgradeable?: boolean;
    isPayable?: boolean;
    isPayableBySmartContract?: boolean;
  };
};
const view = async (fn: string, args: unknown[] = []) =>
  (await controller.query({ contract: contractAddress(), function: fn, arguments: args }))[0];
const announce = (what: string) => {
  console.log(`${GO ? "Running" : "Would run (dry run, nothing sent)"}: ${what}`);
  return GO;
};
const call = async (label: string, fn: string, args: unknown[], options: { gasLimit?: bigint; value?: bigint } = {}) => {
  const deployer = await signer("deployer");
  const tx = await controller.createTransactionForExecute(deployer, deployer.getNonceThenIncrement(), {
    contract: contractAddress(),
    function: fn,
    arguments: args,
    ...(options.gasLimit ? { gasLimit: options.gasLimit } : {}),
    ...(options.value ? { nativeTransferAmount: options.value } : {}),
  });
  return send(label, tx);
};

async function status() {
  const state = loadState();
  console.log(`contract: ${state.contract ?? "not deployed"}`);
  if (!state.contract) return;
  const info = await account(state.contract);
  console.log(`owner: ${info.ownerAddress}`);
  console.log(`code hash: ${Buffer.from(info.codeHash ?? "", "base64").toString("hex")}`);
  console.log(`upgradeable ${info.isUpgradeable}, payable ${info.isPayable}, payable by contracts ${info.isPayableBySmartContract}`);
  console.log(`claim keys: ${(await view("getClaimKeyCollection"))?.toString() || "-"}`);
  console.log(`cancel keys: ${(await view("getCancelKeyCollection"))?.toString() || "-"}`);
  console.log(`creation paused: ${await view("isCreationPaused")}, fee: ${(await view("getFee"))?.toString()}`);
  console.log(`burn disabled: ${JSON.stringify(state.burnDisabled ?? {})}`);
}

async function deploy() {
  if (loadState().contract) throw new Error(`Already deployed: ${loadState().contract}`);
  if (!existsSync(join(REPRODUCIBLE, "mvxvest.wasm"))) throw new Error("No reproducible build in output-docker/: run sc-meta reproducible-build first.");
  const bytecode = readFileSync(join(REPRODUCIBLE, "mvxvest.wasm"));
  const codeHash = readFileSync(join(REPRODUCIBLE, "mvxvest.codehash.txt"), "utf8").trim();
  if (!announce(`deploy ${bytecode.length} bytes, code hash ${codeHash}, upgradeable, readable, not payable`)) return;
  const deployer = await signer("deployer");
  const tx = await controller.createTransactionForDeploy(deployer, deployer.getNonceThenIncrement(), {
    bytecode,
    gasLimit: 150_000_000n,
    arguments: [],
    isUpgradeable: true,
    isReadable: true,
    isPayable: false,
    isPayableBySmartContract: false,
  });
  const result = await send("deploy", tx, { note: `code hash ${codeHash}` });
  const address = controller.parseDeploy(await onNetwork(result.hash)).contracts[0].address.toBech32();
  saveState({ ...loadState(), contract: address });
  const info = await account(address);
  const onChain = Buffer.from(info.codeHash ?? "", "base64").toString("hex");
  if (onChain !== codeHash) throw new Error(`Code hash on chain ${onChain} is not the build's ${codeHash}`);
  if (!info.isUpgradeable || info.isPayable || info.isPayableBySmartContract) throw new Error(`Wrong code metadata: ${JSON.stringify(info)}`);
  console.log(`contract ${address}: code hash and metadata checked`);
}

async function pause() {
  if (!announce("pauseCreation")) return;
  await call("pauseCreation", "pauseCreation", []);
  if ((await view("isCreationPaused")) !== true) throw new Error("Still not paused");
}

async function collections() {
  for (const [endpoint, getter, name, ticker, field] of [
    ["issueClaimKey", "getClaimKeyCollection", "MvxVestClaimKey", "VESTKEY", "claimKey"],
    ["issueCancelKey", "getCancelKeyCollection", "MvxVestCancelKey", "VESTCANCEL", "cancelKey"],
  ] as const) {
    let id = (await view(getter))?.toString() ?? "";
    if (!id) {
      if (!announce(`${endpoint}("${name}", "${ticker}") paying 0.05 EGLD`)) continue;
      await call(endpoint, endpoint, [name, ticker], { gasLimit: 100_000_000n, value: ISSUE_COST });
      id = (await view(getter))?.toString() ?? "";
      if (!id) throw new Error(`${endpoint} completed but ${getter} is empty`);
    }
    saveState({ ...loadState(), [field]: id });
    console.log(`${field}: ${id}`);
  }
}

async function noburn() {
  for (const [kind, field] of [
    ["Claim", "claimKey"],
    ["Cancel", "cancelKey"],
  ] as const) {
    const state = loadState();
    const collection = state[field];
    if (!collection) throw new Error("Run the collections step first.");
    if (state.burnDisabled?.[kind]) continue;
    if (!announce(`disableKeyBurnByHolders(${kind}) on ${collection}, 100M gas`)) continue;
    const result = await call(`disableKeyBurnByHolders ${kind}`, "disableKeyBurnByHolders", [kind], { gasLimit: 100_000_000n });
    const body = (await (await fetch(`${api()}/transactions/${result.hash}?withLogs=true&withResults=true`)).json()) as {
      logs?: { events?: { identifier: string; topics?: string[] }[] };
      results?: { logs?: { events?: { identifier: string; topics?: string[] }[] } }[];
    };
    const events = [...(body.logs?.events ?? []), ...(body.results ?? []).flatMap((r) => r.logs?.events ?? [])];
    const seen = events.some(
      (e) => e.identifier === "ESDTUnSetBurnRoleForAll" && Buffer.from(e.topics?.[0] ?? "", "base64").toString() === collection,
    );
    if (!seen) throw new Error(`${collection}: no ESDTUnSetBurnRoleForAll event in ${result.hash}`);
    saveState({ ...loadState(), burnDisabled: { ...loadState().burnDisabled, [kind]: result.hash } });
  }
}

async function display() {
  for (const [kind, file] of [
    ["Claim", "claim-key-2"],
    ["Cancel", "cancel-key"],
  ] as const) {
    const uris = [`${SITE}/nft/${file}.png`, `${SITE}/nft/${file}.svg`];
    for (const uri of uris) {
      // Wallets and the explorer fetch these without any password.
      const response = await fetch(uri, { method: "HEAD" });
      if (!response.ok) throw new Error(`${uri} answered ${response.status}: publish the images first`);
    }
    if (!announce(`setKeyDisplay(${kind}, "", ${uris.join(", ")})`)) continue;
    await call(`setKeyDisplay ${kind}`, "setKeyDisplay", [kind, "", ...uris], { gasLimit: 10_000_000n });
  }
}

async function unpause() {
  const state = loadState();
  if (!state.claimKey || !state.cancelKey || !state.burnDisabled?.Claim || !state.burnDisabled?.Cancel) {
    throw new Error("Set up both collections and disable burning first.");
  }
  if (!announce("unpauseCreation (fee stays 0)")) return;
  await call("unpauseCreation", "unpauseCreation", []);
  if ((await view("isCreationPaused")) !== false) throw new Error("Still paused");
}

/** The multisig, checked: a contract answering as a multisig, typed twice. */
async function multisig(): Promise<Address> {
  const address = process.env.MVXVEST_MULTISIG ?? "";
  if (!Address.isValid(address)) throw new Error("Set MVXVEST_MULTISIG to the multisig's erd1 address.");
  if (process.env.MVXVEST_MULTISIG_CONFIRM !== address.slice(-6)) {
    throw new Error("Set MVXVEST_MULTISIG_CONFIRM to the multisig address's last 6 characters.");
  }
  const target = Address.newFromBech32(address);
  if (!target.isSmartContract()) throw new Error(`${address} is not a contract`);
  const answer = async (funcName: string) => {
    const response = await fetch(`${api()}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scAddress: address, funcName, args: [] }),
    });
    const body = (await response.json()) as { returnData?: string[] };
    const [value] = body.returnData ?? [];
    return value === undefined ? undefined : BigInt(`0x${Buffer.from(value, "base64").toString("hex") || "0"}`);
  };
  const quorum = await answer("getQuorum");
  const board = await answer("getNumBoardMembers");
  if (!quorum || !board) throw new Error(`${address} does not answer as a multisig (quorum ${quorum}, board ${board})`);
  console.log(`multisig ${address}: quorum ${quorum} of ${board} board members`);
  return target;
}

async function handover() {
  const target = await multisig();
  const contract = contractAddress();
  const before = await account(contract.toBech32());
  if (before.ownerAddress === target.toBech32()) {
    console.log("Already owned by the multisig.");
    return;
  }
  if ((await view("isCreationPaused")) !== false) throw new Error("Unpause first: after the hand-over only the multisig can.");
  if (!announce(`ChangeOwnerAddress of ${contract.toBech32()} to ${target.toBech32()}`)) return;
  const deployer = await signer("deployer");
  const tx = new Transaction({
    sender: deployer.address,
    receiver: contract,
    value: 0n,
    gasLimit: 6_000_000n,
    chainID: "1",
    nonce: deployer.getNonceThenIncrement(),
    data: new TextEncoder().encode(`ChangeOwnerAddress@${target.toHex()}`),
  });
  tx.signature = await deployer.signTransaction(tx);
  await send("ChangeOwnerAddress", tx);
  const after = await account(contract.toBech32());
  if (after.ownerAddress !== target.toBech32()) throw new Error(`Owner is ${after.ownerAddress}, not the multisig`);
  console.log(`owner is now the multisig ${target.toBech32()}`);
}

async function sweep() {
  const target = await multisig();
  const deployer = await signer("deployer");
  const balance = BigInt((await account(deployer.address.toBech32())).balance);
  const fee = 50_000n * 1_000_000_000n;
  if (balance <= fee) {
    console.log("Nothing left to send.");
    return;
  }
  const amount = balance - fee;
  if (!announce(`send ${Number(amount) / 1e18} EGLD from the deployer to the multisig`)) return;
  const tx = await entrypoint()
    .createTransfersController()
    .createTransactionForTransfer(deployer, deployer.getNonceThenIncrement(), {
      receiver: target,
      nativeAmount: amount,
    });
  await send("sweep to the multisig", tx);
}

const steps: Record<string, () => Promise<void>> = { status, deploy, pause, collections, noburn, display, unpause, handover, sweep };
const run = steps[step];
if (!run) throw new Error(`Unknown step ${step}: one of ${Object.keys(steps).join(", ")}`);
await run();
if (step !== "status") await status();
