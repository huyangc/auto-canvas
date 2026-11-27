# T194 — Remove flaky wall-clock timing assertion in `lns-recreate.test.ts`

- Branch: `task/T194-fix-lns-recreate-flaky-test`
- Base: `main` at `e933dde65fd9e466f9a1f113707cdbddf2641237`
- Status: approved
- Plan review: self-checked against `packages/auto-layout/test/lns-recreate.test.ts` and GitHub Actions CI run `45936927475`.

## Goal

Eliminate CI flakiness in `packages/auto-layout/test/lns-recreate.test.ts` ("bounds APR work on a 120-resistor chain"), which failed on shared GitHub runners with `AssertionError: expected 165.80219800001942 to be less than 150`, by asserting deterministic algorithmic work bounds (`evaluations`, `candidates.length`, `placements.size`) rather than a tight `150 ms` wall-clock check under parallel Vitest contention.

## Context

In `packages/auto-layout/test/lns-recreate.test.ts:158-180`, the test already verifies the deterministic APR evaluation cap (`1 < result.evaluations <= 34`). Adding a `performance.now() - before < 150` check caused intermittent CI failures whenever a 2-vCPU runner experienced GC or parallel-worker contention across 843 test files.

## Scope

Owned paths:

- `packages/auto-layout/test/lns-recreate.test.ts`

Out of scope:

- Any production code or other test files.

## Steps

1. Replace the flaky `expect(performance.now() - before).toBeLessThan(150)` assertion in `packages/auto-layout/test/lns-recreate.test.ts` with deterministic work-bound assertions (`result.evaluations`, `result.candidates.length`, `result.placements.size`).
2. Run build, typecheck, lint, format:check, docs:check, and `lns-recreate.test.ts`.

## Acceptance

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/auto-layout/test/lns-recreate.test.ts
```
