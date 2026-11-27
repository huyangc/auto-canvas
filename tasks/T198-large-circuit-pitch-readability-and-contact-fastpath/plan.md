# T198 — Large-Circuit Drafting Follow & Recovery, Calibrated 2D Reshaping, and R38 Contact Fast-Path

- Branch: `task/T198-large-circuit-pitch-readability-and-contact-fastpath`
- Base: `main` at `3a05b461`
- Status: approved
- Plan review: self-checked against code, existing `<= 40` boundary tests, PR #175 Codex review findings, and L4/L5 empirical probes.

## Goal

Eliminate four general bottlenecks exposed by the 591-case evaluation and PR #175's independent review without changing quick-mode or `<= 40` boundary test contracts:

1. Unlock drafting-group following and owner recovery for `> 40`-instance circuits under bounded search so unlocked drafting text/annotations follow their owning devices instead of remaining stranded in empty space above large schematics.
2. Guide `reshapeFinalist` (2D folding and 2D constraint-graph compaction) with calibrated readability across all circuit sizes, and check deadline expiry before returning a promoted candidate.
3. Make marker and port placement (`placeMarkers` / `placePowerMarkers` / `placeCellPins`) R38 contact-aware when `placeDocument` replays a supplied placement with licensed contacts (PR #175 review `[P2]`).
4. Add an AABB early-exit fast path in `contactGeometryProblem` before `pairKey` serialization (PR #175 review `[P2]`), cutting replay overhead in half on non-touching circuits, and harden the PR #175 `[P3]` test assertions.

## Context

Verified in the repository at `3a05b461`:

- `packages/auto-layout/src/auto-layout.ts:1625-1775` (`planWithBranches`): bails out when `document.instances.length > 40`, skipping `followDraftingGroups` and leaving unlocked drafting objects stranded far from their moved owners on large circuits (e.g. `sm663cbs8b`, `4fb59zv76m`, `g47e465db5`). On `> 40` instances, if the exact-placement stripped replay fails or `fixedDraftingBlocksReuse` triggers, falling back to `planWithFixedDrafting(stripped, ...)` would double full-planning latency (~20–30s); falling back directly to `followDraftingGroups(document, resolver, base, base, groups)` keeps large-circuit overhead bounded.
- `packages/auto-layout/src/auto-layout.ts:1341-1401` (`selectFinalLayout`) and `packages/auto-layout/src/recover-drafting-owners.ts:596-641` (`recoverDraftingOwners`): `recoverDraftingOwners` is gated on `!finalists` (which is `undefined` for `> 40` instances) and `source.instances.length <= 40` inside `recoverDraftingOwners`. `finishingTrialBudget(source.instances.length, 512, false)` already scales down as `(30 / n)^3` (`110` trials at 50 instances, `12` at 103), keeping runtime small.
- `packages/auto-layout/test/finished-selection.slow.test.ts:8-36` asserts an exact SHA-256 hash for `planAutoLayout(doc41Resistors, resolver)` with default `options = {}` (no `options.search`, no `drafting`), and `selectFinishedLayout` not called. Gating the new `> 40` drafting follow/recovery paths on `(options.search?.evaluations ?? 0) > 0` preserves quick/default-call byte-identity.
- `packages/auto-layout/src/readability-selection.ts:12-23` (`readabilityTerm`) returns `0` for `> 40` instances, which is explicitly asserted by `packages/auto-layout/test/readability-selection.test.ts:213` and `packages/auto-layout/test/readability-perf.test.ts:76`. Adding a separate helper `unboundedReadabilityTerm(document, resolver)` preserves `readabilityTerm`'s contract while letting `reshapeFinalist` (`auto-layout.ts:617, 704-788`) rank and accept 2D compaction/folding proposals uniformly across all circuit sizes (`readabilityMetrics(..., "weighted")` takes ~125–204ms even on 70–103 instance circuits).
- `packages/auto-layout/src/auto-layout.ts:785-788` (PR #175 `[P3]`): `retainRefinementMetrics` recomputes `routedScore` after `stopped()` is checked; re-checking `stopped()` immediately after `retainRefinementMetrics` (before returning `best.run.result`) guarantees no expired candidate escapes.
- `packages/auto-layout/src/place.ts:385-389, 699, 856` and `packages/auto-layout/src/place-markers.ts:255-409, 493-808, 987-1044` (PR #175 `[P2]`): both `placeMarkers` calls still check plain `geometryProblem` against the full device core, rejecting valid marker/port seats whenever a supplied placement contains a licensed R38 device contact and causing duplicate markers to exhaust 200 grid nudges.
- `packages/auto-layout/src/contact-placement.ts:89-166` (PR #175 `[P2]`): `contactGeometryProblem` serializes `JSON.stringify(p.point)` for every pin and calls `!permitted.has(pairKey(a.id, b.id))` before checking whether two instance AABBs overlap, plus allocates `boxes.slice(i + 1)` on every outer iteration.

## Scope

Owned paths (may be edited):

- `packages/auto-layout/src/contact-placement.ts`
- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/readability-selection.ts`
- `packages/auto-layout/src/recover-drafting-owners.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/compact-2d.test.ts`
- `packages/auto-layout/test/recover-drafting-owners.test.ts`
- `tasks/T198-large-circuit-pitch-readability-and-contact-fastpath/plan.md`

Out of scope (do not change):

- `packages/auto-layout/src/geometry.ts` (`legacyPitch` / `smallPitch` / `cellPinOffset` / `markerOffset` 40-instance defaults — empirical probe showed blindly switching `> 40` circuits to `smallPitch` causes crossing explosions on dense 70–103 device schematics)
- `readabilityTerm` / `improvesReadability` public `<= 40` contract and existing assertions in `readability-selection.test.ts`, `readability-perf.test.ts`, `finished-selection.slow.test.ts`, `tighter-pitch.test.ts`, `short-stubs.test.ts`
- Any circuit-ID-specific logic or hardcoded thresholds targeting specific benchmark cases

## Steps

1. **Optimize `contactGeometryProblem` in `packages/auto-layout/src/contact-placement.ts`**:
   - Use `${p.point.x},${p.point.y}` instead of `JSON.stringify(p.point)` as the `hits` map key.
   - Replace `boxes.slice(i + 1)` with an indexed nested loop `for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)`.
   - Evaluate the 4 numeric AABB overlap inequalities **first**, and only call `permitted.has(pairKey(a.id, b.id))` when the boxes actually intersect and `permitted.size > 0`.
   - Preserve exact behavior, error messages, and determinism.

2. **Thread R38 `placementProblem` into `placeMarkers` (`packages/auto-layout/src/place-markers.ts` and `packages/auto-layout/src/place.ts`)**:
   - Add an optional `problem: (document: SchematicDocument, resolver: SymbolResolver) => string | undefined = geometryProblem` parameter to `placeMarkers`, `placePowerMarkers`, and `placeCellPins`.
   - Replace the hardcoded `geometryProblem(...)` calls in `placePowerMarkers` (line 308) and `placeCellPins` (lines 697 and 791) with `problem(...)`.
   - Pass `placementProblem` at both `placeMarkers(...)` call sites in `placeDocument` (`packages/auto-layout/src/place.ts:699` and `:856`).

3. **Unlock drafting follow & owner recovery for `> 40`-instance circuits under bounded search (`packages/auto-layout/src/auto-layout.ts` and `packages/auto-layout/src/recover-drafting-owners.ts`)**:
   - In `planWithBranches` (`auto-layout.ts:1631-1638`): allow `document.instances.length > 40` when `(options.search?.evaluations ?? 0) > 0` (keeping the bailout when `!(options.search?.evaluations)` so quick/default-option calls remain unchanged).
   - Inside `planWithBranches` (`auto-layout.ts:1734-1753`): when `document.instances.length > 40` and the exact-placement stripped replay fails or is rejected by completeness guards, skip the expensive second `planWithFixedDrafting(stripped, ...)` call and fall back directly to `followDraftingGroups(document, resolver, base, base, groups)` so large-circuit latency stays strictly bounded.
   - In `recoverDraftingOwners` (`recover-drafting-owners.ts:605-606`): compute `const groups = draftingGroups(source, resolver);` without the `<= 40` cutoff (the caller already gates when recovery runs, and `finishingTrialBudget` bounds trials).
   - In `selectFinalLayout` (`auto-layout.ts:1367-1380`): allow `recover()` to run `recoverDraftingOwners` when `(finalists || (document.instances.length > 40 && (options.search?.evaluations ?? 0) > 0))` (still respecting `!options.partition && options.quality !== "optimized" && !stopped()`).

4. **Unlock calibrated readability selection in `reshapeFinalist` for all circuit sizes and tighten deadline check (`packages/auto-layout/src/readability-selection.ts` and `packages/auto-layout/src/auto-layout.ts`)**:
   - In `readability-selection.ts`: keep `readabilityTerm` and `improvesReadability` unchanged for existing `<= 40` tests, and export `unboundedReadabilityTerm(document, resolver)` computing `READABILITY_SELECTION_WEIGHT * planningMemo(document, resolver, "selection-readability", () => readabilityScore(readabilityMetrics(document, resolver, "weighted")))` for any instance count (returning `0` only if `!READABILITY_SELECTION_WEIGHT`).
   - In `reshapeFinalist` (`auto-layout.ts:617, 704-788`):
     - Compute `score = unboundedReadabilityTerm(final, resolver)` and `next = unboundedReadabilityTerm(after, resolver)` uniformly for all sizes.
     - Unify the acceptance condition and candidate ranking across all circuit sizes:
       - For `mode === "compact"`: accept when `next < score` and `(area.layout.area <= before.layout.area || (audit.crossings < baseline.crossings && area.layout.area <= before.layout.area * 1.02))` (note: `noExtraCrossings`, `afterRail <= rail`, `netlistSymmetry`, `aprGuardsRegressed`, `routedGuards`, `unownedDrafting`, `keepIntactReroute`, and `seatedContacts` guards all remain enforced).
       - For `mode === "fold"`: use the existing calibrated readability fold acceptance condition uniformly across all sizes (removing the `source.instances.length <= 40` split at lines 710, 724, and 768), and rank passing candidates by `[next]`.
     - After `retainRefinementMetrics(best.run, incumbent, resolver)` (line 787), re-check `if (stopped()) return incumbent;` before returning `best.run.result` so deadline expiry during final scoring cannot return a post-deadline candidate.

5. **Add & strengthen tests (`packages/auto-layout/test/compact-2d.test.ts` and `packages/auto-layout/test/recover-drafting-owners.test.ts`)**:
   - In `compact-2d.test.ts`:
     - Strengthen the replay user-group test (lines 427–437) so the source document has a real user `layoutGroup` alongside planner-emitted `final.layoutGroups`, asserting `candidates.length > 0` and that every candidate preserves the user group while compacting outside it.
     - Strengthen the deadline test (lines 558+) to separately verify (a) expiry during `finish` skips validation and stops iterating, and (b) expiry during a second candidate's `finish` or during `retainRefinementMetrics` after a first candidate already passed still returns the incumbent.
     - Add a regression test reproducing the four-resistor, two-ground licensed R38 device-contact case (from PR #175 review) verifying that `placeDocument` / `compactFinalist2D` keeps the duplicate ground compact without exhausting 200 nudges or blowing up area.
     - Add a regression test verifying `contactGeometryProblem` with the AABB fast path still allows licensed contacts and rejects unlicensed overlaps and coincidences.
   - In `recover-drafting-owners.test.ts`:
     - Add a regression test with `> 40` instances (e.g. 42 instances) and an unlocked free drafting text owned by a device, verifying that bounded-search `planAutoLayout(doc, resolver, { search: { seed: 1, evaluations: 2 } })` moves the drafting text with its owner (0 `unownedDrafting` violations), and that `recoverDraftingOwners` directly recovers an unowned drafting group on a `> 40`-instance document.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build                                                           # expected: exit 0
pnpm typecheck                                                       # expected: exit 0
pnpm lint                                                            # expected: exit 0
pnpm format:check                                                    # expected: exit 0
pnpm docs:check                                                      # expected: exit 0
pnpm exec vitest run packages/auto-layout/test/compact-2d.test.ts packages/auto-layout/test/recover-drafting-owners.test.ts packages/auto-layout/test/readability-selection.test.ts # expected: all pass
pnpm exec vitest run packages/auto-layout/test                       # expected: all pass
pnpm test:slow                                                       # expected: all pass (including finished-selection.slow.test.ts)
```

Behavioral checks:

- All changes are 100% general and deterministic (no circuit IDs, no order-dependent iteration).
- `finished-selection.slow.test.ts`, `readability-selection.test.ts`, `tighter-pitch.test.ts`, `short-stubs.test.ts`, and `readability-perf.test.ts` pass untouched with all existing assertions intact.
- Write implementation summary to `tasks/T198-large-circuit-pitch-readability-and-contact-fastpath/report.md` (do not commit; do not run `git commit` or `git push`).

## Notes for the implementer

- Follow `CODING_STANDARDS.md` and keep edits focused strictly on the owned paths.
- Remember `compactFinalist2D` / `reshapeFinalist` checks `stopped()` before and after `retainRefinementMetrics` — make sure `retainRefinementMetrics` isn't mutating `incumbent`'s weakmap entry (it sets metrics on `best.run.result`, which is distinct from `incumbent`, so returning `incumbent` if `stopped()` is safe and clean).
- Check `placeCellPins` line 791: passing `problem` for pairwise `[other, entry.i]` checks works because `contactGeometryProblem` only checks pins/bounds of the instances passed in `d.instances`.
- Do NOT change `readabilityTerm`'s `<= 40` guard; only add `unboundedReadabilityTerm`.
- Leave git clean of any commits; write the report to `tasks/T198-large-circuit-pitch-readability-and-contact-fastpath/report.md`.
