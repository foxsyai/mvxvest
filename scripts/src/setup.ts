// One-time setup after a deploy on devnet or testnet: issues the two key
// collections through the contract, sets how keys look, and issues test
// tokens with 0, 6 and 18 decimals. Skips whatever is already done.
//
//   pnpm tsx src/setup.ts

import { EGLD, abi, amount, contractAddress, entrypoint, loadState, network, saveState, send, signer } from "./lib.js";

const ISSUE_COST = EGLD / 20n;
const owner = await signer("owner");
const contract = contractAddress();
const controller = entrypoint().createSmartContractController(abi());

async function collection(view: string): Promise<string> {
  const [value] = await controller.query({ contract, function: view, arguments: [] });
  return value?.toString() ?? "";
}

for (const [endpoint, view, name, ticker, field] of [
  ["issueClaimKey", "getClaimKeyCollection", "MvxVestClaimKey", "VESTKEY", "claimKey"],
  ["issueCancelKey", "getCancelKeyCollection", "MvxVestCancelKey", "VESTCANCEL", "cancelKey"],
] as const) {
  let id = await collection(view);
  if (!id) {
    const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
      contract,
      function: endpoint,
      arguments: [name, ticker],
      nativeTransferAmount: ISSUE_COST,
      gasLimit: 100_000_000n,
    });
    await send(endpoint, tx);
    id = await collection(view);
    if (!id) throw new Error(`${endpoint} completed but ${view} is still empty`);
  }
  saveState({ ...loadState(), [field]: id });
  console.log(`${field}: ${id}`);
}

// How keys look. Devnet points at placeholder images on devnet.mvxvest.io.
const site = network() === "devnet" ? "https://devnet.mvxvest.io" : "https://mvxvest.io";
for (const [kind, file] of [
  ["Claim", "claim-key"],
  ["Cancel", "cancel-key"],
] as const) {
  // PNG first: wallets show the first URI, and not all of them render SVG.
  const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
    contract,
    function: "setKeyDisplay",
    arguments: [kind, "", `${site}/nft/${file}.png`, `${site}/nft/${file}.svg`],
    gasLimit: 10_000_000n,
  });
  await send(`setKeyDisplay ${kind}`, tx);
}

// Test tokens, owned by the owner wallet. The factory adds the issue cost.
const tokens = { ...(loadState().tokens ?? {}) };
const management = entrypoint().createTokenManagementController();
for (const [ticker, decimals] of [
  ["TFOX", 18],
  ["TUSD", 6],
  ["TPTS", 0],
] as const) {
  if (tokens[ticker]) continue;
  const tx = await management.createTransactionForIssuingFungible(owner, owner.getNonceThenIncrement(), {
    tokenName: `Mvxvest${ticker}`,
    tokenTicker: ticker,
    initialSupply: amount(1_000_000_000n, decimals),
    numDecimals: BigInt(decimals),
    canFreeze: false,
    canWipe: false,
    canPause: false,
    canChangeOwner: false,
    canUpgrade: false,
    canAddSpecialRoles: false,
    gasLimit: 60_000_000n,
  });
  const result = await send(`issue ${ticker}`, tx);
  const [issued] = await management.awaitCompletedIssueFungible(result.hash);
  tokens[ticker] = issued.tokenIdentifier;
  saveState({ ...loadState(), tokens });
  console.log(`${ticker}: ${issued.tokenIdentifier}`);
}

// Gas money for the second wallet, which plays the new holder of a claim key.
const holder = await signer("holder");
const balance = BigInt((await entrypoint().createNetworkProvider().getAccount(holder.address)).balance);
if (balance < EGLD / 2n) {
  const transfers = entrypoint().createTransfersController();
  const tx = await transfers.createTransactionForTransfer(owner, owner.getNonceThenIncrement(), {
    receiver: holder.address,
    nativeAmount: EGLD,
  });
  await send("fund holder", tx);
}
console.log("setup done");
