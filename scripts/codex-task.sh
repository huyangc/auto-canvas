#!/usr/bin/env bash
# Run one Codex implementation round for a task directory.
#
#   scripts/codex-task.sh tasks/T001-<slug>
#
# Requires: plan.md marked "Status: approved", the current branch equal to the
# plan's Branch line, and (round 1) no uncommitted changes outside the task
# directory. CODEX_MODEL overrides the model. See docs/workflow.md.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

task="${1:?usage: scripts/codex-task.sh tasks/<id>-<slug>}"
task="${task%/}"
plan="$task/plan.md"
[[ -f "$plan" ]] || { echo "No $plan" >&2; exit 2; }

grep -qE '^- Status: approved\b' "$plan" ||
  { echo "$plan is not marked '- Status: approved'" >&2; exit 2; }

branch="$(sed -nE 's/^- Branch: `([^`]+)`.*/\1/p' "$plan" | head -1)"
[[ -n "$branch" ]] || { echo "$plan has no '- Branch: \`...\`' line" >&2; exit 2; }
current="$(git branch --show-current)"
[[ "$current" == "$branch" ]] ||
  { echo "On '$current'; the plan expects '$branch'" >&2; exit 2; }

logs="$task/logs"
mkdir -p "$logs"
round=$(( $(find "$logs" -name 'round-*.jsonl' -size +0 | wc -l) + 1 ))

if (( round == 1 )); then
  outside="$(git status --porcelain --untracked-files=all | awk '{print $NF}' | grep -v "^$task/" || true)"
  [[ -z "$outside" ]] ||
    { echo "Uncommitted changes outside $task:" >&2; echo "$outside" >&2; exit 2; }
fi

review_line=""
[[ -f "$task/review.md" ]] &&
  review_line="Then read $task/review.md and fix every must-fix finding of its latest round."

prompt="$logs/round-$round-prompt.md"
cat > "$prompt" <<EOF
You are the implementer in this repository. Follow AGENTS.md exactly.

Task directory: $task (round $round). Branch: $branch.
Read $task/plan.md in full. $review_line
Implement the plan, run every acceptance command it lists, and write
$task/report.md for round $round using tasks/_template/report.md.
Do not commit, switch branches, or edit plan.md or review.md.

End with a final message whose first line is exactly one of
STATUS: done | STATUS: partial | STATUS: blocked
followed by at most five lines of summary.
EOF

echo "Codex round $round on $branch → $logs/round-$round.jsonl"
model_args=()
[[ -n "${CODEX_MODEL:-}" ]] && model_args=(-m "$CODEX_MODEL")

set +e
codex exec -C "$root" --approve-for-me --json \
  ${model_args[@]+"${model_args[@]}"} \
  -o "$logs/round-$round-last.md" - <"$prompt" \
  >"$logs/round-$round.jsonl" 2>"$logs/round-$round.stderr"
status=$?
set -e

echo "codex exit $status"
[[ -f "$logs/round-$round-last.md" ]] && cat "$logs/round-$round-last.md"
exit "$status"
