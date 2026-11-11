# T043 report — Crossings after connectivity repair

Brokaw is still completely connected and now has one crossing instead of three, in both quick and bounded-search mode. No other plan changed. The previous T042 changes remain in the same worktree.

| Step | Status | Evidence |
| --- | --- | --- |
| Reproduce and diagnose | Done | T042 measured 3 crossings, 6 bends, wire length 1,526. Two crossings were on the newly connected output net. A six-instance synthetic example reproduced the blocked approach followed by a complete, twice-crossed fanout. |
| General repair | Done | On a completed port repair, select a crossed signal net with a single declared output driving multiple devices on its row. If the driver is outside the loads, exchange its column with the median host column and orient horizontal receiver pins toward it. At most one extra replan per successful repair; no new annealing evaluations. Skip partitions and moves involving fixed/grouped/constrained instances. Compare completed plans and require full connectivity, safety, fewer crossings and a lower routed score. No circuit identifiers or coordinates in product code. |
| Regression | Done | Both modes × 30 original Gallery cases; all completed safely. The 29 non-Brokaw plans have exactly the T042 hash in **each** matching mode. No old snapshots or source projects overwritten. |

No prior review findings. A port-seat change alone did not resolve the two crossings. A routing-only detour in the fixed layout reduced the count to two in the probe but required a longer wire. Column exchange uses the existing row and column geometry and reached one crossing.

## Acceptance results

- Synthetic integration regression: before the change, expected fewer than 2 crossings, observed 2. After the change, the free layout has 1 and the version with a fixed branch retains the fixed position and 2 crossings. The test executes the actual route, repair and transaction pipeline.
- `tsc -p packages/auto-layout`, `tsc -p tsconfig.check.json --noEmit`, changed TS Prettier check and `git diff --check`: exit 0.
- `vitest run packages/auto-layout --maxWorkers=4`: 33 files, 576 tests passed.
- Gallery evaluator: `node scripts/auto-layout-eval.mjs <bucket> --block-boxes off --jobs 2 [--quick]`: all four runs exit 0. Default used 7–8 annealing evaluations, quick used 0. Equivalent terminal partitions, zero missing physical connections, floating pins and unsafe routes for all results. 27 full electrical graphs compared equal; 3 original graphs not extractable. No analog simulation performed.
- Exported and re-opened 30 native default-result projects. Plan hashes matched, and geometry and connectivity metrics survived serialization. In Brokaw the reloaded physical component is shared by Q1.B, Q2.B, P1.P and X1.OUT. The quick plan also has all four on one component.

| Brokaw metric | Gallery reference | T042 default | T043 default |
| --- | ---: | ---: | ---: |
| Missing connections | 0 | 0 | 0 |
| Crossings | 1 | 3 | 1 |
| Bends | 4 | 6 | 6 |
| Wire length | 879 | 1,526 | 1,519 |
| Drawing width | 372 | 474 | 484 |
| Drawing height | 411 | 595 | 595 |

One crossing remains between the output net and the branch leading to R1. This is a net reduction of two crossings, not elimination of both specific output-net intersections: the other output crossing and the former upper sense-wire crossing disappeared. The instance envelope is about 20 units narrower; the rendered drawing including annotations is 10 units wider. Against the reference drawing, wire length and detached-looking ink annotations remain visible opportunities. The rule needs an identifiable single driver; it deliberately abstains on ambiguous nets.

Default corpus totals: 0–4 (13 cases) 0 crossings / 25 bends / 7,830 length; 5–10 (17 cases) 27 crossings / 118 bends / 29,539 length. The latter previously had 29 crossings / 118 bends / 29,546 length.

Local untracked artifacts in the main workspace: `output/apr-small-t043/index.html` (30 comparisons and downloadable projects), `brokaw-comparison.png` (common scale), `brokaw-physical.json`, per-mode JSON and `comparisons.json`.
