# Agent Entry (Codex: implementer)

auto-canvas is a web schematic canvas for automatic analog placement and
routing (APR) with human fine-tuning. It starts from an analog-canvas snapshot
(UPSTREAM.md). The repository workflow is in [docs/workflow.md](docs/workflow.md):
Opus plans and reviews, Codex implements.

These rules replace the upstream analog-canvas process. Ignore upstream stage
skills under `.agents/skills/` (implement, implement-spec, pr, to-spec,
to-tickets, retro) and `docs/development-workflow.md`: there are no Issues,
deployments or Production acceptance here. Opus delivers reviewed work through
a PR; see the workflow document.

## When you are given a task

1. Read the task's `plan.md` in full, then `review.md` if it exists. A review
   lists findings from the previous round; fix every one marked `must-fix`.
2. Run `git status --short --branch`. Work only on the branch the plan names.
   Leave unrelated changes alone.
3. Implement the plan's steps in order. Stay inside its owned paths. If a step
   is impossible, wrong or would need an out-of-scope change, stop that step
   and record why in the report instead of improvising a different design.
4. Run every acceptance command in the plan. A failing command is fixed or
   reported with its output; never weaken, skip or delete a test to make it
   pass unless the plan puts that test in scope for removal.
5. Write the task's `report.md` from `tasks/_template/report.md`.

## Hard rules

- Do not commit, push, merge, rebase or switch branches. Opus commits after
  review.
- Do not edit `plan.md` or `review.md`.
- Do not install, upgrade or remove dependencies or change `pnpm-lock.yaml`
  unless the plan says so. The sandbox has no network.
- Do not hand-edit generated files (`*.generated.ts`, generated docs); run the
  generator script that owns the file.
- Keep behavior the plan does not mention unchanged.

## Repository facts

- Node 24+ and pnpm 11.16. Checks: `pnpm build`, `pnpm typecheck`,
  `pnpm test:local` (Vitest), `pnpm lint`, `pnpm format:check`,
  `pnpm deadcode` (knip).
- Packages are `packages/*` (`@icm/*`), apps are `apps/*`. Ownership and
  contracts: [docs/overall-product-plan.md](docs/overall-product-plan.md) and
  [docs/specs/](docs/specs/README.md).
- Code standards: [CODING_STANDARDS.md](CODING_STANDARDS.md). Testing:
  [docs/testing/README.md](docs/testing/README.md).
