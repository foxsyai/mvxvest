// Audit 5 (vest-dapp, VSD-08): a stand-in for the network, loaded before
// src/multisig.ts with `node --import tsx --import ./src/audit5_multisig_mock.ts`.
// It answers the tool's reads (every read goes through `fetch`) with a pending
// action #7 picked by AUDIT5_CASE, and logs each read to stderr as
// "AUDIT5_READ ...". Built like audit4_ops_multisig_mock.ts. Nothing here
// touches a real network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address } from "@multiversx/sdk-core";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** The vesting contract the tool reads from its state file, so a call on it is "ours". */
const MVXVEST = ((): string => {
  try {
    const file = join(process.cwd(), "state", `${process.env.MVXVEST_NETWORK ?? "devnet"}.json`);
    return (JSON.parse(readFileSync(file, "utf8")) as { contract?: string }).contract ?? "";
  } catch {
    return "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
  }
})();
/** An address nobody holds (0x22 repeated): the recipient a signer proposes. */
export const RECIPIENT = Address.newFromHex("22".repeat(32)).toBech32();
export const TOKEN = "FOXSY-5d5f3e";
/** What getSurplus answers for the token: 1,234,567 units. */
export const SURPLUS = 1_234_567n;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer) => Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string) => Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");
const big = (value: bigint) => {
  const hex = value.toString(16);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
};

/** The legacy multisig's Action::SendAsyncCall(CallActionData { to, egld_amount, endpoint_name, arguments }). */
const sendAsyncCall = (to: string, endpoint: string, args: Buffer[]) =>
  Buffer.concat([Buffer.from([6]), addr(to), nested(Buffer.alloc(0)), nested(Buffer.from(endpoint)), u32(args.length), ...args.map(nested)]);

const action = (): Buffer => {
  switch (process.env.AUDIT5_CASE) {
    case "unpause":
      return sendAsyncCall(MVXVEST, "unpauseCreation", []);
    // recoverSurplus(token, to): "all of it", whatever that is.
    case "recover-surplus-all":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from(TOKEN), addr(RECIPIENT)]);
    // An amount within the surplus: the contract accepts it.
    case "recover-surplus-within":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from(TOKEN), addr(RECIPIENT), big(1_000_000n)]);
    // An amount above the surplus: the contract refuses it ("above surplus"), after the quorum signed.
    case "recover-surplus-over":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from(TOKEN), addr(RECIPIENT), big(2_000_000n)]);
    default:
      throw new Error(`AUDIT5_CASE ${process.env.AUDIT5_CASE} unknown`);
  }
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A view's answer, in the API's shape (returnData). */
const answer = (funcName: string, args: string[]): string[] => {
  if (funcName === "getActionData") return [action().toString("base64")];
  if (funcName === "getSurplus" && args.length === 1) return [big(SURPLUS).toString("base64")];
  if (funcName === "getQuorum") return [Buffer.from([2]).toString("base64")];
  return [];
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query") || url.endsWith("/vm-values/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { scAddress: string; funcName: string; args: string[] };
    process.stderr.write(`AUDIT5_READ query ${body.scAddress} ${body.funcName} ${JSON.stringify(body.args ?? [])}\n`);
    const returnData = answer(body.funcName, body.args ?? []);
    if (url.endsWith("/vm-values/query")) return json({ data: { data: { returnData, returnCode: "ok" } }, code: "successful" });
    return json({ returnData, returnCode: "ok" });
  }
  process.stderr.write(`AUDIT5_READ ${url}\n`);
  if (url.includes(`/accounts/${MULTISIG}`)) return json({ shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
