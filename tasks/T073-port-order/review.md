# T073 review

## Round 1 — changes-requested

Reviewed: round 1 report on 2026-11-13. The mechanics exist (shared
`signal-direction.ts`, `port-convention.ts`, positional R74, R146 convention
rank) and determinism / large-document identity pass, but the layouts got
worse: dev crossings 273 → 346 (+26.7%), bends +5.1%, blocked joins 4 → 42,
rail crossings 60 → 79, readability composite 100.0 → 108.8 (+8.7%); val on
common drawings crossings +20.8%, composite +3.2%; one new refusal
(`yje2n6eva2`, R10 touching-pin stub); two corpus crossing limits fail;
`ota-sky130` +76% median. portOrder fell only 20% on dev.

Diagnosis (Opus): the convention is imposed too early and too hard. The
initial R19/R71 seeds force the conventional side before routing, so every
later stage starts from a detoured seat (crossings, blocked joins, rail
crossings all rise), and the R57 mirror is applied to template/layered drafts
without comparing it against the unmirrored draft.

| #   | Severity | Where                                                   | Finding                                                              | Expected fix                                                                                                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | initial seats (R19/R71)                                 | Conventional side forced before routing.                             | Restore the main initial seats. The conventional seat (input left of its host, output right) becomes an additional R146 candidate per port, inside the existing candidate cap, and the straight-join filter applies to it.                                                |
| 2   | must-fix | R146 ranking                                            | Convention ranked ahead of length; seats chosen with worse geometry. | R146 keeps ranking by the finished calibrated score with routed guards. The positional R74 `offConvention` term (weight 300, below one crossing at 1000) is what rewards the conventional seat; do not add a separate rank key. Reject any seat that adds a blocked join. |
| 3   | must-fix | R57 for template / layered                              | Mirror applied without comparison.                                   | Build both the corrected (mirrored) and uncorrected draft for template and layered and keep the one with the lower routed draft score (as T068 does for row policies; reuse the draft router). Ties keep the corrected draft.                                             |
| 4   | must-fix | refusal `yje2n6eva2`, corpus `five-t-ota`, `fig-17-19b` | New refusal and two crossing limits broken.                          | Must not refuse; the two corpus tests pass unchanged.                                                                                                                                                                                                                     |
| 5   | must-fix | runtime `ota-sky130` +76%                               | Not diagnosed.                                                       | Profile by phase; within +20% median (the user accepts some planning cost for quality; prefer +10%).                                                                                                                                                                      |

Acceptance otherwise unchanged: portOrder −25% dev and val; readability
composite lower on dev and val; crossings and bends not higher by more than 1%;
blocked joins and rail crossings not higher; guards; determinism; large
documents byte-identical.

## Round 2 — closed without merge (superseded by T074)

Reviewed: round 2 report on 2026-11-13. Round 2 fixed the round 1 defects
(main seeds restored, mirror chosen by routed draft score, convention as the
R74 300-point term, `yje2n6eva2` completes, both corpus limits pass, runtime
within +10%, large documents identical), but the outcome is net negative on
the frozen readability composite: dev 100.03 → 101.14 (+1.1%), val 49.92 →
50.25 (+0.7%); portOrder only −1.6% / −3%, crossings +2.6% / +3.8%.

Cause: the planner's convention term (port side relative to its own host)
is a proxy that does not match the `portOrder` metric (inputs left of outputs
across the drawing), and the routed score weighs one crossing (1000) far
above one convention violation (300), whereas the readability composite
weighs them about equally. Tuning this proxy further is not useful.

Decision (Opus): do not merge T073. Keep the branch; T074 builds on its
mechanics (`signal-direction.ts`, mirrored/unmirrored draft comparison,
conventional R146 candidates) and makes the frozen readability composite part
of the planner's selection score, so the metric itself decides these
trade-offs.
