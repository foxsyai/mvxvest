#!/usr/bin/env python3
"""Audit 4 (operations): more cases for the reviewer's workspace gate (scripts/ci/review_gate.py).

Run: python3 scripts/ci/audit4_ops_review_gate_test.py

Every case here PASSES on main at 322cb43: the fourth audit probed the gate with sixty inputs its own
table does not cover and found no way past it. These pin what was checked, so a later change to the
gate or to Claude Code's tools keeps the same answers:
  - a Grep pattern that starts with `-` is allowed, because Claude Code 2.1.3xx passes such a pattern
    to ripgrep as `-e <pattern>` (read in the binary: `if(n.startsWith("-"))$e.push("-e",n)`), so no
    ripgrep flag such as --pre can be smuggled through the pattern; the `type` value goes after
    `--type`, where a flag is only an unknown file type;
  - the spellings of the repository, the number and the flags that gh accepts and the gate must too,
    and the ones it must not;
  - heredoc terminators: a trailing blank after the terminator does not end a heredoc for bash, so the
    gate must look for the exact line (and refuses when there is none);
  - the verdict script with an empty or a multi-line summary (harmless: only line 2 is read);
  - the inline comment tool is allowed whatever its arguments (it only posts to this PR).
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GATE = Path(__file__).resolve().parent / "review_gate.py"
REPO = "foxsyai/mvxvest"
PR = "251"


class MoreCases(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(os.path.realpath(self.tmp.name))
        self.ws = root / "repo"
        (self.ws / "src").mkdir(parents=True)
        (self.ws / "src/a.rs").write_text("fn a() {}\n")
        (self.ws / ".git").mkdir()
        (self.ws / ".git/config").write_text("[remote] url = https://x-access-token:SECRET@github.com/o/r\n")
        (self.ws / "dir.git").mkdir()                      # a directory whose name only ends in .git
        (self.ws / "dir.git/x").write_text("x\n")
        self.verdict = str(root / "_temp" / "review-verdict.sh")
        self.log = root / "gate.log"

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, tool, cwd=None, **tool_input):
        event = {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input,
                 "cwd": str(self.ws if cwd is None else cwd)}
        p = subprocess.run([sys.executable, str(GATE), "check", "--workspace", str(self.ws), "--log", str(self.log),
                            "--verdict", self.verdict, "--repository", REPO, "--pull-request", PR],
                           input=json.dumps(event), capture_output=True, text=True, timeout=30)
        return p.returncode, p.stderr

    def allowed(self, tool, cwd=None, **tool_input):
        code, err = self.call(tool, cwd=cwd, **tool_input)
        self.assertEqual(code, 0, f"{tool} {tool_input} was refused: {err}")

    def refused(self, tool, cwd=None, **tool_input):
        code, err = self.call(tool, cwd=cwd, **tool_input)
        self.assertEqual(code, 2, f"{tool} {tool_input} was let through (exit {code})")
        self.assertIn("review gate", err)

    def test_a_pattern_or_type_that_looks_like_a_ripgrep_flag_cannot_run_anything(self):
        # Claude Code passes a pattern starting with `-` as `-e <pattern>` and the type after `--type`.
        self.allowed("Grep", pattern="-f/etc/passwd")
        self.allowed("Grep", pattern="--pre=/bin/sh")
        self.allowed("Grep", pattern="x", type="--pre=/bin/sh")

    def test_names_that_only_end_in_git_are_not_the_git_directory(self):
        self.allowed("Read", file_path="dir.git/x")
        self.allowed("Grep", pattern="x", glob="dir.git/*")
        self.allowed("Glob", pattern="dir.git/*")
        self.allowed("Grep", pattern="x", glob="**/*.gitconfig")

    def test_the_working_directory_may_be_a_spelling_of_the_workspace_but_never_git(self):
        self.allowed("Read", file_path="src/a.rs", cwd=str(self.ws) + "/src/..")
        self.allowed("Glob", pattern="*", path="src/../src")
        self.refused("Read", file_path="src/a.rs", cwd=str(self.ws) + "/.git")
        self.refused("Read", file_path="/proc/self/cwd/src/a.rs")
        self.refused("Read", file_path="/dev/fd/0")
        self.refused("Glob", pattern="**/*.rs", path="/proc/self/cwd")

    def test_every_field_whose_name_sounds_like_a_path_is_checked(self):
        self.refused("Read", file_path="src/a.rs", file_path2="/etc/passwd")
        self.allowed("Read", file_path="src/a.rs", offset="/etc/passwd")   # not a path field; Claude Code rejects it

    def bash_allowed(self, command):
        code, err = self.call("Bash", command=command, description="d")
        self.assertEqual(code, 0, f"{command!r} was refused: {err}")

    def bash_refused(self, command):
        code, err = self.call("Bash", command=command, description="d")
        self.assertEqual(code, 2, f"{command!r} was let through (exit {code})")

    def test_gh_spellings_that_are_the_same_command_to_gh(self):
        for c in ("gh\tpr\tview\t251", "gh pr view 251 --json=files,title", "gh pr view 251 --json files --repo FOXSYAI/MVXVEST",
                  "gh pr diff 251 --color=always", "gh pr view 00251", "gh pr view 251 -c -c",
                  "gh pr comment 251 --edit-last --body-file - <<'EOF'\nx\nEOF", "gh pr comment 251 --body-file - <<'E'\nx\nE"):
            self.bash_allowed(c)

    def test_gh_spellings_that_are_another_command_or_another_repository(self):
        for c in ("gh pr view +251", "gh pr view 251 -R=foxsyai/mvxvest", "gh pr view 251 --repo foxsyai/mvxvest/",
                  "gh pr view 251 --repo github.com/foxsyai/mvxvest", "gh pr view 251 --repo https://github.com/foxsyai/mvxvest",
                  "gh pr view 251 --json files;", "gh pr view 251 --comments --json"):
            self.bash_refused(c)

    def test_heredoc_terminators_the_way_bash_reads_them(self):
        # "EOF " is not a terminator for bash: the heredoc runs to the real one or to the end.
        self.bash_allowed("gh pr comment 251 --body-file - <<'EOF'\nx\n EOF\nEOF")
        self.bash_allowed("gh pr comment 251 --body-file - <<'EOF'\nx\nEOF\n\n\t \n")
        self.bash_refused("gh pr comment 251 --body-file - <<'EOF'\nx\nEOF\n#")

    def test_verdict_summaries_that_are_only_text(self):
        self.bash_allowed(f"{self.verdict} pass ''")
        self.bash_allowed(f"{self.verdict} pass 'a\nb'")
        self.bash_allowed(f"{self.verdict} pass ::error::x")     # the workflow prints it after a prefix
        self.bash_allowed(f"'{self.verdict}' 'pass' 'x'")

    def test_the_inline_comment_tool_posts_only_to_this_pull_request(self):
        self.allowed("mcp__github_inline_comment__create_inline_comment", path="/etc/passwd", line=1, body="x")
        self.allowed("ToolSearch", query="select:Bash")


if __name__ == "__main__":
    unittest.main()
