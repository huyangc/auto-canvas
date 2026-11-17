# T125 — Net labels follow their Net

- Branch: `task/T125-labels-follow-net` (stacked on T124, PR 80)
- Base: `task/T124-marker-stub-dangling` at `9247935`
- Status: approved under the user's 2026-11-16 goal to work through the listed
  optimisation points (item: labels follow their Net)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

After automatic layout every visible net label reads as naming its own Net: it
sits within one grid of a wire or pin of that Net and no other Net's wire or
pin is closer. Today 75 labels in 39 of 628 corpus results fail this although
their source drawing does not: 42 are left far from their Net ("own-far") and
33 end up nearer to another Net ("foreign-closer"). A human reviewer read one
of them (`5hjsy2g863`: the `VOUT` label above the op-amp-output-to-gate wire)
as the drawing no longer being equivalent to the source.

## Context

- The measure: `labelOwnership` in `scripts/visible-integrity.mjs` (definition
  in `docs/testing/readability.md`, "Visible integrity"); per case
  `integrity.introduced.labelOwnership` in the evaluation report lists
  `{ annotationId, netId, name, reason, bounds, ownDistance, foreignDistance,
  foreignNetId, foreignObject }`. The staged base report
  `tmp/inputs/t124-report.json` has them (75 flags, 39 cases).
- Known from the T123 analysis: 59 of the 75 flagged labels are free-anchored
  in the source (all 42 own-far ones); the planner leaves a free label where it
  was while its Net moves (`5hjsy2g863`: `VOUT` stays at (460,190) in both
  drawings). The other 16 are labels the planner does seat, but onto or next to
  a foreign wire.
- Label handling in the planner: rule R15 and the label rules around it in
  `docs/specs/auto-layout.md`; code in `packages/auto-layout/src` (grep
  `net-label`, `seatLabel`, `repairStubLabels`, `labelRepair`, `stub-seat.ts`,
  `follow-drafting-labels`); `labelClearance` / `labelOverlaps` /
  `labelOwnerDistance` in `readability-metrics.ts` are the planner's own label
  measures. Which code path owns a free-anchored net label is NOT known: that
  is step 1.

## Scope

Owned paths:

- `packages/auto-layout/src/**` — only the label seating/follow file(s) where
  the cause is, named in the report with the reason; a new small module is fine
- `packages/auto-layout/test/**` — new regression tests (synthetic fixtures)
- `scripts/visible-integrity.mjs` — only if the ownership geometry moves into
  the package so planner and evaluation share one definition (then the script
  imports it; its tests must still pass unchanged)
- `docs/specs/auto-layout.md` — the label rule text

Out of scope: device placement, routing, the readability weights, labels that
are not net labels (instance names, parameter text, free notes), labels whose
source drawing already fails the measure.

## Steps

1. Investigate: for the 75 flagged labels, classify by mechanism with counts —
   anchor kind in the source, which planner step last positions the label (or
   none), and why the chosen seat is far from its Net or next to a foreign one.
   Report the table and the code paths with file:line.
2. Fix at the cause, generally:
   - a net label the planner does not seat today must follow its Net: place it
     with the same seater the planner uses for the labels it does seat, next to
     a wire of its own Net (prefer the segment nearest to where the label sat
     relative to its Net in the source, so a label drawn at a node stays at
     that node);
   - a seat is rejected when another Net's wire or pin is closer to the label
     box than its own Net, or when it overlaps text or symbols.
   Do not add a late "fix flagged labels" pass keyed to the evaluation's
   flags unless step 1 shows seating has no single owner (say why).
3. Tests: a free-anchored net label whose Net moves away follows it; a label is
   not seated between its own wire and a nearer foreign wire; a label that
   already reads correctly keeps its place (plan unchanged).
4. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
pnpm vitest run packages/auto-layout scripts/visible-integrity.test.mjs   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 4  # exits 0
```

- No case `threw`; all completed cases equivalent; no introduced dangling
  wires, unconnected pins or touching pins.
- Introduced label-ownership flags: 75 → at most 15, with every remaining one
  listed and explained (for example no free seat exists).
- Against `tmp/inputs/t124-report.json`: `labelOverlaps` and `labelClearance`
  totals (dev and val) not higher; crossings, bends, wire unchanged in every
  case whose only change is a label position; list every case whose `planHash`
  changed and say how many of them had no flag before (labels that moved
  although they read correctly must be explained or avoided).
- Render ORIGINAL | before | after for `5hjsy2g863` and 9 more changed cases
  chosen by a stated rule (not hand-picked; no sealed ids) and look at them:
  each moved label must read as naming its own Net and not sit on a wire or
  another label.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. 30 sealed ids are listed under `sealed` in
`tmp/inputs/sample.json`: aggregates only, never render or name them. The
machine is shared: iterate on a sub-corpus of the 39 flagged cases plus 30
others, and run the full 628-case evaluation once at the end.
