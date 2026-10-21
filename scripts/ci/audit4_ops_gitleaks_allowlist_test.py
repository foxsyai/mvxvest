#!/usr/bin/env python3
"""Audit 4 (operations): the gitleaks allowlist in .gitleaks.toml hides more than token identifiers.

Run: python3 scripts/ci/audit4_ops_gitleaks_allowlist_test.py   (needs docker, as CI's secrets job does)

The allowlist regex `\\b[A-Z0-9]{3,10}-[0-9a-f]{6}(-[0-9a-f]{2,16})?\\b` is meant for MultiversX token
identifiers such as VESTKEY-8f217c-c9. gitleaks applies an allowlist regex to the SECRET of a finding
with a search, not a whole match (regexTarget defaults to "secret"), so any secret that merely CONTAINS
a token-shaped prefix is dropped: `RLXKEY-9f31ac-7b2e4d9c0a1f5e6b8d3c2a1b` is hidden while the same
secret without the dashes is reported. FAILS on main at 322cb43; passes once the regex is anchored to
the whole secret (`^...$`), which keeps every real token identifier allowlisted (the full history still
scans clean with the anchored regex: checked with gitleaks v8.30.1 on 21 Oct 2026).
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"   # v8.30.1, the digest ci.yml runs


@unittest.skipUnless(shutil.which("docker"), "docker is needed to run gitleaks, as CI's secrets job does")
class Allowlist(unittest.TestCase):
    def scan(self, folder):
        p = subprocess.run(["docker", "run", "--rm", "-v", f"{folder}:/probe:ro", IMAGE, "dir", "/probe",
                            "--config", "/probe/.gitleaks.toml", "--no-banner", "--redact", "--verbose"],
                           capture_output=True, text=True, timeout=300)
        return p.returncode, p.stdout + p.stderr

    def test_a_secret_that_merely_starts_like_a_token_identifier_is_still_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.realpath(tmp)
            shutil.copy(ROOT / ".gitleaks.toml", Path(folder) / ".gitleaks.toml")
            (Path(folder) / "hidden.ts").write_text('const apiKey = "RLXKEY-9f31ac-7b2e4d9c0a1f5e6b8d3c2a1b";\n')  # gitleaks:allow (a made-up probe)
            (Path(folder) / "visible.ts").write_text('const apiKey = "RLXKEYQ9f31acX7b2e4d9c0a1f5e6b8d3c2a1b";\n')  # gitleaks:allow (a made-up probe)
            code, output = self.scan(folder)
            self.assertIn("visible.ts", output, "the control secret must be reported (gitleaks ran)")
            self.assertNotEqual(code, 0, "gitleaks exits 1 when it finds leaks")
            self.assertIn("hidden.ts", output,
                          "a 38-character secret is hidden because its first 13 characters look like a token id")

    def test_a_real_token_identifier_stays_allowlisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = os.path.realpath(tmp)
            shutil.copy(ROOT / ".gitleaks.toml", Path(folder) / ".gitleaks.toml")
            (Path(folder) / "keys.ts").write_text('const claimKey = "VESTKEY-8f217c-c9";\nconst token = "TFOX-d61b09";\n')
            code, output = self.scan(folder)
            self.assertEqual(code, 0, output)
            self.assertIn("no leaks found", output)


if __name__ == "__main__":
    unittest.main()
