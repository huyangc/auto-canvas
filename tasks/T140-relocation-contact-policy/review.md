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
   `block-direction.test.ts`, "seats a fixed left-facing block's output port
   as before" (`266a6d04…` on `main`, `49c47cbb…` now). Its fixture has the
   feedback resistor in its row above the fixed amplifier; `main`'s R147 pulled
   it level with the amplifier, the guard keeps it, and the output port is then
   seated on that row. The fixed amplifier is unchanged. The test now also
   asserts the amplifier's pose and that the port is not seated by R164's
   rule. **Weak point:** those two assertions alone do not fail when R164's
   exemption for fixed blocks is broken; only the hash does (checked by
   breaking the fixed filter and the left-exit check).

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

| Plan acceptance line                                      | Result against `main` (`0b93996`)                                                                                                                                                                                        | State           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| No threw; same 16 refused; equivalent; no defects         | 612 / 16 same; 0 not equivalent; introduced dangling / unconnected / touching 0                                                                                                                                          | met             |
| A case without touching pins at R147 entry keeps its hash | 68 changed, all with touching pins (implementer's instrumented count); none without                                                                                                                                      | met             |
| Crossings, bends not higher                               | 316 → 310; 2048 → 2037; wire 526147 → 522177; 68 plans changed                                                                                                                                                           | met             |
| Label overlaps, clearance, long-narrow not higher         | 3 → 3; 212 → 212; long-narrow 47 → 46 (implementer's measure)                                                                                                                                                            | met             |
| `pinJogs` planner-only, stacks broken                     | 311 → 295; 237 → 228 (implementer)                                                                                                                                                                                       | reported        |
| Worse cases listed with five reasons                      | 7 worse by the experiment's combined definition on round 1; the largest five and their reasons are the experiment's (renders in `tmp/handoff/pt-r147c/png-worse`); not re-rendered for round 3, which differs in 2 plans | met for round 1 |
| The 32 preferred drawings                                 | all 32 keep the judged drawing                                                                                                                                                                                           | met             |
| Planning time at most ×1.08                               | ×1.02 interleaved on 40 cases in round 1; not remeasured with the guard (two pose comparisons per trial)                                                                                                                 | not measured    |
| Netlist (node 0)                                          | 515 completed and equivalent, no introduced defect; 8 changed; crossings 326 → 326; bends 2016 → 2010                                                                                                                    | met             |

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
