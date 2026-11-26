---
name: plan-task
description: Turn a request into an auto-canvas task for an implementer. Investigates the code, writes tasks/<id>-<slug>/plan.md from the template, confirms scope with the user, marks it approved in its dedicated worktree. Use before any implementation work in this repository.
---

# plan-task

The plan is the only context the implementer gets besides AGENTS.md. Write it
for a capable engineer who has never seen this conversation.

1. **Number and name.** Next free `T<nnn>` under `tasks/`; slug in lowercase
   kebab case. For a new task, create its dedicated worktree from the planned
   base as described in the [workflow](../../../docs/workflow.md#并行任务).
   Record the path and branch at creation. Use the existing task worktree
   for a continuation, or the checkout explicitly chosen by the developer.
   Copy `tasks/_template/plan.md` in that worktree.
2. **Investigate before writing.** Read the code the request touches. Record
   in Context the facts that matter: entry points, importers of what will
   change (`grep -rn` the symbol), generated files and their generators,
   tests that cover the behavior, scripts and CI entries that reference the
   paths. Give paths with line numbers.
3. **Size it.** One task's diff must be reviewable in one pass. Split large
   work (for removals: cut entry points first, then delete code that became
   unreachable, then remove now-unused tests, scripts and docs). A removal's
   owned paths must cover every importer of what it deletes, across the whole
   repository (`worker/`, `scripts/`, build/census/dev code, other packages'
   tests), or the plan must say which code stays and why. Otherwise the
   implementer correctly stops at the boundary and the deletion is left half done (T001).
4. **Write steps and acceptance.** Steps are ordered and name files and
   functions. Unknowns become "Investigate:" steps with what to report.
   Acceptance lists exact commands with expected results, plus behavioral
   checks. Include the baseline commands that passed on `main`
   (`.baseline/status` and its logs) so regressions are visible.
5. **Plan review.** By default, review the plan yourself against the code you
   read and go on to step 6; do not run codex unless the user asks for a plan
   review. When asked, have codex review the plan read-only; commands and rules
   are in [Plan review](../../../docs/workflow.md#方案评审). Verify each finding
   against the code, revise the plan, and repeat until a round reports no
   P0/P1. Record the rounds and verdict in the plan's `Plan review` line; raw
   outputs go under `tasks/<id>/logs/`.
6. **Confirm with the user** the goal, scope and any product decision the plan
   makes (what replaces a removed feature, what stays). If the
   confirmation changes the plan's scope or design, review the plan again; if
   that changes scope or a product decision again, go back to the user. Set
   `- Status: approved` and record the base commit only once the user has
   confirmed the final reviewed scope and product decisions.
7. **Handoff.** Verify the checkout and branch match the task record, commit
   the plan alone (`Plan T<nnn>: <title>`) on that branch, and pass its worktree
   path and branch to `run-task`.
