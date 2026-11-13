# T068 review

## Round 1 — changes-requested

Reviewed: the round 1 report and `git diff` on
`task/T068-signal-series-and-straight-stubs` on 2026-11-13; renders of both
named drawings inspected. Metrics and the signal-row rule work (upright signal
parts dev 55 → 47, val 29 → 24; primary metrics within limits; guards,
determinism and the six large documents pass). The diagnosis of both named
drawings is correct and better than the plan's.

| #   | Severity | Where                                          | Finding                                                                                                                                                                                                                                                      | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `auto-layout.ts` `planSeriesDispatch`, runtime | `signalSeries` is tied to `seriesLevels`, so documents with a signal part now plan twice (`signalRows`); `common-source-ac` +106.5%. The plan asked for a placement rule, not another complete-plan comparison.                                              | Decouple `signalSeries` from `seriesLevels`: on by default up to 40 instances in every layered row build, and remove the `signalRows` dispatch trigger. The existing strategy competition inside one plan (template / layered / stages, finished score and guards) chooses. If dev shows a real loss without the outer comparison, report it with the drawings; do not restore a second complete plan. Timing within +10%. |
| 2   | must-fix | `layered.ts` `orderRows`                       | Any row that contains a signal part is re-sorted by `tie` after the crossing-minimizing order is chosen, discarding that order for the whole row.                                                                                                            | Keep the chosen order; place signal parts by signal distance only relative to their neighbours (or seed the barycenter with it). Remove the re-sort unless dev shows it is needed; report the effect either way.                                                                                                                                                                                                           |
| 3   | must-fix | CS amplifier render (`f1a0b46a`)               | Rs is horizontal but now one row below the input source: Vin's + pin is at the top of the source in the upper row, so the Vin → Rs join drops a full row. Humans draw the source's signal pin level with the series part it drives.                          | General rule: an independent source whose other pin is a rail (an input source) and whose signal Net is joined by a signal part takes that part's row, with its signal pin level with the part's pin where the symbol allows; decided by finished score with the guards. No circuit-specific condition.                                                                                                                    |
| 4   | must-fix | Source degeneration render (`bv9zwmd835`)      | Confirmed: the output port P2 is seated on the straight segment between R1.2 and M1.D, which already share x, and the wire detours around it. In the same drawing the other output port is seated beside its trunk with a junction, which is what humans do. | Port seats (R71/R146 candidates and the rail/port searches) must not lie on the open segment between two pins of the port's Net that face each other along a common axis; seat the port beside that segment (its stub leaving from a junction on it). Add the metric below and a regression test with a drain load and an output port on the drain Net.                                                                    |
| 5   | must-fix | metrics                                        | The jog metric excludes Nets with more than two pins, so finding 4 is unmeasured.                                                                                                                                                                            | Add `blockedJoins`: pairs of pins on one Net that face each other along a common axis (opposing exits, same cross coordinate, no other pin of that Net between them) whose straight segment is crossed by a marker or port symbol, counted per pair. Human and result, per split.                                                                                                                                          |

Decision on the val jog (`23wahmw6b2`, 0 → 1 with bends unchanged and wire
1220 → 670): acceptable as a trade-off. Acceptance for avoidable jogs becomes
"lower on dev and not higher on all 628 combined" (val base is 2, too small
for a per-split gate).

Acceptance rerun: not rerun for round 1; changes requested.

## Round 2 — changes-requested (final Codex round)

Reviewed: the round 2 report, `git diff`, the named renders and
`tmp/t068-r2/regressions.html` on 2026-11-13. Both named drawings now have
the requested geometry; blocked joins 55 → 6, upright signal parts 84 → 53,
jogs 24 → 23. Remaining: one failing test, dev crossings +1.81%, val wire
+1.14%, wire-through-symbol 17 → 20, common-source-ac +17% median. The
regression renders show defects a user would see, so the gates matter.

| #   | Severity | Where                                                                                                                                                  | Finding                                                                                                                                                                                                                                         | Expected fix                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | `signalSeriesParts` scope (`3byq69ryhz`)                                                                                                               | Parasitic-style capacitors whose two Nets are both pins of the **same** device (Cgs, Cgd, Cdb, Cgb around one MOSFET) are treated as series signal parts and all laid in one row. They are bridges around a device, not parts in a signal path. | A signal series part must join Nets that reach **different** devices (or a device and a source/port); a part whose two Nets both touch one device's pins, and no other device/source on one side, keeps the legacy rule. Note Rs (Vin+ ↔ gate) stays eligible. Count the metric with the same definition.                                                                                              |
| 2   | must-fix | `stages` strategy, `signal-series.test.ts:68`                                                                                                          | The stages winner lays Vin → Rs right-to-left. The signal-order rule only seeds layered rows.                                                                                                                                                   | Apply the same signal-order rule inside each stage (the input source and signal parts ordered by signal distance, left → right), or mirror a stage whose signal parts all flow right-to-left before scoring. Keep the test unchanged; it must pass.                                                                                                                                                    |
| 3   | must-fix | dev crossings (`gx36d3sre9` 2 → 6, `5nrdf75rpd`, `czmmfvytar`, `hpfcqs6cjr`, `t3r2dvffgc`) and VISUAL_WIRE_THROUGH_SYMBOL (`9ggfasx38f`, `xnjc69vr35`) | With signal rows now unconditional, some drawings lose the legacy-row candidate that was better. The port-seat filter forces diagonal cross-coupled routes in two drawings.                                                                     | Inside the layered strategy, build both the signal-row and the legacy-row **draft** (rows and orders only, no extra complete plan) and keep the one with the lower draft routed score; the finished competition stays as it is. For the port-seat filter, keep an obstructing seat when every non-obstructing seat raises the routed guards. Diagnose each listed drawing after the fix and report it. |
| 4   | must-fix | runtime                                                                                                                                                | common-source-ac +17% median with no second complete plan; cause not reported.                                                                                                                                                                  | Profile it (which pass grew), then cache or bound it (`straight-joins` checks per seat candidate are a suspect). Within +10% median over five alternating pairs.                                                                                                                                                                                                                                       |

Acceptance unchanged from the plan change after round 1. If a gate still
fails after this round, report per-drawing causes; Opus decides with the user.

Acceptance rerun: not rerun for round 2; changes requested.

## Round 3 — awaiting the user's decision (with an Opus review fix)

Reviewed: round 3 report and `git diff` on 2026-11-13; acceptance and the
full evaluation rerun by Opus (all seven commands exit 0; 8052 local and 14
slow tests pass; the 628 per-case results are identical to Codex's
`tmp/t068-r3/result.json`). Opus review fix: `quality.test.ts` R63 now checks
that the two refinement slots go to the two distinct portfolios in either
score order, and counts the extra R153 draft routes; the assertion pinned the
old order and route count, not the R63 contract.

Against main `05050fd` (baseline remeasured with the final metric
definitions):

| Metric               | Dev             | Val             |
| -------------------- | --------------- | --------------- |
| Crossings            | 276 → 279       | 153 → 153       |
| Bends                | 1808 → 1751     | 764 → 737       |
| Wire                 | 429855 → 428455 | 192716 → 191616 |
| Median area / human  | 1.284 → 1.274   | 1.240 → 1.226   |
| Avoidable jogs       | 22 → 22         | 2 → 2           |
| Blocked joins        | 40 → 9          | 15 → 10         |
| Upright signal parts | 39 → 28         | 17 → 12         |

Guards: 628/628, none non-equivalent, floating 6, missing 16, no `VISUAL_*`
total above main; determinism and the six large documents byte-identical.
Both named drawings have the requested geometry.

Gates missed: dev crossings +1.087% (limit 1%: +3 crossings net, from
`5nrdf75rpd`, `czmmfvytar`, `en97w8v92y`, `fteqwehmtf`, `p3af2sg23j`);
avoidable jogs not lower on dev; `common-source-ac` +20.8% median
(about +150 ms). Opus recommends accepting: bends −3%, the blocked-join and
upright-part defects fall sharply, and the renders of the crossing cases are
trade-offs rather than defects. Decision is the user's.
