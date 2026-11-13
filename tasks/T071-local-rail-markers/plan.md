# T071 — Local power markers instead of long rail wires

- Branch: `task/T071-local-rail-markers`
- Base: `main` at `865924b` (T069 pitch, T070 readability score, T072 drafting)
- Status: approved

## Goal

The user decided (2026-11-13, "允许，一起做"): auto-layout may place additional
ground / supply markers next to the pins that need them, as human drawings do,
instead of routing one long rail trunk across the drawing. This changes the
standing rule that labels and markers are only a routing-failure fallback (R14)
and that R148 keeps the marker count.

Why: on the 628 ≤10-part Gallery drawings (main `eb72cb1`), crossings that
involve a rail Net are 97 vs 18 in the human drawings, about 40% of the whole
crossing excess, spread over 61 drawings. Matching humans on those alone would
take crossings from 1.83× to about 1.51× of human.

## Context

- Power markers: `isMarker` (`placement-connectivity.ts:5`; symbols `ground`,
  `vdd-port`, plus ports). R6a host pairing and placement
  (`docs/specs/auto-layout.md:200`, `place-markers.ts` `powerHosts:40`,
  `placeMarkers:518`), R12 stubs and R43 trunks (spec line 266), R86 rail
  fallback (line 805), R148 finished rail search keeps marker count
  (line 1215, `rail-seat-search.ts` `searchRailSeats:119`), R14 fallback labels
  only for named Nets (line 289).
- Instance creation edit exists in the model (`add_instance`; used by
  `packages/agent-adapter/src/authoring-helper.ts:675`). Auto-layout plans are
  one transaction (one Undo).
- Equivalence: `terminalPartition` (`transaction.ts:64`) compares terminal
  partitions; the evaluator uses it (`scripts/auto-layout-eval.mjs:664`). A
  new marker adds terminals, so equivalence must be redefined as: the
  partition of the original terminals is unchanged, and every added terminal
  belongs to a Net that already had a marker of the same symbol and name.
- How a second ground / supply marker joins its Net (global name, symbol
  semantics, connectivity evidence such as `name-claim`) must be established
  first (step 1); never invent a Net name.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  `netBreakdown.crossingsByKindPair` gives rail-involving crossings; T070 adds
  readability metrics and a composite score (use them as guards).

- Main now includes T069 (tighter pitch up to 40 instances, label repair in
  `stub-seat.ts`, `pitch-fallback.ts`), T070 (`readability-metrics.ts`,
  frozen `readability-weights.ts`, evaluator `readability.targets`) and T072
  (drafting follows owners). Base report: `tmp/main-865924b-report.json`.
  Readability `railCrossings` on main: dev 60 vs human 8 (7.5×), val 36 vs
  10 (3.6×); composite dev 100.03 (2.08×), val 49.92 (1.85×).

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `scripts/auto-layout-eval.mjs` (equivalence
definition and a marker-count metric only),
`tasks/T071-local-rail-markers/report.md`.
Out of scope: other packages' behavior; documents above 40 instances
(byte-identical); Nets without an existing ground / supply marker (no new
names, no new symbols).

## Steps

1. **Investigate:** how a duplicated `ground` / `vdd-port` instance joins the
   same Net in the model (copy which fields, evidence, annotations); confirm
   with `deriveElectricalTopologyProjection` on a fixture. Report.
2. **Rule (R154).** For documents up to 40 instances, after the finished
   layout, for each rail Net that already has a marker: group its device pins
   into clusters that one short tree can join without crossing another Net;
   give each additional cluster its own marker (same symbol, same name,
   placed by R6a/R12 at that cluster's host pin) and drop the trunk between
   clusters. Bounded and deterministic; decide by the finished calibrated
   score with the routed guards (and T070's readability composite as a guard
   once merged). Locked or fixed markers and user groups are untouched; a plan
   re-run on its own output must be stable (no marker growth on a second run).
3. **Equivalence and Undo.** Added markers are `add_instance` edits in the same
   transaction. Redefine the equivalence check as in Context in
   `transaction.ts` (keep the old function's callers correct) and in the
   evaluator. Report the human vs result marker count per rail Net.
4. Tests: a ground trunk crossing a signal Net becomes two local grounds with
   zero crossings; a Net without a marker gets none; idempotent re-run; locked
   marker kept; equivalence accepts duplicates and rejects a marker on the
   wrong Net; determinism.
5. Spec (R12, R14, R43, R148, new R154); evaluate all 628; review page
   human | main | T071 for the 25 samples plus the ten drawings whose rail
   crossings fall the most.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0, no timeout raised
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-865924b-report.json`:

- Rail-involving crossings lower by at least 30% on dev **and** val; total
  crossings lower by at least 10% on dev and val.
- Bends, wire and median area not higher by more than 1% on either split.
- Guards: completed 628; none non-equivalent under the new definition;
  floating and missing not above main; every `VISUAL_*` total not above main;
  readability composite (`readability.targets.composite.result`) lower on
  dev and val; `railCrossings` lower by at least 30% on dev and val.
- Determinism; idempotent re-run; the 6 large documents byte-identical;
  held-out times within +10% of main.

## Notes for the implementer

- Same rule for every document; no circuit-, id- or coordinate-specific code.
- Tune on dev; report val.
- If a tested contract pins "marker count is preserved", report it with the
  test; Opus decides.
