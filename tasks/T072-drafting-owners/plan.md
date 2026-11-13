# T072 — Drafting ink follows the circuit it annotates

- Branch: `task/T072-drafting-owners`
- Base: `main` at `19c0220`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of the human drawings). T070's frozen readability score puts
`unownedDrafting` furthest from target: drafting groups (free circles, text,
lines drawn as ink — e.g. pseudo-ports drawn as a circle plus text) that end
up with no nearby owner after auto-layout. On main `19c0220`: human 15 vs
result 214 on dev (14.3×), 7 vs 53 on val; 66 drawings, 245 excess groups. It
has the largest frozen weight (0.317). The user flagged "New Circuit"
(`75k4jskamd`): its Vin / Vout / VB4 / Vref pseudo-ports stay where they were
while the wires they belong to move away. Drawings with the most excess:
`qj62dz4qvm` (3 → 21 of 24 groups), `nwarxxcwp7` (0 → 12), `59qxym4d4f`,
`asq5c6m96w`, `ec8bty96h4`, `sgkrkm3czm` (0 → 10), `kyxytts7gz` (0 → 9).

## Context

- R150 (`docs/specs/auto-layout.md:1278`): group touching input drafting ink;
  assign each movable component to the nearest visible instance, route segment
  or junction within 1.5 × its larger ink dimension; keep its displacement from
  that owner; unowned components move as one rigid block.
- Code: `drafting-groups.ts` (`draftingGroups:60`, `draftingDisplacements:169`),
  `follow-drafting-groups.ts` (`followDraftingGroups:115`),
  `follow-drafting-labels.ts` (`placementDrafting:195`,
  `followDraftingLabels:319`), `drafting-search.ts`.
- Metric: `packages/auto-layout/src/readability-metrics.ts` `unownedDrafting`
  = groups returned by `draftingGroups` with no `owner`, measured on the final
  document (human and result alike). Do not change the metric.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  base report `tmp/main-19c0220-report.json` (has `readability.targets` per
  split and per-case `readabilityMetrics`).
- Parallel work: T069 (tighter pitch) is editing `auto-layout.ts`,
  `geometry.ts`, `layered.ts`, `net-roles.ts`, `place-fallback.ts`,
  `place-markers.ts`, `place.ts`, `search-moves.ts`, `search.ts`,
  `seat-labels.ts`, `stub-seat.ts`, `template-placement.ts`, `timing.ts` and
  `docs/specs/auto-layout.md`. Do not edit those files.

## Scope

Owned: `packages/auto-layout/src/drafting-groups.ts`,
`packages/auto-layout/src/follow-drafting-groups.ts`,
`packages/auto-layout/src/follow-drafting-labels.ts`,
`packages/auto-layout/src/drafting-search.ts`, new files under
`packages/auto-layout/src/` if needed, `packages/auto-layout/test/**`,
`tasks/T072-drafting-owners/report.md`.
Out of scope: the files listed under parallel work (if the fix needs one,
stop and report the exact change), the readability metric, other packages.
Write the proposed R150 spec text in the report; Opus applies it.

## Steps

1. **Investigate** the seven drawings above and `75k4jskamd`: for each excess
   group, why it is unowned in the result — no owner found in the input,
   owner found but the group not moved with it, moved but now farther than the
   ownership radius, or owner removed / rerouted. Count the causes over all 66
   drawings. Report with examples.
2. **Fix generally** by cause. Expected directions: a pseudo-port drawn as ink
   (circle or text at a wire end) belongs to the Net whose wire end or pin it
   touches in the input and should follow that wire end; text next to a device
   follows the device; the ownership search must consider the input geometry
   the group was drawn against. Keep R150's locked / fixed handling.
3. Tests: a circle + text pseudo-port at a wire end follows the end after the
   device moves; a device annotation follows its device; a group with no
   plausible owner keeps the rigid-block behavior; determinism.
4. Evaluate all 628; review page human | main | T072 for the eight named
   drawings and the 25 samples (as in T068).

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

Against `tmp/main-19c0220-report.json`:

- `unownedDrafting` result total lower by at least 50% on dev **and** val.
- Readability composite (`readability.targets.composite.result`) lower on dev
  and val; no other weighted readability metric higher by more than 2%.
- Crossings, bends, wire, median area not higher by more than 1% on either
  split. Guards: completed 628, none non-equivalent, floating ≤ 6, missing ≤ 16,
  every `VISUAL_*` total not above main.
- Determinism; the 6 large documents byte-identical unless the drafting fix
  changes them (then report and show them); held-out times within +10%.

## Notes for the implementer

- Same rule for every document; no circuit-, id-, text- or coordinate-specific
  code. Ownership from geometry and connectivity, not from label text.
- Tune on dev; report val.
