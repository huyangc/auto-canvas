# T151 report — round 1

Written by the reviewer from the implementer's final message (Opus subagent).

## Summary

All seven steps are done. The netlist corpus gives exactly the plans of the
measured experiment (`tmp/exp/runs/T151b`): 0 of 515 plan hashes differ.

- **Power flow:** `preferPowerFlow` no longer offers the left-right reflection.
  The top-bottom reflection is rejected when it would break an ordered block's
  input order (R169).
- **Port search:** the new module `netlist-reflection-veto.ts` drops any trial of
  the port search's `mirror` frame that leaves a single block or port on the
  wrong side.
- **Tail step:** `selectCurrentSourceTail` returns its incumbent for a p-channel
  pair.
- **Tests and spec:** tests updated or added; the spec gains R170 and one
  sentence at the end of R81.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                          |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | `netlist-power-flow.ts`: the `x`/`y` loop became one `y` block with the same conditions as before; the `anchored` check and the `portDirection` import are gone. `railOrder`, `admissible` and the rail-lead moves are unchanged.                                                                              |
| 2    | done   | Local `keepsInputOrder(doc, nextDoc, r)`: every instance `keepsOrder` passes in the incumbent must pass in the trial; an instance already out of order or without a placement never vetoes. Applied to the `y` trial before `admissible`.                                                                      |
| 3    | done   | `src/netlist-reflection-veto.ts` exports `reflectionWorsensDirection(incumbent, candidate, resolver)` with clauses (a) and (b) as the plan writes them. In `searchPortLayouts` a `mirrored` flag is true while the frame loop is in the `mirror` mode; `consider` checks the veto first, against `best.final`. |
| 4    | done   | `current-source-tail.ts`: returns `prior` when `polarity` of the device `tail.drivers[0]` is `"p"`.                                                                                                                                                                                                            |
| 5    | done   | See below.                                                                                                                                                                                                                                                                                                     |
| 6    | done   | R170 after R169; one sentence at the end of R81.                                                                                                                                                                                                                                                               |
| 7    | done   | Both corpora run; three gates pass.                                                                                                                                                                                                                                                                            |

Tests (step 5):

- `test/netlist-reflection-veto.test.ts` (new): clause (a) fires for one block
  newly facing left even when another turns right; not for a block that already
  faced left or for members of a two-inverter cycle. Clause (b) fires for an
  unclassified port newly on the right, a classified input newly on the right,
  an output newly on the left, an input at exactly `cx + grid`, an output at
  exactly `cx − grid`, and for one worse port even when another improves; not
  for a port already on that half, a rail port, a port strictly inside the
  neutral band (±0.9 grid) or a port that improves.
- `netlist-port-sides.test.ts`: new test "keeps the incumbent when the mirror
  would turn a free block left (R170)" (fails with the veto disabled); the
  existing "input-left orientation" test still passes.
- `netlist-power-flow.test.ts`: the two `y` rows keep title and assertions; the
  two `x` rows became "never reflects the drawing left-right for power flow on
  %s (R170)" (`load` keeps position, rotation and mirror; equivalence and
  routing assertions kept); one new R169 test.
- `current-source-tail.test.ts`: the `high-side` row left the `it.each` and
  became "leaves the current source of a high-side pair between the supply and
  the pair (R170)": y of `supply` < y of `bias` < top of the pair's bodies, with
  the replay, equivalence and crossings assertions (fails with step 4 disabled).

## Acceptance results

Implementer's runs:

```text
pnpm build → 0
pnpm typecheck → 0
pnpm lint → 0; oxlint: 2170 files, 0 errors, 3896 warnings
pnpm format:check → 0
pnpm docs:check → 0; Validated local Markdown links in 75 files
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0; 90 files, 1228 tests passed
pnpm test:slow → 0; 2 files, 8 tests passed
netlist eval → 0
gate vs tmp/exp/runs/T151b --same-plans → GATE PASSED; 499 completed, 16 refused; re-export 495 identical, 4 blocked; 0 plans differ
gate vs tmp/exp/runs/s0 --differ 31 → GATE PASSED; 31 plans differ (28 unsealed + 3 sealed)
drawing eval → 0
gate vs tmp/pr106/pr-drawing --same-plans → GATE PASSED; 612 completed, 16 refused; 0 plans differ
```

`pnpm deadcode` (not in the plan) exits 1 with no item in a touched file; whether
it also fails on the base was not checked by the implementer.

## Investigation results

- **Power-flow test rows.** The `vdd-port`/`x` and `ground`/`x` rows failed
  after step 1 as predicted (signed span 0 and −80): they asserted a left-right
  reflection. Under the new assertion the `ground`/`x` drawing is unchanged; for
  `vdd-port`/`x` the rail-lead step still moves the marker while `load` keeps its
  pose. The `y` rows pass unchanged.
- **The R169 fixture's reflection wins without the guard.** The fixture is the
  `ground`/`y` fixture plus an unconnected upright `opamp`. With the guard
  bypassed the test fails on the order assertion (the reflection is accepted and
  the inputs exchange vertically); with the guard it passes, and the rail-lead
  step moves the ground marker instead. The same disable-and-restore check was
  done for the port-sides fixture and the high-side tail test.

## Deviations and open questions

- The op-amp test asserts that `amp` and `load` keep their placements and the
  input order, not that every placement is unchanged (the rail-lead step
  legitimately moves the marker).
- `preferPowerFlow` keeps the `y` conditions as an `if`, not a one-element loop.
- The experiment's `admissible` took extra arguments only for a switch that was
  off in `T151b`; they were not ported.
- No open questions.
