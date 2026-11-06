---
name: codex-task
description: Dispatch an approved auto-canvas task to Codex, review the result independently, then commit it and open a PR or write a review round and redispatch. Use after plan-task, on the task's branch.
---

# codex-task

## Dispatch

Run `scripts/codex-task.sh tasks/<id>-<slug>` with Bash `run_in_background`
(Codex rounds take many minutes). Do not poll; wait for the completion
notification. Tell the user the round started and where the logs are.

## Review

Codex's `report.md` and final `STATUS:` line are claims. Establish the facts
yourself:

1. `git status --short` and `git diff --stat main`: every changed path is in
   the plan's owned paths; nothing in plan.md or review.md changed; no
   lockfile or dependency change unless planned.
2. Rerun every acceptance command. Compare against `.baseline/` for commands
   that were already failing before the task.
3. Read the diff. Check it against the plan's steps and CODING_STANDARDS.md:
   removed behavior really is unreachable, kept behavior still has tests,
   no test was weakened to pass, no silent design change.
4. Read report.md's deviations and investigation results; decide each.

## Decide

- **Accepted:** append the round to `review.md` (verdict accepted), commit on
  the task branch with a message that states what changed, why, validation
  and known limits, a Test-Impact trailer and the attribution line. Then
  deliver it as a PR (below).
- **Changes requested:** append a round to `review.md` from
  `tasks/_template/review.md` with concrete must-fix findings (path, what is
  wrong, what done looks like), then dispatch again. Do not commit Codex's
  partial work between rounds.
- **After round 3**, or when a finding needs a product decision or a change of
  plan, stop and ask the user. A plan change edits plan.md (note it in
  review.md) before the next round.

## Deliver

Follow [PR review and merge](../../../docs/workflow.md#pr-评审与合入):

1. `git push -u origin task/<id>-<slug>`, then `gh pr create --base main` using
   `.github/pull_request_template.md`. Put the acceptance commands you reran
   and their results under Evidence: CI on a PR does not run the build or tests.
2. Read the review the codex hook posts to the PR. Verify each finding. Fix P0/P1
   findings that hold, push, and read the re-review. No comment on the current
   head means no review: run it by hand.
3. Merge only if this delivery authorizes it, `gh pr checks` meets the workflow's
   merge condition (only the `merge_group` jobs may be `skipping`) and
   `~/.claude/hooks/codex-pr-review.sh verify <PR>` succeeds, or the workflow's
   manual check does where the hook is not installed:
   `gh pr merge <PR> --rebase`. Confirm `state` is `MERGED`. Otherwise hand back
   the PR link and its status.

## Small fixes

Fix a few lines yourself only when explaining the fix would take longer than
making it; note it in review.md.
