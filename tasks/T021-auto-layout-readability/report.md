# T021 report — round 1

## Summary

Implemented R73 label seating on every complete candidate and R74 readability
energy using the unchanged derived diagnostics and exported starting weights.
Added a general, guarded final port-facing correction and human/result metrics in
the evaluation script. Quick mode meets every round target: 32 completed,
3 label overlaps, 59 clearance findings,
13 terminal departures, 650 crossings,
63 floating pins, and a 13.591 s slowest plan.
Search returns 512 crossings, 593 bends and
66 floating pins; its readability counts are
5 / 54 / 13 (overlap / clearance / departure).

Quick targets: **pass**.
Search targets: **not all met; see deviations**.

## Steps

| Step                  | Status  | Notes                                                                                                                                                                                                                                                                                  |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — R73               | done    | Shared derived sides/rows and port candidates; grouped name/value seating; lexicographic label/wire/ink/distance costs; conflict-first order with annotation-id ties; at most two passes. Locked annotations and fixed owners remain untouched. Whole-list replay validates the edits. |
| 2 — R74               | done    | All eight weights live in exported `ROUTED_SCORE_WEIGHTS`. Counts use full `diagnoseVisualQuality` and `diagnoseLabelClearance`, cached by immutable preview/resolver. Measured costs remain below 25%.                                                                                |
| 3 — departures        | done    | Classified the 33 dev departures. Movable non-rail ports face their sole routed departure while keeping the terminal fixed. Preserve bounds alignment, locks and audit safety. Apply after selection; the reason is recorded below.                                                    |
| 4 — evaluation        | done    | Human and result readability metrics appear in per-case JSON, dev/val totals, overall totals and the console table. Planning phase timings are also recorded.                                                                                                                          |
| 5 — tests             | done    | Seven hand-built tests cover different label sides, wires, locks, paired name/value rows and field preservation, score preference, deterministic replay and fixed-terminal port facing. All 184 auto-layout tests pass; existing corpus tests are unchanged.                           |
| 6 — evaluation/report | partial | Both requested evaluations, T020 comparisons, dev/val ablation, timing benchmark and six inspected render pairs are recorded here.                                                                                                                                                     |

## Review findings addressed

Round 1; no `review.md` was present and there are no prior must-fix findings.

## Acceptance results

Lane 1: `ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
Logs are under ignored `tmp/t021/`.

```text
pnpm install --frozen-lockfile --offline → 0; all 23 workspace projects already up to date
pnpm format:check → 0; all matched files use Prettier code style
pnpm docs:check → 0; local Markdown links validated
pnpm typecheck → 0
pnpm lint → 0; no errors (2770 warnings)
pnpm vitest run packages/auto-layout → 0; 13 files, 184 tests passed
pnpm test:local → 0 on final unrestricted retry; 749 files / 7465 tests passed, 2 files / 116 tests skipped
pnpm deadcode 2>&1 | grep -E 'auto-layout' → 1 from grep; expected empty output, no auto-layout findings
pnpm build → 0; all workspace builds completed
pnpm auto-layout:review → 0; 9 corpus and 7 held-out circuits satisfy existing limits
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json → 0; 32 completed, 1 safely refused
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 32 completed, 1 safely refused
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/' → 1 from grep; expected empty output
```

The first sandboxed full-suite run could not open loopback/PostgreSQL sockets or
run its process-management tests (`EPERM`). The final full suite ran with the
required access and passed. Intermediate implementation failures were fixed;
none of the existing tests or ceilings was weakened or removed.

Unfiltered `pnpm deadcode` still reports unused files/exports/types outside the
owned paths and exits 1 before its production scan. Its exact acceptance filter
has no auto-layout output. Those unrelated findings were left untouched; the full
output is preserved in `tmp/t021/deadcode-full.log`.

## Investigation results

### Terminal departures

The plan's 68 is the total across all 32 completed drawings, not the dev count.
Dev contains 33 findings (17 drawings); val contains 35. Classification and the
placement rule were developed on dev only. Each finding below is assigned to the
placement policy that supplied the mismatched facing, without double-counting a
route detour as another cause.

| Primary cause on dev                                                      | Count | Evidence                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Part orientation: edge-port artwork convention                            |    20 | One-pin edge ports retain an edge/role facing while their actual route starts perpendicular to it.                                                                                          |
| R71 local port facing                                                     |     8 | Local seats are the snapped host-exit + 80 position. Their facing is correct toward the host, but the routed departure turns sideways; this is not an error in R71's host-facing transform. |
| Marker stub                                                               |     5 | Three ground and two VDD sideways departures. Marker conventions and the router remain unchanged.                                                                                           |
| Routing around an obstacle, independently of the port-facing policy above |     0 | No additional multi-pin/backward part findings; port detours are counted in their placement-policy bucket above.                                                                            |
| Other                                                                     |     0 | All 33 findings are accounted for.                                                                                                                                                          |

The general correction considers only a movable, unlocked, non-rail one-pin port
with one routed end. It rotates the artwork around its fixed terminal to face
that route. It rejects changes to the top/left envelope, symbol overlap or unsafe
routing, then reseats labels and validates the whole edit list, electrical
partition and preserved name claims. Power markers, fixed ports, locked-label
owners, rail ports and trunk taps retain their conventions.

The final dev probe has 10 terminal departures: five marker stubs and five
ports that cannot safely change facing under those guards remain. No router
change or case-specific rule was introduced. Private diagnostic details are in
`tmp/t021/baseline-causes.json` and `tmp/t021/final-dev-details.json`.

### Readability and ablation

Each cell is **label overlaps / label clearance / terminal departures**. Human
counts use the same 32 completed drawings, rather than silently including the
one refused input in a different denominator. The baseline diagnostic probe
matched the plan's T020 totals exactly: **45 / 242 / 68**.

| Split | Completed | Human       | T020 quick    | Steps 1+2 only | T021 quick  | T021 search |
| ----- | --------: | ----------- | ------------- | -------------- | ----------- | ----------- |
| dev   |        17 | 1 / 59 / 1  | 16 / 125 / 33 | 0 / 29 / 33    | 0 / 28 / 10 | 0 / 21 / 8  |
| val   |        15 | 0 / 57 / 7  | 29 / 117 / 35 | 3 / 29 / 35    | 3 / 31 / 3  | 5 / 33 / 5  |
| all   |        32 | 1 / 116 / 8 | 45 / 242 / 68 | 3 / 58 / 68    | 3 / 59 / 13 | 5 / 54 / 13 |

The ablation compiles a temporary copy of the final source with only final
port-facing disabled. It retains candidate seating and readability energy. The
held-out ablation is a measurement of the frozen mechanism; no weights were fitted
or changed on val. Both dev and val improve on all three readability counts in
the final quick result.

### Wiring against T020

Each cell is **crossings / bends / floating pins**. T020 quick comes from
`tmp/t020-accept/quick.json`; T020 search comes from the existing
`tmp/t020-accept/search120.json`, whose overall **495 / 612 / 59** matches the
plan. The T020 search artifact has no readability diagnostics, so no missing
historical counts are inferred.

| Split | T020 quick     | T021 quick     | T020 search    | T021 search    |
| ----- | -------------- | -------------- | -------------- | -------------- |
| dev   | 260 / 308 / 23 | 263 / 307 / 23 | 181 / 245 / 23 | 194 / 235 / 30 |
| val   | 387 / 395 / 40 | 387 / 395 / 40 | 314 / 367 / 36 | 318 / 358 / 36 |
| all   | 647 / 703 / 63 | 650 / 702 / 63 | 495 / 612 / 59 | 512 / 593 / 66 |

All completed results pass the evaluator's electrical equivalence and routing
safety checks. Floating pins remain explicitly reported by R14. The one original
refusal remains a refusal; the 32-completion target is preserved.

### Planning time and phase cost

Times below are seconds per completed quick plan. Seating and scoring columns
are cumulative measured phase time divided by cumulative plan time in that size
bin. They exclude the untimed reference quick run that the evaluator performs
before its timed run.

| Instances | Drawings | T020 mean s | T021 mean s | T021 max s | Seating share | Readability share |
| --------- | -------: | ----------: | ----------: | ---------: | ------------: | ----------------: |
| 1–20      |       11 |       1.547 |       1.853 |      4.548 |         1.43% |             1.12% |
| 21–40     |       16 |       4.295 |       4.912 |     13.591 |         1.02% |             0.79% |
| 41–60     |        3 |       1.817 |       2.306 |      3.841 |         1.04% |             0.75% |
| 61–120    |        2 |       6.853 |       7.431 |     10.491 |         0.68% |             0.30% |

Across the 32 timed quick plans: 120.749 s planning,
1.269 s seating (1.05%), and
0.945 s readability diagnostics (0.78%).
There were 593 seating calls including the final post-facing arrangement,
averaging 2.140 ms per call. The largest per-drawing phase shares were
2.06% seating
and 2.02%
readability. Full derived visual diagnostics are therefore retained.

A separate dev benchmark pairs each of three strategies with/without seating,
alternating order for two repetitions: 102 complete
paired plans across 17 dev drawings. Seating **including its
extra whole-list replay** added 3.24%
(35.276 s without, 36.419 s with).
The full routed-score call, including routing audit as well as readability,
accounted for 1.22% of plan-plus-score time. This is below
the 25% fallback thresholds, so every search candidate remains seated and scored.
Benchmark source/results stay in ignored `tmp/t021/phase-bench.mjs` and
`tmp/t021/phase-bench.log`.

For search, the sum of the 32 drawing planning times is 3813.862 s (not
elapsed wall time with 12 workers). Seating accounts for 44.885 s (1.18%) and
readability scoring for 34.692 s (0.91%). The largest rendered-span ratio is
1.3314; the largest instance width/height ratios are 1.4006 / 1.4209, below the
existing R67 dimension ceiling of 1.5.

### Six rendered pairs

Selected six dev drawings with high T020 label conflict counts. Each pair shows
T020 quick beside T021 quick. SVGs and inspected PNGs are under
`tmp/t021/pairs/`; open `tmp/t021/pairs/index.html`. The full requested evaluations
also retain human/result SVGs and HTML. No human case id or id-keyed data is
included in this report or tracked artifacts.

| Pair | Instances | T020 overlap / clearance / departure | T021 overlap / clearance / departure |
| ---- | --------: | ------------------------------------ | ------------------------------------ |
| 1    |        22 | 1 / 13 / 3                           | 0 / 1 / 1                            |
| 2    |        25 | 1 / 13 / 1                           | 0 / 0 / 1                            |
| 3    |        50 | 1 / 12 / 10                          | 0 / 4 / 1                            |
| 4    |        50 | 4 / 9 / 7                            | 0 / 2 / 2                            |
| 5    |        23 | 3 / 9 / 0                            | 0 / 3 / 0                            |
| 6    |        24 | 0 / 12 / 0                           | 0 / 6 / 0                            |

Visual inspection confirmed reduced clustered transistor names, switch names
clear of their wires, and paired values moved together. Some free and
route-anchored label/wire conflicts remain outside R73's instance-anchor seating
scope. Original content, styles and drafting objects remain intact.

## Deviations and open questions

- Port-facing correction runs **after quick/search selection**. An initial
  version inside every candidate changed a tied portfolio choice in the public
  `two-inverters` fixture. Replanning that result merged supply/ground membership
  while replaying a reused route id, which the unchanged R10 partition guard
  correctly refused. Moving the artwork correction after selection preserves
  the existing repeat-planning contract; all original corpus tests now pass
  unchanged. R73 seating and R74 readability scoring still run on every complete
  candidate, and the returned result is replayed and scored after the correction.
  No router, R10, R23 or `lostNameClaim` change was made.
- Starting weights remain exactly those in the approved plan; this round does
  not calibrate them. Historical T020 search readability counts were not recorded.
- Search target outcome: **not all met**.
  Required crossings ≤520 and readability counts no greater than quick:
  search 512 crossings, 5 / 54 / 13 readability;
  quick 3 / 59 / 13 readability. Overlaps fail the global non-regression
  requirement (5 > 3). Val also regresses relative to its quick result in all
  three counts: 5 / 33 / 5 versus 3 / 31 / 3. Search floating pins rise to 66
  from quick's 63 and T020 search's 59; dev contributes 30 versus quick's 23,
  while val improves to 36 from 40. These are weighted-score trade-offs, not
  electrical-equivalence or routing-safety failures. The prescribed weights
  were retained and no new selection gate, ceiling relaxation or val-driven
  calibration was introduced. As a diagnostic counterfactual, reverting every
  per-case readability regression to its quick result would produce 599
  crossings, 3 / 47 / 10 readability and 55 floating pins: it would fix the
  readability regression but miss the 520-crossing ceiling. That gate was not
  implemented because it is a different selection policy from the plan.
- No dependencies or lockfile changed. No commit, push, rebase, merge or branch
  switch was performed. All source edits stay inside the owned paths; this
  requested report is the only task-directory write. Human cases, probes,
  generated evaluations and render pairs remain ignored under `tmp/`.
