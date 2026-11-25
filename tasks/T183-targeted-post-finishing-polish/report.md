# T183 report — round 2

## Summary

Both round 1 must-fix findings are resolved. The planner records separate
crossing-polish and stack-repair timings, and the R166 draft-selection test
isolates both runs from finished-stage stack repair. All 1,259 tests in the
focused Vitest run passed. The strict gate passed for both corpora using the
round 1 evaluation reports.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Round 1 added deterministic crossing polish and broken-stack repair with guarded acceptance. |
| 2 | done | Round 1 added the reverse-step peer fallback and raised the R167 trial cap to 12. |
| 3 | done | Added both timing keys and wrapped the existing finishing calls in order between gap closing and R167. |
| 4 | done | Isolated the R166 draft-selection test and preserved its assertions. The crossing, stack, and pin-jog regression tests passed, including both R167 hash checks. |
| 5 | done | The round 1 spec documents the finishing passes and the R167 fallback and budget. |
| 6 | partial | The round 2 review directs reuse of the sequential round 1 evaluations. The strict gate passed and the cumulative comparison is below. The pin-jog and defect-free expectations remain partly unmet. |

## Review findings addressed

1. The R166 draft-selection test spies on `repairBrokenStacks` and returns
   the input for both plan runs. The `stackPairs` mock applies only to the
   reference run. Each spy is restored in `finally`, and all assertions
   remain intact.
2. `timing.ts` defines `crossingPolish` and `stackRepair` in `PlanningPhase`
   and initializes their duration and call counters to zero.
   `auto-layout.ts` wraps each finishing call with its corresponding
   `timePhase` key.

## Acceptance results

```text
pnpm build → 0; editor built with a chunk-size warning
pnpm typecheck → 0
pnpm lint → 0; 2,202 files, 0 errors, 4,000 warnings
pnpm format:check → 0; all matched files use Prettier code style
pnpm docs:check → 0; validated local Markdown links in 75 files
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0
  92 files and 1,259 tests passed
pnpm test:slow → 0; 2 files and 8 tests passed
mkdir -p tmp/t183 → 0
Netlist corpus evaluation (--jobs 6) → round 1 exit 0; reused 514/515 completions
Drawing corpus evaluation (--jobs 6) → round 1 exit 0; reused 612/628 completions
Plan strict gate against tmp/t182 → 0
  0 throws, lost completions, or integrity failures in either corpus
```

A smoke check on the built planner recorded one call and a positive duration
for each new phase with eight search evaluations. Both counters and
durations were zero in quick mode.

### Corpus comparisons

Quality totals cover cases completed in both runs for each comparison. Wire
length is rounded to whole units. The completion row covers the full corpus.

| Metric | Netlist T182 → T183 | Drawing T182 → T183 | Netlist `c5f1678` → T183 | Drawing `c5f1678` → T183 |
| --- | ---: | ---: | ---: | ---: |
| Completed | 514/515 → 514/515 | 612/628 → 612/628 | 499/515 → 514/515 | 612/628 → 612/628 |
| Matched completions | 514 | 612 | 499 | 612 |
| Crossings | 271 → 251 | 292 → 274 | 265 → 232 | 312 → 274 |
| Bends | 1,854 → 1,814 | 1,924 → 1,878 | 1,865 → 1,716 | 2,047 → 1,878 |
| Wire length | 456,508 → 454,598 | 510,738 → 508,912 | 441,238 → 430,028 | 524,703 → 508,912 |
| Broken stacks | 215/761 → 204/761 | 227/890 → 185/890 | 196/717 → 186/717 | 228/890 → 185/890 |
| Pin jogs | 257 → 258 | 293 → 276 | 254 → 253 | 299 → 276 |
| Netlist symmetry violations | 39/285 → 39/285 | 72/314 → 71/314 | 43/283 → 39/283 | 80/314 → 71/314 |
| Changed plan hashes | 58 | 82 | 128 | 192 |

The strict gate output is in `tmp/t183/round-2-gate.log`. The refreshed
aggregate comparison is in `tmp/t183/round-2-comparison.jsonl`.

## Investigation results

Among T182 outputs with zero crossings, broken stacks, and pin jogs, four of
222 netlist plans and three of 276 drawings changed hash. All four netlist
plans stayed at zero for those three metrics. Two gained bends and one
gained wire. Three drawings gained bends and one gained wire. One drawing
gained a broken stack and another gained a pin jog. Neither corpus gained
crossings or symmetry violations on these cases.

The comparison uses the final selected plans across revisions. The finishing
guards compare each trial against its incumbent within a single finalist
chain, and the direct zero-defect and pinned-hash tests passed.

## Deviations and open questions

The two six-worker corpus evaluations were reused as directed by the
round 2 review. The strict gate and cumulative comparison were rerun from
those reports. The netlist pin-jog increase and the regressions on previously
defect-free cases remain open. The round 2 review limits changes to timing
and test isolation.
