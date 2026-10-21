// Owner actions on mvxvest through its multisig: the legacy mx-contracts-rs
// multisig that mvxsafe deploys (the mainnet owner erd1...ul78u3 runs exactly
// that code, hash f5658529...). mvxsafe cannot propose contract calls or
// upgrades yet, so this builds them.
//
//   pnpm tsx src/multisig.ts status
//   pnpm tsx src/multisig.ts propose pause | unpause | fee <egld> | tokenfee <bps> | claimfees
//                                   | display <Claim|Cancel> <png url> <svg url>
//                                   | recover-bounced <id> <Claim|Cancel> <erd1 to>
//                                   | recover-surplus <token> <erd1 to>
//                                   | stamping <on|off>
//   pnpm tsx src/multisig.ts propose-upgrade <erd1 source>
//   pnpm tsx src/multisig.ts sign <id> | perform <id> | discard <id>
//   pnpm tsx src/multisig.ts stage          (devnet: deploy the upgrade's source)
//
// Environment: MVXVEST_NETWORK, MVXVEST_MULTISIG (the owner multisig),
// MVXVEST_FROM (the board member who sends it: its gas is simulated with its
// guardian, if any). Each command prints the transaction to send from that
// member's wallet: to the multisig, 0 EGLD, the data and the gas limit.
// On devnet MVXVEST_SEND=<owner|holder> signs it with that devnet key and sends
// it (the rehearsal in docs/DEPLOY.md). Mainnet is never signed here.
//
// An upgrade's source is a copy of the new build deployed IN THE MULTISIG'S
// SHARD (performAction reads its code there) by any wallet. Set
// MVXVEST_EXPECT_HASH to the release's code hash (the reproducible build's):
// propose-upgrade, sign and perform refuse a source with another hash, an
// upgradeable source or one in another shard.
//
// Nothing is signed blind (second audit, red team H1/M1): `status`, `sign`
// and `perform` decode each pending action and say it in words, and `sign`
// and `perform` refuse anything but one of mvxvest's owner calls or an
// upgrade of mvxvest from the release's source with metadata 0500. Use
// mvxsafe.io for the multisig's other actions. Fees take strict values:
// `fee 0.1` (EGLD), `tokenfee 10` (basis points: 10 = 0.1%).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address, Transaction, TransactionComputer } from "@multiversx/sdk-core";
import { blake2b } from "@noble/hashes/blake2b";
import { ROOT, abi, api, contractAddress, entrypoint, network, onNetwork, send, signer } from "./lib.js";

const multisigAddress = process.env.MVXVEST_MULTISIG ?? "";
if (!Address.isValid(multisigAddress)) throw new Error("Set MVXVEST_MULTISIG to the owner multisig's address.");
const multisig = Address.newFromBech32(multisigAddress);
const chainID = network() === "mainnet" ? "1" : network() === "devnet" ? "D" : "T";
const [command, ...rest] = process.argv.slice(2);

/** Upgradeable and readable, not payable: what mvxvest was deployed with. */
const CODE_METADATA = "0500";
/**
 * What the call performAction makes needs on our contract, measured (devnet
 * rehearsal and the mainnet launch: pause 3.78M, setKeyDisplay 5.06M) times
 * ~1.2. An upgrade's need depends on the source's size: see upgradeNeed.
 */
const INNER_GAS: Record<string, bigint> = {
  pauseCreation: 4_600_000n,
  unpauseCreation: 4_600_000n,
  setFee: 4_600_000n,
  setTokenFee: 4_600_000n,
  claimFees: 6_000_000n,
  setKeyDisplay: 6_100_000n,
  recoverBouncedKey: 10_000_000n,
  recoverSurplus: 10_000_000n,
  // Version 3: a storage write and an event, like a pause.
  setKeyStamping: 4_600_000n,
};
/** The fewest and the most arguments each takes (the ABI's; setKeyDisplay's URIs are variadic). */
const ARGUMENTS: Record<string, [number, number]> = {
  pauseCreation: [0, 0],
  unpauseCreation: [0, 0],
  setFee: [1, 1],
  setTokenFee: [1, 1],
  claimFees: [0, 0],
  setKeyDisplay: [2, Infinity],
  recoverBouncedKey: [3, 3],
  recoverSurplus: [2, 3],
  setKeyStamping: [1, 1],
};
/** The contract's caps (contracts/vesting/src/admin.rs): 1 EGLD a vesting, 200 basis points. */
const FEE_CAP = 10n ** 18n;
const TOKEN_FEE_CAP = 200n;
/**
 * An upgrade from source compiles the new code in the contract's shard, at
 * about 300 gas a byte, and runs its `upgrade` (which does nothing in
 * mvxvest): measured by mvxsafe on devnet, 13 Oct 2026, 8,264,045 for the
 * 26,540-byte release. Plus a fifth. (The 106M first assumed worked and was
 * about ten times the need.)
 */
const upgradeNeed = (codeBytes: number) => ((300n * BigInt(codeBytes) + 1_000_000n) * 12n) / 10n;
/**
 * Locked by the network for the multisig's callback when a call leaves its
 * shard: callbacks came back with 6,458,200 on devnet, and a token transfer
 * performed with only 5M for it ran out (mvxsafe's rehearsal, 13 Oct 2026).
 * Without enough, the call fails and the action is used up (an unpause with
 * 8M forwarded failed "not enough gas").
 */
const CALLBACK_GAS = 7_000_000n;
// Mainnet was performed with a 118.5M floor for an upgrade until one had been
// measured there (Sebastian, 14 Oct 2026). The version 2 upgrade measured the
// same as devnet (upgrade 8.50M, callback 3.39M: MAINNET.md), so the budget
// below applies on mainnet too.
/** performAction's own part: 5.9M measured in the devnet rehearsal, x1.27. */
const PERFORM_OWN_GAS = BigInt(process.env.MVXVEST_PERFORM_OWN_GAS ?? "7500000");

const hex = (text: string) => Buffer.from(text).toString("hex");
const u32 = (n: number) => (n === 0 ? "" : n.toString(16).padStart(n.toString(16).length + (n.toString(16).length % 2), "0"));

/** The vesting contract's own encoding of a call: "fn@arg@arg", split. */
async function innerCall(fn: string, args: unknown[]): Promise<string[]> {
  const factory = entrypoint().createSmartContractTransactionsFactory(abi());
  const tx = await factory.createTransactionForExecute(multisig, {
    contract: contractAddress(),
    function: fn,
    arguments: args,
    gasLimit: 1n,
  });
  return Buffer.from(tx.data).toString().split("@");
}

async function proposal(): Promise<{ data: string; perform?: { kind: string; need: bigint } }> {
  if (command === "propose") {
    const [action, ...a] = rest;
    const kind = (k: string) => {
      if (k !== "Claim" && k !== "Cancel") throw new Error(`Kind is Claim or Cancel, not ${k}`);
      return k;
    };
    const calls: Record<string, () => [string, unknown[]]> = {
      pause: () => ["pauseCreation", []],
      unpause: () => ["unpauseCreation", []],
      fee: () => ["setFee", [feeUnits(a[0])]],
      // Version 2: basis points of each vesting's total (10 = 0.1%, 100 = 1%,
      // at most 200). Whole numbers only: "0.1" would be encoded as 0.
      tokenfee: () => ["setTokenFee", [basisPoints(a[0])]],
      claimfees: () => ["claimFees", []],
      // Version 3: whether claims stamp the keys they return (on unless turned off).
      stamping: () => ["setKeyStamping", [onOff(a[0])]],
      display: () => ["setKeyDisplay", [kind(a[0]), "", a[1], a[2]]],
      "recover-bounced": () => ["recoverBouncedKey", [BigInt(a[0]), kind(a[1]), Address.newFromBech32(a[2])]],
      // Version 2: an optional amount, in the token's smallest units.
      "recover-surplus": () => [
        "recoverSurplus",
        a[2] === undefined
          ? [a[0], Address.newFromBech32(a[1])]
          : [a[0], Address.newFromBech32(a[1]), wholeNumber(a[2], "amount")],
      ],
    };
    const make = calls[action];
    if (!make) throw new Error(`Unknown action ${action}: one of ${Object.keys(calls).join(", ")}`);
    const [fn, args] = make();
    console.log(`propose: ${fn}(${args.map((arg) => (arg instanceof Address ? arg.toBech32() : String(arg))).join(", ")})${fn === "setTokenFee" ? ` = ${Number(args[0]) / 100}% of each vesting` : ""}`);
    const [name, ...encoded] = await innerCall(fn, args);
    // proposeAsyncCall(to, egld_amount, function_and_arguments...)
    return { data: ["proposeAsyncCall", contractAddress().toHex(), "", hex(name), ...encoded].join("@") };
  }
  if (command === "propose-upgrade") {
    const source = Address.newFromBech32(rest[0] ?? "");
    // The source is checked before anything is proposed, on every network.
    const facts = await sourceFacts(source.toBech32());
    console.log(describeSource(facts));
    const problems = await sourceProblems(facts);
    if (problems.length) throw new Error(`Not proposed:\n  - ${problems.join("\n  - ")}`);
    // proposeSCUpgradeFromSource(sc_address, amount, source, code_metadata, args...)
    return { data: ["proposeSCUpgradeFromSource", contractAddress().toHex(), "", source.toHex(), CODE_METADATA].join("@") };
  }
  const id = Number(rest[0]);
  if (!Number.isInteger(id) || id < 1) throw new Error("Give the action id.");
  if (command === "discard") return { data: `discardAction@${u32(id)}` };
  // Never a blind signature: what is signed or performed is read from the
  // chain, said in words and checked first (second audit, red team H1, M1).
  const inspection = await inspectAction(id);
  for (const line of inspection.lines) console.log(line);
  if (inspection.problems.length) {
    throw new Error(`REFUSED, do not ${command} action ${id}:\n  - ${inspection.problems.join("\n  - ")}`);
  }
  if (command === "sign") return { data: `sign@${u32(id)}` };
  if (command === "perform") return { data: `performAction@${u32(id)}`, perform: inspection };
  throw new Error(`Unknown command ${command}`);
}

const query = async (funcName: string, args: string[] = [], scAddress = multisig) => {
  const response = await fetch(`${api()}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scAddress: scAddress.toBech32(), funcName, args }),
  });
  return ((await response.json()) as { returnData?: string[] }).returnData ?? [];
};
const num = (b64?: string) => BigInt(`0x${Buffer.from(b64 ?? "", "base64").toString("hex") || "0"}`);

const readNested = (bytes: Buffer, at: number) => {
  const length = bytes.readUInt32BE(at);
  return { value: bytes.subarray(at + 4, at + 4 + length), next: at + 4 + length };
};
const bigOf = (bytes: Buffer) => (bytes.length ? BigInt(`0x${bytes.toString("hex")}`) : 0n);
const bech32Of = (bytes: Buffer) => Address.newFromHex(bytes.toString("hex")).toBech32();

/** "0.1" EGLD as base units, exactly (no floating point). */
function egldUnits(text: string | undefined): bigint {
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text ?? "");
  if (!match) throw new Error(`"${text}" is not an amount of EGLD (for example 0.1).`);
  return BigInt(match[1]) * 10n ** 18n + BigInt((match[2] ?? "").padEnd(18, "0"));
}
function onOff(text: string | undefined): boolean {
  if (text !== "on" && text !== "off") throw new Error(`Stamping is on or off, not "${text}".`);
  return text === "on";
}
function feeUnits(text: string | undefined): bigint {
  const units = egldUnits(text);
  if (units > FEE_CAP) throw new Error(`${egldText(units)} is above the contract's cap of 1 EGLD.`);
  return units;
}
function wholeNumber(text: string | undefined, what: string): bigint {
  if (!/^\d+$/.test(text ?? "")) throw new Error(`The ${what} "${text}" must be a whole number of the token's smallest units.`);
  return BigInt(text!);
}
function basisPoints(text: string | undefined): number {
  if (!/^\d+$/.test(text ?? "")) {
    throw new Error(`"${text}" is not a number of basis points: 10 is 0.1%, 100 is 1% (whole numbers only).`);
  }
  const bps = Number(text);
  if (bps > 200) throw new Error(`${bps} basis points is ${bps / 100}%, above the contract's cap of 2% (200).`);
  return bps;
}
const egldText = (units: bigint) => {
  const whole = units / 10n ** 18n;
  const fraction = (units % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} EGLD`;
};

/** The arguments of an mvxvest owner call, in words. */
function describeArgs(endpoint: string, args: Buffer[]): string {
  const kind = (b?: Buffer) => (bigOf(b ?? Buffer.alloc(0)) === 0n ? "Claim" : "Cancel");
  switch (endpoint) {
    case "setFee":
      return egldText(bigOf(args[0] ?? Buffer.alloc(0)));
    case "setTokenFee": {
      const bps = Number(bigOf(args[0] ?? Buffer.alloc(0)));
      return `${bps} = ${bps / 100}% of each vesting`;
    }
    case "recoverSurplus":
      return [
        args[0]?.toString("latin1"),
        args[1]?.length === 32 ? bech32Of(args[1]) : `?${args[1]?.toString("hex")}`,
        ...(args[2] ? [`${bigOf(args[2])} units`] : ["all of it"]),
      ].join(", ");
    case "recoverBouncedKey":
      return `vesting ${bigOf(args[0] ?? Buffer.alloc(0))}, ${kind(args[1])} key, to ${args[2]?.length === 32 ? bech32Of(args[2]) : "?"}`;
    case "setKeyDisplay":
      return [kind(args[0]), ...args.slice(1).map((b) => JSON.stringify(b.toString("utf8")))].join(", ");
    case "setKeyStamping":
      return bigOf(args[0] ?? Buffer.alloc(0)) === 0n ? "off" : "on";
    default:
      return args.map((b) => `0x${b.toString("hex").slice(0, 40)}${b.length > 20 ? "…" : ""}`).join(", ");
  }
}

/**
 * What the contract would refuse in an owner call, found before two
 * signatures are spent on it: a failed perform uses the action up (fourth
 * audit, OPS-2).
 */
function argumentProblems(endpoint: string, args: Buffer[]): string[] {
  const [least, most] = ARGUMENTS[endpoint] ?? [0, 0];
  if (args.length < least || args.length > most) {
    const takes = least === most ? `${least}` : most === Infinity ? `at least ${least}` : `${least} or ${most}`;
    return [`${endpoint} takes ${takes} argument(s), not ${args.length}: the contract would refuse it and the action would be used up`];
  }
  const problems: string[] = [];
  const refused = (what: string) => problems.push(`${what}: the contract would refuse it and the action would be used up`);
  const isKind = (b: Buffer) => b.length === 0 || (b.length === 1 && b[0] === 1);
  if (endpoint === "setFee" && bigOf(args[0]) > FEE_CAP) refused(`${egldText(bigOf(args[0]))} is above the cap of 1 EGLD`);
  if (endpoint === "setTokenFee" && bigOf(args[0]) > TOKEN_FEE_CAP) refused(`${bigOf(args[0])} basis points is above the cap of 200 (2%)`);
  if ((endpoint === "setKeyDisplay" && !isKind(args[0])) || (endpoint === "recoverBouncedKey" && !isKind(args[1]))) {
    refused("the key kind is neither Claim (0) nor Cancel (1)");
  }
  if (endpoint === "recoverBouncedKey" && args[0].length > 8) refused("the vesting id is longer than a u64");
  if (endpoint === "setKeyStamping" && !isKind(args[0])) refused("the value is not a bool (on 1, off 0)");
  if ((endpoint === "recoverBouncedKey" && args[2].length !== 32) || (endpoint === "recoverSurplus" && args[1].length !== 32)) {
    refused("the recipient is not an address");
  }
  return problems;
}

/**
 * Whom a bounced key was made for, read from its vesting: the beneficiary
 * for a claim key, the creator for a cancel key. A second signer sees when
 * the proposed recipient is someone else (fourth audit, OPS-1); a later
 * holder can own the key too, and the transaction that bounced it says so.
 */
async function bouncedKeyOwner(args: Buffer[]): Promise<{ lines: string[]; problems: string[] }> {
  const id = bigOf(args[0]);
  const [view] = await query("getVesting", [args[0].toString("hex")], contractAddress());
  // VestingView: id (u64), then the vesting's creator and beneficiary.
  const bytes = Buffer.from(view ?? "", "base64");
  if (bytes.length < 72) return { lines: [], problems: [`vesting ${id} could not be read (the contract refuses an unknown vesting); try again`] };
  const claim = bigOf(args[1]) === 0n;
  const role = claim ? "beneficiary" : "creator";
  const owner = bech32Of(claim ? bytes.subarray(40, 72) : bytes.subarray(8, 40));
  const to = bech32Of(args[2]);
  const lines = [`  the ${claim ? "claim" : "cancel"} key of vesting ${id} was made for its ${role} ${owner}`];
  if (to !== owner) {
    lines.push(`  WARNING: the recipient ${to} is not that ${role}: sign only if the transaction that bounced the key shows ${to} held it`);
  }
  return { lines, problems: [] };
}

interface SourceFacts {
  address: string;
  /** blake2b-256 of the code the API returned: what the source holds. */
  hash: string;
  /** The code hash the API states for the account. */
  label: string;
  bytes: number;
  shard?: number;
  /** Undefined when the API's answer does not say. */
  upgradeable?: boolean;
}
async function sourceFacts(address: string): Promise<SourceFacts> {
  const account = (await (await fetch(`${api()}/accounts/${address}`)).json()) as {
    code?: string;
    codeHash?: string;
    shard?: number;
    isUpgradeable?: boolean;
  };
  // The code is hashed here, not taken from the API's label: a wrong or
  // tampered answer could label any code as the release (fourth audit, RT2).
  const code = Buffer.from(account.code ?? "", "hex");
  return {
    address,
    hash: code.length ? Buffer.from(blake2b(code, { dkLen: 32 })).toString("hex") : "",
    label: account.codeHash ? Buffer.from(account.codeHash, "base64").toString("hex") : "",
    bytes: code.length,
    shard: account.shard,
    // A missing field is not "frozen" (fourth audit, OPS-3).
    upgradeable: typeof account.isUpgradeable === "boolean" ? account.isUpgradeable : undefined,
  };
}
const describeSource = (f: SourceFacts) =>
  `  source ${f.address}: code hash ${f.hash || "(none)"}, ${f.bytes} bytes, shard ${f.shard ?? "?"}, ${f.upgradeable === undefined ? "upgradeable or not: unknown" : f.upgradeable ? "UPGRADEABLE" : "not upgradeable"}`;

/**
 * What must hold of an upgrade's source: the release's code (MVXVEST_EXPECT_HASH,
 * from the reproducible build), not upgradeable (nobody can change it before
 * the perform), and in the multisig's shard (performAction reads it there).
 */
async function sourceProblems(f: SourceFacts): Promise<string[]> {
  const problems: string[] = [];
  const expected = (process.env.MVXVEST_EXPECT_HASH ?? "").toLowerCase();
  if (!f.label && !f.hash) problems.push(`the source ${f.address} holds no code`);
  // The upgrade's gas is budgeted from the code's size: without the code the
  // budget would silently fall to about 15.7M and the perform could fail,
  // using the action up (third audit, C3).
  else if (!f.hash) problems.push(`the API did not return the source's code, so its hash and size (and the upgrade's gas) are unknown; try again`);
  else if (f.label !== f.hash) {
    problems.push(`the API states code hash ${f.label || "(none)"} for the source, but the code it returned hashes to ${f.hash}: do not trust this answer`);
  }
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    problems.push("MVXVEST_EXPECT_HASH is not set to the release's code hash (64 hex characters), so the source cannot be checked");
  } else if (f.hash !== expected) {
    problems.push(`the source's code hash ${f.hash} is not the release's ${expected}`);
  }
  if (f.upgradeable === undefined) {
    problems.push("the API did not say whether the source is upgradeable, so its code could change before the upgrade is carried out; try again");
  } else if (f.upgradeable) problems.push("the source is upgradeable: its code could change before the upgrade is carried out");
  const multisigShard = ((await (await fetch(`${api()}/accounts/${multisig.toBech32()}`)).json()) as { shard?: number }).shard;
  if (f.shard === undefined || f.shard !== multisigShard) {
    problems.push(`the source is in shard ${f.shard ?? "?"}, not the multisig's shard ${multisigShard ?? "?"}: the upgrade would fail and use the action up`);
  }
  return problems;
}

interface Inspection {
  /** What the action does, in words. */
  lines: string[];
  /** Why it must not be signed or performed; empty when it may. */
  problems: string[];
  /** What the call it makes needs, for the perform's gas. */
  need: bigint;
  kind: string;
}

/**
 * Pending action `id`, decoded from the legacy multisig's Action enum
 * (5 SendTransferExecute, 6 SendAsyncCall, 7 SCDeployFromSource,
 * 8 SCUpgradeFromSource) and checked against what this tool is for: one of
 * mvxvest's owner calls, or an upgrade of mvxvest from the release's source.
 * Anything else is refused; mvxsafe.io handles the multisig's other actions.
 */
async function inspectAction(id: number): Promise<Inspection> {
  const [raw] = await query("getActionData", [u32(id).padStart(2, "0")]);
  const bytes = Buffer.from(raw ?? "", "base64");
  if (bytes.length === 0) throw new Error(`No pending action ${id}`);
  const mvxvest = contractAddress().toBech32();
  const problems: string[] = [];
  try {
    if (bytes[0] === 6) {
      // SendAsyncCall(CallActionData { to, egld_amount, endpoint_name, arguments })
      const to = bech32Of(bytes.subarray(1, 33));
      let at = 33;
      const egld = readNested(bytes, at);
      at = egld.next;
      const endpoint = readNested(bytes, at);
      at = endpoint.next;
      const count = bytes.readUInt32BE(at);
      at += 4;
      const args: Buffer[] = [];
      for (let i = 0; i < count; i++) {
        const arg = readNested(bytes, at);
        args.push(arg.value);
        at = arg.next;
      }
      const name = endpoint.value.toString("latin1");
      if (to !== mvxvest) problems.push(`it calls ${to}, not the vesting contract ${mvxvest}`);
      if (bigOf(egld.value) !== 0n) problems.push(`it sends ${egldText(bigOf(egld.value))} with the call`);
      if (!(name in INNER_GAS)) {
        problems.push(
          `"${name}" is not one of mvxvest's owner calls (${Object.keys(INNER_GAS).join(", ")}): an upgrade or an owner change must never come as a plain call`,
        );
      }
      if (at !== bytes.length) problems.push("the action holds bytes this tool does not understand");
      problems.push(...argumentProblems(name, args));
      const lines = [`action #${id}: call ${name}(${describeArgs(name, args)}) on ${to}`];
      if (name === "recoverBouncedKey" && !problems.length) {
        const owner = await bouncedKeyOwner(args);
        lines.push(...owner.lines);
        problems.push(...owner.problems);
      }
      return {
        lines,
        problems,
        need: INNER_GAS[name] ?? 0n,
        kind: name,
      };
    }
    if (bytes[0] === 8) {
      // SCUpgradeFromSource { sc_address, amount, source, code_metadata, arguments }
      const target = bech32Of(bytes.subarray(1, 33));
      let at = 33;
      const amount = readNested(bytes, at);
      at = amount.next;
      const source = bech32Of(bytes.subarray(at, at + 32));
      at += 32;
      const metadata = bytes.subarray(at, at + 2).toString("hex");
      at += 2;
      const count = bytes.readUInt32BE(at);
      if (target !== mvxvest) problems.push(`it upgrades ${target}, not the vesting contract ${mvxvest}`);
      if (metadata !== CODE_METADATA) {
        problems.push(`the new code metadata is ${metadata}, not ${CODE_METADATA} (upgradeable, readable, not payable)`);
      }
      if (bigOf(amount.value) !== 0n) problems.push(`it sends ${egldText(bigOf(amount.value))} with the upgrade`);
      if (count !== 0) problems.push(`it passes ${count} argument(s); mvxvest's upgrade takes none`);
      const facts = await sourceFacts(source);
      problems.push(...(await sourceProblems(facts)));
      return {
        lines: [`action #${id}: upgrade ${target} with the code of ${source}, metadata ${metadata}`, describeSource(facts)],
        problems,
        need: upgradeNeed(facts.bytes),
        kind: `upgrade from ${source}`,
      };
    }
  } catch (failure) {
    return {
      lines: [`action #${id}: kind ${bytes[0]}, unreadable`],
      problems: [`it could not be decoded (${(failure as Error).message})`],
      need: 0n,
      kind: "unreadable",
    };
  }
  return {
    lines: [`action #${id}: kind ${bytes[0]}, not a call or an upgrade of mvxvest`],
    problems: [`kind ${bytes[0]} is not what this tool signs; use mvxsafe.io for the multisig's other actions`],
    need: 0n,
    kind: `kind ${bytes[0]}`,
  };
}

async function status() {
  console.log(`multisig ${multisig.toBech32()} (${network()}), owner of ${contractAddress().toBech32()}`);
  console.log(`quorum ${num((await query("getQuorum"))[0])}`);
  for (const member of await query("getAllBoardMembers")) {
    console.log(`  board: ${Address.newFromHex(Buffer.from(member, "base64").toString("hex")).toBech32()}`);
  }
  const last = Number(num((await query("getActionLastIndex"))[0]));
  console.log(`actions so far: ${last}`);
  for (let id = Math.max(1, last - 9); id <= last; id++) {
    const [data] = await query("getActionData", [u32(id).padStart(2, "0")]);
    if (!data) continue;
    const signers = num((await query("getActionValidSignerCount", [u32(id).padStart(2, "0")]))[0]);
    const inspection = await inspectAction(id);
    console.log(`  pending #${id}, ${signers} valid signature(s):`);
    for (const line of inspection.lines) console.log(`    ${line}`);
    for (const problem of inspection.problems) console.log(`    WARNING: ${problem}`);
  }
}

/**
 * Deploys the reproducible build as the source of an upgrade, from a wallet in
 * the multisig's shard (devnet keys only), and checks its code hash on chain
 * against the build's.
 */
async function stage() {
  if (network() !== "devnet") throw new Error("On mainnet the source is deployed by a wallet in the multisig's shard; see docs/DEPLOY.md.");
  const dir = join(ROOT, "output-docker/mvxvest");
  const bytecode = readFileSync(join(dir, "mvxvest.wasm"));
  const codeHash = readFileSync(join(dir, "mvxvest.codehash.txt"), "utf8").trim();
  const key = await signer(process.env.MVXVEST_SEND ?? "holder");
  const shardOf = async (a: string) => ((await (await fetch(`${api()}/accounts/${a}`)).json()) as { shard: number }).shard;
  if ((await shardOf(key.address.toBech32())) !== (await shardOf(multisig.toBech32()))) {
    throw new Error("The source must be deployed from a wallet in the multisig's shard.");
  }
  const tx = await entrypoint().createSmartContractTransactionsFactory(abi()).createTransactionForDeploy(key.address, {
    bytecode,
    arguments: [],
    isUpgradeable: false,
    isReadable: true,
    isPayable: false,
    isPayableBySmartContract: false,
  });
  tx.nonce = key.getNonceThenIncrement();
  tx.signature = await key.signTransaction(tx);
  const result = await send("deploy the upgrade source", tx);
  const source = entrypoint().createSmartContractController().parseDeploy(await onNetwork(result.hash)).contracts[0].address;
  const info = (await (await fetch(`${api()}/accounts/${source.toBech32()}`)).json()) as { codeHash: string; shard: number };
  const onChain = Buffer.from(info.codeHash, "base64").toString("hex");
  if (onChain !== codeHash) throw new Error(`Source code hash ${onChain} is not the build's ${codeHash}`);
  console.log(`source ${source.toBech32()} (shard ${info.shard}), code hash ${onChain} = the reproducible build`);
}

async function run() {
  if (command === "status") return status();
  if (command === "stage") return stage();
  const { data, perform } = await proposal();
  const from = process.env.MVXVEST_SEND
    ? (await signer(process.env.MVXVEST_SEND)).address
    : process.env.MVXVEST_FROM
      ? Address.newFromBech32(process.env.MVXVEST_FROM)
      : undefined;
  const tx = new Transaction({
    sender: from ?? multisig,
    receiver: multisig,
    value: 0n,
    gasLimit: 0n,
    chainID,
    data: new TextEncoder().encode(data),
  });
  let gasLimit: bigint | undefined;
  if (from) {
    const account = (await (await fetch(`${api()}/accounts/${from.toBech32()}?withGuardianInfo=true`)).json()) as {
      nonce: number;
      isGuarded?: boolean;
      activeGuardianAddress?: string;
    };
    tx.nonce = BigInt(account.nonce);
    if (account.isGuarded && account.activeGuardianAddress) {
      new TransactionComputer().applyGuardian(tx, Address.newFromBech32(account.activeGuardianAddress));
    }
    if (command === "perform") {
      // The network cannot simulate a performAction whose call goes to another
      // shard ("no async context found", devnet rehearsal): a measured budget
      // for the multisig's own part, plus what the call it makes needs (it is
      // forwarded whatever is left).
      gasLimit = PERFORM_OWN_GAS + perform!.need + CALLBACK_GAS;
      console.log(
        `gas: ${PERFORM_OWN_GAS} performAction + ${perform!.need} for ${perform!.kind} + ${CALLBACK_GAS} held for the callback`,
      );
    } else {
      const simulated = BigInt((await entrypoint().createNetworkProvider().estimateTransactionCost(tx)).gasLimit);
      gasLimit = (simulated * 12n) / 10n;
      console.log(`gas: simulated ${simulated}`);
    }
    if (account.isGuarded) gasLimit += 50_000n;
  }
  console.log(`\nSend from a board member's wallet:\n  to:     ${multisig.toBech32()}\n  amount: 0 EGLD\n  data:   ${data}\n  gas:    ${gasLimit ?? "(set MVXVEST_FROM to simulate)"}`);

  if (!process.env.MVXVEST_SEND) return;
  if (network() !== "devnet") throw new Error("Only devnet transactions are signed here.");
  const key = await signer(process.env.MVXVEST_SEND);
  tx.gasLimit = gasLimit!;
  tx.nonce = key.getNonceThenIncrement();
  tx.signature = await key.signTransaction(tx);
  await send(`${command} ${rest.join(" ")}`.trim(), tx);
}

await run();
