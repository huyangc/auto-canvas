# T135 — A feedback-row draft for block circuits without transistors

- Branch: `task/T135-feedback-rows`
- Base: `main` at `fb61255`
- Status: approved under the owner's 2026-11-16 goal (listed item: long,
  narrow drawings; owner priorities: fewer corners over area, square over
  long-narrow)

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series.

## Goal

A circuit with no MOS or BJT in which a block (op-amp, amplifier, comparator …)
has a feedback part gets one more candidate layout: the forward signal chain
in the main row and the feedback parts in a row beside the block, as people
draw integrators, inverting amplifiers and switched-capacitor stages. Today
every strategy lays such a circuit out as one row. The candidate competes
under the unchanged selection score. Every other document plans exactly as
today.

## Context

Pre-test staged at `tmp/inputs/pt-rows/` (`results.txt`, `summary.txt`,
`pop.txt`; the arrangement in `arrange.mjs` and `struct.mjs`; the runner
`eval.mjs`; blind verdicts for the non-sealed cases in
`blind-verdicts.json`). It placed devices by script, held them fixed and let
the planner seat markers and ports, route and finish. Verify what you rely on.

- Population: 154 corpus cases have no MOS or BJT; 147 complete; 73 come out
  as a single row (human: 35), 71 at aspect ≥ 2 (human: 37). The arrangement
  applies to the 52 with a block feedback part (a two-pin part or chain
  between a block's output Net and one of its input Nets).
- Why one row today: for these documents `template` and `layered` both fall
  back to the same single-row draft (`packages/auto-layout/src/place.ts:392-451`,
  `place-fallback.ts` `placeFallback`), and `stages` is one row by
  construction (`stages.ts`; its two-row form needs an explicit partition,
  `:774-779`).
- Human drawings of these circuits (`pop.txt`): 70 of 87 feedback parts sit
  above the block (65 span from the input pin to the output pin, 67 are
  horizontal), 12 below (10 of them the second half of a differential block);
  parallel feedback parts are stacked (12 of 12); other parallel parts sit
  side by side; ground shunts hang below their node (168 of 180).
- Pre-test result on 51 applicable cases, current → scripted (human): bends
  250 → 184 (179); aspect ≥ 2 in 22 → 0 (4); crossings 3 → 4 (0); label
  clearance 9 → 39 (27); median area 92k → 115k (93k). All equivalent.
- Blind review by two calibrated reviewers (50 judgeable cases): current
  acceptable in 18, scripted in 25; 15 cases gained, 8 lost; of the 22
  currently long-narrow cases 2 are acceptable today and 10 with the
  arrangement. Choosing by the existing selection score (the scripted layout
  wins the score in 21 of 51) gives 27 acceptable: it takes 10 of the 15 gains
  and only 1 of the 8 losses. So the score stays as it is.
- Where the arrangement was rejected (`blind-verdicts.json`, `results.txt`
  "breaks"): the output port seated at the top end of the feedback row
  instead of right of the block's output; an input source or port placed off
  the main row (reversed flow); parallel switched-capacitor branches laid end
  to end in the main row (a crossing); both input chains of a differential
  block in one row; labels left behind or crowded in the feedback row; a
  long empty wire before the block.
- Where it does not apply it is worse (blocks without feedback: crossings 13
  → 39; passive-only: bends 127 → 159): the draft must not be offered there.
- A parallel task (T134, not merged) keeps a directed block's output facing
  right and seats its output port on its right; it changes `search-moves.ts`,
  `stages.ts`, `place-markers.ts`, `place-fallback.ts`. Keep changes to those
  files minimal here, and do not solve the output-port seat a second way:
  seat it through the existing port-side and seat rules (R19, R71, R146) so
  that T134's rule applies when both land.

## Scope

Owned paths:

- `packages/auto-layout/src/feedback-rows.ts` (new): recognition of the
  subset and the draft placement
- `packages/auto-layout/src/place.ts` and the strategy list in
  `auto-layout.ts`: only what is needed to offer the draft as a candidate
  (say in the report where it enters and why there)
- `packages/auto-layout/test/feedback-rows.test.ts` (new, synthetic fixtures)
- `docs/specs/auto-layout.md`: a new rule (next free R number) and the
  cross-references it needs

Out of scope: selection and evaluation weights; the `stages` strategy;
circuits with a MOS or BJT; blocks without feedback and passive-only
circuits; label seating rules (R15, R15a, R73) beyond what the existing
pipeline already does for any draft; routing.

## Steps

1. Investigate and report (probe scripts under `tmp/`): how the three
   strategies' drafts are produced, deduplicated and ranked for a no-MOS/BJT
   document (`auto-layout.ts` around the strategy list and R63 dedupe), and
   the cheapest correct place to add one more draft so that it is refined,
   searched, finished and compared exactly like the others — a fourth
   strategy value, or the `layered` slot when its draft would equal
   `template`'s. Report the planning-time effect on the subset.
2. Recognition (`feedback-rows.ts`), from connectivity only: the document has
   no MOS or BJT; a directed block; its feedback chains (two-pin parts in
   series from the block's output Net to one of its input Nets); the forward
   chain from the input ports or sources; shunts; parallel groups; a
   differential block's two halves. A document without a block feedback part
   is not in the subset.
3. The draft, by general rules taken from the human statistics above:
   - main row: the forward chain left to right by signal distance, input
     ports and sources at the left end of that row, the block's output and its
     port to the right;
   - each feedback chain in a row above the block (below when it feeds the
     lower input pin and for the second half of a differential block),
     horizontal, spanning from the input pin's column to the output pin's
     column; several chains of one block stack outward;
   - parallel two-pin parts between the same two nodes: stacked when they are
     feedback parts, side by side when they are forward or shunt branches —
     never end to end in the main row;
   - shunts hang below their node; a part joining two main-row nodes sits in
     the row above them;
   - the two input chains of a differential block in separate rows, mirrored;
   - no long empty run before the block: columns are compacted as the other
     drafts are.
     Markers, ports and labels are seated by the existing pipeline.
4. Offer the draft only for the subset; everything downstream (routing,
   refinement, search, finishing, selection) unchanged.
5. Tests: an inverting amplifier with one feedback resistor; an integrator
   with a reset switch across the capacitor (two stacked chains); a
   switched-capacitor stage with parallel branches; a differential block with
   two feedback halves; a block without feedback and a passive-only circuit
   (draft not offered, plan equal to today's); a document with a MOS (not in
   the subset).
6. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 5   # exits 0
```

- No case `threw`; the same 16 refused; every completed case equivalent; no
  introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/main-fb61255-report.json`: every case outside the
  subset keeps its plan hash (state the count; about 575). List the changed
  cases.
- On the subset: results at aspect ≥ 2 fall from 22 to at most 10; total
  bends fall; total crossings do not rise; label overlaps do not rise; state
  label clearance before and after and the largest five increases with their
  cause.
- For each of the six rejection causes in Context, say what the draft does
  now, with the corpus cases it concerned.
- Render ORIGINAL | main | result for the first 16 changed non-sealed cases
  by sha256 of id and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and runs a blind
  review of the changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json`. The machine is
shared with other long runs: at most 4 worker processes; iterate on the
subset plus 40 other cases, and run the full evaluation once at the end.
