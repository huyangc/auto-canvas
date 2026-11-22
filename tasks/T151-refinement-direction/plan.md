# T151 — Netlist refinement: veto bad whole-drawing mirrors, keep supply on top

- Branch: `task/T151-refinement-direction`
- Base: `codex/spice-differential-layout` (PR 106) at `7256569`; the PR for this
  task targets that branch, not `main`
- Status: approved (owner, 2026-11-22: "确认，派发 T151")
- Plan review: codex gpt-6.2-astra, 2 rounds, approved (round 1: 5 P1 fixed;
  raw output in `logs/plan-review-r1.txt`, `logs/plan-review-r2.txt`)

## Goal

PR 106 added a late refinement for netlist input (`refineNetlistPlacement`). On
the 515-case netlist corpus it changes 282 drawings and is preferred overall,
but three of its steps produce drawings a reader rejects:

- the power-flow step reflects whole drawings left-right, which moves inputs to
  the right (`dp884p9sjn`, `dpc8h45vg7`) and never changes crossings or bends;
- the port search accepts a whole-drawing mirror that turns amplifiers and gates
  to face left (`vtvb2bzz89`, `g8xh7jm33z`) or moves an input to the right
  (`2zr5gwx42v`);
- the current-source-tail step draws a p-channel input pair with its tail below
  the pair, so VDD ends at the bottom of the drawing (`8szwjcnvxz`).

After this task the refinement no longer reflects a drawing left-right for power
flow, accepts a port-search mirror only when no single block or port ends on the
wrong side because of it, leaves a p-channel pair's tail where the earlier steps
put it, and never lets a top-bottom reflection reverse an amplifier's input
order (R169). The mirrors that put outputs on the right and inputs on the left
(`85c84m4tjv`, `gwer4fr5c3`, `e2dj5fphtt` and others) stay.

## Context

All numbers were measured on a private copy of this base's built planner with
switches (`tmp/exp/`, not tracked; `tmp/exp/results.md`, patch
`tmp/exp/lib/patch.mjs`, runtime `tmp/exp/lib/exp-runtime.js`). The copy with all
switches off reproduces the base's corpus report on 515/515 plan hashes. Read
`exp-runtime.js:182-231` and `patch.mjs:244-262,296-312,330-345` before starting:
the product change is that logic without the switches and counters.

The combination to implement is the run `tmp/exp/runs/T151b`:

| netlist corpus, 515 cases                                                         | base (PR 106) |                   this task |
| --------------------------------------------------------------------------------- | ------------: | --------------------------: |
| delivered / refused (same ids)                                                    |      499 / 16 |                    499 / 16 |
| drawings changed vs base                                                          |             – |                          31 |
| crossings / bends over the changed drawings                                       |      20 / 127 |                    20 / 131 |
| free directed blocks facing left                                                  |            10 |                           0 |
| whole drawings mirrored left-right vs `main` (device-centre x correlation ≤ −0.9) |            44 |                          15 |
| differential placements complete (of 46 recognised)                               |            39 | 38 (`8szwjcnvxz`, intended) |
| missing connection / floating pin / introduced defect / not equivalent            |             0 |                           0 |

Blind preference (`tmp/review/t151/`, scored with `tmp/tools/score-prefer.mjs`
restricted to the 28 ids of `tmp/review/t151b-open.json`, the unsealed drawings
this task changes; the judged drawings are byte-identical to `T151b`'s). Two
reviewers, each on all 28: both prefer this task's drawing 19, one prefers it
and one sees no difference 2, both prefer the base 7 (`3tte4aw3tf`,
`gdkneq9f89`, `jhpfmtx5ay`, `vcgtzej894`: mostly "matches the original's
orientation", which a netlist does not carry; `6ecccd6yxz`, `avqe2g6qrf`,
`yg9kafexrw`: see Notes). One vote per circuit family: 18 for, 6 against. Both
reviewers mark the preference "clear" in 7 drawings, all 7 for this task.

Where the code is (line numbers at the base commit):

- `packages/auto-layout/src/netlist-power-flow.ts:101-141` — `preferPowerFlow`
  loops `for (const dim of ["x", "y"])` and calls `reflectNetlistPlan` for a
  left-right (`x`) or top-bottom (`y`) reflection; lines 142-167 then move rail
  leads (`forwardRailLeads`). On the corpus the `x` reflection decided 19
  delivered drawings, the `y` reflection none (tried once), rail leads 13.
- `packages/auto-layout/src/netlist-port-sides.ts` — `searchPortLayouts`. The
  inner `consider` (line 385) accepts a trial; the frame loop is at line 429;
  in the `mirror` frame, line 444 offers `reflectNetlistPlan(...)` and line 446
  routes the mirrored seats, and the `edgeColumns` loop below also runs on the
  mirrored drawing. `frames()` builds the mirrored placement at lines 169-170.
  The frame decided 22 delivered drawings.
- `packages/auto-layout/src/current-source-tail.ts:295-320` —
  `selectCurrentSourceTail`; `currentSourceTail` (lines 25-58) returns the tail
  with `drivers`, the input pair. `centeredTail` (83-96), `exteriorTailSeats`
  (`tail-branch-seats.ts`) only build or accept a tail below the pair, and the
  stage's `completeDrawing` (`differential-stage-columns.ts:211-219`) requires
  the output ports above the devices. R81 (`docs/specs/auto-layout.md:1395`)
  places the tail below n pairs and above p pairs. Of the six corpus cases
  where the tail step routed anything, one has a p pair.
- `packages/auto-layout/src/reflect-netlist-plan.ts` — rewrites a finished plan;
  it never passes `buildPlan`, where R169 (`polarity-order.ts`, `keepsOrder` at
  line 130) is enforced. A left-right reflection keeps the vertical input order;
  a top-bottom one exchanges vertically separated inputs (level inputs stay
  level).
- Helpers the veto needs already exist: `classifyNets(...).rightFacing` (R164's
  free directed blocks, `directed-blocks.ts:48`), `directedPins`
  (`directed-blocks.ts:27`), `pinExit` and `enclosingBox` (`geometry.ts`),
  `portDirection` (`port-convention.ts`), `isMarker`
  (`placement-connectivity.ts`), `polarity` (`net-roles.ts:38`).
- Tests of the touched behaviour: `packages/auto-layout/test/netlist-power-flow.test.ts`
  (`it.each` over `vdd-port`/`ground` × `x`/`y`: "prefers forward flow on %s
  along the %s axis"; under step 1 both `x` rows fail — the signed span the
  test asserts becomes 0 for `vdd-port` and −80 for `ground` — and both `y`
  rows pass), `test/netlist-port-sides.test.ts` ("carries a routed netlist to
  the input-left orientation in one replay" must keep passing: it is a mirror
  the veto allows), `test/current-source-tail.test.ts` (the `high-side` row of
  "keeps the inputs outside both banks and the tail below a %s pair", lines
  125-281, is a p pair with an independent source and asserts the tail below
  the pair and the outputs above the devices: it fails under step 4),
  `test/differential-branches.test.ts`, `test/held-out.slow.test.ts`,
  `apps/editor/src/features/auto-layout/auto-layout-core.test.ts`.

Corpus inputs are staged in this worktree (not tracked): netlist inputs
`tmp/netlist-input/global/` (515), reference drawings `tmp/inputs/le10-input/`
(628), base reports `tmp/exp/runs/s0/report.json` (netlist) and
`tmp/pr106/pr-drawing/report.json` (drawing input), target report
`tmp/exp/runs/T151b/report.json`, gate tool `tmp/tools/gate.mjs`. Ids listed in
`tmp/inputs/sealed.json` must never be printed, listed or opened one by one.
The evaluation script prints every case id, so its output goes to a log file
that nobody reads case by case; the gate tool prints unsealed ids and only
counts sealed ones. A difference that exists only in sealed cases is reported
as a count and investigated through aggregates.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/netlist-power-flow.ts`
- `packages/auto-layout/src/netlist-port-sides.ts`
- `packages/auto-layout/src/current-source-tail.ts`
- `packages/auto-layout/src/netlist-reflection-veto.ts` (new)
- `packages/auto-layout/test/netlist-power-flow.test.ts`
- `packages/auto-layout/test/netlist-port-sides.test.ts`
- `packages/auto-layout/test/current-source-tail.test.ts`
- `packages/auto-layout/test/netlist-reflection-veto.test.ts` (new)
- `docs/specs/auto-layout.md` (one new entry, R170, and one sentence in R81)
- `tmp/t151/` (untracked acceptance output)

The implementer's report is its final message in the format of
`tasks/_template/report.md`; the reviewer writes `report.md` from it.

Out of scope (do not change):

- Any other stage of the refinement, its routing budgets (`+2` bends, wire
  ×1.1, `+4`, ×1.25), trial counts or timing (T152), sort order and diagnostics
  (T153), the acceptance predicate on corners (T154).
- `portDirection`, `classifyNets`, R164, R169's own rules, and everything on the
  drawing-input path (`preserveDrawnSymmetry`).
- Building a tail above a p pair. This task only stops the tail step from
  drawing it below.
- `tasks/T151-refinement-direction/plan.md` and `review.md`.

## Steps

1. **No left-right reflection for power flow.** In `preferPowerFlow`
   (`netlist-power-flow.ts`), stop offering the `x` reflection: the loop handles
   `y` only, and the `x`-only code (the `anchored` test at lines 114-127)
   goes. Rail-lead moves and the `y` reflection stay as they are. Update
   `railOrder`/`admissible` only if something becomes unused.
2. **R169 on the top-bottom reflection.** Still in `preferPowerFlow`: reject the
   `y` trial when any instance whose pose keeps its symbol's input order in the
   incumbent (`keepsOrder(instance, resolver, placement)`) does not keep it in
   the trial. The rule preserves an ordered pose; it does not try to repair a
   block the incumbent already draws out of order (fixed, locked, no compatible
   pose or geometry fallback under R169), and such a block does not veto.
3. **Veto for port-search mirrors.** New module `netlist-reflection-veto.ts`
   exporting one function, for example
   `reflectionWorsensDirection(incumbent: SchematicDocument, candidate: SchematicDocument, resolver): boolean`,
   true when either holds:
   - (a) a free directed block (`classifyNets(candidate).rightFacing`) has an
     output pin whose `pinExit(...).x < 0` in the candidate and did not in the
     incumbent — per block; another block improving does not offset it;
   - (b) a non-rail port (`port` / `port-filled`, Net not in `roles.rails`) is on
     the wrong half in the candidate and was not in the incumbent — per port, no
     offsetting. Direction is `portDirection(document, roles, net)`; a port for
     which it returns nothing counts as an input. An input is wrong on the right
     half, an output on the left half. With `dx = port placement x − cx`, where
     `cx` is the unsnapped midpoint `box.x + box.width / 2` of `enclosingBox` over
     the non-marker instances of the same drawing: `Math.abs(dx) < grid` is
     neither half (strictly less: a port exactly one grid step from `cx` is on
     that half), otherwise the half is the sign of `dx`. A port without a
     placement or without a Net on `P` is ignored; a drawing with no non-marker
     instance has no ports to judge.
     In `searchPortLayouts`, every trial offered to `consider` while the frame
     loop is in the `mirror` mode (the `reflectNetlistPlan` candidate, the routed
     mirrored seats and the edge-column candidates built on the mirrored drawing)
     is dropped when the function returns true for (`best.final`, `trial.final`),
     `best` being the incumbent at that moment. Other frames are not vetoed. Keep
     the function free of the search's state so it can be unit-tested with two
     documents.
4. **Tail of a p pair.** In `selectCurrentSourceTail`, return `prior` when the
   tail's input pair is p-polarity (`polarity(symbolId) === "p"` of a device of
   `tail.drivers`; see `pTail` in `exp-runtime.js:183-188`). Comment why: R81
   puts that tail above the pair and this stage only builds it below.
5. **Tests.**
   - `netlist-reflection-veto.test.ts`: (a) fires for one block newly facing
     left even when another turns right; does not fire for a block that is a
     member of a block cycle; (b) fires for an unclassified port newly on the
     right half, for a classified input newly on the right, for an output newly
     on the left; does not fire when the port was already on that half, for a
     rail port, or for a port strictly inside the neutral band; a port at exactly
     `cx + grid` (input) and at exactly `cx − grid` (output) does fire.
   - `netlist-port-sides.test.ts`: a fixture where the only mirror that improves
     a classified port would turn a free directed block to face left returns the
     incumbent; the existing "input-left orientation" test still passes.
   - `netlist-power-flow.test.ts`: keep the two `y` rows as they are. Replace
     the two `x` rows by a test that, on the same fixtures, the device (`load`)
     keeps its pose — position, rotation and mirror — while the rail marker may
     move, and keep the equivalence and routing assertions. Add a test for
     step 2 on a fixture whose top-bottom reflection is accepted without the
     guard (verify that first, for example with the guard commented out, and
     say so in the report) and which contains an upright op-amp: with the guard
     the drawing is not reflected and the op-amp's input pins keep their
     vertical order.
   - `current-source-tail.test.ts`: take the `high-side` row out of the
     `it.each` (the `feedback` and `biased-follower` rows stay unchanged) and
     give it its own test with the new expectation: the supply marker is above
     the bias source and the bias source above the pair (y of `supply` < y of
     `bias` < y of the pair's bodies), keeping the replay, equivalence and
     crossing assertions of the old row.
     Tests assert the rules (which half, which way a pin exits, order of y
     coordinates), not coordinates.
6. **Spec.** `docs/specs/auto-layout.md`: add **R170 — Reflections in netlist
   refinement (T151)** after R169 with the four rules of steps 1-4 in the
   style of the neighbouring entries (what, the exact predicate, what is not
   vetoed), and one sentence at the end of R81 saying the netlist refinement's
   tail step applies to n pairs only. Do not describe the rest of PR 106's
   refinement here (T153).
7. **Corpus check.** Build, then run the netlist corpus and the drawing corpus
   (commands below). The netlist run must give exactly the plans of
   `tmp/exp/runs/T151b/report.json`; if the gate lists a differing unsealed
   case, find out why and explain it in the report; if only sealed cases
   differ, report the count and what the aggregates show. Do not paper over a
   difference. Step 2 is the only rule the experiment did not have; the `y`
   reflection was tried once and never accepted on this corpus, so a
   rejection-only rule cannot change a corpus plan.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build                       # exit 0
pnpm typecheck                   # exit 0
pnpm lint                        # 0 errors
pnpm format:check                # exit 0
pnpm docs:check                  # exit 0
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout   # 0 failures
pnpm test:slow                   # 8 passed (2 files)
mkdir -p tmp/t151
node scripts/auto-layout-eval.mjs $PWD/tmp/netlist-input/global --reference $PWD/tmp/inputs/le10-input \
  --presentation netlist --out tmp/t151/netlist --jobs 6 > tmp/t151/netlist.log 2>&1 &&
node tmp/tools/gate.mjs tmp/t151/netlist/report.json tmp/exp/runs/T151b/report.json --same-plans   # GATE PASSED; 499 completed, 16 refused; re-export 495 identical, 4 blocked; 0 plans differ
node tmp/tools/gate.mjs tmp/t151/netlist/report.json tmp/exp/runs/s0/report.json --differ 31       # GATE PASSED; exactly 31 plans differ from the base
node scripts/auto-layout-eval.mjs $PWD/tmp/inputs/le10-input --out tmp/t151/drawing --jobs 6 > tmp/t151/drawing.log 2>&1 &&
node tmp/tools/gate.mjs tmp/t151/drawing/report.json tmp/pr106/pr-drawing/report.json --same-plans # GATE PASSED; 612 completed, 16 refused; 0 plans differ
```

Do not print the two `.log` files (they list every case id). On the base, the
first gate fails (31 plans differ from `T151b`), the second fails (0 differ
where 31 are expected) and the third passes; everything else passes on the
base. `pnpm test:local` (whole repository, 8654 passed on the base) is rerun
by the reviewer.

Behavioral checks:

These follow from plan-hash equality with `T151b`, where they were measured;
they are not separate commands:

- `vtvb2bzz89` (op-amp faces right, `VB` on the left), `g8xh7jm33z` (the three
  inverters face right), `2zr5gwx42v` (`Vin` on the left), `dp884p9sjn` (`Vinp`
  on the left), `dpc8h45vg7` (`Vcont` on the left), `8szwjcnvxz` (VDD above the
  pair).
- `85c84m4tjv`, `gwer4fr5c3`, `e2dj5fphtt`, `h92rpj3dfx`, `sgtt4psa7z`: the
  drawing is the base's (the mirror stays).
- No delivered netlist drawing has a free directed block (`roles.rightFacing`)
  with an output exiting west: 0 in `T151b` (`tmp/exp/runs/T151b/derived.json`,
  `leftFree`). The report field `blockDirection.outputFacesLeft` is a different
  count (pins, cycle members included; 4 in `T151b`) and is not this check.

## Notes for the implementer

- Decisions already made, with their cost:
  - The power-flow `x` reflection is removed, not vetoed: on the 18 unsealed
    drawings it decided, both reviewers prefer its removal in 12, one does and
    one sees no difference in 2, both prefer keeping it in 4; it never changed
    crossings or bends. `dp884p9sjn` and `dpc8h45vg7` recover through this.
  - A port with no known direction counts as an input in the veto. Without that
    reading `2zr5gwx42v`, `xr9crqb93w` and `p9a6ba2x8n` stay mirrored. Its cost
    on this corpus is `6ecccd6yxz`, where a mirror the reviewers liked is
    vetoed because an unclassified test point crosses the centre.
  - Clause (a) vetoes `avqe2g6qrf` (an op-amp) and `yg9kafexrw` (an inverter),
    where the reviewers preferred the mirrored drawing although the block faces
    left in it. R164 wins. `avqe2g6qrf` returns to the plan `main` draws;
    `yg9kafexrw` gets a third drawing (13 bends; `main` has 11).
  - `at7pdcq4ea` / `6xrx9wwkh9` (one circuit family) keep the mirror although the
    reviewers preferred the un-mirrored drawing; no clause applies. Leave it.
- Do not tune the veto on the cases named here. If the corpus gate against
  `T151b` fails, the implementation differs from the measured rule; fix the
  implementation, do not adjust the rule.
- Do not run reviewers or change `tmp/exp/`, `tmp/pr106/`, `tmp/review/`,
  `tmp/tools/`.
- Do not commit, push or switch branches; the reviewer commits after review
  (`Test-Impact: tests-updated`).
