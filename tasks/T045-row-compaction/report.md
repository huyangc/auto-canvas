# T045 — Row compaction

The finishing pass projects protected geometry onto the vertical axis and closes only empty intervals, in whole grid steps. Intersecting protected intervals move together. It preserves explicit and recognized groups, feedback seats, coupled devices, attached drivers, stage symmetry and local marker seats. Column compaction is unchanged. One optional exact replan judges the wires on the real transaction; an unsafe layout or worse wire metric is rejected.

| Default search, 30 Gallery source projects | Reference: length / bends / crossings | T044              | T045              |
| ------------------------------------------ | ------------------------------------- | ----------------- | ----------------- |
| 0–4 devices (13)                           | 3,800 / 19 / 0                        | 7,830 / 25 / 0    | 7,710 / 25 / 0    |
| 5–10 devices (17)                          | 19,383 / 86 / 15                      | 29,539 / 118 / 27 | 28,695 / 118 / 27 |

Twelve drawings shortened, no drawing gained a bend, crossing or wire length. Brokaw: 1,519 → 1,405 length, six bends and one crossing; the rendered height falls from 489 to 446. Median layout area relative to the originals went from 1.78 to 1.72 (0–4), and 1.50 to 1.48 (5–10). No circuit identifiers or absolute case coordinates select a candidate.

## Acceptance

- Built the auto-layout package. The regression for overlapping rigid groups asserts distinct rows close without changing internal offsets or x coordinates. The existing R44 call-order test initially expected two finishing calls after the alternative; it now verifies the additional row trial as well. The corpus's exact tail and feedback offsets and repeated-layout assertions stay in force.
- Ran the evaluator separately on the 13 and 17 original projects with default search, no LLM and no block overlays. All completed: zero missing physical connections, floating pins or unsafe routes. All 30 terminal partitions matched and all 27 extractable electrical graphs were equal; 3 source graphs were uncheckable.
- Exported the 30 native projects, verified their plan hashes, opened them again and checked the wire/connection metrics. In Brokaw, Q1.B, Q2.B, P1.P and X1.OUT remain on one physical component. A/B resolve to the two original sense nets, 1/n to the original transistor IDs (Q2/Q1 respectively). A second APR round after reopening retained all four bindings.
- Local stage data, native projects and label evidence: main workspace under `output/apr-small-t045/`. The four-way same-scale gallery is under `output/apr-small-t046/index.html`. The test and typecheck results on the combined tree are in the T046 report. The private Gallery files are not added to Git.

Most horizontal whitespace remains. Row compaction cannot shorten a feedback loop whose long dimension is horizontal.
