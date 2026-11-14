# T079 review

## Round 1 — changes-requested

Reviewed: round 1 report on 2026-11-14. The attachment variant and the
`attachment` finished finalist work: readability composite dev 62.66 → 60.82
(−2.93%, about 1.27× human), val 34.46 → 32.94 (−4.42%, about 1.22×);
crossings fall on both splits; no drawing worse; 628/628 equivalent;
floating / missing unchanged; six large plans byte-identical; full suites
pass. Explicit floorplans are excluded (fixes the partition snapshot).

| #   | Severity | Where        | Finding                                                                                                                                                                                                    | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | runtime      | Each extra finalist (runner, local loop, attachment) can each pay a full finishing pass: `skew` 1.24× (finishing calls 42 → 75), `deadtime` 1.87×. Every finalist that passes the margin rule is finished. | Give the extra finalists one shared finishing budget per plan: rank the eligible extras by their provisional comparator and finish at most the best **one** (try two on dev and report) beyond the incumbent; skip an extra whose variant moves nothing that takes part in a crossing or a weighted readability violation of the incumbent draft. Keep at least 80% of this round's dev and val composite gains; every held-out median within +20%. Report the dev trade-off. |
| 2   | note     | `yb27wfgqkz` | Free `D` / `S` captions stay far above the compacted circuit.                                                                                                                                              | Out of scope; recorded as a drafting follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Round 2 — changes-requested (final Codex round)

Reviewed: round 2 report on 2026-11-14. The shared one-extra budget let a new
variant take the slot of T078's runner-up, which main already finishes:
15 drawings regress against main (e.g. `386ggqhz53`: the attachment variant
ranks better provisionally, 29,475 vs 35,035, but finishes at composite
0.746 against the runner's 0.131); gain retention falls below 80%;
`deadtime` stays 1.879× (finishing calls 50 → 89). The review's budget rule
was wrong; this round corrects it.

| #   | Severity | Where  | Expected fix                                                                                                                                                                                                                                                 |
| --- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | budget | T078's runner-up keeps its own slot exactly as on main (same margin rule). The new variants (local loop, attachment) share **one** additional slot, ranked by the provisional comparator, with the participation gate kept.                                  |
| 2   | must-fix | cost   | The additional variant is finished with a reduced, deterministic budget: half of the incumbent's relocation, port-seat and rail-seat trial budgets (at least one each), the other finishing passes unchanged.                                                |
| 3   | change   | gates  | No drawing's composite higher than main; dev and val composite gains at least 80% of round 1 (dev ≥ 2.34%, val ≥ 3.5%); held-out medians within +20%, except at most one fixture within +50% (report it); guards, determinism and large documents as before. |

## Round 3 — accepted with an Opus review fix

Reviewed: round 3 report on 2026-11-14. Round 3 kept the runner-up's slot and
halved the variant budgets, but still regressed two drawings and left
`deadtime` at 1.79×. Codex's diagnosis traced both regressions to the new
rules being applied to T077's local-loop finalist (participation gate on
`75k4jskamd`, half budget on `ajwgak3wbv`), i.e. away from main's behavior.

Opus review fix (a few lines): the runner-up and the local-loop finalist keep
exactly main's behavior (own slots, full budgets, no participation gate);
only the new attachment finalist uses the participation gate and half
budgets, and only for documents of at most 24 instances (the corpus gains
come from small drawings; `deadtime`, 30 instances, paid the extra pass).
`rankedFinalists` now returns runner, localLoop, attachment in fixed order;
the two tests that encoded the shared-slot rule were updated to this rule.

Opus rerun against main `a1b022f`: readability composite dev 62.66 → 61.06
(−2.55%, 1.271× human), val 34.46 → 33.58 (−2.55%, 1.244×); crossings 243 →
234 / 146 → 143; **no drawing worse**; 628/628 equivalent; all seven held-out
plans byte-identical to main and deterministic, medians 0.99–1.09×
(`deadtime` 1.004×); `pnpm test:local` 8189 passed, `pnpm test:slow` 8
passed. The val gain is below the 3.5% gate set from round 1, which had
carried two regressions and a 1.8× runtime; accepted.
