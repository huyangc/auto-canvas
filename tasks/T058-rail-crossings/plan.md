# T058 — Reduce crossings on supply and ground Nets

- Branch: `task/T058-rail-crossings` (stacked on `task/T057-device-relocation-search`, PR #52)
- Base: `task/T057-device-relocation-search` at `05692db`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings, by general methods only (optimization,
search, scoring), never circuit-specific rules. After T057 on the 627
completed ≤10-part drawings, ratios to human are crossings 2.15, bends 1.21,
wire 1.49, median area 1.56 (`tmp/le10-t057r2/report.json`). Crossings that
involve a rail Net (`classifyNets(...).rails`) are now the largest excess:

| Crossing kind pair | Human | T057 |
| ------------------ | ----: | ---: |
| rail–signal        |    11 |   91 |
| port–rail          |     6 |   28 |
| rail–rail          |     1 |   16 |
| (all others)       |   216 |  367 |

Rail wire is 148,032 against 97,737. This task finds why rail Nets cross and
fixes it generally.

## Context

- R43 (`docs/specs/auto-layout.md:429-436`, `route.ts:165-300`, `railTrunk` at
  line 277): rail pins without their own marker join one horizontal trunk above
  the device rows (supply) or below (ground), with one marker host; a refused
  trunk falls back to a tree (R86). Markers are never added: the drawing keeps
  its own count of `vdd-port`/`ground` instances (`place-markers.ts:63-134`,
  `placePowerMarkers`, `powerHosts`).
- Placement searches (R147 relocation, R146 port seats, the annealer) rank by
  `createPlacementEstimator`, which skips rail Nets entirely (`estimate.ts`),
  so a move that pulls a supply pin away from the top trunk is invisible until
  full routing. They decide by `calibratedScore` with `routedGuards`
  (`routed-search-score.ts`).
- Human drawings with one VDD marker draw a straight bar with every supply
  device hanging below it; rail crossings are rare (18 in 627 drawings).
- Adding markers (repeated supply/ground symbols) would change how a drawing
  names its rails; that is a pending product decision for the user and is out
  of scope.

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12` prints
the scoreboard including `crossingsByKindPair` and `wireLengthByNetKind`.
Base: `tmp/le10-t057r2/report.json`. Third-party data under `tmp/le10-input/`,
never committed. Rules end at R147; new rules take R148 and up.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T058-rail-crossings/report.md`.

Out of scope: other packages and the router internals of `@icm/edit-engine`;
adding or removing instances (markers included); optimized and partition
modes (partition fallback follows plain planning); documents above 40
instances (byte-identical).

## Steps

1. **Investigate** on dev: classify every crossing that involves a rail Net in
   the T057 result by where it happens (trunk segment vs drop to a pin vs
   marker stub; which side of the trunk the crossed signal lies; whether the
   rail pin's device is in the top/bottom device row). Report counts and a few
   representative drawing ids.
2. **Fix by the dominant cause, generally.** Candidates, to choose by step 1's
   data:
   - make the placement estimator aware of rail pins (for example the vertical
     distance of each supply pin to the top of the device bounds and of each
     ground pin to the bottom, plus crossings of those drops with other Nets),
     so R147/R146/annealer shortlists see rail cost;
   - compare more than one trunk position or trunk shape per rail Net by
     routed score (still one horizontal trunk per rail and side, or the R86
     tree), keeping the lower score;
   - any other general method the data points to.
     Decide by finished routed score with the existing guards.
3. Budget: paired timing median ≤ 2× base, p95 ≤ 1.5× base p95; evaluation
   counts, not wall clock.
4. Tests: synthetic documents where a supply device below another row forces a
   drop across a signal; where a trunk position choice avoids a crossing;
   determinism; locked devices untouched.
5. Spec updates; evaluate all 628 drawings; report dev and val.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t057r2/report.json`:

- Rail-involving crossings (rail–signal + port–rail + rail–rail) at least 30%
  lower; total crossings lower on dev **and** val; bends and wire not higher.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base.
- Determinism; the 6 large documents byte-identical; timing as in step 3.

## Notes for the implementer

- Same rule for every Net and document; no branches on circuit type, symbol
  family, tag, id, name or coordinates.
- Tune on dev; report val.
- If a tested contract blocks a clearly better layout, report it; do not edit
  the test.
