// Gas measurements on devnet: create, createBatch at several sizes, the
// largest schedule, claim of one and of many keys, cancel, and the storage
// each vesting adds. Results go to scripts/state/<network>.json (runs) and to
// the console, for docs/MEASUREMENTS.md.
//
//   pnpm tsx src/gas.ts

import { Token, TokenTransfer } from "@multiversx/sdk-core";
import { abi, amount, api, contractAddress, entrypoint, loadState, send, signer } from "./lib.js";

const DAY = 86_400n;
const MAX_GAS = 600_000_000n;
const owner = await signer("owner");
const holder = await signer("holder");
const state = loadState();
const TFOX = state.tokens!.TFOX;
const contract = contractAddress();
const controller = entrypoint().createSmartContractController(abi());
const now = BigInt(Math.floor(Date.now() / 1000));
const linear = { start: now, cliff: now, cliff_amount: 0n, end: now + 365n * DAY, curve: "Linear" };
const results: Record<string, number | string> = {};

async function storageBytes(): Promise<number> {
  const gateway = api().replace("-api.", "-gateway.").replace("://api.", "://gateway.");
  const body = await (await fetch(`${gateway}/address/${contract.toBech32()}/keys`)).json();
  const pairs: Record<string, string> = body.data.pairs;
  return Object.entries(pairs).reduce((sum, [key, value]) => sum + key.length / 2 + value.length / 2, 0);
}

function fox(units: bigint): TokenTransfer {
  return new TokenTransfer({ token: new Token({ identifier: TFOX }), amount: amount(units, 18) });
}

async function batch(size: number, cancelable: boolean): Promise<number> {
  const entries = Array.from({ length: size }, (_, i) => [i % 2 ? holder.address : owner.address, amount(10n, 18), linear]);
  const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
    contract,
    function: "createBatch",
    arguments: [cancelable, "gas run", ...entries],
    tokenTransfers: [fox(10n * BigInt(size))],
    gasLimit: MAX_GAS,
  });
  const result = await send(`createBatch ${size}${cancelable ? " cancelable" : ""}`, tx);
  return result.gasUsed ?? 0;
}

// Single creates.
for (const cancelable of [false, true]) {
  const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
    contract,
    function: "create",
    arguments: [holder.address, linear, cancelable, "gas run"],
    tokenTransfers: [fox(10n)],
    gasLimit: 30_000_000n,
  });
  results[`create ${cancelable ? "cancelable" : "non-cancelable"}`] = (await send(`create ${cancelable}`, tx)).gasUsed ?? 0;
}

// The largest schedule: 120 explicit tranches.
const tranches = Array.from({ length: 120 }, (_, i) => ({ time: now + BigInt(i + 1) * 30n * DAY, amount: amount(1n, 18) }));
const tx120 = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
  contract,
  function: "create",
  arguments: [holder.address, { start: now, cliff: now, cliff_amount: 0n, end: tranches[119].time, curve: { name: "Tranches", fields: { 0: tranches } } }, true, "120 tranches"],
  tokenTransfers: [fox(120n)],
  gasLimit: 100_000_000n,
});
results["create 120 tranches cancelable"] = (await send("create 120 tranches", tx120)).gasUsed ?? 0;

// Batches, and the storage one vesting adds.
for (const size of [1, 10, 25, 50]) {
  results[`createBatch ${size} cancelable`] = await batch(size, true);
}
const bytesBefore = await storageBytes();
results["createBatch 100 cancelable"] = await batch(100, true);
const bytesAfter = await storageBytes();
results["storage bytes per vesting (batch of 100, cancelable)"] = Math.round((bytesAfter - bytesBefore) / 100);
results["createBatch 100 non-cancelable"] = await batch(100, false);

// Claims: one key, then ten at once (the holder got every other vesting).
const nfts = (await (
  await fetch(`${api()}/accounts/${holder.address.toBech32()}/nfts?collections=${state.claimKey}&size=11`)
).json()) as { nonce: number }[];
const claimTx = async (nonces: number[]) =>
  controller.createTransactionForExecute(holder, holder.getNonceThenIncrement(), {
    contract,
    function: "claim",
    arguments: [],
    tokenTransfers: nonces.map(
      (nonce) => new TokenTransfer({ token: new Token({ identifier: state.claimKey!, nonce: BigInt(nonce) }), amount: 1n }),
    ),
    gasLimit: 100_000_000n,
  });
results["claim 1 key (cross-shard)"] = (await send("claim 1", await claimTx([nfts[0].nonce]))).gasUsed ?? 0;
results["claim 10 keys (cross-shard)"] = (await send("claim 10", await claimTx(nfts.slice(1, 11).map((n) => n.nonce)))).gasUsed ?? 0;

// Cancel one key.
const cancels = (await (
  await fetch(`${api()}/accounts/${owner.address.toBech32()}/nfts?collections=${state.cancelKey}&size=1`)
).json()) as { nonce: number }[];
const cancelTx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
  contract,
  function: "cancel",
  arguments: [],
  tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: state.cancelKey!, nonce: BigInt(cancels[0].nonce) }), amount: 1n })],
  gasLimit: 30_000_000n,
});
results["cancel 1 key"] = (await send("cancel 1", cancelTx)).gasUsed ?? 0;

console.table(results);
