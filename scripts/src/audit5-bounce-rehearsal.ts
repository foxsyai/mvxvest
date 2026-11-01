// The fifth audit's RT-1, played on devnet: a griefer's dust key rides in one
// claim with a victim's real keys, the griefer freezes the victim for the dust
// token, and the victim is in another shard than the contract. What reaches
// the victim, what comes back to the contract and what the views then say?
//
//   pnpm tsx src/audit5-bounce-rehearsal.ts
//
// The devnet "owner" (shard 0) plays the griefer and the "holder" (shard 1)
// the victim, against the devnet contract (shard 0). Devnet only: signer()
// refuses mainnet and so does the line below.

import { Address, Token, TokenTransfer, Transaction } from "@multiversx/sdk-core";
import { abi, amount, api, contractAddress, createdIds, entrypoint, loadState, network, onNetwork, saveState, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("The rehearsal runs on devnet only (MVXVEST_NETWORK=devnet).");

const griefer = await signer("owner");
const victim = await signer("holder");
const state = loadState() as ReturnType<typeof loadState> & { audit5Evil?: string };
const contract = contractAddress();
const controller = entrypoint().createSmartContractController(abi());
const management = entrypoint().createTokenManagementController();
const transfers = entrypoint().createTransfersController();
const TFOX = state.tokens!.TFOX!;
const DAY = 86_400n;
const now = BigInt(Math.floor(Date.now() / 1000));

const big = (value: { toFixed?: () => string; toString(): string }) =>
  BigInt(value.toFixed ? value.toFixed() : value.toString());
const hexNonce = (nonce: bigint) => {
  const hex = nonce.toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};
const query = (name: string, args: unknown[] = []) => controller.query({ contract, function: name, arguments: args });

async function keyHolder(nonce: bigint): Promise<string> {
  const response = await fetch(`${api()}/nfts/${state.claimKey}-${hexNonce(nonce)}?fields=owner`);
  if (response.status === 404) return "burned";
  const body = (await response.json()) as { owner?: string };
  if (body.owner === contract.toBech32()) return "the contract";
  if (body.owner === victim.address.toBech32()) return "the victim";
  return body.owner ?? "unknown";
}

async function tokenBalance(address: Address, token: string): Promise<bigint> {
  const response = await fetch(`${api()}/accounts/${address.toBech32()}/tokens/${token}`);
  return response.status === 404 ? 0n : BigInt(((await response.json()) as { balance: string }).balance);
}

async function report(ids: bigint[], tokens: string[]) {
  for (const id of ids) {
    const [view] = await query("getVesting", [id]);
    const nonce = big(view.vesting.claim_nonce);
    console.log(`  vesting ${id}: claimed ${big(view.claimed)}, claimable ${big(view.claimable)}, key ${nonce} at ${await keyHolder(nonce)}`);
  }
  for (const token of tokens) {
    const [surplus] = await query("getSurplus", [token]);
    const [deficit] = await query("getDeficit", [token]);
    console.log(
      `  ${token}: surplus ${big(surplus)}, deficit ${big(deficit)}, victim holds ${await tokenBalance(victim.address, token)}`,
    );
  }
}

async function create(step: string, beneficiary: Address, total: bigint, token: string, schedule: unknown): Promise<bigint> {
  const [fee] = await query("getFee");
  const [bps] = await query("getTokenFee");
  const tokenFee = (total * big(bps)) / 10_000n;
  const tx = await controller.createTransactionForExecute(griefer, griefer.getNonceThenIncrement(), {
    contract,
    function: "create",
    arguments: [beneficiary, total, schedule, false, step],
    tokenTransfers: [
      new TokenTransfer({ token: new Token({ identifier: token }), amount: total + tokenFee }),
      TokenTransfer.newFromNativeAmount(big(fee)),
    ],
  });
  const result = await send(step, tx);
  const [id] = await createdIds(result.hash);
  if (id === undefined) throw new Error(`${step}: no vestingCreated event in ${result.hash}`);
  return id;
}

// 1. The griefer's token, freezable (0.05 EGLD), once.
let evil = state.audit5Evil;
if (!evil) {
  const tx = await management.createTransactionForIssuingFungible(griefer, griefer.getNonceThenIncrement(), {
    tokenName: "Audit5Dust",
    tokenTicker: "DUST",
    initialSupply: 1_000n,
    numDecimals: 0n,
    canFreeze: true,
    canWipe: true,
    canPause: false,
    canChangeOwner: false,
    canUpgrade: false,
    canAddSpecialRoles: false,
    gasLimit: 60_000_000n,
  });
  const result = await send("issue the dust token", tx);
  const [issued] = management.parseIssueFungible(await onNetwork(result.hash));
  evil = issued.tokenIdentifier;
  saveState({ ...loadState(), audit5Evil: evil } as ReturnType<typeof loadState>);
}
console.log(`dust token ${evil}`);

// 2. The victim's real vesting, half way through, and one dust vesting that
// has fully vested. Both claim keys land in the victim's wallet.
const real = await create(
  "audit5 real vesting",
  victim.address,
  amount(100n, 18),
  TFOX,
  { start: now - DAY, cliff: now - DAY, cliff_amount: 0n, end: now + DAY, curve: "Linear" },
);
const dust = await create(
  "audit5 dust vesting",
  victim.address,
  1n,
  evil,
  { start: now - 2n * DAY, cliff: now - 2n * DAY, cliff_amount: 0n, end: now - DAY, curve: "Linear" },
);
console.log(`real vesting ${real}, dust vesting ${dust}`);
await report([real, dust], [TFOX, evil]);

// 3. An airdrop of one unit, then the freeze.
const airdrop = await transfers.createTransactionForTransfer(griefer, griefer.getNonceThenIncrement(), {
  receiver: victim.address,
  tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: evil }), amount: 1n })],
});
await send("airdrop one unit to the victim", airdrop);
// sdk-core's createTransactionForFreezing addresses the transaction to its own
// sender, so the freeze never runs: the system contract is named here.
const freeze = new Transaction({
  sender: griefer.address,
  receiver: Address.newFromBech32("erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzllls8a5w6u"),
  chainID: "D",
  gasLimit: 60_000_000n,
  nonce: griefer.getNonceThenIncrement(),
  data: Buffer.from(`freeze@${Buffer.from(evil).toString("hex")}@${victim.address.toHex()}`),
});
freeze.signature = await griefer.signTransaction(freeze);
await send("freeze the victim for the dust token", freeze);
const frozen = (await (
  await fetch(`https://devnet-gateway.multiversx.com/address/${victim.address.toBech32()}/esdt/${evil}`)
).json()) as { data?: { tokenData?: { properties?: string } } };
console.log(`victim's dust token properties after the freeze: ${JSON.stringify(frozen.data?.tokenData?.properties)}`);
await new Promise((resolve) => setTimeout(resolve, 12_000));

// 4. The victim presses Claim all: both keys, one transaction, simulated first
// by the estimator as the site's is.
const [realView] = await query("getVesting", [real]);
const [dustView] = await query("getVesting", [dust]);
const tfoxBefore = await tokenBalance(victim.address, TFOX);
const surplusBefore = big((await query("getSurplus", [TFOX]))[0]);
const claim = await controller.createTransactionForExecute(victim, victim.getNonceThenIncrement(), {
  contract,
  function: "claim",
  arguments: [],
  tokenTransfers: [big(realView.vesting.claim_nonce), big(dustView.vesting.claim_nonce)].map(
    (nonce) => new TokenTransfer({ token: new Token({ identifier: state.claimKey!, nonce }), amount: 1n }),
  ),
});
console.log("simulation passed: the transaction got its gas limit", claim.gasLimit.toString());
// On a bounce the API calls the transaction failed although the first hop was
// booked; what counts is where the key and the money end up.
let hash = "";
try {
  hash = (await send("claim all, as the victim", claim)).hash;
} catch (error) {
  console.log(`  ${(error as Error).message}`);
}
console.log(`claim hash ${hash || "(in the line above)"}`);

// 5. Wait for the indexer, then the verdict: the real key must stay with the
// victim and no money of the real token may come back to the contract.
await new Promise((resolve) => setTimeout(resolve, 15_000));
console.log(`victim's TFOX changed by ${(await tokenBalance(victim.address, TFOX)) - tfoxBefore}`);
await report([real, dust], [TFOX, evil]);
const keyAt = await keyHolder(big(realView.vesting.claim_nonce));
const [surplus] = await query("getSurplus", [TFOX]);
const safe = keyAt === "the victim" && big(surplus) === surplusBefore;
console.log(safe ? "PASS: the dust token took nothing else with it" : `FAIL (RT-1): the real key is at ${keyAt}, TFOX surplus ${big(surplus)}`);
if (!safe) process.exitCode = 1;
