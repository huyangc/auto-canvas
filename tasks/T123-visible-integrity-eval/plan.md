# T123 — Evaluation reports visible-integrity regressions and label ownership

- Branch: `task/T123-visible-integrity-eval`
- Base: `main` at `ac0db38`
- Status: approved (user, 2026-11-17: "开这个任务")

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

`scripts/auto-layout-eval.mjs` reports, per case and in totals, visible
connection defects that the current audit (`missingConnections`,
`floatingPins`, `unsafeProblems`) cannot see, comparing the result with its own
source drawing, and fails the run when the planner introduces one. Planner
behaviour does not change.

Three defect families, all observed on the 628-case corpus:

1. **Planner-made dangling wires.** 6 cases (`2jhdk32et5`, `6n39a2gvtc`,
   `7d93gjqbw8`, `c3qbntbj56`, `j462r7dnbk`, `gbvzf4h3fj`) end with a 20-unit
   wire on a ground/VDD net, split at a marker stub junction (ids `…-a-…` /
   `…-b-…`), both ends open, with no counterpart in the source. Product ERC
   reports them as `ERC_DANGLING_WIRE`.
2. **Source pictures that disagree with their netlist.** In 28 sources a pin
   looks connected because it touches another Net's wire or marker, but the
   stored netlist leaves it unconnected (e.g. `pfakspv4kx` LP.1 and M1.D touch
   the VDD rail; `78f2kqva2z`, `hjtfydjx52`). Layout preserves the netlist
   (R10), so the result shows the pin open. ERC reports
   `ERC_TOUCHING_NOT_CONNECTED` / `ERC_UNCONNECTED_PIN` on the source. These are
   input defects, to be listed, not counted as planner regressions.
3. **Net labels that read as belonging to another Net.** In `5hjsy2g863` the
   `VOUT` net label (`net-label-route-ui-21_2`, bound to
   `net-119ebe6e770cd882_2`) ends up above the X1.OUT → M1.G wire (another
   Net); a reviewer read the drawing as not equivalent to the source.

## Context

- `metrics()` in `scripts/auto-layout-eval.mjs:289-318` builds per-side
  measures; the exit condition is at `:1147-1165` (`process.exitCode = 1`).
  The per-case table at `:938` prints unsafe counts.
- ERC: `diagnoseProject` in `packages/derived/src/diagnostics/diagnostic.ts:244`
  (exported from `@icm/derived`); codes produced in
  `packages/derived/src/diagnostics/erc.ts` (`reportDanglingWires` :1361,
  `reportPinsTouchingAnotherNet` :1444-1455, `ERC_UNCONNECTED_PIN` :647, :759).
  All are warnings, `gateEligible: false`, never run by the eval today.
- A working prototype of the census (read it, do not import it): 
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/priceless-pascal-a9479c/tmp/handoff/stubs/detect.mjs`,
  `erc.mjs`, `erc-dangling.mjs`. Its results: ERC_UNCONNECTED_PIN 109 in sources
  and 109 in results; ERC_TOUCHING_NOT_CONNECTED 44 / 0; 60 ERC_DANGLING_WIRE in
  results across 21 cases, of which 36 are `auto-layout-frame-*` routes
  (intent unknown) and the 6 cases above are real.
- Label geometry: net labels are `annotations` with `kind: "net-label"` and
  `binding: { kind: "net-name", netId }`; the label seating code is in
  `packages/auto-layout/src` (grep `net-label` / `seatLabel` / R15 in
  `docs/specs/auto-layout.md`). Use the resolved rendered label box and route
  geometry (`resolveRouteGeometry`, `buildSvgScene` already used by the eval).

## Scope

Owned paths:

- `scripts/visible-integrity.mjs` (new module: pure functions over a document +
  resolver)
- `scripts/visible-integrity.test.mjs` (new; synthetic documents only)
- `scripts/auto-layout-eval.mjs` (call the module in `metrics()`, add totals,
  per-case table column, exit condition)
- `docs/testing/readability.md` or the eval section of `docs/specs/auto-layout.md`
  (a short paragraph defining the new fields)

Out of scope: anything under `packages/` (no planner, audit or ERC change), the
readability metrics and weights, fixtures copied from corpus drawings.

## Steps

1. `visibleIntegrity(document, resolver)` returns
   `{ erc: { danglingWires, unconnectedPins, touchingNotConnected } (counts +
   object ids), labelOwnership: [...] }`.
   - ERC: run `diagnoseProject` on a one-document project the eval already
     builds (see how the eval resolves symbols) and group the three codes.
   - Label ownership: for each net label bound to a Net, measure the distance
     from its rendered box to the nearest visible wire/pin of its own Net and to
     the nearest wire/pin of any other Net. Flag when its own Net is not within
     one grid of the box, or another Net is strictly closer. Define this
     precisely in the doc paragraph.
2. In `metrics()`, add `visibleIntegrity` for human and result. Per case derive
   `introduced` = result-only defects: dangling wires whose ids have no source
   counterpart (compare counts per Net), unconnected pins not unconnected in the
   source, label-ownership flags on labels not flagged in the source. List
   `sourceDefects` = source touching-not-connected pins (input data problem).
3. Totals per split; per-case table column `integrity` (introduced count).
   Exit condition: `introduced` dangling wires or unconnected pins > 0 fails the
   run like `unsafeProblems`. Label ownership is reported only (no exit
   failure) until calibrated.
4. Tests (synthetic): a source with a pin touching a rail without being in the
   Net → reported as source defect, not introduced; a result with an open
   20-unit wire → introduced; a label seated over a foreign wire → flagged; a
   label seated on its own wire → not flagged; a clean document → all zero.
5. Investigate and report: run the eval on the corpus, list cases per family
   with counts (dev/val), and check by rendering: the 6 dangling cases, 
   `pfakspv4kx`, `5hjsy2g863`, and 5 random clean cases. Say whether the 36
   frame-route danglings look intentional, and the false-positive rate of label
   ownership on 10 random flagged labels (look at each).

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
node --test scripts/visible-integrity.test.mjs                    # 0 failures
node scripts/auto-layout-eval.mjs /Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/le10-input --jobs 6
```

- All 628 `planHash` equal the main report
  `/Users/huzhifeng/workspace/auto-canvas/.claude/worktrees/t087-flow-symmetry-detectors/tmp/auto-layout-eval/report.json`.
- The 6 dangling cases are reported as introduced; `pfakspv4kx` as a source
  defect and not introduced; `5hjsy2g863` VOUT label flagged.
- The eval run now exits non-zero because of the 6 cases: that is expected and
  must be stated, not suppressed.
- The reviewer reruns `pnpm test:local`; do not run it.

## Notes for the implementer

Do not commit implementation. Do not fix the planner here; the dangling wires
get their own task once this check exists.
