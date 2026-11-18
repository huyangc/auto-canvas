# T140 review

Implemented by a Claude subagent (Opus), reviewed by the planner; the owner
asked on 2026-11-16 for subagents instead of Codex.

## Round 1 — accepted after one guard was added

The fix as planned: `railContacts` is computed before R147's alignment phase
and one closure replans alignment trials with it. R148 receives the same
function with the same policy object as before; R146 and the gaps phase are
untouched. On the corpus it reproduces the experiment exactly (70 plans
changed, every one with touching pins when R147 starts).

It exposed a gap. `corpus.test.ts` 'two-stage-symbolic' asserts that the
capacitor bridging two amplifier stages lies horizontal one row above them;
with alignment trials no longer failing, R147 turned it and moved it beside
another capacitor. The test stayed; the rule got a guard, in three steps:

1. The gaps phase's feedback-band check (any vertical offset between a
   two-pin part and a signal block sharing its two Nets is frozen) applied to
   the alignment phase: too broad. R147 could no longer bring a far-off
   feedback part beside its amplifier, two pinned plans changed, 12 of the 14
   bends gained were lost, and an inverter across a gate counted as a feedback
   part. Reverted; the gaps check is as on `main` (its pair list is hoisted,
   a pure move).
2. A monotone guard for the alignment phase only: a two-pin part that is not
   a directed block, across two non-rail Nets of one signal block, that lies
   level and exactly one placement row above or below that block must stay in
   that row on the same side; a part outside its row is free. On the corpus 32
   cases have such a part and the guard refuses 32 of 4629 finished trials in
   17 cases.
3. One pinned plan changes under the guard and is re-recorded:
   `block-direction.test.ts`, now "keeps a fixed left-facing block's output
   port off R164's seat" (`266a6d04…` on `main`, `49c47cbb…` now). Its fixture
   has no pin contact; the feedback resistor lies in its row above the fixed
   amplifier. `main`'s R147 pulled it level with the amplifier; the guard
   keeps it. The fixed amplifier is unchanged.

   The new drawing seats the output port worse than `main`'s. The port sits
   inside the feedback loop, directly above the amplifier's output, with the
   return wire passing over it. On `main` it hangs below the output junction,
   outside the loop. No corpus case shows this pattern: 0 ports moved onto a
   feedback row in the plans that differ from round 1 (implementer's count).

   The test asserts the amplifier's pose and the exact port seat: `out.P` x
   equals X1.OUT's x, and `out.P` y equals R2's row. It also asserts that the
   seat is not right of X1's centre, as R164's filter would require. Breaks
   (temporary, reverted): b1 = the `place.ts` fixed filter, b2 =
   `withoutFixedBlocks`, b3 = `drivingOutput`'s exit check.

   | Breaks   | Hash, `main` | Hash, head | Seat assertions, before round 2 | Seat assertions, after round 2 |
   | -------- | ------------ | ---------- | ------------------------------- | ------------------------------ |
   | b1+b3    | unchanged    | changes    | pass (not caught)               | fail (x 160 ≠ 170)             |
   | b2+b3    | changes      | changes    | fail (x 210 > centre)           | fail (x 210 > centre)          |
   | b1+b2+b3 | changes      | changes    | fail (x 220 > centre)           | fail (x 220 > centre)          |

   Single breaks and b1+b2 change neither hash (reviewer's measurement).

A declined alignment trial returns the starting run; R147 accepts only a
strictly better run, so it cannot be taken for progress (no identity check
needed, unlike R167).

Fixed and locked instances: units with a fixed or locked member are never
tried, re-anchoring is off when anything is fixed and the replan uses exact
placements; the policy changes only the coincidence check. A search-level test
has a fixed marker on a pin. Through `planAutoLayout` the case is not
reachable: a fixed device with a fixed marker on its pin is refused by the
base planner already.

Also in this change, from the last review of PR 92 (text and one test name):
the T137 record's blind-review counts, its long-narrow row and the ranking
measure of its worse cases; the R167 rationale says which tree its figures come
from; the block-direction test of the source-driven chain is named for what it
checks.

Reviewer run on the final tree: build, typecheck, lint, format:check,
docs:check 0; `pnpm test:local` 0 (819 files, 8484 passed, 117 skipped);
`pnpm test:slow` 0 (2 files, 8 passed); both evaluations 0; every plan hash of
both evaluations equals the implementer's round-3 run.

| Plan acceptance line                                      | Result against `main` (`0b93996`)                                                                                                                                                | State                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| No threw; same 16 refused; equivalent; no defects         | 612 / 16 same; 0 not equivalent; introduced dangling / unconnected / touching 0                                                                                                  | met                                |
| A case without touching pins at R147 entry keeps its hash | 68 changed, all with touching pins; met on the corpus (the implementer's instrumented count); not true in general — the guard changes the contact-free fixed left-facing fixture | met on the corpus                  |
| Crossings, bends not higher                               | 316 → 310; 2048 → 2037; wire 526147 → 522177; 68 plans changed                                                                                                                   | met                                |
| Label overlaps, clearance, long-narrow not higher         | 3 → 3; 212 → 212; long-narrow 47 → 46 (implementer's measure)                                                                                                                    | met                                |
| `pinJogs` planner-only, stacks broken                     | 311 → 295; 237 → 228 (implementer)                                                                                                                                               | reported                           |
| Worse cases listed with five reasons                      | 7 by the experiment's combined definition in round 1; two plans differ on the delivered tree, which was not re-rendered                                                          | not measured on the delivered tree |
| The 32 preferred drawings                                 | all 32 keep the judged drawing                                                                                                                                                   | met                                |
| Planning time at most ×1.08                               | ×1.02 interleaved on 40 cases in round 1; not remeasured with the guard (two pose comparisons per trial)                                                                         | not measured                       |
| Netlist (node 0)                                          | 515 completed and equivalent, no introduced defect; 8 changed; crossings 326 → 326; bends 2016 → 2010                                                                            | met                                |

Blind preference (ORIGINAL beside the two drawings, sides at random,
calibrated reviewer subagents; not calibrated against the owner's labels), on
the fix without any guard: new 32, earlier 11, same 15 of its 58 changed
non-restricted cases (clear preferences 11 to 3). The delivered tree differs
from that variant in two plans, one of them restricted, so the verdicts apply.
The stack and level-row guards of R167 were tried on R147 and rejected: on the
18 cases only they change the reviewers preferred the earlier drawing 9 to 8.

Open after this task: R146's port-seat search has the same defect (every trial
fails in 257 cases). Fixing it moves ports into the drawing; with a check that
keeps properly seated ports in place the blind preference was 25 new to 42
earlier, so it is not done.

## Round 2 — changes requested (PR review of 13fbc1c)

| Finding                                                            | Priority | Change                                                                                                                                           |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Contact-free plans keep their hash" is false as worded            | P2       | Acceptance row qualified as met on the corpus only; R147's text says the guard applies to every document, also one without any pin contact       |
| The guard's wiring into the planner has no test that names it      | P2       | New planner test "keeps a fixed block's feedback part in its row through R147" (R2's offset from X1 stays −row); fails with the guard unwired    |
| The re-recorded pin is misnamed, and its seat is worse than main's | P3       | Renamed; exact seat assertions added; this record states the worse seat and the break table                                                      |
| The spec understates the contact policy                            | P3       | R147 says any declared same-Net pair may abut, and that its candidates keep two grid steps of clearance and cannot create a new contact          |
| The spec omits when and against what the guard reads               | P3       | R147 says the guard reads the proposal before the replan, against the alignment-phase incumbent on placement origins; compactRows binds the pair |
| The worse-cases row overstates what was measured                   | P3       | Changed to "not measured on the delivered tree"                                                                                                  |

### Round 2 result

`packages/auto-layout/src` is unchanged from `13fbc1c`; the changes are to tests, the spec and this record.

Temporary edits, all reverted:

- With `leavesFeedbackRow(placements) ? initial :` replaced by `false ? initial :`, both tests on the fixture fail:
  - the new row test: offset 0, not −100;
  - the renamed seat test: x 150, not 170.
- The three break combinations in the table each fail a seat assertion before the hash line is reached.

Checks: build, typecheck, lint, format:check, docs:check and `pnpm vitest run packages/auto-layout --maxWorkers=2` all exit 0. No corpus evaluation was run; product source is unchanged.

Reviewer check of round 2: `git diff 13fbc1c -- packages/auto-layout/src
scripts` is empty, so the corpus evaluations of round 1 stand; build,
typecheck, lint, format:check, docs:check 0; `pnpm test:local` 0
(819 files, 8485 passed, 117 skipped); `pnpm test:slow` 0 (2 files, 8 passed).
