# T039 report — round 1

## Summary

Implemented R144 as a finishing alternative after R97: route cross-coupled MOS/BJT
connections with audited octilinear X wires, retaining the candidate only when its
R22 score does not increase. R89 now seats cross-coupled members immediately before
axis devices in each half row. All three placement strategies use that order.

The 33-drawing quick-mode comparison completes with unchanged electrical topology.
Two drawings change; crossings decrease in both splits, with no per-drawing increase
in floating pins or missing connections. All 29 non-cross-coupled plan hashes stay
identical, and all four cross-coupled pairs are adjacent across their R88 axes.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                 |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | done   | Stable half-row ordering: ordinary nodes, cross-coupled nodes, axis nodes. Synthetic latch checks all three strategies.                                                                                                                                               |
| 1    | done   | Optional `crossX`, G/D and B/C geometry, R98 reservation, per-wire preview/audit guard, frozen-Net replay translation, and ordinary R13 completion. R95 preserves Nets seeded with an X, including reconciled pieces.                                                 |
| 2    | done   | One exact-placement replan of the compacted R44 winner with its trunk setting and rip-up; non-increasing R22 score, including ties; fixed instances skipped. No X inside candidate evaluations.                                                                       |
| 3    | done   | 11 new tests cover seating, MOS/BJT X intersection and topology, determinism, short corners, unplaced members, obstacle rejection, score rejection/ties, fixed instances, and unchanged non-pair edits/call sequence. Existing quality/search tests remain unchanged. |
| 4    | done   | Added R144 and updated R89 in the auto-layout spec.                                                                                                                                                                                                                   |
| 5    | done   | Sequential baseline/result evaluation on all 33 local drawings. Aggregate and per-drawing comparisons and human/before/after SVGs are in git-ignored `tmp/t039/result/`.                                                                                              |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Every command used lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
Logs are in git-ignored `tmp/t039/logs/`.

```text
pnpm install --frozen-lockfile --offline → 0; already up to date, pnpm 11.16.0
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files
pnpm typecheck → 0
pnpm lint → 0; 1991 files, 0 errors (warnings retained)
pnpm vitest run packages/auto-layout → 0; 30 files, 514 tests passed
pnpm test:local → 0 on unrestricted rerun; 771 files passed, 3 skipped; 7865 tests passed, 117 skipped
pnpm deadcode 2>&1 | grep -E 'route\.ts|auto-layout\.ts' → 1 from grep, no output (expected no matches)
pnpm build → 0; existing large-chunk warning
pnpm auto-layout:review → 0; 9 corpus + 7 held-out SVGs and index.html written
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; 33/33 completed, electrically equivalent
  Baseline run also → 0; 33/33 completed
git ls-files tmp | head -1 → 0; no output
git diff --check → 0
```

The first full local test run failed under the sandbox: 18 files failed, 753 passed,
3 skipped; 61 tests failed, 7771 passed, 150 skipped, with 2 unhandled errors.
Failures included `listen EPERM: operation not permitted 127.0.0.1` and restricted
local service access. The unchanged suite passed with sandbox escalation: 771 files
passed, 3 skipped; 7865 tests passed, 117 skipped (82.01 seconds).

An initial new-test assertion omitted four ordinary refinement calls; its expected
call list was corrected. The complete auto-layout suite then passed; no existing
test was edited, skipped, or removed.

## Investigation results

The initial HEAD was `d3989df`; its only tracked difference from `3526e33` was this
task's plan. Built and evaluated that unchanged product baseline before editing,
then built and evaluated the result. No branch switch or alternate implementation
was needed, and no LLM calls were made.

Quick-mode totals (wire length in canvas units):

| Split            | Crossings before → after | Bends before → after | Wire before → after | Floating before → after | Missing before → after |
| ---------------- | ------------------------ | -------------------- | ------------------- | ----------------------- | ---------------------- |
| dev, 18 drawings | 271 → 270                | 367 → 372            | 123280 → 123364.56  | 0 → 0                   | 0 → 0                  |
| val, 15 drawings | 310 → 306                | 397 → 397            | 145190 → 145250     | 1 → 1                   | 1 → 1                  |

Readability counts are unchanged: dev label overlaps / label-clearance violations /
terminal departures = 0 / 32 / 8; val = 1 / 31 / 6. The existing validation floating
pin and missing connection occur on the same unchanged drawing as before. Per-case
checks find no floating-pin or missing-connection increase.

Changed drawings, identified here only by split and size:

- Dev, 17 instances: two diagonal segments form the X; crossings 13 → 12,
  bends 16 → 21, wire 5000 → 5084.56. No floating pins or missing connections;
  readability counts unchanged.
- Val, 34 instances: innermost pair seating is retained, with orthogonal routing;
  crossings 30 → 26, bends 33 → 33, wire 7170 → 7230. The finishing score guard
  does not retain an X. No floating pins or missing connections; readability counts
  unchanged.
- The other two cross-coupled drawings (dev 20 and val 40 instances) keep their
  plan hashes. All four pairs pass same-row adjacency checks, with no intervening
  device, and retain mirrored R88 placement.

Private case ids, source data, comparison JSON, and SVGs stay under `tmp/`.
`tmp/t039/result/index.html` presents the two changed drawings as
human | before | after; `comparison.json` records all per-case target checks.

## Deviations and open questions

- R141–R143 are absent from this base's spec. R144 is placed after R140, the last
  numbered rule before the contract section.
- R95 excludes Nets with accepted X seeds from rip-up, because reconciliation can
  split a seed into new canonical route ids while adding the rest of its tree.
  This preserves the X and its replay; all other Nets retain ordinary R95 behavior.
- `route.ts` is now 1056 lines. The repository testing standard leaves splitting
  changed files over 1000 lines to the reviewer; no out-of-scope module was added.
- No dependencies, lockfile, generated files, other tests, plan, or review were
  changed. No commit, push, merge, rebase, or branch switch was performed.
