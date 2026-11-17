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

## Round 2 — changes requested (independent PR review of 89b80a6)

The Opus PR review approved with one P2 and three P3 findings. Fix on this
branch (now rebased on `main` `c26e267`, round 1 committed):

| #   | Severity   | Where                                                                                                       | Finding                                                                                                                                                                                                                                           | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `place-markers.ts` (seat fallback near :282), `pin-contacts.ts` `assignRailHosts`, `route.ts` stub decision | A surplus marker that is handed a spare extra host whose seats are all blocked becomes unhosted (placed from the origin, trunk-joined), although on main it shared the last channel host and got a stub. Regression against main for that subset. | When no extra-host seat is clear and a channel or two-pin host exists, fall back to main's behaviour (share the last channel host); placement and the routing stub decision must agree. Test: one MOS host, two markers on the Net, an extra host whose seats are all blocked → the second marker sits beside the channel host with a stub, as on main. First report how many corpus markers and cases take this path on the current head (quick plans are enough). |
| 2   | should-fix | `packages/auto-layout/test/rail-marker-hosts.test.ts`                                                       | No test for a rotated or mirrored extra host, nor for several markers mixing channel and extra hosts (where placement and routing must pair identically).                                                                                         | Add both.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | note       | seats                                                                                                       | Lead corridor, labels, drafting and frames are not checked for a seat; a failed extra-host stub does not return the marker to the trunk; fixed markers take part in the pairing with a phantom seat.                                              | follow-up, not this round                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Acceptance for round 2: all plan checks; full corpus against
`tmp/inputs/main-c26e267-report.json`: no `threw`, the same 16 refused, no
introduced integrity defects; list plans that changed relative to the round-1
head report (`tmp/inputs/t127-r1-report.json`) and say why; totals not worse
than round 1.

## Round 2 result — accepted

Findings 1 and 2 fixed. `assignRailHosts` returns the channel host a marker
would have shared on main as `fallback`; placement and the routing stub decision
both use it when no extra-host seat is clear. Tests added: blocked extra-host
seats with a channel host present (identical to a `main` build's placement and
routes), four rotated or mirrored host poses, and three markers mixing channel
and extra hosts.

Census on the round-1 head: no corpus marker takes the fallback path (1214
channel-hosted, 162 seated at an extra host, 2 unseated on a Net without a
channel host, 33 without any host), so the corpus is unchanged by this round:
628 plan hashes equal the round-1 report.

Acceptance rerun by the reviewer: `pnpm typecheck` 0, `pnpm lint` 0 errors,
`pnpm format:check` 0, `pnpm docs:check` 0, `pnpm test:local` 0 (808 files,
8320 passed, 117 skipped), `pnpm test:slow` 0 (8 passed).
