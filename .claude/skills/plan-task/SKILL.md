---
name: plan-task
description: Turn a request into an auto-canvas task for Codex. Investigates the code, writes tasks/<id>-<slug>/plan.md from the template, confirms scope with the user, marks it approved and opens the task branch. Use before any implementation work in this repository.
---

# plan-task

The plan is the only context Codex gets besides AGENTS.md. Write it for a
capable engineer who has never seen this conversation.

1. **Number and name.** Next free `T<nnn>` under `tasks/`; slug in lowercase
   kebab case. Copy `tasks/_template/plan.md`.
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
   tests), or the plan must say which code stays and why. Otherwise Codex
   correctly stops at the boundary and the deletion is left half done (T001).
4. **Write steps and acceptance.** Steps are ordered and name files and
   functions. Unknowns become "Investigate:" steps with what to report.
   Acceptance lists exact commands with expected results, plus behavioral
   checks. Include the baseline commands that passed on `main`
   (`.baseline/status` and its logs) so regressions are visible.
5. **Confirm with the user** the goal, scope and any product decision the plan
   makes (what replaces a removed feature, what stays). Then set
   `- Status: approved` and record the base commit.
6. **Branch.** From a clean `main`: `git switch -c task/<id>-<slug>`, commit
   the plan alone (`Plan T<nnn>: <title>`), and hand over to `codex-task`.
