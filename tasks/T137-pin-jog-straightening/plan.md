# T137 — Straighten small jogs at gates and two-pin parts

- Branch: `task/T137-pin-jog-straightening`
- Base: `main` at `65075a0`
- Status: approved under the owner's 2026-11-16 goal (owner comments ask for
  exactly this: "拉平更好", "把 Cp 挪一下就能省拐角")

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series; T136 (stack
candidates, rule R166) is in progress on its own branch.

## Goal

When a wire leaves a transistor gate or a two-pin part and steps sideways by
one or two grid steps before it goes on, the finished drawing moves that part
by exactly that step so the wire is straight — when nothing else gets worse.
Human drawings have such a step at 93 pins of the corpus, planner results at
482; reviewers and the owner read them as corners that one small move removes.

## Context

Experiment staged at `tmp/inputs/pt-level/` (`results.txt` — read sections 1,
2, 3 and 6 completely; the detector `jog.mjs`; the pass in `lvl-lib.js` and
`wrapper.js`; how it was patched into the built planner in `patch.mjs`;
`summary-Hg.txt`; `table-variants.txt`; reviewer verdicts in
`blind-verdicts-Hg.json`). It ran on an older build (transistor circuits equal
to `main` then; T134 and T135 landed since). Verify what you rely on.

- The relation ("jog"): subject pins are transistor gates/bases on a non-rail
  Net that has another terminal, and both pins of two-pin non-transistor
  parts. On the routed wires, the wire leaves the pin along its exit (a first
  leg of length ≥ 0; zero means it leaves the pin tip sideways), makes a
  perpendicular step of d ≤ 20 (two grid steps), then either goes on in the
  original direction (Z) or ends on a junction (L).
- Why the planner leaves them: 454 of 462 planner-only jogs leave the pin tip
  sideways; `auditRouting` (`routing-audit.ts`) does not count that corner as
  a bend and `VISUAL_TERMINAL_DEPARTURE` exempts it, so the score barely sees
  them. R147 (`device-relocation-search.ts`: `relocationUnits`,
  `relocationCandidates`, `searchDeviceRelocations`) only proposes poses where
  a pin faces another pin at 40 or 80 units: 0 of 38 diagnosed jogs had their
  straightening shift among its candidates.
- What worked (variant Hg): a pass of its own in the finishing chain
  (`finishFinalist` in `auto-layout.ts`, after R149's gap visits near line
  1611 and before the R152 branch-column comparison). Detect jogs on the
  incumbent's finished drawing; Z before L, smaller d first; the candidate is
  the step vector applied to the subject's R147 rigid unit plus one-pin
  markers wired only to it; rejected when a moved body overlaps another body;
  one try per jog; every trial fully finished through the replan R147/R149
  use; re-detect after each accepted move. Acceptance ("hybrid"):
  completeness and routed guards not worse; crossings, counted bends, visible
  corners (counted bends + pin-tip sideways departures), jog count, label
  overlaps and label clearance not up; wire at most +40; width, height each at
  most +20; and progress = fewer jogs, or fewer visible corners, or a lower
  calibrated score. The experiment also required the STACK / LEVEL / PAIR /
  SHUNT detector counts (`tmp/inputs/mos-next/det.mjs`) not to rise.
- Result on 612 cases: 121 plans change; planner-only jogs 462 → 328;
  crossings 343 → 340; counted bends −143; visible corners −301; wire −3258;
  long-narrow 108 → 106; label clearance 226 → 223; no equivalence or
  integrity defect; 1.55 extra finished trials per case on average (p90 4).
  31 cases worse on some measure: 18 inside the tolerances, 7 because the
  moved chain then wins finalist selection and the whole drawing changes.
- Blind review by two calibrated reviewers on 80 changed non-forbidden cases
  (74 judgeable): acceptable 12 → 18; 6 gained, none lost.
- Found on the way, NOT part of this task's delivered behaviour: R147's
  alignment-phase replan is called without a contact policy, so in a document
  with a licensed pin contact every R147 alignment trial fails "R10:
  coincident pin" (7 of 20 diagnosed cases). See step 7.

## Scope

Owned paths:

- `packages/auto-layout/src/pin-jogs.ts` (new): the relation and the pass
- `packages/auto-layout/src/auto-layout.ts`: the one call in the finishing
  chain; `device-relocation-search.ts`: only exports the pass needs (rigid
  units, the trial replan); `routing-audit.ts` only if the visible-corner
  count belongs there (report-only; no score change)
- `packages/auto-layout/test/pin-jogs.test.ts` (new, synthetic fixtures)
- `scripts/auto-layout-eval.mjs` and a `scripts/lib/` module: a report-only
  result key `pinJogs` (on the human and the result drawing)
- `docs/specs/auto-layout.md` (a new rule, R167), `docs/testing/readability.md`

Out of scope: the score and its weights (pin-tip corners stay uncounted
there); R147's candidates and budget; draft generation; search; the stack
snap of T136 (`stack-snap.ts`, `search.ts`, `place.ts` — do not touch).

## Steps

1. Reproduce on this base: build, run the staged detector on the base results
   (`tmp/inputs/main-65075a0-drawing-report.json` has the plan hashes; re-plan
   as needed) and state planner jogs / planner-only jogs (the experiment: 482
   / 462 on the older build).
2. `pin-jogs.ts`: the relation and the pass as in variant Hg, general rules
   only. Every arbitrary choice (d ≤ 20, Z before L, +40 wire, +20 per extent,
   clearance 0, markers carried, the trial cap, the three kinds of progress)
   goes into the rule text with the number of corpus cases that use it; drop
   any the corpus does not need.
3. Structural relations in the acceptance: the experiment's rule read four
   detector counts that product code does not have. Measure how many accepted
   moves each of them rejects on the corpus and what happens to those cases
   without it. Keep a relation only if it rejects moves that are visibly bad
   (render them); implement what is kept in product code, minimal. T136 brings
   a stack relation of its own in `stack-snap.ts` on another branch: do not
   copy it; if the stack check is needed, write it so the two can be merged
   (say how).
4. Two refinements the experiment recommended but did not test — measure each
   and adopt it only if it removes worse cases without losing gained ones
   (`blind-verdicts-Hg.json`: `base` rejected, `new` acceptable):
   a. finalist switches: run the pass on the selected finalist only, or keep
   the pass in every chain but compare with and without it before finalist
   selection (7 of 31 worse cases);
   b. reject a move that leaves a new perpendicular step larger than 20 on a
   moved pin.
5. Report-only measure `pinJogs` in the evaluation.
6. Tests (quick mode unless the search itself is under test; explicit timeout
   on any test that runs the default search): a gate one grid step off its
   driver is straightened; a two-pin part likewise; a move that would overlap,
   add a crossing or a bend, or stretch the drawing beyond the tolerance is
   not taken; a rigid unit (pair) moves as a whole; fixed and locked parts
   never move; a document without jogs plans exactly as on `main` (pinned
   hash, non-corpus shape); determinism.
7. Measure only, separately from everything above and not in the delivered
   diff: give R147's alignment-phase replan the contact policy the gaps phase
   uses, run the corpus, and report plans changed, the totals and 8 renders.
   This decides a follow-up task.
8. Corpus evaluation, drawing mode; then the node-0 netlist form with
   `--presentation netlist`.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 3 --out tmp/t137-drawing   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 3
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t137-global --jobs 3
```

- Drawing mode: no case `threw`; the same 16 refused; every completed case
  equivalent; no introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/main-65075a0-drawing-report.json`: every case without a
  jog on its base result keeps its plan hash, or the change is explained. List
  the changed cases (the experiment: 121).
- Totals over completed cases: crossings, counted bends, label overlaps, label
  clearance, long-narrow count not higher. Planner-only jogs: before and after
  (the experiment: −29%); state dev and val separately.
- Cases worse on crossings, bends, wire (+40 or more) or an extent (+20 or
  more): at most the experiment's 31; list them with the reason for the
  largest five.
- The 6 cases the reviewers judged gained keep a plan without the jogs that
  were removed; name any that do not.
- Planning time: median and p90 ratio against the base, measured interleaved
  on 40 cases; and the number of extra finished trials per case.
- Netlist mode (node-0 form): 515 completed and equivalent, no integrity
  defect, no presentation drop; plans changed and totals against
  `tmp/inputs/main-65075a0-global-report.json`.
- Render ORIGINAL | main | result for the first 16 changed non-sealed cases by
  sha256 of id and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and runs a blind
  review of the changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json` or the ids in
`tmp/inputs/forbidden.json`. The machine is shared with other long runs: at
most 3 worker processes; iterate on the jog-flagged cases plus 60 others, and
run each full evaluation once at the end.
