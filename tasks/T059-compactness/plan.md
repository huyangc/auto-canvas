# T059 — Compactness in the search score and gap-closing moves

- Branch: `task/T059-compactness` (stacked on `task/T058-rail-crossings`, PR #53)
- Base: `task/T058-rail-crossings` at `f37bf21`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods. After T058, on the 627
completed ≤10-part drawings, ratios to human are crossings 2.01, bends 1.19
(within target), wire 1.47, median area 1.56 (`tmp/le10-t058r1/report.json`).
Area has not moved since T056 because no search scores it. This task makes the
searches value compactness and gives them moves that close gaps.

## Context

- `routed-search-score.ts:12-19`: `calibratedScore` = `routedScore` + wire at
  weight 4. T055 fitted wire **and** span together on dev (wire 4, span 4 on
  `instanceWidth + instanceHeight`, 289/310 pairwise agreement with human
  placements, `tasks/T055-human-baseline-search/report.md`), but only the wire
  half was ever used. R146 (ports), R147 (relocation) and the T058 rail search
  all decide with `calibratedScore` and `routedGuards`.
- The evaluation's area ratio is the rendered layout box
  (`scripts/auto-layout-eval.mjs:607-612`, `layoutWidth × layoutHeight`,
  ports, markers and labels included), median per drawing.
- Measured on T058: per-drawing median width ratio 1.17, **height ratio 1.34**;
  sums 1.22 width, 1.32 height. Height is the larger excess.
- Existing compaction: R97 column compaction (`compact.ts`, `compactPlacements`),
  T045 row compaction (`compactRows`). Row pitch `ROW_PITCH` 120,
  `MARKER_OFFSET` 40, `CELL_PIN_OFFSET` 80 (`geometry.ts:25-30`). Rows are
  pinned by some corpus tests (tail +120, feedback capacitor −120): satisfy
  them, do not edit them.
- Visual guards already penalize crowding: label clearance, label run-on,
  terminal departure. T051's optimized mode shows what happens without them
  (area 0.79× but crushed drawings).

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
base `tmp/le10-t058r1/report.json`. Third-party data under `tmp/le10-input/`,
never committed. Rules end at R149 or wherever T058 stopped (check the spec);
take the next free number.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T059-compactness/report.md`.

Out of scope: other packages; adding or removing instances; optimized and
partition modes (fallback follows plain planning); documents above 40
instances (byte-identical).

## Steps

1. **Score.** Add the compactness term to `calibratedScore`: span of the
   finished layout's visible bounds (width + height) at the dev-fitted weight,
   or refit wire and span on dev against the human placements as T055 did
   and report the procedure and agreement. Measure on dev what the term alone
   changes in R146/R147/rail decisions.
2. **Moves.** Add gap-closing candidates to the existing coordinate search: a
   unit (or a whole row or column of units) shifted toward its neighbours by
   the largest step that keeps bounds, marker and port room clear, vertically
   and horizontally. Same finished comparison and guards as R147.
3. Budget: paired median ≤ 2× base, p95 ≤ 1.5× base p95; evaluation counts,
   not wall clock.
4. Tests: synthetic documents with an empty row and an empty column gap that
   should close; a gap that must stay because closing it would collide with a
   marker or crowd a label; determinism; locked devices untouched.
5. Spec; evaluate all 628 drawings; report dev and val, with width and height
   ratios separately.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t058r1/report.json`:

- Median area ratio at most 1.40 overall and lower on dev **and** val; wire
  lower; crossings and bends not higher (dev and val).
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; timing as in step 3.

## Notes for the implementer

- Same rule for every unit and document; no branches on circuit type, symbol
  family, tag, id, name or coordinates.
- Tune on dev; report val.
- If a tested contract blocks a clearly better layout, report it; do not edit
  the test.
