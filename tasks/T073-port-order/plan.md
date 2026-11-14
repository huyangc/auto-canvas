# T073 — Inputs left, outputs right: signal direction and port seats

- Branch: `task/T073-port-order`
- Base: `main` at `865924b`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). The frozen T070 metric `portOrder` (an input port or
input source not left of an output port) is dev 193 vs human 118, val 100 vs
74 on main `865924b`; it is 13–16% of the composite excess. An Opus analysis
(2026-11-13, scripts in `tmp/gap-analysis/`, `portorder.py` reproduces the
metric exactly) found:

- Template strategy produces +65 of the +75 dev excess (51 → 116); layered +7,
  stages +2. Stages already has R57's signal-direction correction; template
  and layered do not.
- **Device placement (+50):** pairs whose input host devices sit at or right
  of the output hosts went 103 → 153. Applying R57's test and mirroring the
  whole drawing when it fires would remove about 20 (best-of-mirror 28);
  mirroring does not change crossings.
- **Seat choice (+27):** host order right but marker order wrong went 13 → 40;
  24 of them are an output marker seated left of its own host (val 4 → 32).
  R19 picks the edge nearest the host pin, R71 seats along the pin's exit;
  R74 `offConvention` (`refine.ts:93`) only checks the port's mirror flag, not
  where it sits; R146 ranks seats by spanning length and crossings only.

Out of scope: differential drawings with one input on each half (humans put
both inputs left); that is a house-style choice awaiting the user's decision.

## Context

- R57 (`docs/specs/auto-layout.md:493`), implemented in `stages.ts` around
  line 929 (`hostMean`, reverse order and mirror mirrorable blocks).
- R19 Cell Pin side (spec line 332), R71 single-host ports (line 625), R146
  routed port-seat search (`port-seat-search.ts`), `portSeatCandidates`
  (`place-markers.ts`), R74 `offConvention` in `refine.ts:93` (weight 300).
- Metric: `readability-metrics.ts` `portOrder` (around line 190) — do not
  change the metric or `readability-weights.ts`.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`,
  base report `tmp/main-865924b-report.json` (has `readability.targets`).
- Parallel work: T071 (local rail markers) is editing `auto-layout.ts`,
  `routing-audit.ts`, `transaction.ts`, `local-rail-markers.ts`,
  `rail-marker-identity.ts`, `scripts/auto-layout-eval.mjs`,
  `scripts/auto-layout-review.mjs` and `docs/specs/auto-layout.md`. Do not
  edit those files; if the fix needs one, stop and report the exact change.

## Scope

Owned: `packages/auto-layout/src/stages.ts`, `layered.ts`,
`template-placement.ts`, `place.ts`, `refine.ts`, `port-seat-search.ts`,
`place-markers.ts`, new files under `packages/auto-layout/src/`,
`packages/auto-layout/test/**`, `tasks/T073-port-order/report.md`.
Write the proposed spec text (R19, R57, R74, R146) in the report; Opus applies
it.

## Steps

1. **Signal direction for every strategy.** Factor R57's host-mean test out of
   `stages.ts` and apply it to the template and layered drafts: when inputs'
   hosts lie right of outputs' hosts, mirror the draft left-right (whole
   drawing; rigid groups and symmetry blocks mirror as units and keep their
   internal convention). Keep the corrected draft only through the normal
   routed scoring (no extra complete plan).
2. **Position-based port convention.** An input port belongs left of its host
   pin and an output port right of it. Use that in R19/R71 initial seats, as a
   ranking term in R146 (ahead of length when crossings tie), and in R74
   `offConvention` (count a port as off convention by its position relative to
   its host, not only by its mirror flag).
3. Tests: template and layered drafts flip a right-to-left drawing; an output
   port seats right of its host; R146 prefers the conventional side at equal
   crossings; determinism; fixed ports untouched.
4. Evaluate all 628; review page human | main | T073 for the 25 samples
   (`tmp/le10-analysis/main-05050fd-samples.html` lists them) plus the ten
   drawings whose `portOrder` falls most.

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

- `portOrder` result total lower by at least 25% on dev **and** val.
- Readability composite lower on dev and val; no other weighted readability
  metric higher by more than 2%.
- Crossings and bends not higher by more than 1% per split; guards: 628
  completed, none non-equivalent, floating and missing not above main, every
  `VISUAL_*` total not above main.
- Determinism; the 6 large documents byte-identical; held-out times within
  +10% median (five alternating pairs for any fixture above in the first pass).

## Notes for the implementer

- Same rule for every document; roles from netlist/Cell Pin directions, never
  from label text, ids or coordinates.
- Tune on dev; report val.
