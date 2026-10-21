// Version 3's devnet rehearsal (docs/DEPLOY.md): claims with a chosen devnet
// key and reads back what the claim key shows, the stamp version 3 writes at
// each claim that pays (its name and attributes; its URIs must not change).
//
//   pnpm tsx src/v3-rehearsal.ts key <nonce>...
//   pnpm tsx src/v3-rehearsal.ts claim <owner|holder> <nonce>...
//
// `key` only reads. `claim` sends one claim of the given claim keys from that
// devnet wallet and prints its gas and the keys afterwards. Devnet only:
// signer() refuses mainnet.

import { Token, TokenTransfer } from "@multiversx/sdk-core";
import { abi, api, contractAddress, entrypoint, loadState, network, send, signer } from "./lib.js";

if (network() !== "devnet") throw new Error("The rehearsal runs on devnet only (MVXVEST_NETWORK=devnet).");
const state = loadState();
if (!state.claimKey) throw new Error("No claim key collection in scripts/state/devnet.json.");
const [command, ...rest] = process.argv.slice(2);

const hexNonce = (nonce: bigint) => {
  const hex = nonce.toString(16);
  return hex.length % 2 ? `0${hex}` : hex;
};

/** The claim key as the devnet API shows it (null once burned). */
async function key(nonce: bigint) {
  const id = `${state.claimKey}-${hexNonce(nonce)}`;
  const response = await fetch(`${api()}/nfts/${id}?fields=identifier,name,attributes,uris,creator,owner`);
  if (response.status === 404) return { id, burned: true };
  const nft = (await response.json()) as { name?: string; attributes?: string; uris?: string[]; creator?: string; owner?: string };
  return {
    id,
    name: nft.name,
    attributes: Buffer.from(nft.attributes ?? "", "base64").toString(),
    uris: (nft.uris ?? []).map((u) => Buffer.from(u, "base64").toString()),
    creator: nft.creator,
    owner: nft.owner,
  };
}

const nonces = (args: string[]) => {
  if (!args.length || !args.every((a) => /^\d+$/.test(a))) throw new Error("Give claim key nonces (decimal).");
  return args.map(BigInt);
};

if (command === "key") {
  for (const nonce of nonces(rest)) console.log(JSON.stringify(await key(nonce), null, 2));
} else if (command === "claim") {
  const [who, ...list] = rest;
  if (who !== "owner" && who !== "holder") throw new Error("Claim as owner or holder.");
  const from = await signer(who);
  const controller = entrypoint().createSmartContractController(abi());
  const tx = await controller.createTransactionForExecute(from, from.getNonceThenIncrement(), {
    contract: contractAddress(),
    function: "claim",
    arguments: [],
    tokenTransfers: nonces(list).map(
      (nonce) => new TokenTransfer({ token: new Token({ identifier: state.claimKey!, nonce }), amount: 1n }),
    ),
  });
  const result = await send(`claim ${list.join(" ")} as ${who}`, tx);
  console.log(`claim ${result.hash}`);
  // The API indexes the stamp a few seconds after the transaction.
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  for (const nonce of nonces(list)) console.log(JSON.stringify(await key(nonce), null, 2));
} else {
  throw new Error("Commands: key <nonce>..., claim <owner|holder> <nonce>...");
}
