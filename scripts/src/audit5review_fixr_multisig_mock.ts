// Fifth audit, review of the fixes (FIXR): a stand-in for the network, loaded
// before src/multisig.ts with `node --import tsx --import ./src/audit5review_fixr_multisig_mock.ts`.
// It serves one pending action #7 of the multisig, picked by AUDIT5REVIEW_CASE,
// whose one argument is a number written on more than 8 bytes. The VM decodes
// an endpoint argument by its value (smallIntGetUnsignedArgument), so these
// pass on the contract too: the Go VM scenario of the same name pins it.
// Nothing here touches a network, signs anything or reads a key.
// On mainnet the tool reads no state file (any such file is said not to exist
// here), so the vesting contract is lib.ts's MAINNET_CONTRACT.

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { Address } from "@multiversx/sdk-core";

export const MULTISIG =
  "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";
/** mvxvest on mainnet (docs/MAINNET.md, scripts/src/lib.ts). */
export const MAINNET_CONTRACT =
  "erd1qqqqqqqqqqqqqpgqlzpdsymdk7zxekm9pvtpxja4gfx6trwluc2qgmllsu";

const isState = (p: unknown) =>
  /\/scripts\/state\/[a-z]+\.json$/.test(String(p));
const realExists = fs.existsSync;
fs.existsSync = ((p: fs.PathLike) =>
  isState(p) ? false : realExists(p)) as typeof fs.existsSync;
syncBuiltinESMExports();

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const nested = (bytes: Buffer): Buffer =>
  Buffer.concat([u32(bytes.length), bytes]);
const addr = (bech32: string): Buffer =>
  Buffer.from(Address.newFromBech32(bech32).toHex(), "hex");
/** Action::SendAsyncCall(CallActionData { to, egld_amount, endpoint_name, arguments }). */
const sendAsyncCall = (to: string, endpoint: string, args: Buffer[]): Buffer =>
  Buffer.concat([
    Buffer.from([6]),
    addr(to),
    nested(Buffer.alloc(0)),
    nested(Buffer.from(endpoint, "latin1")),
    u32(args.length),
    ...args.map(nested),
  ]);

const PNG = Buffer.from("https://mvxvest.io/nft/claim-key.png");

const action = (): Buffer => {
  switch (process.env.AUDIT5REVIEW_CASE) {
    // A kind of two bytes (0001): the contract takes it as Cancel (the fix's own claim, pinned on the Go VM).
    case "display-kind-two-bytes":
      return sendAsyncCall(MAINNET_CONTRACT, "setKeyDisplay", [
        Buffer.from("0001", "hex"),
        Buffer.alloc(0),
        PNG,
      ]);
    // A kind of nine bytes, worth 1: the VM takes it as Cancel.
    case "display-kind-nine-bytes":
      return sendAsyncCall(MAINNET_CONTRACT, "setKeyDisplay", [
        Buffer.from("000000000000000001", "hex"),
        Buffer.alloc(0),
        PNG,
      ]);
    // A kind worth 2: neither Claim nor Cancel.
    case "display-kind-two":
      return sendAsyncCall(MAINNET_CONTRACT, "setKeyDisplay", [
        Buffer.from([2]),
        Buffer.alloc(0),
        PNG,
      ]);
    // 10 basis points on ten bytes: the VM takes it as 10.
    case "tokenfee-ten-bytes":
      return sendAsyncCall(MAINNET_CONTRACT, "setTokenFee", [
        Buffer.from("0000000000000000000a", "hex"),
      ]);
    // 10 basis points on one byte: fine.
    case "tokenfee-one-byte":
      return sendAsyncCall(MAINNET_CONTRACT, "setTokenFee", [
        Buffer.from([10]),
      ]);
    default:
      throw new Error(
        `AUDIT5REVIEW_CASE ${process.env.AUDIT5REVIEW_CASE} unknown`,
      );
  }
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/query") || url.endsWith("/vm-values/query")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      scAddress: string;
      funcName: string;
      args: string[];
    };
    process.stderr.write(
      `AUDIT5REVIEW_READ query ${body.scAddress} ${body.funcName} ${JSON.stringify(body.args ?? [])}\n`,
    );
    const returnData =
      body.funcName === "getActionData"
        ? [action().toString("base64")]
        : body.funcName === "getQuorum"
          ? [Buffer.from([2]).toString("base64")]
          : [];
    if (url.endsWith("/vm-values/query"))
      return json({
        data: { data: { returnData, returnCode: "ok" } },
        code: "successful",
      });
    return json({ returnData, returnCode: "ok" });
  }
  process.stderr.write(`AUDIT5REVIEW_READ ${url}\n`);
  if (url.includes("withGuardianInfo"))
    return json({ nonce: 7, isGuarded: false });
  return json({});
}) as typeof fetch;
