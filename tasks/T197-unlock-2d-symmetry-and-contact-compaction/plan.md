# T197 — Unlock Real-Plan 2D Symmetry & Contact-Aware Compaction

- Branch: `task/T197-unlock-2d-symmetry-and-contact-compaction`
- Base: `main` at `e8ee63051f4f13176f1babf1cee6b54f4c7b2736`
- Status: approved
- Plan review: self-checked against `compact-2d.ts`, `auto-layout.ts`, `place.ts`, `contact-placement.ts`, and Codex `gpt-6.2-sol` PR #174 review findings (P2 #2, P2 #3, P2 #4, P3).

## Goal

Unlock real-plan 2D symmetric inward compaction and R38 direct-contact compaction across medium and large circuits (L2–L5), enforce post-`finish` deadline checks in finalist reshaping, and tighten center-axis and marker-pocket clearances in `compact-2d.ts` — all with 100% general geometry/topology rules and zero latency or quality regressions.

## Context

Verified at `e8ee6305`:
1. **Planner-emitted `layoutGroups` lock inward symmetry compaction** (`packages/auto-layout/src/auto-layout.ts:4083-4092`, `packages/auto-layout/src/compact-2d.ts:193-195`):
   - `planLayoutOnce` emits `set_layout_group` for every recognized `group` into `final.layoutGroups`.
   - `compactFinalist2D` passes `final` into `generateCompacted2DCandidates`, where `compact-2d.ts:193` puts ALL `document.layoutGroups` into `rigid`, which feeds `g.local = compactionUnits("x", true)` and freezes every pair belonging to a recognized group during `compactSymmetricComponentX` (`limit[pair] = 0`).
   - Only genuine **user-authored** `layoutGroups` (i.e. `source.layoutGroups`, or excluding planner-emitted `groups.map(g => g.id)` when `userLayoutGroups` is omitted) should be treated as rigid user constraints.
2. **Valid R38 direct pin contacts suppress all compaction candidates** (`packages/auto-layout/src/compact-2d.ts:628, 762`, `packages/auto-layout/src/place.ts:402-406`):
   - `compact-2d.ts` binds coincident same-net device pins rigidly (`compact-2d.ts:217-229`), then validates the resulting placement using plain `geometryProblem(...)`, which rejects any coincident pin!
   - Likewise, `place.ts:402-406` validates supplied device placements (`given`) using plain `geometryProblem(...)` instead of `contactGeometryProblem(placedCore, resolver, contacts)` (`packages/auto-layout/src/contact-placement.ts:89`).
3. **Global axis-width clamp over-constrains multi-row symmetric stages** (`packages/auto-layout/src/compact-2d.ts:578-588`):
   - `axisLo`/`axisHi` takes the min/max X extent of ALL `c.axis` devices across every row and applies it to EVERY pair on EVERY row (so a wide axis block in row 3 prevents pairs in row 1 from moving inward toward `center`, even though `visibility(...)` at line 590 already enforces exact row-band clearance against every `c.axis` member!).
   - Replacing the global `axisLo`/`axisHi` clamp with a pure mirror-axis half-plane clamp (`center - m.hi` / `m.lo - center` with half of `tier * g.grid` clearance from `center`) lets `visibility(...)` enforce exact local clearance against each `c.axis` member on its own row while allowing unrelated rows to contract freely.
4. **Distant perimeter markers on `>40`-device circuits create oversized pockets** (`packages/auto-layout/src/compact-2d.ts:129`):
   - `cellPinOffset(document)` is `80` above 40 instances (vs `40` at `<= 40`), attaching distant perimeter ports up to `80u` away as rigid pockets on their host device. Capping pocket attachment distance at `Math.min(cellPinOffset(document), 40)` preserves adjacent seated markers while letting `placeMarkers` re-seat distant perimeter ports tightly.
5. **Post-`finish` deadline guard** (`packages/auto-layout/src/auto-layout.ts:635-779`):
   - `reshapeFinalist` currently checks `stopped()` after `planLayoutOnce`, but not after `finish(labeled)` or before returning `best`, allowing a candidate to be promoted even if the deadline expired inside `finish`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/compact-2d.ts`
- `packages/auto-layout/src/place.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/test/compact-2d.test.ts`

Out of scope (do not change):

- Frozen readability weights (`readability-weights.ts`, `readability-selection-weights.ts`)
- Any circuit-specific / ID-based rules or unrelated packages

## Steps

1. **Separate user-authored vs planner-emitted `layoutGroups` in `packages/auto-layout/src/compact-2d.ts` and `packages/auto-layout/src/auto-layout.ts`**:
   - Add an optional `options` parameter (or optional arguments) to `generateCompacted2DCandidates(document, resolver, roles, groups, stopped, options?)` supporting:
     - `userLayoutGroups?: SchematicDocument["layoutGroups"]` (defaults to `document.layoutGroups.filter((g) => !emittedGroupIds.has(g.id))`, where `emittedGroupIds = new Set(groups.map((g) => g.id))`), and
     - `contacts?: ReturnType<typeof contactPolicy>`.
   - In `compactFinalist2D` / `reshapeFinalist` (`auto-layout.ts`), pass `{ userLayoutGroups: source.layoutGroups, contacts }` to `generateCompacted2DCandidates`.
   - Use `userLayoutGroups` (NOT planner-emitted `document.layoutGroups`) when populating `rigid` in `compactionGeometry`.

2. **Contact-aware geometry validation (`R38`) in `packages/auto-layout/src/compact-2d.ts` and `packages/auto-layout/src/place.ts`**:
   - In `compact-2d.ts`: add a small helper `placementProblem(doc, resolver, contacts)` that calls `contactGeometryProblem(doc, resolver, contacts)` when `contacts?.allowed.size`, otherwise `geometryProblem(doc, resolver)`. Use it in both `compactSymmetricComponentX` and `compactAxis2D`.
   - In `place.ts`: add an optional `contacts?: ReturnType<typeof contactPolicy>` parameter to `placeDocument` (preserving backwards compatibility for all existing callers) and use `contacts?.allowed.size ? contactGeometryProblem(...) : geometryProblem(...)` at line 402 when validating `given` device placements.
   - In `auto-layout.ts`: thread `contacts` from `planLayoutOnce` into `placeDocument` (around line 3884) so compacted candidates with preserved R38 same-net pin contacts are accepted cleanly by `planLayoutOnce`.

3. **Relax over-conservative symmetry center clamp and >40-device marker pocket distance in `packages/auto-layout/src/compact-2d.ts`**:
   - In `compactSymmetricComponentX` (`compact-2d.ts:578-588`): replace the global `axisLo`/`axisHi` clamp (which propagated wide axis blocks across unrelated rows) with a mirror half-plane clamp from `center`: for each pair member `m` on the left (`direction > 0`), `clearance = center - m.hi`; on the right (`direction < 0`), `clearance = m.lo - center`; clamp `limit[i]` by `Math.max(0, clearance - Math.ceil((tier * g.grid) / 2))`. Keep `visibility(g, parts, "x", tier, ...)` enforcing exact row-band clearance against every `c.axis` member and opposing-half member.
   - In `compactionGeometry` (`compact-2d.ts:129`): cap marker-pocket attachment distance at `Math.min(cellPinOffset(document), 40)`.

4. **Enforce post-`finish` deadline checks in `packages/auto-layout/src/auto-layout.ts`**:
   - In `reshapeFinalist`, check `if (stopped()) break;` right after `const candidate = finish(labeled);` (and before appending to `passing`), and check `if (!best || stopped()) return incumbent;` before promoting `best`.

5. **Add focused regression tests in `packages/auto-layout/test/compact-2d.test.ts`**:
   - **Real-plan symmetric replay test**: run a loose multi-pair symmetric fixture through `planLayoutOnce` (so planner-emitted `layoutGroups` are present on `final`) and verify `generateCompacted2DCandidates` + `compactFinalist2D` contracts the symmetric pair spans while preserving mirror symmetry (`netlistSymmetry` non-regressing).
   - **Row-independent axis block test**: multi-pair symmetric stage with a wide `c.axis` device in one row and a loose pair in a disjoint row — verify the disjoint row contracts past the axis block's X-width while the same-row pair respects clearance from the axis block.
   - **R38 direct-contact compaction test**: loose four-resistor circuit containing a licensed same-net touching pin contact — verify `generateCompacted2DCandidates` produces compacted candidates and `compactFinalist2D` promotes a smaller routed layout with the direct contact preserved and `connectionsIntact === true`.
   - **Mid-`finish` deadline cancellation test**: advance `Date.now()` (via `vi.spyOn(Date, "now")` or a custom `finish` callback) past `options.search.deadline` inside `finish`, and verify `compactFinalist2D` returns `incumbent` untouched.
   - Give any multi-planner / large test an explicit `30000` timeout so CI never flakes.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/auto-layout/test/compact-2d.test.ts
pnpm exec vitest run packages/auto-layout/test
pnpm test:slow
```

Behavioral checks (verified by Task Lead on full 591-case Gallery A/B):
- Common-completed readability score improves further on `dev` and `val` with `0` newly refused circuits.
- Real-plan symmetric and direct-contact circuits compress cleanly without symmetry, crossing, or latency regressions.

## Notes for the implementer

- Keep all algorithms 100% general and topology/geometry-driven.
- Follow `CODING_STANDARDS.md` strictly (no `any`, clean helpers, Prettier formatting, zero lint errors).
- Write your concise implementation report to `tasks/T197-unlock-2d-symmetry-and-contact-compaction/report.md` without committing or pushing.
