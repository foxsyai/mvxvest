// Owner actions on mvxvest through its multisig: the legacy mx-contracts-rs
// multisig that mvxsafe deploys (the mainnet owner erd1...ul78u3 runs exactly
// that code, hash f5658529...). mvxsafe cannot propose contract calls or
// upgrades yet, so this builds them.
//
//   pnpm tsx src/multisig.ts status
//   pnpm tsx src/multisig.ts propose pause | unpause | fee <egld> | claimfees
//                                   | display <Claim|Cancel> <png url> <svg url>
//                                   | recover-bounced <id> <Claim|Cancel> <erd1 to>
//                                   | recover-surplus <token> <erd1 to>
//   pnpm tsx src/multisig.ts propose-upgrade <erd1 source>
//   pnpm tsx src/multisig.ts sign <id> | perform <id> | discard <id>
//   pnpm tsx src/multisig.ts stage          (devnet: deploy the upgrade's source)
//
// Environment: MVXVEST_NETWORK, MVXVEST_MULTISIG (the owner multisig),
// MVXVEST_FROM (the board member who sends it: its gas is simulated with its
// guardian, if any). Each command prints the transaction to send from that
// member's wallet: to the multisig, 0 EGLD, the data and the gas limit.
// On devnet MVXVEST_SEND=<owner|holder> signs it with that devnet key and sends
// it (the rehearsal in docs/DEPLOY.md). Mainnet is never signed here.
//
// An upgrade's source is a copy of the new build deployed IN THE MULTISIG'S
// SHARD (performAction reads its code there) by any wallet; its code hash must
// be checked against the reproducible build before proposing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { ROOT, abi, api, contractAddress, entrypoint, network, onNetwork, send, signer } from "./lib.js";

const multisigAddress = process.env.MVXVEST_MULTISIG ?? "";
if (!Address.isValid(multisigAddress)) throw new Error("Set MVXVEST_MULTISIG to the owner multisig's address.");
const multisig = Address.newFromBech32(multisigAddress);
const chainID = network() === "mainnet" ? "1" : network() === "devnet" ? "D" : "T";
const [command, ...rest] = process.argv.slice(2);

/** Upgradeable and readable, not payable: what mvxvest was deployed with. */
const CODE_METADATA = "0500";
/**
 * What the call performAction makes needs on our contract, measured (devnet
 * rehearsal and the mainnet launch: pause 3.78M, setKeyDisplay 5.06M, a 26.5 KB
 * code upgrade ~88M) times ~1.2.
 */
const INNER_GAS: Record<string, bigint> = {
  pauseCreation: 4_600_000n,
  unpauseCreation: 4_600_000n,
  setFee: 4_600_000n,
  claimFees: 6_000_000n,
  setKeyDisplay: 6_100_000n,
  recoverBouncedKey: 10_000_000n,
  recoverSurplus: 10_000_000n,
  upgrade: 106_000_000n,
};
/**
 * On a call to another shard the network holds back 4M of the forwarded gas
 * for the multisig's callback; without it the call itself runs out of gas
 * and the action is used up (devnet rehearsal: unpause with 8M forwarded
 * failed "not enough gas"). Plus a margin for the callback's own work.
 */
const CALLBACK_GAS = 5_000_000n;
/** performAction's own part: 5.9M measured in the devnet rehearsal, x1.27. */
const PERFORM_OWN_GAS = BigInt(process.env.MVXVEST_PERFORM_OWN_GAS ?? "7500000");

const hex = (text: string) => Buffer.from(text).toString("hex");
const u32 = (n: number) => (n === 0 ? "" : n.toString(16).padStart(n.toString(16).length + (n.toString(16).length % 2), "0"));

/** The vesting contract's own encoding of a call: "fn@arg@arg", split. */
async function innerCall(fn: string, args: unknown[]): Promise<string[]> {
  const factory = entrypoint().createSmartContractTransactionsFactory(abi());
  const tx = await factory.createTransactionForExecute(multisig, {
    contract: contractAddress(),
    function: fn,
    arguments: args,
    gasLimit: 1n,
  });
  return Buffer.from(tx.data).toString().split("@");
}

async function proposal(): Promise<{ data: string; inner?: string }> {
  if (command === "propose") {
    const [action, ...a] = rest;
    const kind = (k: string) => {
      if (k !== "Claim" && k !== "Cancel") throw new Error(`Kind is Claim or Cancel, not ${k}`);
      return k;
    };
    const calls: Record<string, () => [string, unknown[]]> = {
      pause: () => ["pauseCreation", []],
      unpause: () => ["unpauseCreation", []],
      fee: () => ["setFee", [BigInt(Math.round(Number(a[0]) * 1e6)) * 10n ** 12n]],
      claimfees: () => ["claimFees", []],
      display: () => ["setKeyDisplay", [kind(a[0]), "", a[1], a[2]]],
      "recover-bounced": () => ["recoverBouncedKey", [BigInt(a[0]), kind(a[1]), Address.newFromBech32(a[2])]],
      "recover-surplus": () => ["recoverSurplus", [a[0], Address.newFromBech32(a[1])]],
    };
    const make = calls[action];
    if (!make) throw new Error(`Unknown action ${action}: one of ${Object.keys(calls).join(", ")}`);
    const [fn, args] = make();
    const [name, ...encoded] = await innerCall(fn, args);
    // proposeAsyncCall(to, egld_amount, function_and_arguments...)
    return { data: ["proposeAsyncCall", contractAddress().toHex(), "", hex(name), ...encoded].join("@"), inner: fn };
  }
  if (command === "propose-upgrade") {
    const source = Address.newFromBech32(rest[0] ?? "");
    // proposeSCUpgradeFromSource(sc_address, amount, source, code_metadata, args...)
    return { data: ["proposeSCUpgradeFromSource", contractAddress().toHex(), "", source.toHex(), CODE_METADATA].join("@") };
  }
  const id = Number(rest[0]);
  if (!Number.isInteger(id) || id < 1) throw new Error("Give the action id.");
  if (command === "sign") return { data: `sign@${u32(id)}` };
  if (command === "discard") return { data: `discardAction@${u32(id)}` };
  if (command === "perform") return { data: `performAction@${u32(id)}`, inner: await actionKind(id) };
  throw new Error(`Unknown command ${command}`);
}

const query = async (funcName: string, args: string[] = []) => {
  const response = await fetch(`${api()}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scAddress: multisig.toBech32(), funcName, args }),
  });
  return ((await response.json()) as { returnData?: string[] }).returnData ?? [];
};
const num = (b64?: string) => BigInt(`0x${Buffer.from(b64 ?? "", "base64").toString("hex") || "0"}`);

/** Which owner call (or an upgrade) a pending action makes, for its gas. */
async function actionKind(id: number): Promise<string> {
  const [raw] = await query("getActionData", [u32(id).padStart(2, "0")]);
  const bytes = Buffer.from(raw ?? "", "base64");
  if (bytes.length === 0) throw new Error(`No pending action ${id}`);
  // The legacy multisig's Action enum (seen on chain in the devnet rehearsal):
  // 5 SendTransferExecute, 6 SendAsyncCall, 7 SCDeployFromSource,
  // 8 SCUpgradeFromSource.
  if (bytes[0] === 8) return "upgrade";
  if (bytes[0] === 6) {
    const text = bytes.toString("latin1");
    const known = Object.keys(INNER_GAS).find((fn) => fn !== "upgrade" && text.includes(fn));
    if (known) return known;
  }
  throw new Error(`Action ${id} is not an mvxvest owner call (kind ${bytes[0]}); perform it with an explicit gas limit.`);
}

async function status() {
  console.log(`multisig ${multisig.toBech32()} (${network()}), owner of ${contractAddress().toBech32()}`);
  console.log(`quorum ${num((await query("getQuorum"))[0])}`);
  for (const member of await query("getAllBoardMembers")) {
    console.log(`  board: ${Address.newFromHex(Buffer.from(member, "base64").toString("hex")).toBech32()}`);
  }
  const last = Number(num((await query("getActionLastIndex"))[0]));
  console.log(`actions so far: ${last}`);
  for (let id = Math.max(1, last - 9); id <= last; id++) {
    const [data] = await query("getActionData", [u32(id).padStart(2, "0")]);
    if (!data) continue;
    const signers = num((await query("getActionValidSignerCount", [u32(id).padStart(2, "0")]))[0]);
    const kind = Buffer.from(data, "base64")[0];
    console.log(`  pending #${id}: kind ${kind}, ${signers} valid signature(s)`);
  }
}

/**
 * Deploys the reproducible build as the source of an upgrade, from a wallet in
 * the multisig's shard (devnet keys only), and checks its code hash on chain
 * against the build's.
 */
async function stage() {
  if (network() !== "devnet") throw new Error("On mainnet the source is deployed by a wallet in the multisig's shard; see docs/DEPLOY.md.");
  const dir = join(ROOT, "output-docker/mvxvest");
  const bytecode = readFileSync(join(dir, "mvxvest.wasm"));
  const codeHash = readFileSync(join(dir, "mvxvest.codehash.txt"), "utf8").trim();
  const key = await signer(process.env.MVXVEST_SEND ?? "holder");
  const shardOf = async (a: string) => ((await (await fetch(`${api()}/accounts/${a}`)).json()) as { shard: number }).shard;
  if ((await shardOf(key.address.toBech32())) !== (await shardOf(multisig.toBech32()))) {
    throw new Error("The source must be deployed from a wallet in the multisig's shard.");
  }
  const tx = await entrypoint().createSmartContractTransactionsFactory(abi()).createTransactionForDeploy(key.address, {
    bytecode,
    arguments: [],
    isUpgradeable: false,
    isReadable: true,
    isPayable: false,
    isPayableBySmartContract: false,
  });
  tx.nonce = key.getNonceThenIncrement();
  tx.signature = await key.signTransaction(tx);
  const result = await send("deploy the upgrade source", tx);
  const source = entrypoint().createSmartContractController().parseDeploy(await onNetwork(result.hash)).contracts[0].address;
  const info = (await (await fetch(`${api()}/accounts/${source.toBech32()}`)).json()) as { codeHash: string; shard: number };
  const onChain = Buffer.from(info.codeHash, "base64").toString("hex");
  if (onChain !== codeHash) throw new Error(`Source code hash ${onChain} is not the build's ${codeHash}`);
  console.log(`source ${source.toBech32()} (shard ${info.shard}), code hash ${onChain} = the reproducible build`);
}

async function run() {
  if (command === "status") return status();
  if (command === "stage") return stage();
  const { data, inner } = await proposal();
  const from = process.env.MVXVEST_SEND
    ? (await signer(process.env.MVXVEST_SEND)).address
    : process.env.MVXVEST_FROM
      ? Address.newFromBech32(process.env.MVXVEST_FROM)
      : undefined;
  const tx = new Transaction({
    sender: from ?? multisig,
    receiver: multisig,
    value: 0n,
    gasLimit: 0n,
    chainID,
    data: new TextEncoder().encode(data),
  });
  let gasLimit: bigint | undefined;
  if (from) {
    const account = (await (await fetch(`${api()}/accounts/${from.toBech32()}?withGuardianInfo=true`)).json()) as {
      nonce: number;
      isGuarded?: boolean;
      activeGuardianAddress?: string;
    };
    tx.nonce = BigInt(account.nonce);
    if (account.isGuarded && account.activeGuardianAddress) {
      new TransactionComputer().applyGuardian(tx, Address.newFromBech32(account.activeGuardianAddress));
    }
    if (command === "perform") {
      // The network cannot simulate a performAction whose call goes to another
      // shard ("no async context found", devnet rehearsal): a measured budget
      // for the multisig's own part, plus what the call it makes needs (it is
      // forwarded whatever is left).
      gasLimit = PERFORM_OWN_GAS + INNER_GAS[inner!] + CALLBACK_GAS;
      console.log(
        `gas: ${PERFORM_OWN_GAS} performAction + ${INNER_GAS[inner!]} the call + ${CALLBACK_GAS} held for the callback`,
      );
    } else {
      const simulated = BigInt((await entrypoint().createNetworkProvider().estimateTransactionCost(tx)).gasLimit);
      gasLimit = (simulated * 12n) / 10n;
      console.log(`gas: simulated ${simulated}`);
    }
    if (account.isGuarded) gasLimit += 50_000n;
  }
  console.log(`\nSend from a board member's wallet:\n  to:     ${multisig.toBech32()}\n  amount: 0 EGLD\n  data:   ${data}\n  gas:    ${gasLimit ?? "(set MVXVEST_FROM to simulate)"}`);

  if (!process.env.MVXVEST_SEND) return;
  if (network() !== "devnet") throw new Error("Only devnet transactions are signed here.");
  const key = await signer(process.env.MVXVEST_SEND);
  tx.gasLimit = gasLimit!;
  tx.nonce = key.getNonceThenIncrement();
  tx.signature = await key.signTransaction(tx);
  await send(`${command} ${rest.join(" ")}`.trim(), tx);
}

await run();
