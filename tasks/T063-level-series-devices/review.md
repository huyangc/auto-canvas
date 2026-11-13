# T063 review

## Round 1 — changes-requested

Reviewed: the round 1 report on `task/T063-level-series-devices` on
2026-11-12. R30 series leveling cuts crossings on both splits (dev 279 → 272,
val 127 → 118; examples 10 → 4 and 6 → 3) and raises verticality, but two
visual guards rise and the T062 branch test fails. Group-row behavior stays
unchanged (removing grouping raised crossings 66 → 68 on the affected 18).

| #   | Severity | Where                | Finding                                                   | Expected fix                                                     |
| --- | -------- | -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | must-fix | R30 levels / planner | Terminal departures 84 → 91, wire through symbol 20 → 22. | Per-drawing fallback to the old levels as the amended plan says. |
| 2   | must-fix | T062 branch test     | Fails on a shorter, equally crossed layout.               | Rewrite as the amended plan allows.                              |

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — interrupted

The round-2 Codex run stopped with "Selected model is at capacity" before it
finished; its partial work (per-drawing fallback `series-fallback.ts`, series
inference `series-levels.ts`, `dc-connectivity.ts`, test changes) is in the
working tree. Meanwhile T064–T066 were merged into main with T056–T062 as
PR #58 (`a6ae6a0`); Opus rebased this task onto it, resolving two conflicts:
`planAutoLayout` now wraps the series dispatch (`planSeriesDispatch`) in
T064's `reusePlanning`/`reusePreviews` scopes, and the branch-column test keeps
the round-2 assertions with main's explicit 30 s timeout.

## Round 3 — instructions

Finish round 2's must-fix findings on top of the rebased tree, then:

| #   | Severity | Where                | Finding                                                                                        | Expected fix                                                                                                                                                                                                                                                                                                              |
| --- | -------- | -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | per-drawing fallback | Planning both level variants doubles planning time again, which T064/T065 just reduced.        | Keep the fallback, but meet: paired median ≤ 1.3× and aggregate p95 ≤ 1.3× of main `a6ae6a0` on the ≤10-part set, and `tmp/fixture-timing.mjs` held-out times (deadtime, ltc3452) ≤ 1.3× main. Prefer reuse (for example run the old-level plan only when the new one fails a guard, or share searches) over budget cuts. |
| 2   | must-fix | acceptance           | Base for quality is now main: `tmp/le10-t065r2/report.json` (main's product code equals T065). | Crossings lower on dev and val; bends, wire, area within +2%; floating ≤ 10, missing ≤ 18; no `VISUAL_*` total above it.                                                                                                                                                                                                  |
| 3   | must-fix | tests                | `pnpm test:local` and `pnpm test:slow` must pass; no timeout raised.                           | —                                                                                                                                                                                                                                                                                                                         |

## Round 3 — accepted with an Opus size gate

Reviewed: `git diff HEAD` on `task/T063-level-series-devices` on 2026-11-12;
acceptance, timing and the full evaluation rerun by Opus.

Round 3 finished the per-drawing fallback (plan both R30 variants, keep the
series-level plan only if its finished calibrated score is not higher and no
floating pin, missing connection or `VISUAL_*` count rises) and shared routed
results between the variants. Quality, determinism, large documents and all
tests passed; held-out timing still failed (deadtime 2.03×, ltc3452 1.83× of
main). As a review fix Opus gated the comparison to documents with at most 20
instances (T064's budget threshold); larger documents keep main's levels.

| Ratio to human (all) | main `a6ae6a0` |                                Final |
| -------------------- | -------------: | -----------------------------------: |
| Crossings            |          1.735 | 1.709 (dev 279 → 275, val 127 → 125) |
| Bends                |          1.126 |                                1.092 |
| Wire length          |          1.448 |                                1.424 |
| Median area          |          1.429 |                                1.430 |

Every `VISUAL_*` total equal or lower (terminal departure 85 → 83, label run-on
35 → 30); floating 10, missing 18; 627/628; 39 plans change. Timing (single
process): deadtime 19.4 s (main 19.4), ltc3452 16.0 s (main 16.3).

Acceptance rerun:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
git diff --check → 0
pnpm test:local → 0; 786 files, 8026 tests, 117 skipped
pnpm test:slow → 0; 14 tests
node tmp/fixture-timing.mjs . held-out-cases.json → deadtime 19,372 ms, ltc3452 16,013 ms
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; numbers above
```
