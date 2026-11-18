# T137 review

Implemented by Claude subagents (Opus), reviewed by the planner; the owner
asked on 2026-11-16 for subagents instead of Codex.

## Round 1 — accepted after two guards were added

The implementation was made on `main` at `65075a0`. T136 (R166) and T138
(R168) merged while it was reviewed; it was rebased twice and the numbers
below are for the final tree on `main` at `347082f`.

What changed during review:

- **Relation checks.** The experiment's acceptance read four structural
  detector counts. On 302 cases the pass without them and with a gate-level
  check alone had the same worse cases (14) and crossings; the check cost
  bends (1247 against 1240), so the implementation shipped none. Two guards
  came back for reasons found later (below).
- **Stack guard.** On the first reviewer run the pass shifted one member of a
  stack that R166 keeps in column in five cases: R147's rigid units join only
  vertical facing stacks of transistors, resistors, diodes and inductors, so a
  current source over a transistor moved alone. A stack (R166's relation and
  `stackHolds`) that holds on the incumbent must hold on the trial.
- **Level-row guard.** A blind preference test (below) preferred the earlier
  drawing mainly where the pass had pulled a transistor out of the row it
  shared with another transistor to straighten a gate line; 53 of 206 accepted
  moves on the judged cases did that. A pair of transistors level on the
  incumbent (same channel axis, reference points at most 2 apart) must stay
  level. Both guards are monotone: a relation already broken blocks nothing.
- **Declined replan.** R149's replan returned the pre-gap incumbent for a
  declined trial, which the pass could have taken for progress (42 such trials
  on 302 cases, none accepted). A declined trial is now rejected; R149's replan
  closure is hoisted for it and shares one incumbent object that R149 only
  reads.
- Not adopted, measured: rejecting a move that leaves a new step larger than 20
  on a moved pin (one fewer worse case, 39 fewer jogs removed, a judged gain
  partly lost); restricting the pass to the selected finalist (finalist
  switches give both the largest regressions and judged gains; measured
  offline only).

Two existing tests changed:

- `block-direction.test.ts`: the pinned plan of a block-free document
  (`b75ab103…` on `main` at `65075a0`) has two jogs that R167 straightens; the
  pin is now `477fddfc…`, recorded from this branch, with a comment. It
  guards that shape against later drift but no longer proves equality with the
  plan before R164. Unchanged beside it: the mechanism test "does not reverse
  a chain whose input is a grounded source" and the pin of "plans a document
  without directed blocks exactly as main".
- `cross-coupled.test.ts`: R144's route call is found by its option instead of
  being the last call, because R167 trials may route after it.
- `corpus.test.ts` (from the PR 91 review): a ground marker may sit on its
  host pin only when that is the pin it touched in the input.

Reviewer run on the final tree: build, typecheck, lint, format:check,
docs:check 0; `pnpm test:local` 0 (819 files, 8473 passed, 117 skipped);
`pnpm test:slow` 0 (2 files, 8 passed); both evaluations 0.

| Plan acceptance line                                    | Result against `main` (`347082f`)                                                                                              | State        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| No threw; same 16 refused; equivalent; no defects       | 612 / 16 same; 0 not equivalent; introduced dangling / unconnected / touching 0                                                | met          |
| A case without a jog keeps its plan hash                | Not remeasured here. On `65075a0`, 7 such plans changed, all finalist switches (explained in the implementer report)           | not met      |
| Crossings, bends not higher                             | 316 → 316; 2134 → 2048                                                                                                         | met          |
| Label overlaps, label clearance not higher              | 3 → 3; 217 → 212; label-ownership flags 12 → 10                                                                                | met          |
| Long-narrow not higher                                  | Not remeasured here (85 → 85 on `65075a0`, before the guards)                                                                  | not measured |
| Planner-only jogs, dev and val                          | 311 left on this tree; `main` has no jog key to compare. On `65075a0`, before the guards: 432 → 290                            | not measured |
| Worse cases at most 31                                  | 2 worse on crossings or bends of 79 changed; wire and extent growth not recounted (22 by the plan's definition on `65075a0`)   | met          |
| The experiment's 6 gained cases keep their jogs removed | On `65075a0`: 4 of 6; the other two had no jog on that base                                                                    | not measured |
| Planning time                                           | Median ×1.02, p90 ×1.08 interleaved on 40 cases on `65075a0`, before the guards; the guards add two pose comparisons per trial | not measured |
| Netlist (node 0)                                        | 515 completed and equivalent, no introduced defect; 76 changed; crossings 326 → 326; bends 2077 → 2016                         | met          |
| Renders                                                 | Implementer's 16 on `65075a0`; the reviewer looked at the blind material                                                       | not measured |

No R166 stack is newly broken in either mode (five cases before the guard).

Blind reviews:

- Acceptable or not (two calibrated reviewers, before/after without version
  labels, first reviewer run, 90 judged cases): acceptable 22 → 24; 4 gained,
  2 lost. The pass straightens wires in drawings that are rejected or accepted
  for other reasons; this measure barely moves.
- Which of the two (ORIGINAL beside the two automatic drawings, sides assigned
  at random; not calibrated against the owner's labels). Before the row guard,
  98 cases: new 38, earlier 28, same 32. On the final tree, 79 changed cases:
  67 have both drawings unchanged from judged pairs and carry their verdicts,
  12 were judged afresh by one reviewer, 9 of the 79 are restricted and not
  judged: new 32, earlier 14, same 24 (clear preferences 7 to 4).

Measured on the way and not in this change: giving R147's alignment-phase
replan the contact policy of the gaps phase (it rejects every trial in a
document with a licensed pin contact today) changes 73 plans on `65075a0`,
crossings 334 → 328, bends 2337 → 2297. A follow-up task.

Open after this task: about 310 planner-only jogs remain (overlap, rising
bends, the router re-jogging after the move); finalist switches; the three
cases the last reviewer preferred the earlier drawing in (an output moved to
the top, a taller narrower outline, a resistor crowded beside a source).
