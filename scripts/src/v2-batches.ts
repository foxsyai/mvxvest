// Version 2 check on devnet: the largest batches the contract allows, 49 and
// 32 cancelable, with both fees set, through the dApp's own code (fees,
// transaction builder), signed here with the devnet key instead of a wallet.
// The network allows 100 built-in calls per transaction; with the token fee's
// transfer these batches make 99 and 98 (review5_builtin_calls_test counts
// them). This proves it on the real network, then checks every vesting, the
// fee that reached the owner multisig, the EGLD fees booked, and the new keys'
// cancelable marker.
//
//   MVXVEST_NETWORK=devnet pnpm tsx src/v2-batches.ts

import { ApiNetworkProvider } from "@multiversx/sdk-core";
import { VestingClient } from "../../dapp/src/vesting/client.ts";
import { tokenFeeOfAll } from "../../dapp/src/vesting/fees.ts";
import { api, contractAddress, loadState, network, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("v2-batches.ts is for devnet only.");
const owner = await signer("owner");
const holder = await signer("holder");
const state = loadState() as ReturnType<typeof loadState> & { ownerMultisig?: string };
const token = state.tokens!.TFOX;
const multisig = state.ownerMultisig!;
const provider = new ApiNetworkProvider(api(), { clientName: "mvxvest-v2-batches" });
const client = new VestingClient(contractAddress().toBech32(), provider, "D");

const [limits, fee, bps] = await Promise.all([client.limits(), client.fee(), client.tokenFee()]);
console.log(`limits ${limits.maxBatch} / ${limits.maxBatchCancelable}, EGLD fee ${fee}, token fee ${bps} bps`);
if (limits.maxBatch !== 49 || limits.maxBatchCancelable !== 32) throw new Error("not version 2's limits");
if (bps === 0 || fee === 0n) throw new Error("set both fees first (src/multisig.ts propose tokenfee / fee)");

const tokenBalance = async (address: string) =>
  BigInt(((await (await fetch(`${api()}/accounts/${address}/tokens/${token}`)).json()) as { balance?: string }).balance ?? "0");

const now = Math.floor(Date.now() / 1000);
const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    beneficiary: (i % 2 ? holder : owner).address.toBech32(),
    // 100.0i TFOX: amounts whose 1% does not divide evenly, so rounding shows.
    total: 100n * 10n ** 18n + BigInt(i) * 10n ** 16n + 7n,
    schedule: {
      start: now,
      cliff: now,
      cliffAmount: 0n,
      end: now + 30 * 86_400,
      curve: { kind: "linear" as const },
    },
  }));

for (const [cancelable, count] of [
  [false, 49],
  [true, 32],
] as const) {
  const batch = entries(count);
  const tokenFee = tokenFeeOfAll(
    batch.map((entry) => entry.total),
    bps,
  );
  const before = { multisig: await tokenBalance(multisig), count: await client.vestingCount(), accrued: await client.feesAccrued() };
  const tx = await client.createBatch(owner.address.toBech32(), token, batch, cancelable, "v2 check", fee, bps);
  tx.nonce = owner.getNonceThenIncrement();
  tx.gasLimit = 600_000_000n;
  const estimate = BigInt((await provider.estimateTransactionCost(tx)).gasLimit);
  tx.gasLimit = (estimate * 12n) / 10n;
  tx.signature = await owner.signTransaction(tx);
  await send(`createBatch of ${count}${cancelable ? " cancelable" : ""} with both fees`, tx);
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  const after = { multisig: await tokenBalance(multisig), count: await client.vestingCount(), accrued: await client.feesAccrued() };
  const ids = Array.from({ length: count }, (_, i) => before.count + 1 + i);
  if (after.count - before.count !== count) throw new Error(`expected ${count} new vestings, got ${after.count - before.count}`);
  const made = await client.vestings(ids);
  const wrong = made.filter((v, i) => v.total !== batch[i].total || v.beneficiary !== batch[i].beneficiary || v.cancelable !== cancelable);
  if (wrong.length) throw new Error(`${wrong.length} vestings differ from what was asked`);
  // The fee transfer crosses shards (contract shard 0, multisig shard 1).
  for (let i = 0; i < 10 && after.multisig - before.multisig !== tokenFee; i++) {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    after.multisig = await tokenBalance(multisig);
  }
  console.log(`  ${count} vestings exact; token fee ${tokenFee} reached the multisig: ${after.multisig - before.multisig === tokenFee}`);
  console.log(`  EGLD fees booked: ${after.accrued - before.accrued === fee * BigInt(count)}`);
  if (after.multisig - before.multisig !== tokenFee) throw new Error("the multisig did not receive the token fee");

  const last = made[made.length - 1];
  const collections = await client.collections();
  const hex = (n: number) => (n.toString(16).length % 2 ? "0" : "") + n.toString(16);
  const nft = (await (await fetch(`${api()}/nfts/${collections.claim}-${hex(last.claimNonce)}`)).json()) as { attributes?: string };
  const attributes = Buffer.from(nft.attributes ?? "", "base64").toString();
  console.log(`  claim key of #${last.id}: ${attributes}`);
  if (!attributes.endsWith(`;cancelable:${cancelable ? 1 : 0}`)) throw new Error("the claim key lacks the cancelable marker");
}

