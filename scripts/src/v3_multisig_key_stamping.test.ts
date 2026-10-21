// Version 3: the owner's switch for the stamping of claim keys
// (setKeyStamping) is one of mvxvest's owner calls, so scripts/src/multisig.ts
// proposes it, says what it does and lets a board member sign it; a value the
// contract cannot decode as a bool is refused before anyone signs. Runs the
// tool for real against the stand-in network of the fourth audit
// (audit4_ops_multisig_mock.ts).
//
//   cd scripts && node --import tsx --test src/v3_multisig_key_stamping.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const MULTISIG = "erd1qqqqqqqqqqqqqpgqe7jmywfkh74cam8uqnt762c54zuqgp6r6qlsul78u3";

const run = (args: string[], audit4Case = "unpause") => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--import", "./src/audit4_ops_multisig_mock.ts", "src/multisig.ts", ...args],
    {
      env: { ...process.env, MVXVEST_NETWORK: "devnet", MVXVEST_MULTISIG: MULTISIG, AUDIT4_CASE: audit4Case },
      encoding: "utf8",
    },
  );
  return { status: result.status, out: result.stdout, all: result.stdout + result.stderr };
};

test("propose stamping off: the switch is proposed as setKeyStamping(false)", () => {
  const { status, out, all } = run(["propose", "stamping", "off"]);
  assert.equal(status, 0, all);
  assert.match(out, /propose: setKeyStamping\(false\)/);
  // proposeAsyncCall@<mvxvest>@@setKeyStamping@ (false encodes as an empty argument)
  assert.match(out, new RegExp(`data:   proposeAsyncCall@[0-9a-f]{64}@@${Buffer.from("setKeyStamping").toString("hex")}@$`, "m"));
});

test("propose stamping: only on or off", () => {
  const { status, all } = run(["propose", "stamping", "maybe"]);
  assert.notEqual(status, 0);
  assert.match(all, /on or off/);
});

test("sign setKeyStamping(off): described and accepted", () => {
  const { status, out, all } = run(["sign", "7"], "key-stamping-off");
  assert.equal(status, 0, all);
  assert.match(out, /call setKeyStamping\(off\) on/);
  assert.match(out, /data: {3}sign@07/);
});

test("sign setKeyStamping(2): not a bool, refused before two signatures are spent", () => {
  const { status, all } = run(["sign", "7"], "key-stamping-not-a-bool");
  assert.notEqual(status, 0);
  assert.match(all, /bool/);
  assert.doesNotMatch(all, /data: {3}sign@07/);
});
