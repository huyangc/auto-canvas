# T075 — Make the planner's readability term cheaper

- Branch: `task/T075-readability-perf`
- Base: `main` at `01fd2ad`
- Status: approved

## Goal

T074 made the planner compare complete candidates by the frozen readability
composite. That works (composite dev 1.99× → 1.49× human) but costs time:
`two-inverters` plans ~1.5× longer (local corpus test 4.2 → 6.5 s, quality
test 3.0 → 4.6 s) and two CI tests needed longer timeouts. Held-out medians
are within 1.12×. This task makes the readability term much cheaper **without
changing any score**: every plan must stay byte-identical to main.

## Context

- `packages/auto-layout/src/readability-selection.ts`: `readabilityTerm`
  = 30000 × `readabilityScore(readabilityMetrics(document, resolver))`,
  memoized per final document inside one public planning call.
- `packages/auto-layout/src/readability-metrics.ts`: computes all 26 metrics.
  Only the 11 with nonzero frozen weight in `readability-weights.ts` affect
  the score (area, avoidableJogs, blockedJoins, controlSeparation, crossings,
  labelOverlaps, portOrder, railCrossings, sourcePolarity,
  terminalDepartures, unownedDrafting). Zero-weight but costly work includes
  `symmetryCounts` / `symmetryTopology`, `recognizeStructures`
  (structureIntrusion), detour (per-Net `auditRouting`), narrow bands, label
  clearance, wire-through-symbols, potential order, transistor orientation.
- `railCrossings` (weighted) runs `auditRouting` once per pair of routed Nets
  involving a rail (lines ~297–312): O(Nets²) full audits.
- The evaluator (`scripts/auto-layout-eval.mjs`) must keep reporting all 26
  metrics exactly as now.

## Scope

Owned: `packages/auto-layout/src/readability-metrics.ts`,
`packages/auto-layout/src/readability-selection.ts`, new files under
`packages/auto-layout/src/`, `packages/auto-layout/test/**`,
`tasks/T075-readability-perf/report.md`.
Not owned: `readability-weights.ts` (frozen), the evaluator's output format,
every other planner file.

## Steps

1. **Profile** `two-inverters` and the seven held-out fixtures
   (`node tmp/fixture-timing.mjs`-style harness, or a small script) and report
   the share of planning time spent in `readabilityMetrics` and in each of its
   parts.
2. **Weighted-only path.** Give `readabilityMetrics` an internal option (or a
   separate function sharing the same code) that computes only the metrics
   whose frozen weight is nonzero; `readabilityTerm` uses it. The evaluator
   keeps the full computation. Each weighted metric's `violations` must be
   identical between the two paths.
3. **Faster rail crossings.** Compute rail-involving crossings in one pass
   (count crossings between segment pairs where at least one Net is a rail),
   giving exactly the same count as the pairwise audits. Same for any other
   per-Net audit loop that remains on the weighted path.
4. Tests: for a set of fixtures (corpus fixtures plus synthetic cases with
   rails, ports, drafting), the weighted-only path gives the same score as the
   full path; rail crossing counts equal the old pairwise method; determinism.
5. Evaluate all 628 and compare every `planHash` with
   `tmp/main-01fd2ad-report.json` (must be identical) and every readability
   metric value (identical). Measure the seven held-out fixtures and
   `two-inverters` against main in five alternating pairs.

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

- All 628 plan hashes and all readability metric values identical to
  `tmp/main-01fd2ad-report.json`.
- `two-inverters` planning median at most 1.15× of main before T074
  (`789d513`), or at least 30% faster than main `01fd2ad`; no held-out
  fixture slower than main.

## Notes for the implementer

- This is a pure performance change: never change a metric's meaning, a
  weight, or a plan. If an optimisation changes any hash, it is wrong.
