# T189: Digital-APR-Style Macro Place, Legalization & Windowed Detail Place

- Branch: `task/T189-apr-macro-detail-place`
- Base: `origin/main` (`f650515b`, post-PR #163)
- Status: approved
- Plan review: skipped (owner requested no Codex plan review unless explicitly specified)

## Goal

Close the primary remaining quality gap on medium and large schematics (`16–100` instances account for 80.2% of remaining readability gap and all excess crossings after T188) using a general, principled, digital-APR-inspired post-annealing placement refinement pipeline plus two general placement/routing fixes uncovered while validating multi-pin macro blocks:

1. **Fast Geometry-Aware APR Proxy (`packages/auto-layout/src/apr-detail-place.ts`)**:
   - Filter out locally decoupled R172 multi-port clusters (`decoupledSignalPortClusters`) so locally seated multi-port nets do not pollute the proxy with phantom cross-canvas MST wires.
   - Count exact 2D topological chord crossings plus 1D collinear alternating-interval crossings (`topologicalEdgeCrossings`) so collinear multi-pin rows and macro columns are scored accurately.
   - Combine crossings, Manhattan wirelength, pin-exit facing alignment, Liang-Barsky segment-vs-body intrusion (`segmentIntrudesBox`, `width >= 40 && height >= 40`), and gentle signal-flow ordering (`signalDistances`).
2. **Rigid Analog Unit Extraction (`extractAprUnits`)**:
   - Preserve all recognized templates, symmetry components, parallel/driver attachments, aligned vertical DC conducting stacks, user layout groups, constraints, inductor couplings, and fixed/locked instances.
3. **Three Deterministic APR Placement Stages (sub-150ms, works up to 120 instances)**:
   - **Orient / Mirror Pass (`runOrientPass` + single-macro probes)**: Channel-pin-preserving MOS/BJT horizontal flip, valid mirror states with upright escape out of `vertical`/`both`, skipping R164 `rightFacing` blocks.
   - **Macro Column-Cluster Ordering & Legalization (`runMacroColumnPass`)**: Group overlapping vertical columns into column clusters, optimize left-to-right order via sliding-window optimal permutation (`W = 4`), global insertion, and column mirroring, repacked cleanly on grid with congestion-aware and macro-port-aware inter-column gaps (`boundaryGap`) and a width-expansion cap (`<= 1.15x + 120`).
   - **Row-Band Windowed Detail Place (`runWindowedRowPass`)**: Group free rigid units within horizontal bands, preserve cross-band obstacle intervals, and optimize order via sliding-window optimal permutation (`W = 4`), global row insertion, and in-place pairwise swaps.
   - Emits up to 4 deduplicated, legalized (`geometryProblem` + reserved marker-seat verified) phase candidates (`orient`, `macro`, `row`, `combined`).
4. **Guarded Post-Anneal Integration (`packages/auto-layout/src/auto-layout.ts`, `packages/auto-layout/src/timing.ts`)**:
   - Run `aprDetailPlace` in `finishFinalist` ONLY on the primary `searchFinalist` (not alternate finalists), on top of `annealedBaseline` (for unpartitioned layouts up to 120 instances, timed under its own `"aprDetailPlace"` phase) without perturbing annealing's deterministic random stream.
   - Skip APR early when `baseAudit.crossings === 0`, `baseAudit.unsafeProblems.length === 0`, and `baseReadability < 0.5`.
   - Shift unfixed APR placements back near `(0, 0)` before `planFrom(..., given)` so unhosted power markers remain beside the circuit before re-anchoring.
   - Screen at most the top 2 (`>40` instances) or top 3 (`<=40` instances) proxy-ranked candidates with a single `signalTrunks = true` route (falling back to `signalTrunks = false` only if `true` fails), discarding candidates with worse `unsafeProblems`, `crossings > baseAudit.crossings + 1`, or `wireLength > baseAudit.wireLength * 1.25`, and pick the single best raw candidate via `compareRuns`.
   - On that single winning raw candidate only, optionally probe the alternate `signalTrunks = false` route (when `<=40` instances or raw crossings > 0), run `finish(...)` + `finalizeFacing(...)` at most once, and accept only when `connectionsIntact` holds, zero critical `routedGuards` regress, `unsafeProblems` do not increase, `readabilityScore` does not regress, `area` stays within `<= 1.05x` (or `<= 1.15x` when crossings drop), `wireLength <= 1.12x`, `crossings <= base`, and `compareRuns < 0`.
   - Check `stopped()` right after `aprDetailPlace` and right before `finish(...)`.
5. **General Sideways Power-Marker & Touching-Pin Fallbacks (`packages/auto-layout/src/place-markers.ts`, `packages/auto-layout/src/route.ts`)**:
   - In `placePowerMarkers`, when an assigned host's default straight-above/below seat collides (`!free(i)`) on a sideways-exiting pin (`railExit === "sideways"`), fall back to the first free `extraHostSeats` seat instead of colliding into a macro body/adjacent pin.
   - In `routeDocument`, when a separated input touching-pin stub (`contacts`) fails `planWireBatch` but every pin of that contact is already covered by a subsequent non-stub tree target on the same net, fall through to the tree router instead of aborting the whole plan.

## Owned Paths

- `packages/auto-layout/src/apr-detail-place.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/route.ts`
- `packages/auto-layout/src/timing.ts`
- `packages/auto-layout/test/apr-detail-place.test.ts`
- `packages/auto-layout/test/held-out.slow.test.ts`
- `packages/auto-layout/test/rail-marker-hosts.test.ts`
- `docs/specs/auto-layout.md`

## Acceptance Criteria

1. `pnpm build`
2. `pnpm typecheck`
3. `node scripts/lint.mjs` (0 errors)
4. `node scripts/format.mjs --check`
5. `node scripts/check-markdown-links.mjs`
6. `pnpm exec vitest run packages/auto-layout packages/spice apps/editor/src/features/auto-layout`
7. `pnpm exec vitest run --mode slow --project slow`
8. Full 591-case unsealed A/B evaluation vs `origin/main` (`f650515b`) plus mandatory visual PNG inspection of improved and notable circuits.
