# T066 — Keep CI to invariant tests; move heavy quality benchmarks to `pnpm test:slow`

- Branch: `task/T066-lean-ci-tests` (stacked on `task/T065-r150-reuse-search`)
- Base: `task/T065-r150-reuse-search` at `1bc21a7`
- Status: approved

## Goal

User decision (2026-11-12): accept some auto-layout planning slowdown in
exchange for layout quality, and reconsider whether CI needs to run such heavy
cases. CI on the stacked PRs times out only in auto-layout tests that plan real
mid-size drawings with the full default search. This task keeps every
correctness guard in CI but makes it cheap, and moves the expensive
quality benchmarks to an explicit `pnpm test:slow` that Opus runs locally in
review. No assertion is deleted; heavy ones move.

## Context

Slowest auto-layout tests in CI on PR #57 (run 43337108719, before T064/T065):

| File / test                                                                                        |                                       CI time |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------: |
| `held-out.test.ts` (7 real drawings, default search, crossings ≤ T013 baseline + Net preservation) | 360 s file; `deadtime` 153 s, `ltc3452` 122 s |
| `corpus.test.ts` (18 fixtures; several tests re-plan the same fixture)                             |                                         137 s |
| `quality.test.ts` (R22 tests plan three times each)                                                |                                          80 s |
| `search.test.ts`, `stages.test.ts`, `layered.test.ts` (synthetic 60/85/120-device determinism)     |                                50 / 45 / 36 s |

T064/T065 have since halved mid-size planning time locally (deadtime 46.5 →
18.7 s). Repository test layout: `vitest.config.ts` projects `modules` and
`isolated` include `apps/**`, `packages/**`, `scripts/**` tests; CI runs
`pnpm test:local` (`.github/workflows/ci.yml:55`). Testing rules:
`docs/testing/README.md` (local validation; removing or simplifying tests
lines 62+). Workflow: `docs/workflow.md`.

## Scope

Owned: `vitest.config.ts`, `package.json` (scripts only), `packages/auto-layout/test/**`,
`docs/testing/README.md`, `docs/workflow.md` (review evidence line),
`AGENTS.md` (only if it lists test commands), `tasks/T066-lean-ci-tests/report.md`.

Out of scope: product code; test timeouts in CI-run tests may not be raised;
CI workflow file unless strictly needed to keep running `pnpm test:local`.

## Steps

1. **Slow suite.** Add a test naming convention `*.slow.test.ts` that the
   default projects exclude, and a `pnpm test:slow` script that runs only those
   (for example a third vitest project enabled for that script). `pnpm check`
   and CI keep running the default set.
2. **Held-out.** Move the full-search quality comparisons of
   `held-out.test.ts` (crossings ≤ T013 baseline and similar quality checks)
   into `held-out.slow.test.ts`, unchanged. Keep in the default set a fast
   variant over the same drawings that checks validity and Net/terminal
   preservation using quick mode (`search: { seed: 1, evaluations: 0 }`) or a
   small budget.
3. **Shared plans.** In `corpus.test.ts` and `quality.test.ts`, compute each
   fixture's default plan once per file and share it between tests that need
   the same plan (keep determinism checks that plan twice, but only once per
   fixture). No assertion removed.
4. **Synthetic large documents.** Where a test's purpose is determinism or
   bounds, keep it in the default set if under its timeout after step 3;
   otherwise move the full-budget variant to the slow suite and keep a
   reduced-budget variant.
5. **Docs.** `docs/testing/README.md`: what `test:slow` is for and that it is
   required review evidence for auto-layout changes; `docs/workflow.md`: Opus
   reruns `pnpm test:slow` for auto-layout tasks and posts results on the PR.
6. Measure: default auto-layout test files' total time locally before/after,
   and `pnpm test:slow` time.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm docs:check                                   # 0 (or the repository's link check)
pnpm test:local                                   # 0, no timeout raised
pnpm test:slow                                    # 0
```

- Every moved assertion exists verbatim in a `*.slow.test.ts`; list them in the
  report with old and new locations.
- Default auto-layout test time locally at least 50% lower than before.

## Notes for the implementer

- Do not weaken or delete assertions; only move or share work.
- Follow `docs/testing/README.md`'s rules for simplifying tests and record
  replacement protection in the report.
