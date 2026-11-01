// Audit 5 (operations): a stand-in for the network, loaded before src/multisig.ts
// with `node --import tsx --import ./src/audit5_ops_multisig_mock.ts`. Every read
// the tool makes goes through `fetch`; this answers them with a pending action
// #7 crafted by a compromised or careless board member, picked by AUDIT5_CASE,
// and logs each read to stderr as "AUDIT5_READ ...". Nothing here touches a
// real network, signs anything or reads a key. Self contained (the vesting
// view below is copied from audit4_ops_multisig_mock.ts: public mainnet data).

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Address } from "@multiversx/sdk-core";

export const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** mvxvest on mainnet (MAINNET.md). */
export const MAINNET_CONTRACT = "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";
/**
 * A made-up contract address (0x22 repeated, the contract prefix kept) that a
 * careless signer could be told to put into scripts/state/mainnet.json.
 */
export const LOOKALIKE = Address.newFromHex("0000000000000000050022222222222222222222222222222222222222222222").toBech32();
/** A contract address in shard 1 (mvxsafe's devnet rehearsal source), as the upgrade's source. */
const SOURCE = "erd1qqqqqqqqqqqqqpgq3p9mg88g2dth097vrwcasr4n7eutztf0erksnkk738";
/** Version 3's release hash (MAINNET.md). */
export const RELEASE_HASH = "65c689b9d0cefdc5e39e2d1f4e7110e0c3da787a8a56dbf163a3d59ce6e6101d";
export const VESTING_1_BENEFICIARY = "erd1u05m7s9u4dthgzzgxd0795kaxpadhj93yv24nydjczw832a66qlsgw5esx";
/** getVesting(1) as mainnet answers it (20 Oct 2026): 100 FOXSY, claim key nonce 1. */
const VESTING_1_VIEW_HEX =
  "0000000000000001d073e2f48ade91ee84ac0c2ec603a0c47a40fddc039e3b3a4a4018c7e5137ba5e3e9bf40bcab57740848335fe2d2dd307adbc8b123155991b2c09c78abbad03f0000000c464f5853592d35643566336500000009056bc75e2d63100000000000006ace42c0000000006ace42c000000000000000006ace50d00001000000006ace42bb0000000000000001000000000000000100000010546573742031202d204d61696e6e6574000000090149fba2e8a89f1c71000000000000000000000009056bc75e2d63100000000000090421cbbb44ba70e38f00000009056bc75e2d6310000000000000000000006ad7d5d0";

/** The vesting contract the tool reads from its state file: on mainnet, the look-alike this mock serves. */
const MVXVEST = ((): string => {
  if (process.env.MVXVEST_NETWORK === "mainnet") return LOOKALIKE;
  try {
    const file = `${process.cwd()}/state/${process.env.MVXVEST_NETWORK ?? "devnet"}.json`;
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { contract?: string }).contract ?? "";
  } catch {
    return MAINNET_CONTRACT;
  }
})();

// On mainnet the tool's notion of "the vesting contract" is scripts/state/mainnet.json, a
// file git ignores that each signer writes by hand. This serves one naming the look-alike,
// without touching any real state file.
if (process.env.MVXVEST_NETWORK === "mainnet") {
  const isState = (p: unknown) => String(p).endsWith("/scripts/state/mainnet.json");
  const realExists = fs.existsSync;
  const realRead = fs.readFileSync;
  fs.existsSync = ((p: fs.PathLike) => (isState(p) ? true : realExists(p))) as typeof fs.existsSync;
  fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) =>
    isState(p) ? JSON.stringify({ contract: LOOKALIKE }) : (realRead as (...a: unknown[]) => unknown)(p, ...rest)) as typeof fs.readFileSync;
  syncBuiltinESMExports();
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer): Buffer => Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string): Buffer => Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");

/** CallActionData { to, egld_amount, endpoint_name, arguments } behind a variant byte. */
const callAction = (variant: number, to: string, endpoint: string, args: Buffer[], egld: Buffer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([Buffer.from([variant]), addr(to), nested(egld), nested(Buffer.from(endpoint, "latin1")), u32(args.length), ...args.map(nested)]);
const sendAsyncCall = (to: string, endpoint: string, args: Buffer[]) => callAction(6, to, endpoint, args);
const sendTransferExecute = (to: string, endpoint: string, args: Buffer[], egld: Buffer) => callAction(5, to, endpoint, args, egld);

/** Action::SCUpgradeFromSource { sc_address, amount, source, code_metadata, arguments }. */
const upgradeFromSource = (target: string, source: string, metadata: Buffer, args: Buffer[] = []) =>
  Buffer.concat([Buffer.from([8]), addr(target), nested(Buffer.alloc(0)), addr(source), metadata, u32(args.length), ...args.map(nested)]);

/**
 * A token "identifier" that is not one: it carries a carriage return and two terminal
 * escapes, so that what the tool prints before the real recipient looks like a whole,
 * honest line, and the rest of the real line is written over it (\r) or hidden (SGR 8).
 */
export const FORGED_TOKEN = `FOXSY-5d5f3e, ${MULTISIG}, all of it) on ${MAINNET_CONTRACT}\n\x1b[8m\r`;

/** The contract's key collections, as its views answer on mainnet (config.mainnet.ts). */
const CLAIM_COLLECTION = "VESTKEY-f56bea";
const CANCEL_COLLECTION = "VESTCANCEL-ae94f5";
export const CLAIM_KEY_1 = `${CLAIM_COLLECTION}-01`;
export const TRANCHES_CLAIM_KEY = `${CLAIM_COLLECTION}-0a`;
export const STEPPED_CANCEL_KEY = `${CANCEL_COLLECTION}-0b`;

const u64 = (n: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
/**
 * A made-up VestingView (addresses 0x33 and 0x44 repeated), with the curve whose length
 * varies: claim key nonce 10, cancel key nonce 11, or none (0) when it cannot be cancelled.
 */
const viewWith = (curve: Buffer, cancelNonce = 11): Buffer =>
  Buffer.concat([
    u64(1),
    Buffer.from("33".repeat(32), "hex"),
    Buffer.from("44".repeat(32), "hex"),
    nested(Buffer.from("FOXSY-5d5f3e")),
    nested(Buffer.from([0x64])),
    u64(1_700_000_000),
    u64(1_700_000_000),
    nested(Buffer.alloc(0)),
    u64(1_800_000_000),
    curve,
    Buffer.from([cancelNonce ? 1 : 0]),
    u64(1_699_000_000),
    u64(10),
    u64(cancelNonce),
    nested(Buffer.from("made up")),
    nested(Buffer.from([0x05])),
  ]);
const STEPPED = Buffer.concat([Buffer.from([1]), u64(86_400)]);
const TRANCHES = Buffer.concat([
  Buffer.from([2]),
  u32(2),
  u64(1_750_000_000),
  nested(Buffer.from([0x32])),
  u64(1_800_000_000),
  nested(Buffer.from([0x32])),
]);

const action = (): Buffer => {
  switch (process.env.AUDIT5_CASE) {
    // recoverBouncedKey of a key the contract holds, and the ways its read can go wrong.
    case "bounced-key-held":
    case "bounced-key-collection-unread":
    case "bounced-key-nfts-unread":
    case "bounced-key-nfts-not-a-list":
    case "bounced-key-another-key-listed":
    case "bounced-key-view-truncated":
    case "bounced-claim-key-tranches":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.alloc(0), addr(VESTING_1_BENEFICIARY)]);
    case "bounced-cancel-key-stepped":
    case "bounced-cancel-key-none":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.from([1]), addr(VESTING_1_BENEFICIARY)]);
    // OPS-1 for a key: the recipient is the zero address or the contract.
    case "bounced-key-to-zero-address":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.alloc(0), Buffer.alloc(32)]);
    case "bounced-key-to-the-contract":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.alloc(0), addr(MVXVEST)]);
    // A byte 00 for a kind or a bool, as another tool may encode it: the Go VM takes it as Claim or false.
    case "bounced-key-kind-byte-00":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.from([0]), addr(VESTING_1_BENEFICIARY)]);
    case "display-kind-byte-00":
      return sendAsyncCall(MVXVEST, "setKeyDisplay", [Buffer.from([0]), Buffer.alloc(0), Buffer.from("https://mvxvest.io/nft/claim-key.png")]);
    case "display-kind-two":
      return sendAsyncCall(MVXVEST, "setKeyDisplay", [Buffer.from([2]), Buffer.alloc(0), Buffer.from("https://mvxvest.io/nft/claim-key.png")]);
    case "stamping-byte-00":
      return sendAsyncCall(MVXVEST, "setKeyStamping", [Buffer.from([0])]);
    case "stamping-two-zero-bytes":
      return sendAsyncCall(MVXVEST, "setKeyStamping", [Buffer.from([0, 0])]);
    // Identifiers that are fine, and other raw bytes that go to the terminal.
    case "surplus-egld":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from("EGLD-000000"), addr(VESTING_1_BENEFICIARY)]);
    case "surplus-lower-case-token":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from("foxsy-5d5f3e"), addr(VESTING_1_BENEFICIARY)]);
    case "endpoint-with-escapes":
      return sendAsyncCall(MVXVEST, `pauseCreation() on ${MAINNET_CONTRACT}\n\x1b[8m\r`, []);
    case "display-uri-with-escapes":
      return sendAsyncCall(MVXVEST, "setKeyDisplay", [Buffer.alloc(0), Buffer.alloc(0), Buffer.from("https://mvxvest.io/\x7f\u009b8m")]);
    case "unpause":
      return sendAsyncCall(MVXVEST, "unpauseCreation", []);
    // recoverSurplus to the zero address: the contract refuses it (ERR_BAD_RECIPIENT) after two signatures.
    case "surplus-to-zero-address":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from("FOXSY-5d5f3e"), Buffer.alloc(32)]);
    // recoverSurplus to the vesting contract itself: the same refusal.
    case "surplus-to-the-contract":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from("FOXSY-5d5f3e"), addr(MVXVEST)]);
    // A token argument that is not an identifier, with terminal escapes in it.
    case "surplus-forged-token":
      return sendAsyncCall(MVXVEST, "recoverSurplus", [Buffer.from(FORGED_TOKEN, "latin1"), Buffer.from("11".repeat(32), "hex")]);
    // recoverBouncedKey of a key the contract does not hold: ERR_NO_HELD_KEY after two signatures.
    case "bounced-key-not-held":
      return sendAsyncCall(MVXVEST, "recoverBouncedKey", [Buffer.from([1]), Buffer.alloc(0), addr(VESTING_1_BENEFICIARY)]);
    // A pause of whatever the signer's state file calls "the vesting contract".
    case "pause-the-state-files-contract":
      return sendAsyncCall(MVXVEST, "pauseCreation", []);
    // A transfer-and-execute (kind 5) that carries a call to mvxvest in its data.
    case "transfer-execute-hiding-a-call":
      return sendTransferExecute(MVXVEST, "pauseCreation", [], Buffer.alloc(0));
    // An async call to the multisig itself.
    case "call-to-the-multisig-itself":
      return sendAsyncCall(MULTISIG, "changeQuorum", [Buffer.from([1])]);
    // ChangeQuorum(1): kind 4.
    case "change-quorum":
      return Buffer.concat([Buffer.from([4]), u32(1)]);
    // An endpoint named after an Object.prototype property, which `in` finds in every object.
    case "endpoint-toString":
      return sendAsyncCall(MVXVEST, "toString", []);
    case "endpoint-proto":
      return sendAsyncCall(MVXVEST, "__proto__", []);
    // An upgrade of mvxvest from the release's source, but with one argument.
    case "upgrade-with-an-argument":
      return upgradeFromSource(MVXVEST, SOURCE, Buffer.from([0x05, 0x00]), [Buffer.from([1])]);
    // An upgrade that would make the contract payable (0502) or payable by contracts (0504).
    case "upgrade-payable":
      return upgradeFromSource(MVXVEST, SOURCE, Buffer.from([0x05, 0x02]));
    case "upgrade-payable-by-sc":
      return upgradeFromSource(MVXVEST, SOURCE, Buffer.from([0x05, 0x04]));
    // An upgrade that would make the contract not readable (0100).
    case "upgrade-not-readable":
      return upgradeFromSource(MVXVEST, SOURCE, Buffer.from([0x01, 0x00]));
    default:
      throw new Error(`AUDIT5_CASE ${process.env.AUDIT5_CASE} unknown`);
  }
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const answer = (funcName: string, args: string[]): string[] => {
  if (funcName === "getActionData") return [action().toString("base64")];
  if (funcName === "getVesting" && args.length === 1) {
    const the = (view: Buffer) => [view.toString("base64")];
    if (process.env.AUDIT5_CASE === "bounced-claim-key-tranches") return the(viewWith(TRANCHES));
    if (process.env.AUDIT5_CASE === "bounced-cancel-key-stepped") return the(viewWith(STEPPED));
    if (process.env.AUDIT5_CASE === "bounced-cancel-key-none") return the(viewWith(STEPPED, 0));
    if (process.env.AUDIT5_CASE === "bounced-key-view-truncated") return the(viewWith(STEPPED).subarray(0, 120));
    return the(Buffer.from(VESTING_1_VIEW_HEX, "hex"));
  }
  if (funcName === "getClaimKeyCollection" || funcName === "getCancelKeyCollection") {
    if (process.env.AUDIT5_CASE === "bounced-key-collection-unread") return [];
    return [Buffer.from(funcName === "getClaimKeyCollection" ? CLAIM_COLLECTION : CANCEL_COLLECTION).toString("base64")];
  }
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
  if (url.includes(`/accounts/${MVXVEST}/nfts`)) {
    // Each case that holds a key answers it when asked for exactly that one, as the API does.
    const holds: Record<string, string> = {
      "bounced-key-held": CLAIM_KEY_1,
      "bounced-key-kind-byte-00": CLAIM_KEY_1,
      "bounced-claim-key-tranches": TRANCHES_CLAIM_KEY,
      "bounced-cancel-key-stepped": STEPPED_CANCEL_KEY,
    };
    const held = holds[process.env.AUDIT5_CASE ?? ""];
    if (process.env.AUDIT5_CASE === "bounced-key-nfts-unread") return new Response("bad gateway", { status: 502 });
    if (process.env.AUDIT5_CASE === "bounced-key-nfts-not-a-list") return json({ statusCode: 500 });
    if (process.env.AUDIT5_CASE === "bounced-key-another-key-listed") return json([{ identifier: `${CLAIM_COLLECTION}-02` }]);
    if (held && new URL(url).searchParams.get("identifiers") === held) return json([{ identifier: held }]);
    // Otherwise the vesting contract holds no key at all: nothing bounced.
    return json([]);
  }
  if (url.includes(`/accounts/${MVXVEST}`)) return json({ shard: 0, codeHash: Buffer.from(RELEASE_HASH, "hex").toString("base64") });
  if (url.includes(`/accounts/${SOURCE}`)) {
    // The source holds the release's bytes (a made-up 29,327-byte code whose hash the label matches is
    // not needed: the metadata cases are refused before the hash is compared).
    return json({ code: "00".repeat(29_327), codeHash: Buffer.from(RELEASE_HASH, "hex").toString("base64"), shard: 1, isUpgradeable: false });
  }
  if (url.includes(`/accounts/${MULTISIG}`)) return json({ shard: 1 });
  if (url.includes("withGuardianInfo")) return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
