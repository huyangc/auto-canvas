# T059 review

## Round 1 — changes-requested

Reviewed: the round 1 report and status on `task/T059-compactness` on
2026-11-12. Median area 1.558 → 1.511 and wire −9,380 with guards, determinism
and timing passing, but bends rise on dev and val and crossings on dev: the
span term (weight 4 per unit) outweighs a bend (100) for any closure over 25
units. The plan is amended (see "Plan change after round 1").

| #   | Severity   | Where                               | Finding                                         | Expected fix                                                                                                          |
| --- | ---------- | ----------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `routed-search-score.ts`, gap moves | Compaction trades bends and crossings for span. | Reject compaction trials that increase crossings or bends; refit the span weight on dev with all terms and report it. |
| 2   | must-fix   | acceptance                          | Crossings and bends above base.                 | Totals not above the T058 base on dev and val; area lower on both.                                                    |
| 3   | should-fix | report                              | Vertical margin source unknown.                 | Report the investigation from the amended plan.                                                                       |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted

Reviewed: `git diff HEAD` on `task/T059-compactness` on 2026-11-12; acceptance
and the full evaluation rerun by Opus.

Gap closing now runs as a deferred pass inside the existing trial budget; span-
driven acceptances must not raise crossings or bends.

| Ratio to human | T058 dev / val / all  | Round 2 dev / val / all |
| -------------- | --------------------- | ----------------------- |
| Crossings      | 2.078 / 1.888 / 2.013 | 2.078 / 1.888 / 2.013   |
| Bends          | 1.262 / 1.031 / 1.188 | 1.250 / 1.017 / 1.176   |
| Wire length    | 1.472 / 1.477 / 1.474 | 1.458 / 1.459 / 1.459   |
| Median area    | 1.561 / 1.542 / 1.558 | 1.557 / 1.521 / 1.555   |

Every visual guard equal or lower; floating 10, missing 18; 627/628; evaluation
counts and timing equal to the base. The investigation finds that free-anchored
drafting (1,058 of 1,095 dev objects) left at its input coordinates causes
85.6% of the excess vertical margin; that is the next task.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 634 tests
git diff --check → 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
