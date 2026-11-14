# T074 — Select layouts by the readability score

- Branch: `task/T074-readability-selection` (starts from T073's unmerged
  branch, rebased onto main)
- Base: `main` at `789d513`
- Status: approved

## Goal

The user's goal (2026-11-13): "以电路可读性为目标，先优化评价函数，然后基于电路可读性进行整体电路优化，
在可读性的指标上，在人工图的20%浮动以内". T070 built and froze the readability
evaluation function (`readability-metrics.ts`, `readability-weights.ts`,
`readabilityScore`). This task does the second half: the planner chooses
between complete candidate layouts by that readability score, instead of only
by its hand-tuned routed score.

Why now: T073 showed the planner's own terms are proxies that disagree with
the readability metrics. Its port-convention term (port side relative to its
own host, 300 points) does not measure `portOrder` (inputs left of outputs
across the drawing), and the routed score weighs a crossing (1000) more than
three convention violations, whereas the fitted readability score weighs one
crossing and one `portOrder` pair about equally. Tuning the proxy moved
`portOrder` by 1–3% while adding crossings.

Main `789d513` (628 ≤10-part Gallery drawings): readability composite dev
95.36 (1.99× human), val 48.58 (1.80×). Dev excess by metric: crossings 24%,
unowned drafting 19%, portOrder ~17%, rail crossings ~13%, source polarity
~9%, avoidable jogs ~8%, area ~7%.

## Context

- Shared scores: `routed-search-score.ts` (`calibratedScore` = routed score +
  wire 4 + 0.5 × visible span; `compactionRegresses`: a span-driven choice may
  not add crossings or bends; `routedGuards`). `refine.ts`
  (`ROUTED_SCORE_WEIGHTS`, `routedScore`, R74 terms incl. `offConvention`).
- Where complete candidates are compared (call sites of `routedScore` /
  `calibratedScore`): strategy ranking and refinement selection R58/R63
  (`auto-layout.ts` ~480–830), gap closing R149 (`auto-layout.ts` ~1238),
  R147 relocation (`device-relocation-search.ts`), R146 port seats
  (`port-seat-search.ts`), R148 rail seats (`rail-seat-search.ts`), R155 local
  rails (`local-rail-markers.ts`), R150 drafting (`follow-drafting-groups.ts`),
  label repair (`stub-seat.ts`), blocker repair, finalize facing.
- Readability: `readabilityMetrics(document, resolver)` and
  `readabilityScore(metrics)` in `readability-metrics.ts`; frozen weights in
  `readability-weights.ts` (do not refit, do not change metric definitions).
- T073 mechanics already on this branch: `signal-direction.ts` (R57 for
  template / layered with routed comparison of the mirrored draft),
  `port-convention.ts` (conventional R146 candidates). Their round 2 result
  was net negative under the old score; with the readability term they may
  pay off. See `tasks/T073-port-order/`.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  base report `tmp/main-789d513-report.json` (has `readability.targets`);
  `python3 tmp/excess.py <report>` prints the excess per metric (copy from the
  T071 worktree if missing).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T074-readability-selection/report.md`.
Not owned: `readability-metrics.ts` metric definitions and
`readability-weights.ts` (frozen evaluation function), the evaluator, other
packages.

## Steps

1. **Readability term.** Add `readabilityTerm(run) = W × readabilityScore(
readabilityMetrics(run.final))` (memoized per final document) to the score
   used wherever complete finished candidates are compared (the call sites
   above). Do not compute it inside the annealing inner loop or for unrouted
   drafts if that is too slow; report where it is and is not applied.
2. **Calibrate W on dev only.** Try at least W ∈ {0, 3000, 10000, 30000}
   (one composite unit ≈ 9 crossings ≈ 9300 points under current weights).
   Report dev composite, each weighted metric, crossings, bends, wire, area and
   timing for each W; pick the best dev composite that keeps the guards.
3. **Guards follow the goal.** `compactionRegresses` and similar
   "no new crossing or bend" vetoes must not block a candidate that lowers the
   readability score; keep the hard guards (errors, floating pins, missing
   connections, equivalence, `routedGuards` visual totals except the
   zero-weight label clearance / owner distance).
4. **T073 mechanics.** With the readability term in place, re-evaluate the
   mirrored-draft comparison and the conventional port candidates; keep each
   only if dev composite improves. Remove the old position-based
   `offConvention` proxy if the readability term makes it redundant (report).
5. Tests: a candidate that adds one crossing but fixes two `portOrder` pairs
   wins at the chosen W; a candidate that lowers the routed score but raises
   the readability score loses; determinism; the score is independent of the
   rest of the corpus.
6. Spec (R22/R74/R146–R150, R57, R155 wording); evaluate all 628; review page
   human | main | T074 for the 25 samples (`tmp/le10-analysis/main-05050fd-samples.html`)
   plus the ten drawings whose composite falls most and the five whose
   composite rises most.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0, no timeout raised
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-789d513-report.json`:

- Readability composite lower by at least 8% on dev **and** val.
- No weighted readability metric higher by more than 5% on either split
  (report every one).
- Guards: 628 completed; none non-equivalent; floating and missing not above
  main; every `VISUAL_*` total not above main except label clearance (+3%)
  and owner distance (+1), which carry zero readability weight.
- Determinism; the 6 large documents byte-identical (the term applies up to
  40 instances, like the other finishing searches); held-out times within
  +30% median (the user accepts some planning cost for layout quality).

## Notes for the implementer

- The readability score is the frozen T070 function; never refit or edit it
  to make a gate pass.
- Same rule for every document; no circuit-, id- or coordinate-specific code.
- Tune W on dev; report val.
