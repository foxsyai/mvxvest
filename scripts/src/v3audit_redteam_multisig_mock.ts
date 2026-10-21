// Audit of version 3 (Claude Fable 5.1, 21 Oct 2026), red team (V3R): a
// stand-in for the network, loaded before src/multisig.ts with
// `node --import tsx --import ./src/v3audit_redteam_multisig_mock.ts`, like
// audit4_ops_multisig_mock.ts. It holds one pending action #7: an upgrade of
// mvxvest from a source of version 3's size (29,195 bytes, the local build of
// 7361158), whose code the API returns in full and labels truthfully, in the
// multisig's shard, not upgradeable. V3R_SOURCE_BYTES overrides the size.
// Nothing here touches a real network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address } from "@multiversx/sdk-core";
import { blake2b } from "@noble/hashes/blake2b";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
const MVXVEST = ((): string => {
  try {
    const file = join(process.cwd(), "state", `${process.env.MVXVEST_NETWORK ?? "devnet"}.json`);
    return (JSON.parse(readFileSync(file, "utf8")) as { contract?: string }).contract ?? "";
  } catch {
    return "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
  }
})();
const SOURCE = "erd1qqqqqqqqqqqqqpgq3p9mg88g2dth097vrwcasr4n7eutztf0erksnkk738";
/** The source's code: version 3's size, a byte pattern that is not all zeros. */
const SOURCE_BYTES = Number(process.env.V3R_SOURCE_BYTES ?? "29195");
const code = Buffer.alloc(SOURCE_BYTES);
for (let i = 0; i < code.length; i++) code[i] = (i * 7 + 3) & 0xff;
/** What a signer who reproduced the build would set MVXVEST_EXPECT_HASH to. */
export const SOURCE_HASH = Buffer.from(blake2b(code, { dkLen: 32 })).toString("hex");

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer) => Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string) => Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");
/** Action::SCUpgradeFromSource { sc_address, amount, source, code_metadata, arguments }. */
const action = Buffer.concat([Buffer.from([8]), addr(MVXVEST), nested(Buffer.alloc(0)), addr(SOURCE), Buffer.from([0x05, 0x00]), u32(0)]);

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query") || url.endsWith("/vm-values/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { funcName: string };
    const returnData = body.funcName === "getActionData" ? [action.toString("base64")] : [];
    if (url.endsWith("/vm-values/query")) return json({ data: { data: { returnData, returnCode: "ok" } }, code: "successful" });
    return json({ returnData, returnCode: "ok" });
  }
  if (url.includes(`/accounts/${SOURCE}`)) {
    return json({
      code: code.toString("hex"),
      codeHash: Buffer.from(SOURCE_HASH, "hex").toString("base64"),
      shard: 1,
      isUpgradeable: false,
    });
  }
  if (url.includes(`/accounts/${MULTISIG}`)) return json({ shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
