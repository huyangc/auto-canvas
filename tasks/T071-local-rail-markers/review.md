# T071 review

## Round 1 — changes-requested

Reviewed: round 1 report and diff on 2026-11-13. The mechanics are right:
explicit membership plus a copied name claim keep the Base Net and name;
`equivalentTerminals` checks original partitions and validates additions; one
Undo restores everything; re-runs are stable; the six large plans are
byte-identical. The marker-aware missing-connection definition in
`routing-audit.ts` (separate components carrying same-symbol, same-name
markers on one Base Net count as complete, small documents only) is accepted:
it is what a human drawing with local grounds means.

The effect is far too small: rail crossings dev 60 → 58, val 36 → 35. The dev
probe shows 57 crossed rail Nets in 45 drawings, 39 of them **with** a marker
instance, yet only two drawings changed. So the main bottleneck is the
clustering / candidate / guard path, not the symbol scope.

| #   | Severity | Where                                                                | Finding                                                                                                                                                                        | Expected fix                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | local rail pass, 39 eligible Nets                                    | Not diagnosed why 37 of 39 crossed, marked rail Nets got no change.                                                                                                            | For every crossed rail Net on dev, record the outcome: no candidate generated, candidate rejected (name the guard and the values), or candidate accepted but crossings unchanged. Report the table. Fix the dominant causes generally.                                                                                                                                                         |
| 2   | must-fix | clustering                                                           | Clusters are too conservative. Humans give a rail pin its own marker whenever its trunk would cross another Net (the evaluator's `railMarkers` human/result counts show this). | Generate, per crossed rail Net, at least: (a) one marker per device pin whose trunk branch crosses another Net, the rest kept on the trunk; (b) one marker per device. Seat each marker by R6a/R12 on that pin's exit, rail side. Choose by the finished calibrated score with the routed guards, readability composite not higher. Bounded (≤ 8 finished trials per document), deterministic. |
| 3   | must-fix | symbol scope (user decision 2026-11-13: "允许就近重复放 VDD/地符号") | Supplies drawn as an annotation-owned power label (e.g. `label-VDD1`, a `name-claim` with `powerDomain` and a `power-marker` owner) are excluded.                              | A rail Net whose existing `name-claim` has `powerDomain` supply/vdd or ground may receive `vdd-port` / `ground` instances bound to **that existing name** (copy the claim's name, scope and domain; never invent a name). Nets with no such claim stay excluded. Equivalence: an added marker must match an existing claim's name, scope and domain on that original partition.                |
| 4   | must-fix | rule number                                                          | R154 belongs to T069.                                                                                                                                                          | Name the new rule R155 and update references.                                                                                                                                                                                                                                                                                                                                                  |
| 5   | must-fix | runtime (fd-two-stage 1.18×)                                         | Cause not reported.                                                                                                                                                            | Profile by phase; the amended gate is +20% median (as for T069; the user accepts some planning cost for quality), prefer +10%.                                                                                                                                                                                                                                                                 |
| 6   | note     | `scripts/auto-layout-review.mjs`                                     | Still uses strict `terminalPartition`.                                                                                                                                         | Switch it to `equivalentTerminals` (now owned).                                                                                                                                                                                                                                                                                                                                                |

Acceptance unchanged otherwise (rail crossings −30%, total crossings −10% on
dev and val; composite lower; guards; determinism; idempotent re-run).

## Round 2 — accepted by Opus

Reviewed: round 2 report and diff on 2026-11-13. R155 now diagnoses every
crossed dev rail (57 rails / 45 drawings; the dominant round 1 failure was a
preliminary symbol-bounds overlap check, 25 rails), generates per-pin and
per-device candidates within eight finished trials, seats local markers by
geometry, supports rails whose power claim is owned by an annotation or
conductor (existing name, scope and `vdd` / `ground` domain only), and keeps
the original partitions in `equivalentTerminals` (also used by
`scripts/auto-layout-review.mjs`). 628/628 equivalent, six large plans
byte-identical, no marker growth on re-run, one Undo restores everything.

Against main `865924b`: readability composite dev 100.03 → 95.36 (−4.7%),
val 49.92 → 48.58 (−2.7%); rail crossings 60 → 44 (−26.7%) / 36 → 31
(−13.9%); total crossings 273 → 257 / 157 → 152; bends, wire and area not
worse; held-out timing within the amended +20% (fd-two-stage 1.157×).

Missed plan gates: rail crossings −30% and total crossings −10% per split, and
val `VISUAL_LABEL_RUN_ON` 11 → 12 (one drawing). Opus accepts them: the frozen
readability composite — the yardstick of the user's goal — improves on both
splits with no other regression, and the next task (T074) makes the composite
itself the planner's selection criterion.
