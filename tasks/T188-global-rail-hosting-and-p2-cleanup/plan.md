# T188: Global Rail Marker Hosting, R155 Local-Rail Fixes & PR #159 P2 Cleanups

- Branch: `task/T188-global-rail-hosting-and-p2-cleanup`
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

Eliminate the highest-ROI visual and routing bottleneck revealed by the 591-case unsealed evaluation (`railCrossings` at `4.04×` human, `101 vs 25`) through three principled, general fixes, plus clean up the three P2 items from PR #159's Codex review:

1. **MOS-gate fallback rail marker hosting (`place-markers.ts`, `route.ts`)**:
   - When a `vdd-port` or `ground` rail net has no channel/2-pin host or non-MOS extra host (e.g., tie-high/tie-low MOS gates like `M17.G/M18.G` on `VDD` in `g47e465db5`, or `M6.G/M7.G` on `GND` in `3kdhdapd4a`), stop parking its power marker at `(0, 0)`.
   - Append MOS gate pins on the rail whose exit is `"toward"` or `"sideways"` as lowest-priority `extraRailHosts` so `assignRailHosts` uses them only when no channel host or non-MOS extra host is available (keeping all existing R6a/R43/T127 priority unchanged).
   - When `powerTargets` has seated a marker at a MOS-gate extra host and all remaining pins on that rail are MOS gates, join them with a local orthogonal tree `[{ pins }]` instead of hoisting a cross-canvas `railTrunk` to the top/bottom edge of the entire schematic.
2. **Fix R155 `localRailMarkers` canonical-junction replay bug and lift the 40-instance ceiling (`local-rail-candidate.ts`, `local-rail-markers.ts`)**:
   - Separate `docCut` (applied to the post-normalized `document`) from `replayCut` (appended to `result.edits`), materializing any canonical junctions (`add_junction`) before canonical routes (`set_route_path`) in `replayCut` so `preview(source, resolver, [...result.edits, ...built.edits])` no longer fails `EDIT_PRECONDITION: Junction does not exist: junction-canonical-...` (as seen on `qv83v5afdg`).
   - Lift the artificial 40-instance ceiling in `localRailMarkers` (allow up to 120 instances and bound added markers per rail cleanly) so 35–100 instance schematics with crossed shared rail trunks (such as `3kdhdapd4a`) can split crossed rails into local markers.
3. **Clean up PR #159's 3 Codex P2 findings (`auto-layout.ts`, `multi-port-nets.ts`, `route.ts`, `place-markers.ts`)**:
   - Exclude deferred MCTS runs (`deferMctsToFinalist`) from the incumbent's `reroutePortfolio` pool in `auto-layout.ts`.
   - In `multi-port-nets.ts` (`assignSignalPortHosts`), prefer pins with no existing `portAssociations` when choosing a fallback `primaryHost` for an unmatched port so authored local port groupings are preserved.
   - Move the `supply`/`ground` non-rail eligibility guard into `decoupledSignalPortClusters` (`multi-port-nets.ts`) so placement (`place-markers.ts`) and routing (`route.ts`) always agree.

## Owned Paths

- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/local-rail-candidate.ts`
- `packages/auto-layout/src/local-rail-markers.ts`
- `packages/auto-layout/src/routing-audit.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/multi-port-nets.ts`
- `packages/auto-layout/test/rail-marker-hosts.test.ts`
- `packages/auto-layout/test/local-rail-markers.test.ts`
- `packages/auto-layout/test/multi-port-decoupling.test.ts`
- `docs/specs/auto-layout.md`

## Acceptance Criteria

1. `pnpm build`
2. `pnpm typecheck`
3. `node scripts/lint.mjs` (0 errors)
4. `node scripts/format.mjs --check`
5. `node scripts/check-markdown-links.mjs`
6. `pnpm exec vitest run packages/auto-layout packages/spice apps/editor/src/features/auto-layout`
7. `pnpm exec vitest run --mode slow --project slow`
8. 591-case unsealed A/B evaluation vs `origin/main` (`7a22445e`) confirming net reduction in `railCrossings`, `crossings`, `wireLength`, and `composite`, with zero new visual regressions (`VISUAL_WIRE_THROUGH_SYMBOL`, `VISUAL_LABEL_OVERLAP`) and visual PNG verification of improved cases (`g47e465db5`, `3kdhdapd4a`, `qv83v5afdg`, etc.).
