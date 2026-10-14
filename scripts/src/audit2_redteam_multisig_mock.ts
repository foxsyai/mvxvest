// Audit 2 (red team): a stand-in for the network, loaded before
// src/multisig.ts with `node --import tsx --import ./src/audit2_redteam_multisig_mock.ts`.
// It answers the tool's reads with a pending action crafted by a compromised
// signer (AUDIT2_CASE picks which) and logs every read to stderr, so the test
// can see what the tool looked at before it printed a transaction to sign.
// Nothing here touches a real network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address } from "@multiversx/sdk-core";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** The vesting contract the tool itself reads from its state file, so a call on it is "ours". */
const MVXVEST = ((): string => {
  try {
    const file = join(process.cwd(), "state", `${process.env.MVXVEST_NETWORK ?? "devnet"}.json`);
    return (JSON.parse(readFileSync(file, "utf8")) as { contract?: string }).contract ?? "";
  } catch {
    return "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
  }
})();
/** Any contract address in shard 1: here mvxsafe's devnet rehearsal source. */
const SOURCE = "erd1qqqqqqqqqqqqqpgq3p9mg88g2dth097vrwcasr4n7eutztf0erksnkk738";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer) => Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string) => Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");

/** The legacy multisig's Action::SendAsyncCall(CallActionData { to, egld_amount, endpoint_name, arguments }). */
const sendAsyncCall = (to: string, endpoint: string, args: Buffer[]) =>
  Buffer.concat([
    Buffer.from([6]),
    addr(to),
    nested(Buffer.alloc(0)), // egld_amount 0
    nested(Buffer.from(endpoint)),
    u32(args.length),
    ...args.map(nested),
  ]);

/** Action::SCUpgradeFromSource { sc_address, amount, source, code_metadata, arguments }. */
const upgradeFromSource = (target: string, source: string, metadata: Buffer) =>
  Buffer.concat([Buffer.from([8]), addr(target), nested(Buffer.alloc(0)), addr(source), metadata, u32(0)]);

const action = (): Buffer => {
  switch (process.env.AUDIT2_CASE) {
    case "upgradeContract-as-a-call": {
      // The release's own bytes, as the live version 1 is: a compromised signer
      // proposes a plain call of the built-in upgradeContract with the code in
      // the argument, which no source, no hash and no metadata card ever sees.
      const wasm = readFileSync(join(process.cwd(), "../contracts/vesting/scenarios/v1/mvxvest-v1.wasm"));
      return sendAsyncCall(MVXVEST, "upgradeContract", [wasm, Buffer.from([0x05, 0x00])]);
    }
    case "upgrade-the-safe-itself-not-upgradeable":
      // Target: the multisig itself. Metadata 0000: never upgradeable again.
      return upgradeFromSource(MULTISIG, SOURCE, Buffer.from([0x00, 0x00]));
    case "unpause":
      return sendAsyncCall(MVXVEST, "unpauseCreation", []);
    default:
      throw new Error(`AUDIT2_CASE ${process.env.AUDIT2_CASE} unknown`);
  }
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { funcName: string; args: string[] };
    process.stderr.write(`AUDIT2_READ query ${body.funcName} ${JSON.stringify(body.args)}\n`);
    if (body.funcName === "getActionData") return json({ returnData: [action().toString("base64")] });
    return json({ returnData: [] });
  }
  process.stderr.write(`AUDIT2_READ ${url}\n`);
  if (url.includes(`/accounts/${SOURCE}`)) return json({ code: "00".repeat(27_332), shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
