# T077 review

## Round 1 — changes-requested

Reviewed: round 1 report on 2026-11-14. The rule works where it applies
(synthetic regulators 2 → 0 crossings; `ajwgak3wbv`, `8w2ra7hdrw`,
`75k4jskamd` get the amplifier next to its transistor), guards hold
(628/628 equivalent, floating / missing and visual totals unchanged), but the
effect is negligible: dev composite −0.14%, val +0.01%; ten plans change (six
better, four worse). The plan overestimated the cohort: the 113 dev
"block" drawings include adders, gates and flip-flops, and only 12 dev
drawings match a single-receiver local loop, holding 4 of the 76 crossings.

Round 2 broadens the recognition to the two patterns the investigation found
in the worst analog cases, keeps every other part of the rule, and lets the
T074 selection decide per drawing.

| #   | Severity | Where       | Finding                                                                                                                                                             | Expected fix                                                                                                                                                                                                                                                                                                                 |
| --- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | recognition | A block whose output drives the gates of several devices that belong together (a mirror bank / devices sharing a gate Net, `gh3gcb5h3a`, `2adejzy693`) is excluded. | Accept a receiver **group**: all control-pin receivers on the output Net, when at least one input senses a non-rail conducting terminal of one of them (or its rail-cut DC branch). Seat the block beside the receiver group on the control-pin side, output toward the group's gate line (nearest receiver gate as anchor). |
| 2   | must-fix | recognition | A block that drives the receiver through one series passive (`t3r2dvffgc`: OUT → R1 → gate) is excluded.                                                            | Follow at most one two-pin passive from the output Net to the receivers' control Net; move the passive with the block as one unit (R70-style chain), passive between block output and gate.                                                                                                                                  |
| 3   | must-fix | regressions | Four drawings get a higher composite (e.g. `hpfcqs6cjr` gains a crossing).                                                                                          | Report why the selection kept a worse plan there (draft vs finished score, as T074 found) and fix if the draft comparison is the cause; otherwise report.                                                                                                                                                                    |
| 4   | change   | acceptance  | Val has six eligible drawings, all with zero crossings: it can only stay equal or lose.                                                                             | Val gate becomes "composite not higher by more than 0.2%"; dev: composite lower by at least 1% and crossings in the eligible drawings lower.                                                                                                                                                                                 |

Spec: Opus applies the proposed "local-loop amplifier attachment" text (with
the round 2 extensions) at merge time.

## Round 2 — parked until T078 merges

Reviewed: round 2 report on 2026-11-14. Receiver groups and one-passive
chains are implemented (31 dev drawings recognised, up from 12); guards,
determinism, large documents and timing (≤ +1.87%) pass. Dev composite
−0.80% (gate −1%), eligible-dev crossings 36 → 39; val +0.014% (within the
revised limit). The four regressions are a selection problem: the local-loop
draft wins the provisional comparison but finishes worse; disabling it
restores main. That needs `auto-layout.ts`, outside this task's scope.

Decision (Opus): park T077. T078 makes the final choice on finished layouts;
round 3 rebases T077 onto it and offers the local-loop placement as a
separate finalist instead of replacing a strategy's draft, so a worse
finished result is rejected.

## Round 3 brief (final Codex round), after T078 merged

The branch is rebased onto main `9cbdeef` (T078: the runner-up refined
finalist is finished too and the best finished run wins). Base report:
`tmp/main-9cbdeef-report.json` (composite dev 62.82, 1.31× human; val 34.47,
1.28×).

| #   | Severity | Where                            | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | how the local-loop draft is used | Do not let the local-loop draft replace a strategy's draft on its provisional score. Offer the local-loop placement as an additional finalist in T078's finished selection (`finished-selection.ts`): when the winning strategy has an eligible local loop, its amplifiers-seated variant is finished alongside the incumbent under the same margin rule, and the best finished run wins under the shared comparator. A variant that finishes worse is never returned. |
| 2   | must-fix | scope                            | `auto-layout.ts` and `finished-selection.ts` are now owned for this purpose (only what step 1 needs).                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | change   | acceptance                       | Against `tmp/main-9cbdeef-report.json`: composite lower on dev and not higher on val; no drawing's composite higher than main; eligible-dev crossings not higher; guards, determinism, large documents, held-out times within +15% median.                                                                                                                                                                                                                             |

## Round 3 — accepted

Reviewed: round 3 report and diff on 2026-11-14. The local-loop placement is
now an additional finalist in T078's finished selection instead of replacing
a strategy's draft. Against main `9cbdeef`: readability composite dev
−0.25%, val −0.011%; no drawing's composite higher (the six earlier
regressions keep main's exact plan); eligible-dev crossings 34 → 33;
628/628 equivalent; floating / missing unchanged; six large plans
byte-identical; held-out medians at most +3.97%. The gain is small; it is
accepted because it addresses the user's original complaint (amplifiers not
next to the transistor they regulate, e.g. the gain-boost cascode) without
any regression. Opus applied the spec text as R156.
