#!/usr/bin/env python3
"""Audit 5 (operations): the release path of the contract and the site, as the repository describes it.

Run: python3 scripts/ci/audit5_ops_release_path_test.py

Two tests FAIL on main at 26b0d4c:

OPS-5  The reproducible build's Docker image is named by a tag (multiversx/sdk-rust-contract-builder:v12.0.0)
       everywhere the release is built: ci.yml's "Reproducible build" step, README.md, docs/DEPLOY.md. A tag can
       be moved by whoever controls the image name (or a registry in the way): every signer who rebuilds the
       release then gets the SAME other bytes, so "my build matches the source's hash" proves nothing about the
       source any more. ci.yml's own comment (line 176) says every action and image is pinned by commit or digest;
       the builder image is the one that is not. The digest of the image this machine built 65c689b9... with on
       1 Nov 2026 is sha256:879be3d1a7f7f51ac5ff807b15f1d75498d86ed25f54c61650fd616e80bae963 (docker images
       --digests). Fix: name the image as multiversx/sdk-rust-contract-builder@sha256:879be3d1... in ci.yml,
       README.md and DEPLOY.md (sc-meta passes the reference to docker as is).

OPS-6  dapp/deploy.sh publishes a mainnet site whose contractCodeHashes may not contain the hash mainnet runs: it
       checks the tree, the branch, the tests and its own build marker, and after the upload only version.txt. The
       check that the config's hashes contain the live hash lives in CI (ci.yml, "Reproducible build matches a
       known mainnet code hash"), which the maintainer's admin-bypass merges skip, and deploy.sh asks neither CI's
       status nor the chain. The backstop is the site's own red banner ("do not sign anything"), which turns the
       mistake into an outage for every visitor instead of a refused deploy. Fix: before the upload, read
       https://api.multiversx.com/accounts/<contract>?fields=codeHash and refuse when it is not in the config.

The other tests pin what held: the actions are pinned by commit, gitleaks by digest, deploy.sh refuses a dirty tree
and a commit that is not on origin/main, and compares the live version.txt after the upload.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = (ROOT / ".github/workflows/ci.yml").read_text()
README = (ROOT / "README.md").read_text()
DEPLOY_MD = (ROOT / "docs/DEPLOY.md").read_text()
DEPLOY_SH = (ROOT / "dapp/deploy.sh").read_text()
IMAGE = re.compile(r"multiversx/sdk-rust-contract-builder(?P<ref>[:@][^\s\\`'\")]+)")


class ReproducibleBuildImage(unittest.TestCase):
    def references(self, text):
        return [m.group("ref") for m in IMAGE.finditer(text)]

    def test_ci_builds_the_release_from_an_image_pinned_by_digest(self):
        """FAILS (OPS-5): ci.yml names the builder image by the tag v12.0.0."""
        refs = self.references(CI)
        self.assertTrue(refs, "ci.yml runs the reproducible build")
        for ref in refs:
            self.assertRegex(ref, r"^@sha256:[0-9a-f]{64}$", f"ci.yml builds the release with the image {ref!r}, a tag that can move")

    def test_readme_and_deploy_runbook_name_the_same_digest(self):
        """FAILS (OPS-5): README.md and docs/DEPLOY.md tell a signer to rebuild with the tag."""
        for name, text in (("README.md", README), ("docs/DEPLOY.md", DEPLOY_MD)):
            refs = [r for r in self.references(text) if r.startswith("@sha256:")]
            self.assertTrue(refs, f"{name} names the builder image by digest nowhere; a signer rebuilding the release gets whatever the tag points at")


class DeployScript(unittest.TestCase):
    def test_deploy_refuses_a_site_whose_config_does_not_know_the_live_hash(self):
        """FAILS (OPS-6): deploy.sh never reads the contract's code hash from the chain."""
        upload = DEPLOY_SH.index("rsync -a --delete")
        before = DEPLOY_SH[:upload]
        self.assertTrue(
            re.search(r"accounts/.*codeHash|codeHash.*accounts/", before, re.S),
            "deploy.sh does not compare contractCodeHashes with the hash mainnet runs before the upload",
        )

    # ------------------------------------------------------------ pins
    def test_deploy_refuses_a_dirty_tree_and_a_commit_off_origin_main(self):
        self.assertIn("git status --porcelain --untracked-files=all", DEPLOY_SH)
        self.assertIn("git merge-base --is-ancestor HEAD origin/main", DEPLOY_SH)
        self.assertLess(DEPLOY_SH.index("merge-base --is-ancestor"), DEPLOY_SH.index("rsync -a --delete"))

    def test_deploy_checks_the_live_version_after_the_upload(self):
        after = DEPLOY_SH[DEPLOY_SH.index("rsync -a --delete"):]
        self.assertIn("version.txt", after)
        self.assertIn('[ "$live" = "$(cat build/version.txt)" ]', after)


class ActionPins(unittest.TestCase):
    def test_every_action_is_pinned_by_a_full_commit(self):
        for wf in (ROOT / ".github/workflows").glob("*.yml"):
            for m in re.finditer(r"^\s*-?\s*uses:\s*([^\s#]+)", wf.read_text(), re.M):
                self.assertRegex(m.group(1), r"@[0-9a-f]{40}$", f"{wf.name}: {m.group(1)}")

    def test_gitleaks_image_is_pinned_by_digest(self):
        self.assertRegex(CI, r"ghcr\.io/gitleaks/gitleaks@sha256:[0-9a-f]{64}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
