// Audit 4 (operations): a stand-in for the network, loaded before src/multisig.ts
// with `node --import tsx --import ./src/audit4_ops_multisig_mock.ts`. It answers
// the tool's reads (every read the tool makes goes through `fetch`) with a
// pending action #7 crafted by a compromised or careless signer, picked by
// AUDIT4_CASE, and logs each read to stderr as "AUDIT4_READ ...", so the test
// can see what the tool looked at before it printed a transaction to sign.
// Nothing here touches a real network. Built like audit2_redteam_multisig_mock.ts.

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
/** A contract address in shard 1 (mvxsafe's devnet rehearsal source), as the upgrade's source. */
const SOURCE = "erd1qqqqqqqqqqqqqpgq3p9mg88g2dth097vrwcasr4n7eutztf0erksnkk738";
/** An address nobody holds (0x11 repeated): the recipient a compromised signer proposes. */
export const STRANGER = Address.newFromHex("11".repeat(32)).toBech32();
/** Version 2's code hash, what MVXVEST_EXPECT_HASH is set to in the upgrade case. */
const RELEASE_HASH = "a7acbf22b8fdd8f1e624dfd1354aacae4ccb20c0ef5974e1946704359bab718a";

/**
 * getVesting(1) as mainnet answers it (20 Oct 2026): 100 FOXSY, creator
 * erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd, beneficiary
 * erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx (MAINNET.md,
 * milestone 4). Public data; the tool is expected to read it before describing
 * a recoverBouncedKey.
 */
export const VESTING_1_VIEW_HEX =
  "0000000000000001d073e2f48ade91ee84ac0c2ec603a0c47a40fddc039e3b3a4a4018c7e5137ba5e3e9bf40bcab57740848335fe2d2dd307adbc8b123155991b2c09c78abbad03f0000000c464f5853592d35643566336500000009056bc75e2d63100000000000006ace42c0000000006ace42c000000000000000006ace50d00001000000006ace42bb0000000000000001000000000000000100000010546573742031202d204d61696e6e6574000000090149fba2e8a89f1c71000000000000000000000009056bc75e2d63100000000000090421cbbb44ba70e38f00000009056bc75e2d6310000000000000000000006ad7d5d0";
export const VESTING_1_CREATOR = "erd16pe79ay2m6g7ap9vpshvvqaqc3ayplwuqw0rkwj2gqvv0egn0wjsyzvjwd";
export const VESTING_1_BENEFICIARY = "erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx";

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
  switch (process.env.AUDIT4_CASE) {
    case "unpause":
      return sendAsyncCall(MVXVEST, "unpauseCreation", []);
    // A bounced key of vesting 1 sent to an address that is neither its beneficiary nor its creator.
    case "recover-bounced-claim-key-to-stranger":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.alloc(0), addr(STRANGER)]);
    case "recover-bounced-cancel-key-to-stranger":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.from([1]), addr(STRANGER)]);
    // 300 basis points: above the contract's cap of 200, so the perform fails and the action is used up.
    case "token-fee-above-cap":
      return sendAsyncCall(MVXVEST, "setTokenFee", [Buffer.from([0x01, 0x2c])]);
    // 2 EGLD: above the contract's cap of 1 EGLD.
    case "fee-above-cap":
      return sendAsyncCall(MVXVEST, "setFee", [Buffer.from((2n * 10n ** 18n).toString(16), "hex")]);
    // pauseCreation takes no argument: the contract refuses the call, after two signatures.
    case "pause-with-an-argument":
      return sendAsyncCall(MVXVEST, "pauseCreation", [Buffer.from([1])]);
    // A well-formed upgrade of mvxvest from a source whose account answer carries no code metadata.
    case "upgrade-source-metadata-unknown":
      return upgradeFromSource(MVXVEST, SOURCE, Buffer.from([0x05, 0x00]));
    default:
      throw new Error(`AUDIT4_CASE ${process.env.AUDIT4_CASE} unknown`);
  }
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A view's answer, in the API's shape (returnData) and the gateway's (data.data.returnData). */
const answer = (funcName: string, args: string[]): string[] => {
  if (funcName === "getActionData") return [action().toString("base64")];
  if (funcName === "getVesting" && args.length === 1) return [Buffer.from(VESTING_1_VIEW_HEX, "hex").toString("base64")];
  if (funcName === "getQuorum") return [Buffer.from([2]).toString("base64")];
  return [];
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query") || url.endsWith("/vm-values/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { scAddress: string; funcName: string; args: string[] };
    process.stderr.write(`AUDIT4_READ query ${body.scAddress} ${body.funcName} ${JSON.stringify(body.args ?? [])}\n`);
    const returnData = answer(body.funcName, body.args ?? []);
    if (url.endsWith("/vm-values/query")) return json({ data: { data: { returnData, returnCode: "ok" } }, code: "successful" });
    return json({ returnData, returnCode: "ok" });
  }
  process.stderr.write(`AUDIT4_READ ${url}\n`);
  if (url.includes(`/accounts/${SOURCE}`)) {
    // The source holds the release's code, in the multisig's shard; the answer says nothing about its metadata.
    return json({ code: "00".repeat(27_332), codeHash: Buffer.from(RELEASE_HASH, "hex").toString("base64"), shard: 1 });
  }
  if (url.includes(`/accounts/${MULTISIG}`)) return json({ shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
