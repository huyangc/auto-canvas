# T062 report — round 1

## Summary

Added a human/result branch-verticality metric and a bounded branch-column
candidate for plain auto-layout. The candidate adds missing internal DC series
edges, lays out independent DC stages, compacts them before marker placement,
and competes against the finished incumbent using the existing calibrated
score, routed guards and R149 crossing/bend guard. Existing symmetry blocks,
locks, authored relationships, optimized/partition planning (including fallback)
and documents above 40 instances retain their prior placement path. Both final
628-document runs pass all acceptance thresholds and reproduce identical plan
hashes.

## Steps

| Step | Status | Notes                                                                                                                                                  |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | done   | `branch-verticality.ts`; per-document and per-split evaluation counts/shares for the same completed human/result pairs.                                |
| 2    | done   | Four-example R30/R31/R33/stage traces and aggregate dev investigation below.                                                                           |
| 3    | done   | R151 channel overrides and R152 independent branch candidate; no changes to the original three strategies.                                             |
| 4    | done   | Paired medians 0.986831× / 0.990700×; aggregate p95 ratios 0.980924× / 1.005488× T061.                                                                 |
| 5    | done   | All 647 tests pass; five new tests cover two/three branches, gate/amplifier connections, deterministic full routing, fixed poses, and metric geometry. |
| 6    | done   | R151/R152 documented; all 628 evaluated; every numerical acceptance threshold passes.                                                                  |

## Review findings addressed

Round 1; no `review.md` was present.

## Acceptance results

```text
pnpm build → 0; build completed (existing bundle-size warnings)
pnpm typecheck → 0; no type errors
pnpm lint → 0; 2024 files, 0 errors, 3289 warnings
pnpm format:check → 0; all matched files formatted
pnpm exec vitest run packages/auto-layout/test → 0; 43 files passed, 647 tests passed, 129.30s; existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0 on both final runs; 628 evaluated, 627 completed, zero non-equivalent; all quality/timing thresholds pass
```

Supplementary evidence:

- Original-code evaluation with the new metric: 628 cases, all saved T061 plan
  hashes reproduced exactly. `tmp/t062/base-eval/report.json`.
- Six large documents: JSON-stringified complete plans byte-identical to the
  original implementation; 50, 50, 51, 103, 70 and 94 instances.
  `tmp/t062/large.json`.
- Focused final-scope tests: 58/58 branch, symmetry and cross-coupled tests;
  35/35 routing and stage-symmetry tests. Existing tests/timeouts unchanged.
- The first full suite ran concurrently with evaluation and failed with seven
  functional assertions and eight timeouts. The functional failures exposed
  protected symmetry/shared-tail geometry and an extra cross-coupled routing
  trial. Restricting the candidate to supply/ground drawings without R89/R94
  symmetry blocks fixes these contracts; tests were not changed.
- An initial fixture used an array for `fixedInstanceIds`; corrected it to the
  required Set before the successful typecheck.

## Investigation results

### Original strategies and where columns are lost

The original dev winners were template 160, layered 89, stages 186, with no
strategy metadata in four cases. Across 1,255 eligible non-rail DC pin pairs,
raw global R31/R33 placement put 435 in the same row, 358 in different rows
without a shared pin column, and 462 in different rows with a shared column.
These are diagnostic opportunities, not 793 guaranteed defects: fanout Nets
need not make every pair vertical. There were 198 two-conducting-pin devices
without an R30 channel edge in 122 dev drawings; recognized groups moved 15
members above their native level-derived row.

| Example      | T061 winner | Evidence before search                                                                                                                                                                                                                                                                                     |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2adejzy693` | stages      | R1/R2 have no R30 edge. Their downstream PNP emitter Nets remain level 0 while upstream MOS drains are level 1. M2, R1 and Q2 consequently all occupy row 0; stage x origins are 240, 90 and 40. The series chain is already broken before R59 or search.                                                  |
| `ray97q5c2j` | template    | R1 likewise has no edge; M2, R1 and Q2 all occupy row 0, at stage x origins 250, 310 and 380. Correctly grounded shunts occupy row 1. The same failure exists in the layered and stage alternatives before template wins.                                                                                  |
| `dr4e8zhyjg` | layered     | R30 correctly gives the M4–M7 intermediate Net level 1. The recognized M12/M7 mirror uses the minimum member row, pulling M7 to row 0 alongside M4. R33 also excludes a group-to-singleton alignment such as M2–M6. Thus grouping/rows/columns, rather than missing passive levels, dominate this example. |
| `7aevq3rx4z` | template    | The internal resistor between the second MOS and Q1-copy-1 has no edge; all three occupy row 0. The directly connected MOS–PNP branch already occupies rows 0/1. Stage composition retains the broken three-device chain.                                                                                  |

The original R30 constraint builder orients a passive only when it touches a
rail. It does not propagate an edge through an internal resistor. R31 then
uses the minimum incident level, and R33 cannot align devices in the same row.
Separately, recognized pair merging forces unequal-depth branches into one
row and blocks singleton-to-group stack alignment. Independent R50 stages
with inferred internal edges address both causes without changing the old
strategies. R59 is not the dominant cause in these examples: the broken
internal resistor is already a multi-device stage member, not a removed
single-device attachment.

R151 orients only missing two-pin DC edges using rail distances, with existing
MOS/BJT polarity and existing directed edges unchanged. R152 uses the existing
stage composition, ordering and mirroring. It compacts device geometry before
marker/port seats can preserve excess gaps. Every candidate is then fully
routed and finished before comparison. No circuit id, name, tag or input
coordinate is used to identify an eligible circuit.

Detailed original traces are in `tmp/t062/diagnosis.json` and
`tmp/t062/dev-diagnosis.json`; routed candidate probes are in
`tmp/t062/trace-examples.log` and `tmp/t062/compact-examples.log`.

### Development decisions and constraints

An initial dev evaluation improved vertical connections from 394 to 445 and
reduced wire/bends, but crossings increased from 283 to 287: the wire-weighted
calibrated score accepted some crossing tradeoffs. The final candidate also
uses the existing R149 compaction guard, so crossings and bends cannot
increase for a selected alternative. Applying the final topology eligibility
and that guard to the dev experiment retains four fewer crossings and 30 more
vertical connections. Validation data was not used to choose these rules.

Protected symmetry is a tested contract, so R152 declines such documents
instead of separating their blocks. Optimized and partition behavior remains
unchanged; a private eligibility flag preserves the existing partition
fallback even though it recursively invokes plain planning. No provider API
was called.

### Final evaluation

Against `tmp/le10-t061r3/report.json`, measured with the exact acceptance
command. All quality thresholds pass. Human/reference figures and the new
metric's baseline come from the hash-identical original-code rerun.

| Metric               |    Dev T061 |    Dev T062 |    Val T061 |    Val T062 |
| -------------------- | ----------: | ----------: | ----------: | ----------: |
| Completed            |     439/439 |     439/439 |     188/189 |     188/189 |
| Crossings            |         283 |         279 |         134 |         127 |
| Bends                |       1,945 |       1,914 |         744 |         726 |
| Wire length          | 476,861.351 | 473,601.351 | 200,577.234 | 197,834.234 |
| Median area / human  |    1.431803 |    1.436100 |    1.385185 |    1.395489 |
| Vertical connections |   394/1,255 |   424/1,255 |     163/599 |     174/599 |
| Branch verticality   |    31.3944% |    33.7849% |    27.2120% |    29.0484% |
| Floating pins        |           8 |           8 |           2 |           2 |
| Missing connections  |          12 |          12 |           6 |           6 |

Median area increases only 0.3001% on dev and 0.7439% on val, below the 2%
limit. Bends and wire improve on both splits. All 627 completed results are
electrically equivalent; the unchanged refusal is `yje2n6eva2`. Aggregate
floating/missing counts remain 10/18. Every `VISUAL_*` total is non-increasing:
label-clearance violations decrease 184→183 and label-run-on violations
36→35; all other totals are unchanged. Exactly 23 complete plans change
(15 dev, eight val).

The final four diagnostic examples have crossings 10, 6, 5 and 3 respectively
(T061: 10, 6, 5, 4). The first three retain their baseline plan; the fourth
uses the branch candidate and changes vertical connections from 0/8 to 3/8.
Fixing the seed geometry does not guarantee selection: finished routing,
labels and guards remain authoritative. Initial experiments on the first
example also showed missing ground routes, and on the third showed extra
label clearance and wire cost, despite better branch geometry.

| Timing run         | Paired median ratio | Aggregate p95 ms | T061 p95 ms | p95 ratio |
| ------------------ | ------------------: | ---------------: | ----------: | --------: |
| First final run    |           0.986831× |       14,732.854 |  15,019.358 | 0.980924× |
| Determinism repeat |           0.990700× |       15,101.786 |  15,019.358 | 1.005488× |

Both limits are ≤1.5×. No other task build, tests or evaluation overlapped the
final timing runs; machine-wide unrelated activity was not measured. This is
an observed comparison against the supplied baseline, not a claim that the
algorithm itself became faster.

Artifacts: `tmp/t062/final-first.json`,
`tmp/t062/final-first-comparison.json`, `tmp/t062/final-eval.log`, and the
rendered review at `tmp/auto-layout-eval/index.html`. The supplemental
`node tmp/t062/assert-acceptance.mjs` exits 0 after checking every numerical
acceptance condition on both runs. All 628 complete-plan hashes match between
the two final runs: `tmp/t062/determinism.json` records zero mismatches. The
repeat and its comparison are saved in `tmp/t062/final-repeat.json` and
`tmp/t062/final-repeat-comparison.json`.

## Deviations and open questions

- The branch-column candidate is compared after the ordinary R149 finalist,
  rather than replacing or entering the initial three-strategy annealing
  portfolio. This preserves the baseline and allows all routed guards to be
  checked against a fully finished result.
- Scope is narrower for circuits with protected symmetry or without both
  supply and ground rails, preserving tested placement contracts.
- No dependencies, lockfiles, existing tests, plan or review files were edited.
  No commits, branch switches or provider calls were made. All third-party
  inputs, SVGs and diagnostic probes remain under ignored `tmp/` paths.
