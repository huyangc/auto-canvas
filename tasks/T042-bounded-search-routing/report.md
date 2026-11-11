# T042 report — bounded default search and incomplete-net repair

The normal planner now runs deterministic routed search, with seed 1 and a maximum of eight additional candidate evaluations at up to 40 instances, two above 40. The threshold includes ports and markers. Zero evaluations requests the existing quick planner; the evaluator accepts `--quick` and reports the requested budget and actual work. The budget excludes initial strategy ranking, local refinement and finalist repairs; it is not a latency guarantee.

| Step | Status | Evidence |
| --- | --- | --- |
| Reproduce | Done | T041 Brokaw: two physically missing connections, Q1.B and P1.P floating. Synthetic two-instance example with a fixed transistor reproduces the blocked approach on a fine grid. |
| Repair | Done | When R14 reports an obstruction but no movable blocking marker, try moving free floating ports to their next legal seats and replay routing. Use the existing two-pass bound, respect locks, require fewer floating pins and lower routed score, disallow more missing connections. |
| Default search | Done | Compare the searched placement with the actual finished quick plan, including final facing/label placement. Keep quick on a score tie, lost connectivity, or equally connected but strictly dominated routing (crossings, bends, length; also block intrusion for partitions). |
| Validate | Done | Both modes completed all 30 top documents. Compared with T041 by exact plan hash, final geometry and electrical connectivity. Saved editable native projects, round-tripped them, and checked the four Brokaw pins by physical component. |

No prior review findings. No Gallery identifiers, dimensions or device-specific rules were added to production code.

## Acceptance results

- `tsc -p packages/auto-layout` and `tsc -p tsconfig.check.json --noEmit`: exit 0.
- `vitest run packages/auto-layout --maxWorkers=4`: exit 0, 575 tests in 33 files. Historical quick-mode hashes and exact finalist call-count assertions now explicitly request zero search evaluations; original expected values retained.
- Prettier check on all changed TS/MJS files and `git diff --check`: exit 0.
- `node scripts/auto-layout-eval.mjs <by-size/bucket> --block-boxes off --jobs 2 [--quick]`: exit 0 for each of the four combinations. Additional no-options export matched all 30 instrumented plan hashes. Reparse preserved crossing, bend, wire length, missing connections, floating pins and terminal partition.
- For all 30, terminal partition preserved, no unsafe geometry, missing connections or floating pins in either output. Full graph extraction available for 27 original projects: 27 equivalent. For the other 3, only terminal partition and routing checks establish equivalence at the tested level.

## Results and tradeoffs

| Parts | Cases | Mode | Crossings | Bends | Wire length | Physically missing |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| 0–4 | 13 | T041 quick / T042 quick | 0 | 25 | 7,860 | 0 |
| 0–4 | 13 | T042 default | 0 | 25 | 7,830 | 0 |
| 5–10 | 17 | T041 quick | 27 | 117 | 29,247 | 2 |
| 5–10 | 17 | T042 quick / default | 29 | 118 | 29,546 | 0 |

Brokaw's four terminals Q1.B, P1.P, Q2.B and X1.OUT now belong to a single physical component; T041 left them in three. Completing the previously missing wire changes crossings 1→3, bends 5→6 and length 1,227→1,526. The count of label-clearance problems falls 3→0. The general repair works even at zero evaluations. Quick changes no other plan.

Compared to T041, the new default shortens the two-stage Miller-compensated amplifier from 990 to 960 with no change to crossings or bends. All 28 remaining plans are byte-identical. Compared to the repaired quick baseline, the default changes only the Miller case. The search used seven evaluations on 26 cases and eight on four. An initial pass exposed cases where secondary scores improved while wire metrics strictly deteriorated; the final comparison rejects those candidates.

In a separate serial paired timing run (same process, initial warm-up, alternating which mode runs first), quick/default median was 117/193 ms for the 0–4 bin and 551/944 ms for 5–10. These are local measurements, not a limit. There is little benefit to increasing the default budget on this evidence; the repaired Brokaw drawing can be improved by reducing the crossings of its now-complete route.

Local delivery under the main workspace's `output/apr-small-t042/`: `index.html` compares Gallery/T041/default at a common scale and links to quick drawings, native projects and source projects; `comparisons.json`, `brokaw-physical.json`, `timing-paired.json` and the four per-mode/per-bin reports supply the underlying measurements. These data and third-party projects stay out of version control.
