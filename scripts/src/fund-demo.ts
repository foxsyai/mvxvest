// Funds a fresh devnet-only demo wallet for the guide's pictures (third audit,
// O1: no picture shows a wallet with a history). It sends the play EGLD the
// capture pays in fees (the 60-line CSV alone is 6 EGLD at mainnet's 0.1 per
// vesting), TFOX for the vestings it creates, and creates one small TUSD
// vesting for it, so My vestings shows two tokens. Devnet only; the devnet
// keys keep a little EGLD for their own gas.
//
//   MVXVEST_NETWORK=devnet pnpm tsx src/fund-demo.ts erd1...

import {
  Address,
  ApiNetworkProvider,
  Token,
  TokenTransfer,
  TransactionsFactoryConfig,
  TransferTransactionsFactory,
} from "@multiversx/sdk-core";
import { VestingClient } from "../../dapp/src/vesting/client.ts";
import { api, contractAddress, EGLD, loadState, network, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("fund-demo.ts is for devnet only.");
const demo = Address.newFromBech32(process.argv[2] ?? "");
const owner = await signer("owner");
const holder = await signer("holder");
const tokens = loadState().tokens!;
const provider = new ApiNetworkProvider(api(), { clientName: "mvxvest-fund-demo" });
const client = new VestingClient(contractAddress().toBech32(), provider, "D");
const transfers = new TransferTransactionsFactory({ config: new TransactionsFactoryConfig({ chainID: "D" }) });

const egldOf = async (address: Address) =>
  BigInt(((await (await fetch(`${api()}/accounts/${address.toBech32()}`)).json()) as { balance: string }).balance);

// 1. A TUSD vesting for the demo wallet: 1,000 TUSD over a year that began
//    three months ago, so part of it is claimable at once. Skipped when the
//    wallet already holds a claim key (a second run).
const { claim } = await client.collections();
const keysHeld = Number(await (await fetch(`${api()}/accounts/${demo.toBech32()}/nfts/count?collections=${claim}`)).text());
const [fee, bps] = await Promise.all([client.fee(), client.tokenFee()]);
const now = Math.floor(Date.now() / 1000);
const start = now - 91 * 86_400;
const create = await client.create(
  owner.address.toBech32(),
  tokens.TUSD,
  {
    beneficiary: demo.toBech32(),
    total: 1_000n * 10n ** 6n,
    schedule: { start, cliff: start, cliffAmount: 0n, end: start + 365 * 86_400, curve: { kind: "linear" as const } },
  },
  false,
  "Advisors 2026",
  fee,
  bps,
);
if (keysHeld === 0) {
  create.nonce = owner.getNonceThenIncrement();
  create.gasLimit = 600_000_000n;
  create.gasLimit = (BigInt((await provider.estimateTransactionCost(create)).gasLimit) * 12n) / 10n;
  create.signature = await owner.signTransaction(create);
  await send("a TUSD vesting for the demo wallet", create);
} else console.log(`the demo wallet already holds ${keysHeld} claim key(s): no new vesting`);

// 2. TFOX for the vestings it creates (about 28,800 with the fees).
const tfox = await transfers.createTransactionForESDTTokenTransfer(owner.address, {
  receiver: demo,
  tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: tokens.TFOX }), amount: 40_000n * 10n ** 18n })],
});
tfox.nonce = owner.getNonceThenIncrement();
tfox.signature = await owner.signTransaction(tfox);
await send("40,000 TFOX to the demo wallet", tfox);

// 3. Play EGLD from both keys, each keeping a little for its own gas.
for (const [key, keep] of [
  [owner, EGLD / 20n],
  [holder, EGLD / 50n],
] as const) {
  const gas = 50_000n * 1_000_000_000n;
  const amount = (await egldOf(key.address)) - keep - gas;
  if (amount <= 0n) continue;
  const tx = await transfers.createTransactionForNativeTokenTransfer(key.address, { receiver: demo, nativeAmount: amount });
  tx.nonce = key.getNonceThenIncrement();
  tx.signature = await key.signTransaction(tx);
  await send(`${Number(amount) / 1e18} EGLD to the demo wallet`, tx);
}

console.log(`demo wallet ${demo.toBech32()}: ${Number(await egldOf(demo)) / 1e18} EGLD`);
