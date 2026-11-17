# T134 — Directed blocks face right; their outputs sit right of them

- Branch: `task/T134-block-direction`
- Base: `main` at `fb61255`
- Status: approved under the owner's 2026-11-16 goal (listed item: signal
  direction and behavioural blocks; owner comments "the amplifier's out end
  would be better on the right")

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series.

## Goal

After automatic layout a block that has input and output pins (op-amp,
amplifier, comparator, buffer, logic gate, flip-flop) keeps its output leaving
to the right, and a port on a Net such a block drives sits to the right of the
block. Today 24 corpus results have a block whose output faces left (human
drawings: 11) and 34 have an output port left of its driver (human: 0); 54
cases in all, 36% of the cases that contain such a block. Nine of the owner's
comments name this.

## Context

Investigation staged at `tmp/inputs/drawing-next/` (`results.txt`, detectors
in `detect.mjs`: A1 "output faces left", A2 "output port left of its driver";
`trace.mjs`, `quickA.mjs` for the traces). Findings to verify, not to trust:

- The three strategy drafts never face a block left: the orientation choice
  (R21, `packages/auto-layout/src/place-fallback.ts:239-290`) offers only
  `none` and `vertical` for blocks.
- The search adds it: the annealer's orientation move
  (`search-moves.ts:258-265`, `reflectOrientation(p, "left-right" |
"top-bottom")`) reflects a single block left-right, and no score term counts
  block direction (`portOrder` needs both an input and an output port). 17 of
  the 24 A1 cases are clean at search budget 0; in `244ym7g4ht` the op-amp is
  unmirrored up to 16 evaluations and mirrored at 24.
- Stage mirrors (`stages.ts:914-940`) can also flip a block; the R153
  correction after them only fixes two-pin parts. Other places that set a
  block's orientation: `local-loop-amplifier.ts:245`, `amp-gate-row.ts:96`.
- A2: 16 of 34 are introduced by search, 18 are already in the initial port
  seat (R19 side choice and R146 seats, `place-markers.ts`).
- Human drawings do face blocks left when they sit on a directed cycle of two
  or more blocks (latches, ring oscillators, cross-coupled inverters): that
  is where the human's 11 come from.
- Fixed or locked instances keep their pose (R5/R10); nothing here may move
  them.

## Scope

Owned paths:

- `packages/auto-layout/src/**`: the search move, the stage mirror, the two
  variant placers and the port seat code named above; one small new module
  for "directed block" and "on a block cycle" if that keeps the rule in one
  place. Name every file you change and why.
- `packages/auto-layout/test/**`: new regression tests (synthetic fixtures)
- `scripts/auto-layout-eval.mjs` and a `scripts/lib/` module: a report-only
  result key `blockDirection` (`outputFacesLeft`, `outputPortLeft`, counted on
  the human and the result drawing) built from the staged detectors
- `docs/specs/auto-layout.md` (rule text), `docs/testing/readability.md` (the
  new report-only counts)

Out of scope: the selection and evaluation weights (no new weighted term: the
convention is enforced where candidates are generated, as source polarity is);
device placement of anything that is not such a block or a port on its output
Net; the netlist-mode work (T128, T129 touch `planAutoLayout` and `types.ts`:
leave both alone).

## Steps

1. Investigate and report first (probe scripts under `tmp/`): reproduce the
   A1 and A2 counts on the base (24 and 34; the detectors are staged). Then
   the cheap falsification: disable only the left-right reflect for directed
   blocks in the search move and re-plan the 24 A1 cases and the 34 A2 cases.
   Report A1, A2, crossings and bends before and after. If A1 does not fall
   to 8 or fewer on those cases, the search is not the main source: stop and
   report what is.
2. Define once: a directed block (a symbol with at least one input pin and one
   output pin; say how pin direction is read from the symbol or component
   definition) and "on a block cycle" (a directed cycle through two or more
   directed blocks, following output Net → input pin).
3. The rule, enforced in generation:
   - a directed block that is not on a block cycle is never reflected
     left-right by a search move, a stage mirror or a variant placer; top-bottom
     reflection stays available;
   - when a whole stage or symmetric half is mirrored, a directed block in it
     keeps its output to the right if the block is not on a cycle (as R153
     already corrects two-pin signal parts), or the mirror is not offered when
     that is impossible without breaking the unit;
   - a port on a Net driven by such a block's output seats on the right of the
     block, hosted by the output pin; search may not move it to the left side.
     Blocks on a cycle, fixed instances, and documents without directed blocks
     behave as today.
4. Report-only measure: `blockDirection` in the evaluation, on human and
   result, so the corpus acceptance below is reproducible.
5. Tests: an op-amp with feedback keeps its output right under a search that
   mirrors it on `main`; a two-inverter latch may still face one inverter
   left; a mirrored stage keeps its block's output right; an output port of a
   block-driven Net seats right and stays right; a document without directed
   blocks plans exactly as on `main`.
6. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6   # exits 0
```

- No case `threw`; the same 16 refused; every completed case equivalent; no
  introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/main-fb61255-report.json`: results with a block output
  facing left 24 → at most 11; with an output port left of its driver 34 → at
  most 5. List every remaining case with the reason (cycle, fixed, no seat).
- Every case without a directed block keeps its plan hash (say how many:
  about 450). List the changed cases; expected 55–70.
- Total crossings and total bends over the completed cases rise by no more
  than 1% each (dev and val reported apart); list the cases that got worse on
  bends or crossings and explain the largest five.
- Render ORIGINAL | main | result for the first 12 changed non-sealed cases by
  sha256 of id and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and runs a blind
  review of the changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json`. The machine is
shared: at most 5 worker processes; iterate on the flagged cases plus 40
others, and run the full evaluation once at the end.
