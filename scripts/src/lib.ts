// Shared helpers for the deploy and interaction scripts: network, keys, ABI,
// sending transactions and recording what happened.
//
// Keys never live in the repo. Devnet and testnet keys are read from
// ~/.config/mvxvest/<network>/<name>.pem (or MVXVEST_PEM). On mainnet only the
// deployer key loads, for the one-time deploy and setup (see signer()).

import {
  Abi,
  Account,
  Address,
  DevnetEntrypoint,
  MainnetEntrypoint,
  NetworkEntrypoint,
  TestnetEntrypoint,
  Transaction,
} from "@multiversx/sdk-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CONTRACT_OUTPUT = join(ROOT, "contracts/vesting/output");

export type Network = "devnet" | "testnet" | "mainnet";

const NETWORKS: Record<Network, { api: string; explorer: string }> = {
  devnet: {
    api: "https://devnet-api.multiversx.com",
    explorer: "https://devnet-explorer.multiversx.com",
  },
  testnet: {
    api: "https://testnet-api.multiversx.com",
    explorer: "https://testnet-explorer.multiversx.com",
  },
  mainnet: {
    api: "https://api.multiversx.com",
    explorer: "https://explorer.multiversx.com",
  },
};

export const EGLD = 10n ** 18n;

export function network(): Network {
  const value = process.env.MVXVEST_NETWORK ?? "devnet";
  if (value !== "devnet" && value !== "testnet" && value !== "mainnet") {
    throw new Error(`MVXVEST_NETWORK must be devnet, testnet or mainnet, not ${value}`);
  }
  return value;
}

export function api(): string {
  return NETWORKS[network()].api;
}

export function explorerTx(hash: string): string {
  return `${NETWORKS[network()].explorer}/transactions/${hash}`;
}

/**
 * Calls made without an explicit gas limit are simulated by the network and
 * get 1.2 times the estimate: providing far more gas than used is charged in
 * full ("too much gas provided"), as the first devnet run showed.
 */
export function entrypoint(): NetworkEntrypoint {
  const options = { clientName: "mvxvest-scripts", withGasLimitEstimator: true, gasLimitMultiplier: 1.2 };
  switch (network()) {
    case "devnet":
      return new DevnetEntrypoint(options);
    case "testnet":
      return new TestnetEntrypoint(options);
    case "mainnet":
      return new MainnetEntrypoint(options);
  }
}

export function abi(): Abi {
  const json = JSON.parse(readFileSync(join(CONTRACT_OUTPUT, "mvxvest.abi.json"), "utf8"));
  return Abi.create(json);
}

/**
 * Loads a signing key. On mainnet only the single-purpose "deployer" wallet,
 * and only with MVXVEST_MAINNET_GO=yes for that run: it deploys and sets up
 * the contract, then hands ownership to the multisig (src/mainnet.ts). Every
 * later owner action is a multisig proposal.
 */
export async function signer(name: string): Promise<Account> {
  const net = network();
  if (net === "mainnet" && (name !== "deployer" || process.env.MVXVEST_MAINNET_GO !== "yes")) {
    throw new Error(
      "On mainnet only the deployer key signs, and only with MVXVEST_MAINNET_GO=yes (src/mainnet.ts); owner actions go through the multisig.",
    );
  }
  const path = process.env.MVXVEST_PEM ?? join(homedir(), ".config/mvxvest", net, `${name}.pem`);
  const account = await Account.newFromPem(path);
  account.nonce = await entrypoint().recallAccountNonce(account.address);
  return account;
}

// ------------------------------------------------------------------ state

const STATE_DIR = join(ROOT, "scripts/state");

export interface State {
  contract?: string;
  claimKey?: string;
  cancelKey?: string;
  tokens?: Record<string, string>;
  /** Transaction that removed ESDTRoleBurnForAll, per key kind. */
  burnDisabled?: Partial<Record<"Claim" | "Cancel", string>>;
  runs?: RunRecord[];
}

export interface RunRecord {
  step: string;
  hash: string;
  status: string;
  gasLimit: string;
  gasUsed?: number;
  fee?: string;
  note?: string;
  at: string;
}

function statePath(): string {
  return join(STATE_DIR, `${network()}.json`);
}

export function loadState(): State {
  return existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), "utf8")) : {};
}

export function saveState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
}

export function contractAddress(): Address {
  const state = loadState();
  if (!state.contract) throw new Error(`No contract in ${statePath()}: run deploy first.`);
  return Address.newFromBech32(state.contract);
}

// --------------------------------------------------------------- sending

interface ApiTransaction {
  status: string;
  gasUsed?: number;
  fee?: string;
  results?: { returnMessage?: string }[];
  logs?: { events?: { identifier: string; topics?: string[]; data?: string }[] };
}

/**
 * The API's view of a transaction once it and all its results are final, with
 * its gas used. Polls patiently (up to 10 minutes): the SDK's own waiter gives
 * up sooner, and a timeout says nothing about whether a transaction failed.
 */
export async function fetchFinal(hash: string): Promise<ApiTransaction> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await fetch(`${api()}/transactions/${hash}?withResults=true`);
    if (response.ok) {
      const body = (await response.json()) as ApiTransaction & { pendingResults?: boolean };
      if (body.status !== "pending" && !body.pendingResults) return body;
    }
    await new Promise((done) => setTimeout(done, 3_000));
  }
  throw new Error(`Transaction ${hash} still pending after 10 minutes: check it on the explorer before retrying`);
}

/**
 * Sends a signed transaction, waits until it and all its results are final,
 * records it, and returns the API's view. Throws if it failed, unless
 * `expectFailure` is set.
 */
export async function send(
  step: string,
  tx: Transaction,
  options: { expectFailure?: boolean; note?: string } = {},
): Promise<ApiTransaction & { hash: string }> {
  const hash = await entrypoint().sendTransaction(tx);
  console.log(`${step}: ${explorerTx(hash)}`);
  const final = await fetchFinal(hash);
  const state = loadState();
  state.runs = [
    ...(state.runs ?? []),
    {
      step,
      hash,
      status: final.status,
      gasLimit: tx.gasLimit.toString(),
      gasUsed: final.gasUsed,
      fee: final.fee,
      note: options.note,
      at: new Date().toISOString(),
    },
  ];
  saveState(state);
  const failed = final.status !== "success";
  console.log(`  ${final.status}, gas used ${final.gasUsed ?? "?"} of ${tx.gasLimit}, fee ${final.fee ?? "?"}`);
  if (failed && !options.expectFailure) {
    const reason = final.results?.map((r) => r.returnMessage).filter(Boolean).join("; ");
    throw new Error(`${step} failed: ${reason || final.status} (${explorerTx(hash)})`);
  }
  if (!failed && options.expectFailure) {
    throw new Error(`${step} was expected to fail but succeeded (${explorerTx(hash)})`);
  }
  return { ...final, hash };
}

/**
 * Ids of the vestings a transaction created, from the contract's
 * `vestingCreated` events (the SDK's return-value parser fails on cross-shard
 * transactions with several log entries).
 */
export async function createdIds(hash: string): Promise<bigint[]> {
  const body = (await (await fetch(`${api()}/transactions/${hash}?withLogs=true&withResults=true`)).json()) as {
    logs?: { events?: { topics?: string[] }[] };
    results?: { logs?: { events?: { topics?: string[] }[] } }[];
  };
  const events = [...(body.logs?.events ?? []), ...(body.results ?? []).flatMap((r) => r.logs?.events ?? [])];
  const ids = new Set<bigint>();
  for (const event of events) {
    const [name, id] = event.topics ?? [];
    if (name && Buffer.from(name, "base64").toString() === "vestingCreated" && id !== undefined) {
      const hex = Buffer.from(id, "base64").toString("hex");
      ids.add(hex ? BigInt(`0x${hex}`) : 0n);
    }
  }
  return [...ids].sort((a, b) => (a < b ? -1 : 1));
}

/** The network's record of a final transaction, for the SDK's parsers. */
export async function onNetwork(hash: string) {
  return entrypoint().getTransaction(hash);
}

export function amount(units: bigint, decimals: number): bigint {
  return units * 10n ** BigInt(decimals);
}
