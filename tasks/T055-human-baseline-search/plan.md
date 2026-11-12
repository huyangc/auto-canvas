# T055 — Default-mode placement search toward the human baseline

- Branch: `task/T055-human-baseline-search`
- Base: `main` at `bdb5f36`
- Status: approved

## Goal

On the 628 Gallery drawings with at most 10 parts, default-mode
`planAutoLayout` (no options) should come within 20% of the human drawings on
the four primary metrics, without making readability or connectivity worse.
The user's directive (2026-11-12): reach the human baseline through **general
methods**: optimization, search, calibrated objectives. Do **not** add
circuit-specific rules: no branches on circuit type, tag, symbol family, device
count or topology pattern, and no ids, names or coordinates.

Current state on `bdb5f36` (sums over the 627 completed drawings that have a
human reference; ratios are auto / human):

| Metric                        |   Human | Default | Ratio | `--search 10` | Ratio |
| ----------------------------- | ------: | ------: | ----: | ------------: | ----: |
| crossings                     |     234 |     580 |  2.48 |           433 |  1.85 |
| bends                         |   2,356 |   2,998 |  1.27 |         2,600 |  1.10 |
| wire length                   | 465,224 | 772,590 |  1.66 |       793,796 |  1.71 |
| median per-drawing area ratio |    1.00 |    1.66 |       |          1.73 |       |

## Context

Facts Opus measured on `bdb5f36` (scripts and reports under `tmp/`, git-ignored):

1. **The gap is placement, not routing.** `--fixed-human` keeps every human
   placement and runs only the router: on the 447 drawings that complete both
   ways, crossings 0.99×, bends 0.70×, wire 0.94× human. The same 447 in
   default mode: 2.12×, 1.11×, 1.61×.
2. **The objective mostly agrees with humans; the search does not find their
   placements.** With `routedScore`'s weights (`refine.ts:24-34`), the human
   placement scores lower (better) than the default result on 296 of those 447
   drawings. Search with a 10 s budget (`--search 10`, median 244 full
   evaluations per drawing) lowers crossings to 1.85× and bends to 1.10×, but
   wire length rises to 1.71× and area to 1.73×.
3. **Wire length and area are nearly free in the objective.** `wireLength: 0.1`
   per unit: a 100-unit detour costs a tenth of a bend. There is no area or
   compactness term. Setting `wireLength: 1` alone changed little (default
   1.66× → 1.59× wire, crossings 2.48× → 2.58×; with `--search 10` 1.71× →
   1.60× wire, crossings 1.85× → 2.00×).
4. **The fast estimator is usable for ranking.** `createPlacementEstimator`
   (`estimate.ts`, MST with L-shaped edges, microseconds per call): Pearson
   correlation with routed wire length 0.93 (auto) / 0.91 (human placements);
   with routed crossings only 0.43. Ranking human vs default placement by
   `1000·crossings + 0.5·length`, the estimator agrees with the routed metrics
   on 399 of 447 drawings. Today `annealLayout` (`search.ts`) uses it only to
   pick one of four proposals; every accepted step is a full routed evaluation
   (about 40 ms on these drawings).
5. **Metrics can be gamed.** `quality: "optimized"` (PR46) scores 0.88×
   crossings, 0.50× bends, 0.61× wire, 0.79× area, but the drawings are crushed:
   symbols packed edge to edge, labels jammed, disconnected groups far apart.
   Only its visual diagnostics show it: totals over 627 drawings, from
   `diagnoseVisualQuality` + `diagnoseLabelClearance` (`packages/derived`):

   | Code                             | Human | Default | Optimized |
   | -------------------------------- | ----: | ------: | --------: |
   | VISUAL_LABEL_CLEARANCE           |   543 |     226 |       861 |
   | VISUAL_TERMINAL_DEPARTURE        |    30 |     117 |       902 |
   | VISUAL_LABEL_RUN_ON              |    17 |      52 |       115 |
   | VISUAL_LABEL_OVERLAP             |     4 |       5 |         5 |
   | VISUAL_LABEL_OWNER_DISTANCE      |    27 |       7 |         7 |
   | VISUAL_SYMBOL_OVERLAP            |    99 |       0 |         0 |
   | VISUAL_WIRE_THROUGH_SYMBOL       |   315 |      26 |         0 |
   | VISUAL_ROUTE_OVERLAP             |    44 |       0 |         0 |
   | VISUAL_TERMINAL_ON_FOREIGN_ROUTE |    38 |       0 |         0 |

   Any objective change must be judged with these guards.

Code facts:

- Default search budget: `auto-layout.ts:91`, `{ seed: 1, evaluations: n <= 40 ? 8 : 2 }`.
  The annealer, move generator and bounds: `search.ts`, `search-moves.ts`,
  `search-bounds.ts` (R66, R67). Weights and `routedScore`: `refine.ts:24-130`
  (R74, R86). Strategies: template, layered, stages (R36, R44).
- Evaluation: `node scripts/auto-layout-eval.mjs <folder> [--search s] [--split dev|val] --jobs n`
  writes `tmp/auto-layout-eval/report.json`. Dev/val split is
  `sha256(id) % 3 == 0 → val` (`auto-layout-eval.mjs:603-610`): 439 dev, 189 val.
- Data: `tmp/le10-input/` (symlinks into
  `/Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/by-size/{0-4,5-10}/`;
  third-party, local use only, never commit any of it). Base report:
  `tmp/le10-bdb5f36/report.json`. Summaries: `python3 -I tmp/le10-analysis/totals.py <report>...`,
  `python3 -I tmp/le10-analysis/compare.py <base> <new> <catalog>`. Visual
  probe: `tmp/le10-analysis/visual-probe.mjs <folder> <start> <count>`.
- Rules end at R145; new rules take R146 and up.

## Scope

Owned paths:

- `packages/auto-layout/src/**`, `packages/auto-layout/test/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs` (scoreboard and guards, step 1)
- `tasks/T055-human-baseline-search/report.md`

Out of scope:

- `packages/derived`, `packages/edit-engine`, `packages/model`, the router's
  own algorithms (the router already reaches human level on human placements).
- `quality: "optimized"` and LLM partition mode: leave their behavior as is.
- Documents with more than 40 instances: their output stays byte-identical
  to `bdb5f36`.

## Steps

1. **Scoreboard.** Extend `scripts/auto-layout-eval.mjs` so each run prints, per
   split and for all: the four primary ratios against the human drawings (sums
   for crossings, bends, wire length; median per-drawing `areaRatio`), and the
   guard totals for human and result: every `VISUAL_*` code from
   `diagnoseVisualQuality` and `diagnoseLabelClearance`, floating pins, missing
   connections, completed count, non-equivalent count, planning time median and
   p95. Write the same numbers into `report.json` under `scoreboard`. Run it on
   the base and record the base scoreboard in the report.
2. **Objective.** Calibrate `ROUTED_SCORE_WEIGHTS` so the objective prefers what
   humans draw, on **dev only**: fit wire length and an added compactness term
   (for example bounding-box area or span of placed instances) by pairwise
   preference between human placements (`--fixed-human` routing) and default
   results, keeping crossings dominant and every guard term. Report the fitted
   values, the procedure and the dev agreement rate. Do not fit anything to
   individual drawings.
3. **Search.** Make default-mode search find better placements for documents
   with at most 40 instances, within a fixed evaluation budget (never wall
   clock, so output stays deterministic). Preferred: a two-level search, where
   an inner annealing loop moves devices and groups using the fast estimator
   (thousands of proposals), and the outer loop fully routes and checks only
   the best few distinct candidates with `routedScore`. Extend the move set if
   needed (for example single-device grid moves in both axes, swaps across
   rows, orientation flips). Starting points stay the existing strategy
   results. Every accepted result still passes the full routed and checked
   planner (R66).
4. **Budget.** Choose the default budget so that, on this machine, a paired run
   (base and new at the same time, same `--jobs`) gives a planning-time median
   at most 3× the base and a p95 of at most 10 s per drawing. Existing CI tests
   must keep their current timeouts.
5. **Spec.** Update `docs/specs/auto-layout.md` (R74 weights, R66 search, any
   new rule from R146).
6. **Evaluate** the full set and report dev and val separately.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12   # scoreboard below
```

Behavioral checks, on the default-mode run of all 628 drawings:

- **Primary (dev and val each):** crossings, bends and wire length at most
  1.2× the human sums; median area ratio at most 1.2.
- **Guards (all drawings):** completed ≥ 627; every completed drawing
  electrically equivalent; floating pins ≤ 10 and missing connections ≤ 18;
  each `VISUAL_*` total not above the base default run.
- **Determinism:** two runs give identical `report.json` results.
- **Large documents:** the 6 drawings above 40 instances in
  `/Users/huzhifeng/workspace/auto-canvas-cases/human/cases/` produce plans
  byte-identical to `bdb5f36`.
- **Time:** as in step 4, paired.

If the primary targets are not all met, report the best result reached, which
targets remain and why, with evidence. Do not trade a guard for a primary
metric to make the numbers.

## Notes for the implementer

- Tune on dev; use val only to report. Report both.
- General methods only (see Goal). A term in the objective or a move in the
  search must apply to every document alike.
- Prefer measuring before building: a quick prototype that shows the two-level
  search's effect on dev is worth more than a polished but untested design.
- Keep the change reviewable: scoreboard, objective and search as separate
  commits-worth of changes, each described in the report.
