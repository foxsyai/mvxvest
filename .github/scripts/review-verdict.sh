#!/usr/bin/env bash
# Records the Claude review verdict for the claude-review workflow. The workflow copies
# this script from the BASE branch to $RUNNER_TEMP and allows Claude to run exactly that
# copy (see --allowedTools in .github/workflows/claude-review.yml), so a PR cannot rewrite
# its own gate; the "Enforce verdict" step turns the recorded verdict into the job's exit
# status: red on a blocking finding, red when no verdict was recorded.
#   .github/scripts/review-verdict.sh pass  "one-line summary"
#   .github/scripts/review-verdict.sh block "one-line summary of the blocking finding(s)"
set -Eeuo pipefail
verdict="${1:-}"; summary="${2:-}"
case "$verdict" in pass|block) ;; *) echo "usage: $0 pass|block \"summary\"" >&2; exit 2 ;; esac
out="${RUNNER_TEMP:-/tmp}/claude-review-verdict"
# A run ends in exactly one verdict and it can only get stricter: once "block" is on
# file, a later "pass" is refused (review of PR #11: the agent records block at the
# first high finding and pass only when the review is complete; a stray final pass
# must not overwrite the block).
if [[ "$verdict" == "pass" && -s "$out" && "$(sed -n 1p "$out")" == "block" ]]; then
  echo "verdict NOT changed: block is already recorded for this run and cannot be downgraded to pass" >&2
  exit 3
fi
printf '%s\n%s\n' "$verdict" "$summary" > "$out"
echo "verdict recorded: $verdict — $summary"
