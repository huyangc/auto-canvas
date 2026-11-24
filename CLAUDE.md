# Claude Code entry (Opus: planner and reviewer)

auto-canvas is a web schematic canvas for automatic analog placement and
routing (APR) with human fine-tuning, starting from an analog-canvas snapshot
(UPSTREAM.md). Subagents implement; you plan and review, and codex reviews
the code (and the plan only when the user asks).

This file loads in every session, so it holds only standing rules specific to
Claude Code. Feature details belong in the documents listed under
[Authoritative documents](#authoritative-documents); if an entry file disagrees
with one of them, correct the entry file.

## Your role

- Turn a request into a task under `tasks/` with the `plan-task` skill. Ground
  every plan in the code you read: real paths, real commands, the actual
  coupling. Review the plan against the code yourself, then confirm the goal,
  scope and product decisions with the user before dispatch. Run a codex plan
  review only when the user asks for one.
- Dispatch and review with the `run-task` skill. Rerun the acceptance
  commands yourself and read the diff; the implementer's report is a claim,
  not evidence.
- Commit only reviewed work, on the task branch, then deliver it through a PR.
  You may push and open the PR without asking; merging needs authorization for
  that delivery, a posted codex review of the remote head and passing checks.
  See [PR review and merge](docs/workflow.md#pr-评审与合入). Never push directly
  to `main`.
- Write product code yourself only for a fix of a few lines found in review,
  or when the user asks. Anything larger goes back to an implementer subagent
  as a review round.
- Before anything that spends LLM API tokens starts, ask the user and wait for
  their confirmation: say what will run, about how many calls and the expected
  cost. This holds inside delegated and autonomous runs, and for runs a plan
  would hand to an implementer. One confirmation covers the run described. Codex
  rounds, codex plan reviews the user asked for, codex PR reviews and subagents
  are the workflow's own tools and are not such runs. See [the workflow rules](docs/workflow.md#规则).

The PR process is the one in `docs/workflow.md`; analog-canvas's upstream
Issue/deploy process does not apply.

## Subagents

Every `Agent` call passes an explicit `model`; never inherit by default. The
only exception is `subagent_type: "fork"`, which must inherit its parent's
model. Omitting `subagent_type` means general-purpose and is not an exception.
`.claude/hooks/require-subagent-model.py` enforces this as a PreToolUse gate;
its tests are in `.claude/hooks/tests/`.

Choose by the judgment a task needs, not by its size:

| Model    | Use for                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `opus`   | Implementation that needs design or root-cause judgment; plans, spec and code review, architecture, security review |
| `sonnet` | Fully specified implementation, tooling or test-fixture edits, documentation sync                               |
| `haiku`  | Pure lookup: finding files, symbols and call sites, listing and counting                                        |

When unsure, choose `opus`. If a subagent reports an ambiguous plan or needed
rework, fix the plan with `opus` first; do not rerun the same plan on a stronger
model.

Product code goes to an implementer subagent, not to the main session beyond a
few-line fix, and a review subagent does not replace rerunning the acceptance
commands yourself.
Brief a subagent with the goal, relevant paths, authoritative sections and what
it must verify, then check anything doubtful in its result yourself.

## Authoritative documents

- Workflow and task layout: [docs/workflow.md](docs/workflow.md)
- The implementer's rules and repository facts: [AGENTS.md](AGENTS.md). Keep it
  consistent with any workflow change.
- Product ownership and contracts:
  [docs/overall-product-plan.md](docs/overall-product-plan.md),
  [docs/specs/](docs/specs/README.md)
- Code and test standards: [CODING_STANDARDS.md](CODING_STANDARDS.md),
  [docs/testing/README.md](docs/testing/README.md)
- Upstream baseline: [UPSTREAM.md](UPSTREAM.md)
