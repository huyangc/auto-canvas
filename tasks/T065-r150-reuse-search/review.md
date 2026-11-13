# T065 review

## Round 1 — changes-requested

Reviewed: the round 1 report on `task/T065-r150-reuse-search` on
2026-11-12. Reuse halves mid-size planning time (deadtime 36.2 → 18.0 s,
ltc3452 28.5 → 14.9 s) with each search run once, quality within +1% on both
splits, six large documents identical, determinism holding.

| #   | Severity | Where                          | Finding                                                                                                     | Expected fix                                                                                      |
| --- | -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | must-fix | R150 reuse path                | Undoing the R10 shift moves a remote, unowned caption that T060 keeps fixed; the drafting-label test fails. | Keep unowned and locked drafting at input positions on the reuse path; the test passes unchanged. |
| 2   | note     | dev terminal departure 67 → 68 | `57zs7ayept` keeps its searched base.                                                                       | Accepted (see plan change).                                                                       |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — accepted

Reviewed: `git diff HEAD` on `task/T065-r150-reuse-search` on 2026-11-12;
acceptance, timing and the full evaluation rerun by Opus. Unowned and locked
drafting keep their input positions on the reuse path; the drafting-label test
passes unchanged.

| Ratio to human | T062 dev / val | Round 2 dev / val |
| -------------- | -------------- | ----------------- |
| Crossings      | 1.812 / 1.588  | 1.812 / 1.588     |
| Bends          | 1.193 / 0.965  | 1.197 / 0.973     |
| Wire length    | 1.440 / 1.450  | 1.444 / 1.456     |
| Median area    | 1.436 / 1.396  | 1.443 / 1.406     |

All within +1%; terminal departure 84 → 85 is the accepted `57zs7ayept`
exception, every other guard equal or lower; floating 10, missing 18;
627/628. Timing (single process): deadtime 36.2 → 18.7 s, ltc3452 28.5 →
15.3 s.

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm exec vitest run packages/auto-layout/test → 0; 658 tests
git diff --check → 0
node tmp/fixture-timing.mjs . held-out-cases.json → deadtime 18,666 ms, ltc3452 15,344 ms
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
