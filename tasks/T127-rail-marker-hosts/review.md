# T127 review

## Round 1 — accepted

Implemented by a Claude subagent (Opus). Reviewed: `git diff` on
`task/T127-rail-marker-hosts`; acceptance rerun by the reviewer; renders of
`x7evbngj49` and `j462r7dnbk` looked at; a blind review by two calibrated
reviewer subagents.

Step-1 finding: 198 of 1415 rail markers in 112 corpus cases had no host
(op-amp inputs 57, BJT pins about 95, block and switch pins, MOS gates 9); an
unhosted marker's rail wire averages 131 units against 21 for a hosted one. The
restriction to MOS D/S and two-pin parts dates from the first placement task
(T011) and was a scope limit, not a decision.

Rule: every non-MOS multi-pin device offers one visible pin that leaves toward
the rail or sideways; the marker sits straight outside it (pin faces the rail)
or one bend away (pin leaves sideways); otherwise today's trunk join. MOS and
two-pin behaviour is unchanged.

| #   | Severity | Where                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                        | Expected fix                  |
| --- | -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | note     | corpus                                             | 84 plans change. Totals (dev / val): wire −18140 / −5960, bends −178 / −42, crossings −20 / −3, label clearance −16 / −4. 15 cases are worse on bends or crossings because local markers change candidate scores and the search picks another device arrangement (`j462r7dnbk`: op-amp mirrored, output on the left).                                                                                          | follow-up with placement work |
| 2   | note     | blind review                                       | 76 changed, judgeable, non-sealed cases, main vs this task, shuffled and unlabelled, judged against the original by two reviewer subagents calibrated on the user's verdicts (85% and 82.5% agreement with the user on 40 held-back cases): acceptable 3 → 26; 24 cases gained, 1 lost (`qdpj73362b`, output on the left). Of the 13 metric-worse cases 2 became acceptable, 1 was lost, 10 stay unacceptable. | none                          |
| 3   | note     | `packages/auto-layout/test/branch-columns.test.ts` | One existing fixture relied on a parked ground marker's long wire to make the series-level candidate worse; the fixed device moved from (100,100) to (100,0) so the candidate is worse by its pose alone (holds on main and here). Intent unchanged.                                                                                                                                                           | none                          |
| 4   | note     | seats                                              | Seat candidates do not check label clearance (`2sqrha67j7`: the ground seat sits on the C1 label). MOS gates on rails and pins that leave away from the rail are still trunk-joined.                                                                                                                                                                                                                           | follow-up                     |

Acceptance rerun by the reviewer:

```text
pnpm typecheck    → 0
pnpm lint         → 0 errors
pnpm format:check → 0
pnpm docs:check   → 0
pnpm test:local   → 0 (807 files, 8302 passed, 117 skipped)
pnpm test:slow    → 0 (2 files, 8 passed)
node scripts/auto-layout-eval.mjs <628 cases> → 0 (by the implementer; report read by the reviewer)
```

Corpus against `main` at `af3a8e7`: 612 completed and equivalent, the same 16
refused, none threw; no introduced dangling wires, unconnected pins or touching
pins; the 508 cases whose rail partners are only MOS or two-pin parts keep
their plan hash.
