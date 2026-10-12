// One-time setup after a deploy on devnet or testnet: issues the two key
// collections through the contract, sets how keys look, and issues test
// tokens with 0, 6 and 18 decimals. Skips whatever is already done.
//
//   pnpm tsx src/setup.ts

import { EGLD, abi, amount, api, contractAddress, entrypoint, loadState, network, onNetwork, saveState, send, signer } from "./lib.js";

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

// Holders must not be able to burn keys: a burned claim key would lock its
// vesting forever. New collections get ESDTRoleBurnForAll by default. (The
// API's collection roles lag behind: the proof is the system contract's
// ESDTUnSetBurnRoleForAll event, and a holder's burn being refused.)
async function unsetEventFound(hash: string, collection: string): Promise<boolean> {
  const body = (await (await fetch(`${api()}/transactions/${hash}?withLogs=true&withResults=true`)).json()) as {
    logs?: { events?: { identifier: string; topics?: string[] }[] };
    results?: { logs?: { events?: { identifier: string; topics?: string[] }[] } }[];
  };
  const events = [...(body.logs?.events ?? []), ...(body.results ?? []).flatMap((r) => r.logs?.events ?? [])];
  return events.some(
    (e) =>
      e.identifier === "ESDTUnSetBurnRoleForAll" &&
      Buffer.from(e.topics?.[0] ?? "", "base64").toString() === collection,
  );
}
for (const [kind, field] of [
  ["Claim", "claimKey"],
  ["Cancel", "cancelKey"],
] as const) {
  const state = loadState();
  const collection = state[field]!;
  const done = state.burnDisabled?.[kind];
  if (!done) {
    const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
      contract,
      function: "disableKeyBurnByHolders",
      arguments: [kind],
      // The ESDT system contract charges 50M and then notifies every shard.
      gasLimit: 100_000_000n,
    });
    const result = await send(`disableKeyBurnByHolders ${kind}`, tx);
    if (!(await unsetEventFound(result.hash, collection))) {
      throw new Error(`${collection}: no ESDTUnSetBurnRoleForAll event in ${result.hash}`);
    }
    saveState({ ...loadState(), burnDisabled: { ...loadState().burnDisabled, [kind]: result.hash } });
  }
  console.log(`${collection}: holders cannot burn keys (${loadState().burnDisabled![kind]})`);
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
  const [issued] = management.parseIssueFungible(await onNetwork(result.hash));
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
