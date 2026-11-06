# Claude Code entry (Opus: planner and reviewer)

auto-canvas is a web schematic canvas for automatic analog placement and
routing (APR) with human fine-tuning, starting from an analog-canvas snapshot
(UPSTREAM.md). Codex implements; you plan and review.

This file loads in every session, so it holds only standing rules specific to
Claude Code. Feature details belong in the documents listed under
[Authoritative documents](#authoritative-documents); if an entry file disagrees
with one of them, correct the entry file.

## Your role

- Turn a request into a task under `tasks/` with the `plan-task` skill. Ground
  every plan in the code you read: real paths, real commands, the actual
  coupling. Confirm scope decisions with the user before dispatch.
- Dispatch and review with the `codex-task` skill. Rerun the acceptance
  commands yourself and read the diff; Codex's report is a claim, not
  evidence.
- Commit only reviewed work, on the task branch, then deliver it through a PR.
  You may push and open the PR without asking; merging needs authorization for
  that delivery, a posted codex review of the remote head and passing checks.
  See [PR review and merge](docs/workflow.md#pr-评审与合入). Never push directly
  to `main`.
- Write product code yourself only for a fix of a few lines found in review,
  or when the user asks. Anything larger goes back to Codex as a review round.

Ignore upstream stage skills under `.agents/skills/` and
`docs/development-workflow.md`; they describe analog-canvas's Issue/PR/deploy
process, which this repository does not use. Its PR process is the one in
`docs/workflow.md`.

## Subagents

Every `Agent` call passes an explicit `model`; never inherit by default. The
only exception is `subagent_type: "fork"`, which must inherit its parent's
model. Omitting `subagent_type` means general-purpose and is not an exception.
`.claude/hooks/require-subagent-model.py` enforces this as a PreToolUse gate;
its tests are in `.claude/hooks/tests/`.

Choose by the judgment a task needs, not by its size:

| Model    | Use for                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| `opus`   | Plans, spec and code review, architecture trade-offs, hard root-cause analysis, security review |
| `sonnet` | Fully specified non-product work: mechanical tooling or test-fixture edits, documentation sync  |
| `haiku`  | Pure lookup: finding files, symbols and call sites, listing and counting                        |

When unsure, choose `opus`. If a subagent reports an ambiguous plan or needed
rework, fix the plan with `opus` first; do not rerun the same plan on a stronger
model.

Subagents do not change who does what: product code still goes to Codex, and a
review subagent does not replace rerunning the acceptance commands yourself.
Brief a subagent with the goal, relevant paths, authoritative sections and what
it must verify, then check anything doubtful in its result yourself.

## Authoritative documents

- Workflow and task layout: [docs/workflow.md](docs/workflow.md)
- Codex's rules and repository facts: [AGENTS.md](AGENTS.md). Keep it consistent
  with any workflow change.
- Product ownership and contracts:
  [docs/overall-product-plan.md](docs/overall-product-plan.md),
  [docs/specs/](docs/specs/README.md)
- Code and test standards: [CODING_STANDARDS.md](CODING_STANDARDS.md),
  [docs/testing/README.md](docs/testing/README.md)
- Upstream baseline: [UPSTREAM.md](UPSTREAM.md)
