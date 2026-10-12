// Sets up a devnet wallet to try the dApp by hand: test tokens to create with,
// and four vestings that show every state a beneficiary meets.
//
//   pnpm tsx src/tester.ts erd1...
//
// 1. Claim now: TFOX vesting linearly, a third of it already vested.
// 2. Monthly: TUSD in six monthly releases, two of them already due, which the
//    creator (our owner wallet) can still cancel.
// 3. Cancelled: TFOX the creator cancelled at once; what had vested stays
//    claimable.
// 4. Yours to cancel: a cancelable TFOX vesting for our holder wallet whose
//    cancel key is sent to the tester, to try Cancel from its page.
//
// Devnet only (signer() refuses mainnet). Every step is checked on chain.

import { Address, Token, TokenTransfer } from "@multiversx/sdk-core";
import { abi, amount, contractAddress, createdIds, entrypoint, loadState, network, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("tester.ts is for devnet only.");
const target = process.argv[2];
if (!target || !Address.isValid(target) || Address.newFromBech32(target).isSmartContract()) {
  throw new Error("Usage: pnpm tsx src/tester.ts <the tester's wallet address, erd1..., not a contract>");
}
const tester = Address.newFromBech32(target);

const DAY = 86_400n;
const now = BigInt(Math.floor(Date.now() / 1000));
const owner = await signer("owner");
const holder = await signer("holder");
const state = loadState();
if (!state.tokens || !state.claimKey || !state.cancelKey) throw new Error("Run setup first.");
const { TFOX, TUSD, TPTS } = state.tokens;
const contract = contractAddress();
const controller = entrypoint().createSmartContractController(abi());
const transfers = entrypoint().createTransfersController();

const big = (value: { toFixed?: () => string; toString(): string }) =>
  BigInt(value.toFixed ? value.toFixed() : value.toString());
const token = (identifier: string, units: bigint) =>
  new TokenTransfer({ token: new Token({ identifier }), amount: units });

/** create(beneficiary, total, schedule, cancelable, label) paid by the owner. */
async function create(step: string, args: [Address, unknown, boolean, string], payment: TokenTransfer) {
  const [fee] = await controller.query({ contract, function: "getFee", arguments: [] });
  const feeAmount = big(fee);
  const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
    contract,
    function: "create",
    arguments: [args[0], payment.amount, ...args.slice(1)],
    tokenTransfers: feeAmount > 0n ? [payment, TokenTransfer.newFromNativeAmount(feeAmount)] : [payment],
  });
  const result = await send(step, tx);
  const [id] = await createdIds(result.hash);
  if (id === undefined) throw new Error(`${step}: no vestingCreated event`);
  const [v] = await controller.query({ contract, function: "getVesting", arguments: [id] });
  return { id, claimNonce: big(v.vesting.claim_nonce), cancelNonce: big(v.vesting.cancel_nonce) };
}

// Tokens to create vestings with.
const fund = await transfers.createTransactionForTransfer(owner, owner.getNonceThenIncrement(), {
  receiver: tester,
  tokenTransfers: [
    token(TFOX, amount(100_000n, 18)),
    token(TUSD, amount(50_000n, 6)),
    token(TPTS, 1_000n),
  ],
});
await send("tokens to the tester: 100,000 TFOX, 50,000 TUSD, 1,000 TPTS", fund);

// 1. Claim now.
const claimNow = await create(
  "vesting 1: TFOX to claim now",
  [tester, { start: now - 60n * DAY, cliff: now - 60n * DAY, cliff_amount: 0n, end: now + 120n * DAY, curve: "Linear" }, false, "Test 1: claim me"],
  token(TFOX, amount(12_000n, 18)),
);

// 2. Monthly, two releases due, cancelable by the creator.
const tusd = amount(6_000n, 6);
const monthly = Array.from({ length: 6 }, (_, i) => ({ time: now + BigInt(i - 2) * 30n * DAY + DAY, amount: tusd / 6n }));
monthly[0].time = now - 60n * DAY;
monthly[1].time = now - 30n * DAY;
const monthlyVesting = await create(
  "vesting 2: TUSD monthly, two releases due",
  [tester, { start: now - 61n * DAY, cliff: now - 61n * DAY, cliff_amount: 0n, end: monthly[5].time, curve: { name: "Tranches", fields: { 0: monthly } } }, true, "Test 2: monthly, cancelable by its creator"],
  token(TUSD, tusd),
);

// 3. Cancelled at once by the creator.
const cancelled = await create(
  "vesting 3: TFOX, to be cancelled",
  [tester, { start: now - 10n * DAY, cliff: now - 10n * DAY, cliff_amount: 0n, end: now + 20n * DAY, curve: "Linear" }, true, "Test 3: cancelled by its creator"],
  token(TFOX, amount(3_000n, 18)),
);
const cancel = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
  contract,
  function: "cancel",
  arguments: [],
  tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: state.cancelKey, nonce: cancelled.cancelNonce }), amount: 1n })],
});
await send("vesting 3: cancelled", cancel);

// 4. The tester holds the cancel key of a vesting for our holder wallet.
const yours = await create(
  "vesting 4: TFOX for another wallet, cancel key to the tester",
  [holder.address, { start: now - DAY, cliff: now - DAY, cliff_amount: 0n, end: now + 30n * DAY, curve: "Linear" }, true, "Test 4: you hold the cancel key"],
  token(TFOX, amount(2_000n, 18)),
);
const keyMove = await transfers.createTransactionForTransfer(owner, owner.getNonceThenIncrement(), {
  receiver: tester,
  tokenTransfers: [new TokenTransfer({ token: new Token({ identifier: state.cancelKey, nonce: yours.cancelNonce }), amount: 1n })],
});
await send("vesting 4: cancel key to the tester", keyMove);

const site = "https://devnet.mvxvest.io";
console.log(`\nReady for ${target}:`);
console.log(`  1. claim now:       ${site}/v/${claimNow.id}`);
console.log(`  2. monthly:         ${site}/v/${monthlyVesting.id}`);
console.log(`  3. cancelled:       ${site}/v/${cancelled.id}`);
console.log(`  4. you can cancel:  ${site}/v/${yours.id}`);
