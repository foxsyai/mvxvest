#!/usr/bin/env python3
"""Fifth audit, review of the fixes (FIXR): what the public documents say against what the audit found.

Run: python3 scripts/ci/audit5review_fixr_docs_test.py

1. The incident runbook (docs/DEPLOY.md, OPS-8) says "A wallet never bounces; a smart contract that cannot receive
   can." The same audit's RT-1 proved the opposite on devnet: a wallet frozen for a token refuses the payout, and
   under version 3 (live on mainnet) the claim key comes back with it. recoverSurplus's own doc comment names "a
   wallet frozen for the token". A holder sent to the runbook from SECURITY.md reads that their case cannot happen.
2. The copy style of the site and the public documents: no em or en dash, no comma before "and" or "or". The
   build note added to README.md and docs/DEPLOY.md (OPS-5) reads "a tag can be moved, and a moved tag ...".
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = (ROOT / "docs/DEPLOY.md").read_text()
PUBLIC = {
    name: (ROOT / name).read_text()
    for name in ("README.md", "SECURITY.md", "docs/DEPLOY.md", "dapp/docs/beneficiary-guide.html")
}


def runbook():
    match = re.search(r"^## Incident runbook\n(.*?)(?=^## |\Z)", DEPLOY, re.M | re.S)
    if not match:
        raise AssertionError("docs/DEPLOY.md has no section called Incident runbook")
    return " ".join(match.group(1).split())


class Runbook(unittest.TestCase):
    def test_a_wallet_can_bounce_a_payout(self):
        text = runbook()
        self.assertNotIn("wallet never bounces", text.lower(), "RT-1: a wallet frozen for the token refuses the payout")
        self.assertRegex(text, r"(?i)frozen", "the runbook names a frozen wallet as a cause of a bounced payout")


class CopyStyle(unittest.TestCase):
    def test_no_dash_and_no_comma_before_and_or_or(self):
        for name, text in PUBLIC.items():
            prose = re.sub(r"```.*?```|`[^`\n]*`", "", text, flags=re.S)
            for line in prose.splitlines():
                self.assertNotRegex(line, r"[–—]", f"{name}: a dash: {line.strip()!r}")
                self.assertNotRegex(line, r", (and|or) ", f"{name}: a comma before and or or: {line.strip()!r}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
