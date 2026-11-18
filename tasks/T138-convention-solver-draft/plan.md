# T138 — Convention-solved draft as an additional candidate

- Branch: `task/T138-convention-solver-draft` (stacked on T136, PR 90)
- Base: `task/T136-stack-candidates` at `36b51ef`
- Status: approved under the owner's 2026-11-16 goal; the owner asked on
  2026-11-17 how a constraint-solving placement would work and was given this
  design (rows, columns and orientation as unknowns, drawing conventions as
  weighted constraints, the result offered as one more draft)

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series; T137 (pin jogs,
rule R167) is in progress on its own branch.

## Goal

For a transistor circuit in which the planner recognises no symmetric
structure, the planner also builds one draft by solving for all device
positions at once — minimising violated drawing conventions (devices of one
branch in a column, a gate level with its driver, parallel parts side by side,
pair members together, inputs left of outputs, supply above ground) — and lets
the unchanged selection choose among all drafts. These are the circuits the
rule-based drafts handle worst: in a blind review of 49 unseen changed cases
the share of acceptable drawings rose from 17 to 25.

## Context

Experiment staged at `tmp/inputs/pt-csp/`: `step0-results.txt` (is the
objective valid), `step1-results.txt` (the solver as built, sections 0 and 1
— read completely), `step2-results.txt` (the gate, sections 1 and 3),
`csp-lib.js` (the solver; it also contains the step-2 symmetry code, which is
NOT part of this task), `patch.mjs` (how it was wired into the built planner),
`det.mjs` (the relations), `facing.mjs`, `pred.mjs`, reviewer verdicts in
`blind-verdicts-cand.json` (80 cases, solver offered everywhere) and
`blind-verdicts-unseen.json` (78 cases; field `gate: true` marks the 49
without a symmetry component). It ran on `main` at `65075a0`, without T136.
Verify what you rely on.

- The solver: unknowns per rigid unit are position (half-column lattice plus
  pin-alignment values) and pose; hard constraints are body clearance and
  "a transistor is never drawn upside down" (human drawings: 0.5%); soft, one
  unit per violated object: STACK, LEVEL, PAIR, SHUNT as `det.mjs` defines
  them, plus input-left-of-output (4 in total per case), rail side, supply
  above ground, a wire estimate and a shape term; no crossing term.
  Deterministic depth-first branch and bound with limited discrepancy, bounded
  by a node count (60 000 + 15 000 polish), never by time: median 143 ms, max
  420 ms per case; the limit was hit in 317 of 399 cases.
- Two choices of the experiment: a LEVEL object whose Net has a port or marker
  terminal counts as satisfiable (290 cases); rigid pairs face as humans draw
  them, differential pairs gates outward, mirrors inward (177 cases).
- Offered everywhere (step 1), blind review of 80 changed cases: acceptable
  24 → 30, 15 gained, 9 lost. The losses are circuits with a recognised
  symmetric structure, where the template draft is good and the solver splits
  pairs. Building mirror symmetry into the solver (step 2) did not repair
  them: 14 such cases, 9 → 6 acceptable.
- The gate (step 2): the draft is offered only when the planner's own symmetry
  topology finds no component (`symmetryTopology` followed by
  `stageComponents`, as `placeDocument` computes them). On the 399 no-block
  transistor cases: 277 have none; 115 plans change; the solver draft is the
  selected draft in 109; crossings 248 → 223; bends 1350 → 1138; convention
  violations 861 → 749; 12 changed cases worse on crossings or bends;
  backward-flow count +18; no equivalence or integrity defect.
- Blind review of the gate: on the 47 judged cases without a symmetry
  component, 7 → 15 (10 gained, 2 lost); confirmed on 49 unseen cases,
  17 → 25 (10 gained, 2 lost).
- Used alone the solver's drafts route worse than the planner's (crossings
  43 → 60 on 74 cases): it works only as a candidate under the unchanged
  score. Protecting the solved structure in the search gave no net gain.
- Experimental eligibility: at most 40 instances, at most 12 devices, at least
  one transistor, no directed block, no partition, no fixed or locked owner.
  The corpus has no circuit above 10 devices.
- T136 (this branch's base) adds stack-aligned candidates through new strategy
  values (`stack-snap.ts`, `LayoutStrategy`, the R63 portfolio in
  `auto-layout.ts`, `placeDocument` in `place.ts`); T135's `feedback-rows` is
  the pattern for a draft of its own (`feedback-rows.ts`, the `place.ts`
  branch with its containment). Of the cases the solver changed in step 1, 28
  of 188 were also changed by stack alignment.

## Scope

Owned paths:

- `packages/auto-layout/src/convention-solver.ts` (new; split into two or
  three modules if it passes about 500 lines: relations, objective, search)
- `packages/auto-layout/src/auto-layout.ts`, `place.ts`, `types.ts`: only what
  is needed to offer the draft (a new strategy value, its eligibility, the
  `placeDocument` branch)
- `packages/auto-layout/test/convention-solver.test.ts` (new, synthetic)
- `scripts/auto-layout-eval.mjs`: a report-only result key saying whether the
  draft was offered and whether it was selected
- `docs/specs/auto-layout.md` (a new rule, R168),
  `docs/testing/readability.md`

Out of scope: selection and evaluation weights; search and finishing; mirror
symmetry inside the solver; circuits with directed blocks or without
transistors; a stack-aligned version of the solver draft; netlist-mode
behaviour beyond what follows from the shared pipeline.

## Steps

1. Reproduce: build the base; confirm the staged gate predicate gives the
   experiment's split on the corpus (122 with a component, 277 without, of the
   399), or state the numbers on this base.
2. Relations in product code: STACK, LEVEL, PAIR, SHUNT. T136's
   `stack-snap.ts` already has the stack relation — reuse it; do not write a
   second one. State any difference to `det.mjs` and how many corpus objects
   it affects.
3. The solver, to the repository's standards (not a paste of `csp-lib.js`):
   deterministic (stable orders, ties by id, node limit only, no clock, no
   randomness), no dependency. Every weight and limit is a named constant with
   a comment saying where it comes from; the rule text lists them with the
   number of corpus cases each affects. Drop any term the corpus does not
   need (measure: plans changed when it is removed).
4. Offer the draft: a new strategy value, last in the R63 list; eligibility as
   in the experiment plus the gate; a solver failure or an invalid placement
   is a refused draft, never an error. Documents that are not eligible plan
   exactly as on the base. Whether the presence of the draft may change which
   ORIGINAL draft is refined or which finalists run when the solver draft is
   not selected: measure it (the experiment: 5 such cases of 188) and keep
   originals unchanged if that costs no judged gain, as T136 does.
5. Planning time: the solver adds one solve and one routed draft. Measure
   median and p90 against the base, interleaved on 40 eligible cases; say what
   the node limit does to time and to plans at half and double its value.
6. Report-only key in the evaluation.
7. Tests (quick mode unless the search is under test; explicit timeout on any
   default-search test): a two-stage amplifier with loads comes out with its
   branches in columns and the input left; a transistor is never inverted; a
   document with a symmetry component, with a directed block, without a
   transistor, with a fixed or locked instance, with a partition, or above the
   size limit is not offered the draft and plans exactly as on the base (pinned
   hashes from a clean base build, non-corpus shapes); a solver failure is a
   refused draft; the node limit is honoured; determinism (same plan twice,
   and with instance order shuffled if the planner promises that elsewhere).
8. Corpus evaluation, drawing mode; then the node-0 netlist form with
   `--presentation netlist`.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 2 --out tmp/t138-drawing   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 2
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t138-global --jobs 2
```

- Drawing mode: no case `threw`; the same 16 refused; every completed case
  equivalent; no introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/base-36b51ef-drawing-report.json`: every case that is
  not eligible keeps its plan hash; list the changed cases (the experiment:
  115 on the older base) and how often the solver draft is selected.
- Totals over completed cases: crossings and bends lower; label overlaps and
  long-narrow count not higher. Cases worse on crossings or bends: list them
  with the reason for the largest five (the experiment: 12).
- Of the 20 cases the reviewers judged gained with the gate on (10 in each
  verdict file, gate side), name those whose plan is no longer the solver's
  drawing, and why (T136 may now win some).
- Planning time as in step 5; median ratio at most 1.25.
- Netlist mode (node-0 form): 515 completed and equivalent, no integrity
  defect, no presentation drop; plans changed and totals against
  `tmp/inputs/base-36b51ef-global-report.json`.
- Render ORIGINAL | base | result for the first 16 changed cases by sha256 of
  id that are neither sealed nor forbidden, and look at them.
- Report every line above as met, not met or not measured.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and runs a blind
  review of the changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json` or the ids in
`tmp/inputs/forbidden.json`; aggregates only. The machine is shared with other
long runs: at most 2 worker processes; iterate on about 60 eligible cases plus
40 others, and run each full evaluation once at the end.
