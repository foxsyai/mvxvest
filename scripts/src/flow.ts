// The milestone 1 acceptance run on devnet: create, claim, move the claim key
// to another wallet, show the old holder can no longer claim, claim as the new
// holder, cancel, and claim what had vested. Also an EGLD vesting, explicit
// tranches with a 6-decimal token and a cliff equal to the total with a
// 0-decimal token. Every money outcome is checked on chain, not assumed.
//
//   pnpm tsx src/flow.ts

import { Address, Token, TokenTransfer } from "@multiversx/sdk-core";
import { EGLD, abi, amount, api, contractAddress, createdIds, entrypoint, loadState, send, signer } from "./lib.js";

const DAY = 86_400n;
const owner = await signer("owner");
const holder = await signer("holder");
const state = loadState();
if (!state.tokens || !state.claimKey || !state.cancelKey) throw new Error("Run setup first.");
const { TFOX, TUSD, TPTS } = state.tokens;
const contract = contractAddress();
const controller = entrypoint().createSmartContractController(abi());
const transfers = entrypoint().createTransfersController();

/** Query values come back as BigNumber, whose toString() may use exponents. */
const big = (value: { toFixed?: () => string; toString(): string }) =>
  BigInt(value.toFixed ? value.toFixed() : value.toString());

async function view(id: bigint) {
  const [v] = await controller.query({ contract, function: "getVesting", arguments: [id] });
  return {
    claimNonce: big(v.vesting.claim_nonce),
    cancelNonce: big(v.vesting.cancel_nonce),
    total: big(v.vesting.total),
    claimed: big(v.claimed),
    cancelledAt: big(v.cancelled_at),
    vested: big(v.vested),
    finalAmount: big(v.final_amount),
    refunded: big(v.refunded),
  };
}

async function balance(address: Address, token: string): Promise<bigint> {
  if (token === "EGLD") {
    const account = await (await fetch(`${api()}/accounts/${address.toBech32()}`)).json();
    return BigInt(account.balance);
  }
  const response = await fetch(`${api()}/accounts/${address.toBech32()}/tokens/${token}`);
  return response.status === 404 ? 0n : BigInt((await response.json()).balance);
}

async function holdsNft(address: Address, collection: string, nonce: bigint): Promise<boolean> {
  const hex = nonce.toString(16).padStart(2, "0");
  const response = await fetch(`${api()}/accounts/${address.toBech32()}/nfts/${collection}-${hex}`);
  return response.ok;
}

async function surplus(token: string): Promise<bigint> {
  const [value] = await controller.query({ contract, function: "getSurplus", arguments: [token] });
  return big(value);
}

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) throw new Error(`Check failed: ${label} ${detail}`);
}

/**
 * `create(beneficiary, total, schedule, cancelable, label)`, where `args` is
 * everything but the total: the total is the payment, and the current fee is
 * added on top (in EGLD).
 */
async function create(
  step: string,
  from: typeof owner,
  args: [unknown, ...unknown[]],
  payment: TokenTransfer,
): Promise<bigint> {
  const [fee] = await controller.query({ contract, function: "getFee", arguments: [] });
  const feeAmount = big(fee);
  const isEgld = payment.token.identifier === "EGLD-000000";
  const transfers = isEgld
    ? [TokenTransfer.newFromNativeAmount(payment.amount + feeAmount)]
    : feeAmount > 0n
      ? [payment, TokenTransfer.newFromNativeAmount(feeAmount)]
      : [payment];
  const tx = await controller.createTransactionForExecute(from, from.getNonceThenIncrement(), {
    contract,
    function: "create",
    arguments: [args[0], payment.amount, ...args.slice(1)],
    tokenTransfers: transfers,
  });
  const result = await send(step, tx);
  const [id] = await createdIds(result.hash);
  if (id === undefined) throw new Error(`${step}: no vestingCreated event in ${result.hash}`);
  return id;
}

async function claim(step: string, from: typeof owner, nonces: bigint[], expectFailure = false) {
  const tx = await controller.createTransactionForExecute(from, from.getNonceThenIncrement(), {
    contract,
    function: "claim",
    arguments: [],
    tokenTransfers: nonces.map(
      (nonce) => new TokenTransfer({ token: new Token({ identifier: state.claimKey!, nonce }), amount: 1n }),
    ),
    // A claim that must fail cannot be simulated: give it a fixed limit.
    ...(expectFailure ? { gasLimit: 15_000_000n } : {}),
  });
  return send(step, tx, { expectFailure });
}

const now = BigInt(Math.floor(Date.now() / 1000));
// `pnpm tsx src/flow.ts more` runs only steps 8 to 10.
const section = process.argv[2] ?? "all";

if (section !== "more") {
// 1. 3000 TFOX, linear, started a day ago, ends in two days, cancelable.
const total = amount(3_000n, 18);
const linear = { start: now - DAY, cliff: now - DAY, cliff_amount: 0n, end: now + 2n * DAY, curve: "Linear" };
const id = await create(
  "create TFOX linear (cancelable, start in the past)",
  owner,
  [owner.address, linear, true, "m1 devnet run"],
  new TokenTransfer({ token: new Token({ identifier: TFOX }), amount: total }),
);
let v = await view(id);
console.log(`vesting ${id}: claim key nonce ${v.claimNonce}, cancel key nonce ${v.cancelNonce}`);
check("claim key at the beneficiary", await holdsNft(owner.address, state.claimKey, v.claimNonce));
check("cancel key at the creator", await holdsNft(owner.address, state.cancelKey, v.cancelNonce));
check("about a third vested at once", v.vested > total / 3n - total / 100n && v.vested < total / 3n + total / 100n, `${v.vested}`);

// 2. The beneficiary claims.
let before = await balance(owner.address, TFOX);
await claim("claim as beneficiary", owner, [v.claimNonce]);
let after = await balance(owner.address, TFOX);
v = await view(id);
check("paid exactly what the view says was claimed", after - before === v.claimed, `${after - before}`);
check("key returned with the same nonce", await holdsNft(owner.address, state.claimKey, v.claimNonce));

// 3. The claim key moves to another wallet (a different shard).
const move = await transfers.createTransactionForTransfer(owner, owner.getNonceThenIncrement(), {
  receiver: holder.address,
  tokenTransfers: [
    new TokenTransfer({ token: new Token({ identifier: state.claimKey, nonce: v.claimNonce }), amount: 1n }),
  ],
});
await send("move claim key to the second wallet", move);
check("new holder has the key", await holdsNft(holder.address, state.claimKey, v.claimNonce));

// 4. The old holder can no longer claim.
await claim("old holder tries to claim (must fail)", owner, [v.claimNonce], true);

// 5. The new holder claims.
const claimedBefore = v.claimed;
before = await balance(holder.address, TFOX);
await claim("claim as new holder", holder, [v.claimNonce]);
after = await balance(holder.address, TFOX);
v = await view(id);
check("new holder paid the newly vested part", after - before === v.claimed - claimedBefore, `${after - before}`);

// 6. The creator cancels: the unvested rest comes back.
before = await balance(owner.address, TFOX);
const cancel = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
  contract,
  function: "cancel",
  arguments: [],
  tokenTransfers: [
    new TokenTransfer({ token: new Token({ identifier: state.cancelKey, nonce: v.cancelNonce }), amount: 1n }),
  ],
});
await send("cancel", cancel);
after = await balance(owner.address, TFOX);
v = await view(id);
check("refund is total minus vested at the cancel", after - before === v.refunded && v.refunded === total - v.finalAmount, `${v.refunded}`);
check("cancel key burned", !(await holdsNft(owner.address, state.cancelKey, v.cancelNonce)));

// 7. The holder claims what had vested; the key burns.
before = await balance(holder.address, TFOX);
await claim("final claim after the cancel", holder, [v.claimNonce]);
after = await balance(holder.address, TFOX);
v = await view(id);
check("beneficiary side got exactly what had vested", v.claimed === v.finalAmount, `${v.claimed}`);
check("everything accounted for", v.claimed + v.refunded === total);
check("claim key burned", !(await holdsNft(holder.address, state.claimKey, v.claimNonce)));
check("no TFOX surplus in the contract", (await surplus(TFOX)) === 0n);
}

// 8. EGLD: 0.6 xEGLD in hourly steps over a day that began 6 hours ago.
const egldId = await create(
  "create EGLD stepped (not cancelable)",
  owner,
  [holder.address, { start: now - 6n * 3_600n, cliff: now - 6n * 3_600n, cliff_amount: 0n, end: now + 18n * 3_600n, curve: { name: "Stepped", fields: { interval: 3_600n } } }, false, "egld steps"],
  TokenTransfer.newFromNativeAmount((EGLD * 6n) / 10n),
);
let v = await view(egldId);
check("a quarter vested (6 of 24 steps)", v.vested === (EGLD * 6n) / 10n / 4n, `${v.vested}`);
await claim("claim EGLD", holder, [v.claimNonce]);
check("no EGLD surplus in the contract", (await surplus("EGLD-000000")) === 0n);

// 9. TUSD (6 decimals): explicit monthly-style tranches, the first one already due.
const tusd = amount(1_000n, 6);
const tranchesId = await create(
  "create TUSD explicit tranches",
  owner,
  [holder.address, { start: now - DAY, cliff: now - DAY, cliff_amount: 0n, end: now + 60n * DAY, curve: { name: "Tranches", fields: { 0: [{ time: now - DAY, amount: tusd / 4n }, { time: now + 30n * DAY, amount: tusd / 4n }, { time: now + 60n * DAY, amount: tusd / 2n }] } } }, false, "tranches"],
  new TokenTransfer({ token: new Token({ identifier: TUSD }), amount: tusd }),
);
v = await view(tranchesId);
check("first tranche claimable", v.vested === tusd / 4n, `${v.vested}`);

// 10. TPTS (0 decimals): cliff equal to the total, already passed.
const ptsId = await create(
  "create TPTS cliff = total",
  owner,
  [holder.address, { start: now - 2n * DAY, cliff: now - DAY, cliff_amount: 7n, end: now + DAY, curve: "Linear" }, false, "cliff all"],
  new TokenTransfer({ token: new Token({ identifier: TPTS }), amount: 7n }),
);
const ptsView = await view(ptsId);
check("all 7 points claimable", ptsView.vested === 7n);
await claim("claim TUSD and TPTS together", holder, [v.claimNonce, ptsView.claimNonce]);
check("TPTS paid", (await balance(holder.address, TPTS)) >= 7n);
check("no surplus in TUSD or TPTS", (await surplus(TUSD)) === 0n && (await surplus(TPTS)) === 0n);

console.log("acceptance run passed");
