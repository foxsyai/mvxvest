// Points one kind of key at new images: what keys minted from now on show.
// (Keys already minted keep the URIs they were minted with.)
//
//   pnpm tsx src/display.ts Claim claim-key-2
//
// Devnet and testnet only; on mainnet this is a multisig proposal.

import { abi, contractAddress, entrypoint, network, send, signer } from "./lib.js";

const [kind, file] = process.argv.slice(2);
if ((kind !== "Claim" && kind !== "Cancel") || !file) {
  throw new Error("Usage: pnpm tsx src/display.ts <Claim|Cancel> <file name in dapp/public/nft, without extension>");
}
const site = network() === "devnet" ? "https://devnet.mvxvest.io" : "https://mvxvest.io";
for (const extension of ["png", "svg"]) {
  const response = await fetch(`${site}/nft/${file}.${extension}`, { method: "HEAD" });
  if (!response.ok) throw new Error(`${site}/nft/${file}.${extension} answered ${response.status}: deploy the dApp first`);
}
const owner = await signer("owner");
const controller = entrypoint().createSmartContractController(abi());
const tx = await controller.createTransactionForExecute(owner, owner.getNonceThenIncrement(), {
  contract: contractAddress(),
  function: "setKeyDisplay",
  // PNG first: wallets show the first URI, and not all of them render SVG.
  arguments: [kind, "", `${site}/nft/${file}.png`, `${site}/nft/${file}.svg`],
  gasLimit: 10_000_000n,
});
await send(`setKeyDisplay ${kind} -> ${file}`, tx);
