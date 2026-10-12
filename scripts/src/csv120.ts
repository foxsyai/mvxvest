// Milestone 2 check: a CSV of 120 beneficiaries goes through the dApp's own
// code (dapp/src/vesting: CSV parsing, plan builder, batch splitting,
// transaction builder), is signed here with the devnet key instead of a wallet,
// and every vesting is then compared with what the dApp computed.
//
//   pnpm tsx src/csv120.ts

import { ApiNetworkProvider } from "@multiversx/sdk-core";
import { parseBeneficiaries } from "../../dapp/src/vesting/csv.ts";
import { DAY, buildSchedule, planProblem, type Plan } from "../../dapp/src/vesting/builder.ts";
import { splitIntoBatches } from "../../dapp/src/vesting/batches.ts";
import { VestingClient } from "../../dapp/src/vesting/client.ts";
import { validateSchedule } from "../../dapp/src/vesting/schedule.ts";
import { api, contractAddress, entrypoint, loadState, send, signer } from "./lib.js";

const owner = await signer("owner");
const holder = await signer("holder");
const token = loadState().tokens!.TFOX;
const provider = new ApiNetworkProvider(api(), { clientName: "mvxvest-csv120" });
const client = new VestingClient(contractAddress().toBech32(), provider, "D");

// 120 lines, alternating between the two devnet wallets, amounts with decimals.
const lines = ["address,amount"];
for (let i = 0; i < 120; i++) {
  const who = i % 2 ? holder.address.toBech32() : owner.address.toBech32();
  lines.push(`${who},${100 + i}.${String(i).padStart(2, "0")}5`);
}
const csv = parseBeneficiaries(lines.join("\n"), 18);
if (csv.errors.length || csv.rows.length !== 120) throw new Error(`CSV: ${JSON.stringify(csv.errors)}`);

// Monthly for 12 months after a 3-month cliff that unlocks 10%.
const now = Math.floor(Date.now() / 1000);
const plan: Plan = {
  start: now,
  cliff: { at: now + 90 * DAY, style: "lump", bps: 1000 },
  shape: { kind: "months", months: 1, count: 12 }
};
if (planProblem(plan)) throw new Error(planProblem(plan)!);
const entries = csv.rows.map((row) => ({ beneficiary: row.address, total: row.amount, schedule: buildSchedule(plan, row.amount) }));
for (const entry of entries) {
  const problem = validateSchedule(entry.schedule, entry.total);
  if (problem) throw new Error(problem);
}
const limits = await client.limits();
const fee = await client.fee();
const batches = splitIntoBatches(entries, true, limits);
console.log(`120 lines -> ${batches.length} transactions of ${batches.map((b) => b.length).join(", ")}`);

const before = await client.vestingCount();
const controllerFree = entrypoint();
for (const [index, batch] of batches.entries()) {
  const tx = await client.createBatch(owner.address.toBech32(), token, batch, true, "csv 120", fee);
  tx.nonce = owner.getNonceThenIncrement();
  const estimate = BigInt((await provider.estimateTransactionCost(Object.assign(tx, { gasLimit: 600_000_000n }))).gasLimit);
  tx.gasLimit = (estimate * 12n) / 10n;
  tx.signature = await owner.signTransaction(tx);
  await send(`createBatch ${index + 1}/${batches.length} (${batch.length})`, tx);
}
void controllerFree;

// Every vesting on chain must be exactly what the dApp built, in order.
const after = await client.vestingCount();
if (after - before !== 120) throw new Error(`expected 120 new vestings, got ${after - before}`);
const ids = Array.from({ length: 120 }, (_, i) => before + 1 + i);
const onChain = [...(await client.vestings(ids.slice(0, 100))), ...(await client.vestings(ids.slice(100)))];
let mismatches = 0;
for (const [i, v] of onChain.entries()) {
  const want = entries[i];
  const same =
    v.beneficiary === want.beneficiary &&
    v.total === want.total &&
    v.token === token &&
    v.cancelable &&
    v.label === "csv 120" &&
    JSON.stringify(v.schedule, (_, x) => (typeof x === "bigint" ? x.toString() : x)) ===
      JSON.stringify(want.schedule, (_, x) => (typeof x === "bigint" ? x.toString() : x));
  if (!same) {
    mismatches++;
    console.log("MISMATCH", v.id, v.total, want.total);
  }
}
console.log(`checked ${onChain.length} vestings (#${ids[0]} to #${ids[119]}): ${mismatches} mismatches`);
if (mismatches) process.exit(1);
console.log("csv 120 passed");
