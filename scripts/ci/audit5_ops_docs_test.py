#!/usr/bin/env python3
"""Audit 5 (operations): what the review workflow installs, and what the public documents say.

Run: python3 scripts/ci/audit5_ops_docs_test.py
With MVXVEST_LIVE=1 it also compares the pinned CLI hash with the npm registry's.

OPZ-06  The review's runner holds the review token and a GITHUB_TOKEN. Left to itself claude-code-action pipes
        https://claude.ai/install.sh, which nothing pins, into bash. Every step that uses the action must run a CLI
        fetched from npm at a fixed version and checked against a hash written in the workflow (as mvxsafe has done
        since 22 Oct 2026).
OPS-7   A truncated wallet address in a test's comment: wallets stay out of public material.
OPS-8   No runbook said who does what when a bug is found after the announcement, or how a holder with a stuck key
        is helped. The upgrade runbook did not say that each signer derives the release hash alone.
OPS-9   multisig.ts said mvxsafe cannot propose calls (DEPLOY.md says it can), scripts/README.md said the scripts
        refuse any mainnet key (the deployer key loads with MVXVEST_MAINNET_GO=yes), security.txt had no Canonical line.
"""
import json
import os
import re
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REVIEW = (ROOT / ".github/workflows/claude-review.yml").read_text()
DEPLOY = (ROOT / "docs/DEPLOY.md").read_text()
SECURITY = (ROOT / "SECURITY.md").read_text()


def runbook():
    match = re.search(r"^## Incident runbook\n(.*?)(?=^## |\Z)", DEPLOY, re.M | re.S)
    if not match:
        raise AssertionError("docs/DEPLOY.md has no section called Incident runbook")
    return " ".join(match.group(1).split())


class ReviewCli(unittest.TestCase):
    def steps(self):
        return list(re.finditer(r"uses: anthropics/claude-code-action@", REVIEW))

    def test_every_review_step_runs_the_pinned_executable(self):
        steps = self.steps()
        self.assertTrue(steps, "the workflow runs the action")
        spots = list(re.finditer(r"^\s+path_to_claude_code_executable: \$\{\{ env\.CLAUDE_CLI \}\}$", REVIEW, re.M))
        self.assertEqual(len(spots), len(steps), "a review step lets the action run its installer")

    def test_the_cli_comes_from_npm_at_a_version_and_a_hash(self):
        self.assertRegex(REVIEW, r"CLI_VERSION: '\d+\.\d+\.\d+'")
        self.assertRegex(REVIEW, r"CLI_SHA512: '[A-Za-z0-9+/]{86}=='")
        self.assertIn("https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/", REVIEW)
        self.assertIn('if [[ "$got" != "$CLI_SHA512" ]]; then', REVIEW)
        self.assertIn('echo "CLAUDE_CLI=', REVIEW)
        self.assertLess(REVIEW.index("CLI_SHA512:"), self.steps()[0].start(), "the CLI is in place before the first review step")

    def test_nothing_is_piped_into_a_shell(self):
        self.assertNotRegex(REVIEW, r"(?m)^[^#\n]*curl[^\n]*\|\s*(ba)?sh")

    @unittest.skipUnless(os.environ.get("MVXVEST_LIVE") == "1", "set MVXVEST_LIVE=1 to compare with the npm registry")
    def test_the_hash_is_the_registrys(self):
        version = re.search(r"CLI_VERSION: '([\d.]+)'", REVIEW).group(1)
        sha = re.search(r"CLI_SHA512: '([^']+)'", REVIEW).group(1)
        url = f"https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/{version}"
        with urllib.request.urlopen(url, timeout=30) as answer:
            self.assertEqual(json.load(answer)["dist"]["integrity"], f"sha512-{sha}")


class NoWalletInTests(unittest.TestCase):
    def test_the_capture_guards_comment_names_no_wallet(self):
        text = (ROOT / "dapp/src/tests/audit3_ops_capture_guards.test.ts").read_text()
        self.assertNotRegex(text, r"erd1[0-9a-z]{2,}…")


class Runbook(unittest.TestCase):
    def test_security_links_to_the_runbook(self):
        self.assertIn("docs/DEPLOY.md#incident-runbook", SECURITY)

    def test_pause_says_what_it_stops(self):
        text = runbook()
        self.assertRegex(text, r"Pause stops only new creations")
        self.assertRegex(text, r"cannot pause claims or cancels")
        self.assertIn("propose pause", text)

    def test_a_fix_is_an_upgrade_with_the_hash_derived_alone(self):
        text = runbook()
        self.assertIn("reproducible build", text)
        self.assertIn("shard 1", text)
        self.assertIn("MVXVEST_EXPECT_HASH", text)
        self.assertIn("never from the other signer's message", text)

    def test_the_site_lists_both_hashes_before_the_vote(self):
        text = runbook()
        self.assertIn("list both", text)
        self.assertIn("before the vote", text)
        self.assertIn("red banner", text)

    def test_holders_are_told(self):
        self.assertIn("holders", runbook().lower())

    def test_a_stuck_key_or_a_bounced_payout(self):
        text = runbook()
        self.assertIn("propose recover-bounced", text)
        self.assertIn("propose recover-surplus", text)
        self.assertRegex(text, r"events")
        self.assertRegex(text, r"Report a vulnerability|security/advisories|github\.com/foxsyai/mvxvest/issues")

    def test_a_rollback_can_be_refused_and_what_to_do_then(self):
        # OLD_COMMIT=1 skips only the tip check: today's audit and the live hash gate still judge the old commit.
        text = runbook()
        self.assertIn("A rollback can be refused", text)
        self.assertIn("revert", text)
        self.assertIn("Never weaken a gate", text)

    def test_the_upgrade_runbook_says_the_same_about_the_hash(self):
        match = re.search(r"\*\*Each signer checks, then signs:\*\*(.*?)(?=^\d+\. \*\*)", DEPLOY, re.M | re.S)
        self.assertIsNotNone(match)
        self.assertIn("never from the other signer's message", " ".join(match.group(1).split()))

    def test_copy_style(self):
        text = runbook()
        self.assertNotRegex(text, r"[–—]", "no dashes")
        self.assertNotRegex(re.sub(r"`[^`]*`", "", text), r",\s+(and|or)\b", "no comma before and or or")


class Drift(unittest.TestCase):
    def test_multisig_header_says_what_mvxsafe_can_do(self):
        head = (ROOT / "scripts/src/multisig.ts").read_text()[:400]
        self.assertNotIn("cannot propose", head)

    def test_scripts_readme_says_what_the_scripts_allow_on_mainnet(self):
        text = " ".join((ROOT / "scripts/README.md").read_text().split())
        self.assertNotIn("The scripts refuse to load a mainnet key", text)
        self.assertIn("MVXVEST_MAINNET_GO=yes", text)

    def test_mainnet_state_file_is_not_needed(self):
        self.assertRegex(" ".join(DEPLOY.split()), r"no state file")

    def test_security_txt_is_canonical_for_both_sites(self):
        text = (ROOT / "dapp/public/.well-known/security.txt").read_text()
        for host in ("mvxvest.io", "devnet.mvxvest.io"):
            self.assertIn(f"Canonical: https://{host}/.well-known/security.txt\n", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
