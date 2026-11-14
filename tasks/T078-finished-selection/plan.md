# T078 — Choose between finalists by their finished layouts

- Branch: `task/T078-finished-selection`
- Base: `main` at `a9ee786`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main `a9ee786` (T074 selection by the frozen
readability composite, T075, T076) the composite is dev 66.62 (1.39× human),
val 35.72 (1.32×); crossings are the largest remaining gap.

The planner compares candidates on **provisional** runs and only then applies
the finishing passes (R147 relocation, R146 ports, R148 rails, R149 gaps,
R155 local rails, R150 drafting, label repair, facing) to the single winner.
Finishing changes the result, so the winner of the provisional comparison is
not always the best finished layout. Evidence:

- Opus analysis (2026-11-14, every plan hash matching main): of the 103 dev
  drawings with more crossings than the human drawing, 16 had a complete
  candidate with fewer crossings **and** a lower composite that the pipeline
  did not return; the upper bound of picking the lowest-composite complete
  candidate was 9.68 composite units on dev (part of it — unowned drafting —
  has since been recovered by T076).
- T077 round 2 (unmerged): its local-loop drafts win the provisional
  comparison in four drawings and finish worse than main
  (`hpfcqs6cjr`: finished score 1262.96 → 5362.50); disabling the draft
  restores main. Its report traces this in detail.

This task makes the final choice among the top candidates on their finished
layouts.

## Context

- R58 (`docs/specs/auto-layout.md:497`): route each eligible strategy once,
  rank by routed score, refine the top two (≤ 40 instances), keep the lower
  refined score; R44 / R96 / R97 then run on the winner; finishing searches
  run on the winner in `auto-layout.ts` (around lines 980–1200:
  `finishPlacement`, `searchDeviceRelocations`, `searchPortSeats`,
  `searchRailSeats`, gap closing, `repairStubLabels`, local rails, drafting).
- Shared comparator (T074): completeness (floating + missing) first, then
  routed score + 30000 × frozen readability composite
  (`readability-selection.ts`, `routed-search-score.ts`).
- Planning reuse caches (`planning-reuse.ts`, `planningMemo`) and the
  per-call finishing cache (`finished-seats`).
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`,
  base `tmp/main-a9ee786-report.json`; `python3 tmp/excess.py <report>`;
  analysis helpers `tmp/gap2/topcand.py`, `candgap.py`, `dump2.mjs` (paths
  inside may point to the old worktree; adapt).

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts` and
`readability-weights.ts`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T078-finished-selection/report.md`.

## Steps

1. **Investigate** on dev: how often the second refined finalist, once
   finished, beats the first under the shared comparator; the composite gain
   available; and the cost of finishing a second finalist. Report.
2. **Finished selection.** For documents up to 40 instances, carry the top
   K complete finalists (K = 2; try 3 if step 1 shows gain beyond the second)
   through the complete finishing pipeline and return the best finished run
   under the shared comparator (completeness first, then routed score +
   readability). Reuse caches; keep the existing budgets per finalist;
   determinism. Above 40 instances, unchanged (the six large plans
   byte-identical).
3. Tests: a document where the provisional winner finishes worse than the
   runner-up returns the runner-up's finished layout; completeness still
   dominates; determinism; large documents unchanged.
4. Spec (R58 and the finishing order); evaluate all 628; review page
   human | main | T078 for the 25 samples plus the ten drawings whose
   composite falls most and the five whose composite rises most (there
   should be none).

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-a9ee786-report.json`:

- Readability composite lower on dev and val; no drawing's composite higher
  than main (selection can always fall back to main's choice); every weighted
  metric not higher by more than 2%.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical; held-out times within
  +40% median (the user accepts planning cost for layout quality; report the
  exact cost).

## Notes for the implementer

- General rule only; no per-drawing logic.
- The frozen readability function and weights stay unchanged.
- Tune K on dev; report val.
