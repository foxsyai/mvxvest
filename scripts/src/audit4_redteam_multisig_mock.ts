// Fourth audit (red team): a stand-in for the network, loaded before
// src/multisig.ts with `node --import tsx --import ./src/audit4_redteam_multisig_mock.ts`.
// It holds one pending action, an upgrade of mvxvest from a source whose
// CODE is version 1's bytes (code hash fd32f4e1…, MAINNET.md) while the
// account's `codeHash` FIELD says whatever AUDIT4_LABEL_HASH is: the release
// hash the signer expects. A network answer in which the label and the bytes
// disagree (a wrong or tampered API answer, a stale index) is what the tool
// must not be fooled by. Nothing here touches a real network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Address } from "@multiversx/sdk-core";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** The vesting contract the tool reads from its state file, so the upgrade targets "ours". */
const MVXVEST = ((): string => {
  try {
    const file = join(process.cwd(), "state", `${process.env.MVXVEST_NETWORK ?? "devnet"}.json`);
    return (JSON.parse(readFileSync(file, "utf8")) as { contract?: string }).contract ?? "";
  } catch {
    return "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
  }
})();
/** A source in the multisig's shard (shard 1): the address version 2's real source used on mainnet. */
const SOURCE = "erd1qqqqqqqqqqqqqpgqzywreqymt6j00wta43v7zvmrk4yz5xal6qls2j5m2c";

/** The bytes the source "holds": version 1 of the contract. */
const CODE_HEX = readFileSync(join(process.cwd(), "../contracts/vesting/scenarios/v1/mvxvest-v1.wasm")).toString("hex");
/** The code hash the API "reports" for it, as the API encodes it (base64). */
const LABEL = Buffer.from(process.env.AUDIT4_LABEL_HASH ?? "", "hex").toString("base64");

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer) => Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string) => Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");

/** Action::SCUpgradeFromSource { sc_address, amount, source, code_metadata, arguments }: metadata 0500, no arguments. */
const action = Buffer.concat([Buffer.from([8]), addr(MVXVEST), nested(Buffer.alloc(0)), addr(SOURCE), Buffer.from([0x05, 0x00]), u32(0)]);

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { funcName: string; args: string[] };
    process.stderr.write(`AUDIT4_READ query ${body.funcName} ${JSON.stringify(body.args)}\n`);
    if (body.funcName === "getActionData") return json({ returnData: [action.toString("base64")] });
    return json({ returnData: [] });
  }
  process.stderr.write(`AUDIT4_READ ${url}\n`);
  if (url.includes(`/accounts/${SOURCE}`)) {
    return json({ code: CODE_HEX, codeHash: LABEL, shard: 1, isUpgradeable: false });
  }
  if (url.includes(`/accounts/${MULTISIG}`)) return json({ shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
