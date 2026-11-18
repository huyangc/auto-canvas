# T136 — Stack-aligned drafts as additional candidates

- Branch: `task/T136-stack-candidates`
- Base: `main` at `2b2cf7c`
- Status: approved under the owner's 2026-11-16 goal (listed item:
  structure-first placement; owner comments ask for devices of one branch in
  line: "M1 做一下水平翻转，就可以省好几个拐角", "拉平更好")

Numbers T088–T119 were used by an uncommitted experimental run and are
skipped; T130–T133 are reserved for the netlist-mode series.

## Goal

For every placement strategy the planner also routes a second version of its
draft in which the two devices of a current branch stand in one column, and
lets the unchanged selection choose among all drafts. Transistor circuits —
the majority of the corpus, 35% acceptable in a reviewer census — then more
often come out with their branches as straight columns, without the side
effects that forcing the alignment on every draft had.

## Context

Experiments staged at `tmp/inputs/pt-stack/` (`results.txt`, sections 1, 3,
10 and 11; the snap in `stack-lib.js`; the patch applied to the built planner
in `patched-dist.diff` and `patch.mjs`; `summary-C.txt`;
`termdiff-C-summary.txt`; reviewer verdicts for variant C in
`blind-verdicts-C.json`) and `tmp/inputs/mos-next/` (`results.txt`, the
detectors in `det.mjs`). Verify what you rely on.

- The relation ("stack"): two devices that carry the only two conduction
  terminals on a non-rail Net, at least one of them a transistor, drawn with
  those two pins collinear and facing with nothing between. Planner results
  break it where the human drawing keeps it in 149 of 612 cases (236 objects;
  objects violated 34% against the human's 13%). 100 of the 236 are broken in
  every strategy draft, 87 in the selected draft while another strategy had
  it, 44 are broken by annealing.
- Forcing it failed: a snap applied to every draft plus a guard in the
  annealer halves the violation (236 → 108) but a blind review of 78 changed
  cases was neutral (6 gained, 6 lost): the formed column makes other wires
  detour, and pair mirroring suffers (the guard blocks the move that mirrors a
  pair member).
- Offering it worked (variant C): each strategy's original draft is routed as
  today; the same strategy is routed again with the snap as a further
  candidate in the R63 portfolio, added only when its edits differ; ranking,
  refinement, search, finishing and selection unchanged; a run that starts
  from a snapped draft may not break its snapped columns (a monotone guard: a
  column that holds may not be broken; one already broken does not block
  moves); members of an exactly-two mirror or differential pair are never
  moved or mirrored by the snap. On 612 cases: 74 plans change; crossings
  343 → 341, bends 2481 → 2455, long-narrow 108 → 105, pair mirroring +1,
  gate-level misses +6, no integrity defect, planning time unchanged within
  noise (p90 ×1.15). A snapped candidate is the selected one in 77 cases.
  Blind review by two calibrated reviewers on the 65 changed non-forbidden
  cases: acceptable 11 → 22; 11 gained, none lost.
- Known weakness of C: 22 cases are worse on crossings or bends; in 11 of
  them the snapped draft won the draft-stage ranking but its finished drawing
  scores worse than the base's finished drawing — the selection never compares
  finished results of different strategies.
- The snap of the experiment (`stack-lib.js`): on a strategy draft after
  attachments and before markers and routing; the two-pin part moves first,
  otherwise a free transistor; a transistor may only be mirrored so that its
  gate changes side; sideways moves only. Never moved: fixed instances,
  symmetry units, template members and tails, attached parts, group and
  constraint members, pair members. Two stacks wanting one column: transistor
  pairs before transistor–load pairs, first come first served; a snap that
  would overlap a device or leave a body between the pins is skipped; a free
  shunt capacitor in the slot is shifted sideways by up to 8 grid steps.
- The annealer already has a stack guard, `keepsStacks`
  (`packages/auto-layout/src/search.ts:99-150`), gated to documents with
  doubly-anchored labels and to transistor–non-transistor pairs. Leave its
  existing behaviour for original drafts exactly as it is.
- Where candidates enter: the R63 strategy list in `planAutoLayoutMeasured`
  (`auto-layout.ts`); `placeDocument` (`place.ts`). T135 added a fourth
  strategy `feedback-rows` there for documents without transistors — follow
  its pattern (a strategy value or a mode of the existing strategies; say
  which and why). An open PR (T134, block direction) changes `place.ts`,
  `search-moves.ts`, `stages.ts`, `place-markers.ts`, `net-roles.ts`: keep
  edits to those files minimal.

## Scope

Owned paths:

- `packages/auto-layout/src/stack-snap.ts` (new): the relation and the snap
- `packages/auto-layout/src/auto-layout.ts`, `place.ts`, `search.ts`,
  `types.ts`: only what is needed to offer the snapped candidates and to keep
  their columns in the search
- `packages/auto-layout/test/stack-snap.test.ts` (new, synthetic fixtures)
- `scripts/auto-layout-eval.mjs` and a `scripts/lib/` module: a report-only
  result key `stackColumns` (stacks present, stacks broken; on the human and
  the result drawing) built from the staged detector
- `docs/specs/auto-layout.md` (a new rule, next free number: R166),
  `docs/testing/readability.md` (the report-only counts)

Out of scope: selection and evaluation weights; forcing the snap on original
drafts; the annealer guard for original drafts; template rows for current
sources or BJT circuits (variant T refused a case); gate-level alignment;
netlist-mode behaviour beyond what follows from the shared pipeline.

## Steps

1. Reproduce: build the base, apply nothing, and confirm the staged detector
   gives 149 cases / 236 objects on the base results (or state the numbers on
   this base: T135 and T129 landed since the experiment; transistor circuits
   should be unchanged).
2. `stack-snap.ts`: the relation and the snap as in the experiment, general
   rules only. State in the rule text every arbitrary choice (mover order, the
   8-step capacitor shift, sideways-only) and remove any that the corpus does
   not need: for each, count how many corpus drafts use it.
3. Offer the candidates: per strategy, the snapped draft joins the R63
   portfolio after its original when its edits differ. Runs that start from a
   snapped draft keep their snapped columns in the search (monotone guard on
   those columns only). Original drafts plan exactly as on `main`.
4. Investigate, then decide and report: for a snapped candidate that is
   selected, compare its FINISHED result with the finished result the plan
   would have had without snapped candidates (the cost is one more finished
   plan — measure it). Does "keep the snapped result only when its finished
   routed score is not worse and no guard count rises" remove the cases that
   got worse without losing the cases the reviewers judged gained
   (`blind-verdicts-C.json`: `base` rejected, `new` acceptable)? Adopt it only
   if it does, and say what it costs in planning time.
5. Report-only measure `stackColumns` in the evaluation.
6. Tests (quick mode unless the search itself is under test): a load not over
   its transistor is offered in one column and selected when that is better; a
   pair member is never moved; an attached, fixed or template device is never
   moved; two stacks competing for a column; a shunt capacitor in the slot; a
   document without any stack plans exactly as on `main`; a snapped run does
   not break its column in the search; determinism.
7. Corpus evaluation, drawing mode; then both netlist forms with
   `--presentation netlist` (`docs/testing/readability.md`, "Netlist input").

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 5 --out tmp/t136-drawing   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 5
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t136-global --jobs 5
```

- Drawing mode: no case `threw`; the same 16 refused; every completed case
  equivalent; no introduced dangling wire, unconnected pin or touching pin.
- Against `tmp/inputs/main-2b2cf7c-drawing-report.json`: every case in which
  no strategy draft has a broken stack keeps its plan hash, or the change is
  explained (the experiment had 17 changes outside the flagged set through the
  larger portfolio: list them and the mechanism; if original drafts can be
  kept bit-identical in ranking and search for those, do so). List the changed
  cases; expected about 70–80.
- Totals over completed cases: crossings and bends not higher; long-narrow
  count not higher; pair-mirroring misses (staged detector) higher by at most
  1; label overlaps not higher. Planner-only broken stacks: state before and
  after (the experiment: 236 → 185).
- Cases worse on crossings or bends: at most the experiment's 22; list them
  with the reason for the largest five.
- The 11 cases the reviewers judged gained in the experiment
  (`blind-verdicts-C.json`) keep a plan with their stacks in column; name any
  that do not.
- Planning time: median and p90 ratio against the base report, measured
  interleaved on 40 cases.
- Netlist mode (node-0 form): 515 completed and equivalent, no integrity
  defect, no presentation drop; state the plans changed and the totals.
- Render ORIGINAL | main | result for the first 16 changed non-sealed cases by
  sha256 of id and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow` and runs a blind
  review of the changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json`. The machine is
shared with other long runs: at most 5 worker processes; iterate on the
flagged cases plus 60 others, and run each full evaluation once at the end.
