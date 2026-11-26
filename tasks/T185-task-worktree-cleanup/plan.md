# T185 — Retire the task worktree after delivery

- Branch: `codex/task-worktree-cleanup`
- Base: `main` at `d02237bb`
- Status: approved

Document the owner's requested worktree lifecycle in AGENTS.md, docs/workflow.md and the Deliver section of .claude/skills/run-task/SKILL.md. Cover new tasks, continuation of the same task, PR-only and merge-authorized delivery, and safe removal of only the worktree created for that task.

Run the repository Markdown link check and diff whitespace check. Exercise clean removal and dirty-tree refusal in a temporary Git repository. At handoff, apply the documented checks to the real task worktree.
