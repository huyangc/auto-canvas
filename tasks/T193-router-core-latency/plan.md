# T193 — Router-core latency optimization (`route-clearance` & `planRouteNet`)

- Branch: `task/T193-router-core-latency`
- Base: `main` at `e933dde65fd9e466f9a1f113707cdbddf2641237`
- Status: approved
- Plan review: self-checked against `packages/edit-engine/src/route-clearance.ts`, `route-net-planner.ts`, `wire-draft.ts`, and T190 profiling hotspots.

## Goal

Substantially reduce the remaining router-core CPU time in `packages/edit-engine` (`createRouteClearance`, `RouteClearance.conflict`, `RouteClearance.path`, and `planNetTree` in `planRouteNet`) on medium-to-large schematics (25–94 instances) while preserving **100% bit-exact routing decisions, edit plans, conflict diagnostics, and `exhaustive` equivalence**.

## Context

After T190 activated frozen-snapshot `@icm/derived` caches and fast dry-run cloning, profiling on the slowest schematics (`9r4prxnen5` 35i, `sm663cbs8b` 94i, `2rmm2vb45f` 24i) shows the remaining dominant bottleneck (~20s on the heaviest cases) sits inside `packages/edit-engine/src/route-clearance.ts` and `route-net-planner.ts`:

1. **`createRouteClearance` (`route-clearance.ts:301-495`)** rebuilds all symbol body geometry, regex-parses `straightPathPoints(primitive.data)`, transforms every primitive stroke, resolves every pin connection, and indexes all routes from scratch on EVERY `planRouteNet` call — even when dozens of nets or routing trials share the exact same immutable/frozen `SchematicDocument` snapshot.
2. **`RouteClearance.path` (`route-clearance.ts:739-936`)** unconditionally constructs up to ~400 candidate detour paths (`both([])`, 4 escape steps, and `3 steps × 2 axes × up to 64 lines`), runs `compileWireDraft(...)`, `JSON.stringify(points)`, and `crossings(points)` on **ALL ~400 candidates**, sorts all of them, and then returns the **first conflict-free candidate** (which in the vast majority of calls is one of the first 2–6 cheap L/escape candidates!).
3. **`RouteClearance.conflict` (`route-clearance.ts:501-736`)** scans ALL `pins`, ALL `bodies`, and ALL `routes` linearly on every candidate path, checks `own.endpointKeys.has` / `ownNet(pin.logicalId)` inside the hot loop instead of pre-filtering once in `createRouteClearance`, and allocates `segments`, `segmentBoxes`, `endKeys`, and `attachments` on every call.
4. **`planNetTree` (`route-net-planner.ts:481-686`)** calls `clearance.path(node.endpoint, target)` inside `while (joined.size < sorted.length)` for every unjoined component's top-4 targets on every iteration, redundantly re-solving identical `(node, target)` pairs across iterations even though `clearance` is completely immutable throughout `planNetTree`. `documentObjectIds` (`route-net-planner.ts:43-63`) also allocates a dozen intermediate arrays per call.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/edit-engine/src/route-clearance.ts`
- `packages/edit-engine/src/route-net-planner.ts`
- `packages/edit-engine/src/route-clearance.test.ts`
- `packages/edit-engine/src/route-net-planner.test.ts`
- `packages/edit-engine/src/route-options.test.ts`

Out of scope (do not change):

- `packages/auto-layout/**` (owned by parallel task T192)
- `packages/model/**`, `packages/derived/**`
- Public signatures, exported types, error message wording, or routing/tie-breaking semantics of `planRouteNet` and `createRouteClearance`.

## Steps

1. **Memoize static SVG path parsing and frozen-document base geometry in `packages/edit-engine/src/route-clearance.ts`**:
   - Cache `straightPathPoints(data)` in a module-level `Map<string, readonly Point[]>` (bounded, e.g., clear or cap at 2048 entries; symbol library has only dozens of path strings).
   - Add a `WeakMap<SchematicDocument, WeakMap<SymbolResolver, SnapshotGeometry>>` cache populated ONLY when `Object.isFrozen(document)` (matching `@icm/derived` snapshot cache safety — never retain mutable caller documents or stale mutations).
     - `SnapshotGeometry` stores net-independent geometry computed once per frozen `(document, resolver)`:
       - `labels`: `Map<string, string>`
       - `bodies`: precomputed `instanceId`, `label`, `interior`, `strokes`, `box`
       - `pins`: precomputed pin `key`, `label`, `points`, `target`, `text`, `instanceId`, `pinName`, `contactPoint`, `isImplicitVisibility`, `hasSignalMembers`, `baseNetId` (logical net lookup done via `context.logicalNetResolution` using `own.netScope`)
       - `contactSitesBase`: precomputed `Map<string, EndpointConnection[]>` for `netScope === "base"` (populated lazily on first base-scope call on the snapshot)
       - `routes`: precomputed `id`, `baseNetId`, `points`, `endpoints`, `segments`, `box`, `shortSegment`, `signalWidth`, `electricalNetIds`
     - When `document` is NOT frozen, compute directly without caching in the `WeakMap` (preserving full safety for mutable documents).
   - Pre-filter `foreignPins` (`!own.endpointKeys.has(pin.key) && !ownNet(pin.logicalId)`) once in `createRouteClearance` rather than inside `conflict()`'s inner loop.

2. **Accelerate `RouteClearance.conflict()` with exact spatial prefiltering and low-allocation checks (`packages/edit-engine/src/route-clearance.ts`)**:
   - Build lightweight spatial indexes over `foreignPins`, `bodies`, and `routes` (e.g., coarse uniform grid buckets or sorted `minX` with prefix `maxX` bounds) used ONLY when `!own.exhaustive` (and preserving the exact `shortSegment` / `route.shortSegment` bypasses already in `conflict`).
   - **Strict diagnostic order preservation**: Whenever a spatial index returns a subset of candidate `pins`, `bodies`, or `routes`, iterate them in their **exact original document index order** so `conflict()` returns the exact same first conflict message as linear scanning (`exhaustive: true`).
   - Eliminate avoidable per-call allocations inside `conflict()`:
     - Avoid `siteKey` `JSON.stringify([p.x, p.y])` — use compact string key `` `${p.x},${p.y}` ``.
     - Compute `pathBox` and per-segment bounds using scalar locals without allocating intermediate `Point[]` arrays for `paddedBox([a, b])`.
     - Fast-path `endKeys` when no `end` has `memberId`.
     - Fast-path `peerContacts` when `!contactSites.size`.

3. **Implement exact branch-and-bound and fast orthogonal compilation in `RouteClearance.path()` (`packages/edit-engine/src/route-clearance.ts`)**:
   - Replace `compileWireDraft` inside `path()`'s inner candidate loop with a dedicated fast orthogonal path builder that produces the **exact same `points`** as `compileWireDraft({ connection: a }, { connection: b }, waypoints, "orthogonal", cornerOrder)` followed by escape-segment trimming (handling duplicate consecutive points, collinear merges, and `cancelDoubledBackLegs` identically!). Add a randomized/exhaustive equivalence unit test asserting bit-identical `points` against `compileWireDraft` across straight, L, U, Z, escape-lead, and doubled-back configurations.
   - Replace `JSON.stringify(points)` dedup key with a compact numeric-joined string key (e.g., loop-built `` `${p0.x},${p0.y};...` ``).
   - **Exact two-tier branch-and-bound evaluation** (mathematically bit-identical to evaluating and stable-sorting all candidates):
     - Note that in the original candidate order:
       - **Tier 1** consists of `both([])` + `steps = 1..4` outward escapes (at most 26 candidates, original indices `0..T1-1`).
       - **Tier 2** consists of `steps = 0, 1, 2` detour lines along `y` and `x` (original indices `T1..N-1`).
     - Evaluate Tier 1 first: compile, dedup, score (`baseCost + crossingCost * crossings`), stable-sort by `cost`, and test `conflict()` in order to find the first clear winner `best` (with `bestCost = best.cost`), recording `firstReason` from the very first candidate (`scored[0]`'s original order — careful: preserve `reason ??= found` matching the original error message if NO candidate in Tier 1 OR Tier 2 is clear!).
     - Now iterate Tier 2:
       - If `best` already exists:
         - For `steps === 0` exterior lines (`y < min(start.y, end.y)` or `y > max(start.y, end.y)`, or symmetrically for `x`), we can even compute an immediate O(1) admissible lower bound `exteriorLB = manhattan + 2 * excess + (start.x !== end.x ? 4 * grid : 0)` (double-checking degenerate collinear cases!) and skip even building points when `exteriorLB >= bestCost`!
         - For every Tier 2 candidate whose `points` are built: skip if already in `seen`; compute `baseCost = length + Math.max(0, points.length - 2) * 2 * grid + turnsAway * grid`. Because `crossingCost * crossings >= 0` AND Tier 1 has strictly earlier original order than every Tier 2 candidate, if `best` exists and **`baseCost >= bestCost`**, PRUNE immediately (skip `crossings()` AND skip `conflict()`)!
       - Only candidates surviving the prune compute `crossings()` and enter the small `tier2` array (which is empty in ~95%+ of calls when Tier 1 finds a clean L/escape!).
       - Sort surviving `tier2` stably by `(cost, originalIndex)` and test `conflict()` only for entries with `entry.cost < bestCost` (or all entries if `!best`), returning the first clear hit (or `best` if none beats it).
     - **Error-message exactness**: When BOTH Tier 1 and Tier 2 find zero clear paths, fall back cleanly so `reason` matches the lowest-cost candidate's conflict just like the original code (rare failure path — zero cost on the common success path!).

4. **Memoize `clearance.path` and trim allocations in `packages/edit-engine/src/route-net-planner.ts`**:
   - Rewrite `documentObjectIds` using direct `for` loops into a single `Set<string>` (no intermediate `.map()`/`.flatMap()` spread arrays).
   - Inside `planNetTree`:
     - Memoize `clearance.path(from, to)` in a `Map<string, ClearPath | string>` keyed by `(endpointKey(from), toEndpoint ? endpointKey(toEndpoint) : `${toPoint.x},${toPoint.y}`)`, since `clearance` is immutable for the lifetime of `planNetTree`.
     - Avoid allocating `along(points)` arrays inside `overOtherPins` on every check: iterate `for (let i = 1; i < points.length; i++)` directly over `points` and pre-filter unjoined nodes cleanly.
     - Avoid allocating `nodes.slice(index + 1)` inside the trunk loop (`lines 539-540`) and seed pairs loop (`lines 570-580`); use indexed nested loops.

5. **Add thorough equivalence & regression tests**:
   - In `packages/edit-engine/src/route-clearance.test.ts`:
     - Verify `createRouteClearance` with `exhaustive: false` vs `exhaustive: true` (including frozen vs unfrozen documents, short segments, `crossingCost > 0`, blocked paths error messages, and tie-breaking) returns **identical `path()` results and `conflict()` strings**.
     - Verify fast orthogonal path compilation produces bit-identical `points` to `compileWireDraft` across straight, L, U, Z, pin-escape, and doubled-back waypoints.
   - In `packages/edit-engine/src/route-net-planner.test.ts`:
     - Verify multi-pin high-fanout net routing (12+ pins with obstacles and crossings) produces identical edits on frozen and unfrozen documents and exercises memoized `clearance.path` reuse.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm exec vitest run packages/edit-engine packages/auto-layout
```

Performance & exactness checks (run by Task Lead after implementation):

- Bit-exact (`planHash` + `dr = 0.0000`) verification on the 9 heaviest/key Gallery schematics (`9r4prxnen5`, `sm663cbs8b`, `2rmm2vb45f`, `r462vjaatg`, `q9hvr9f7yj`, `3kdhdapd4a`, `ycg43babwa`, `bsvsx7bmns`, `p7mrh78gjj`) against `origin/main` (`e933dde6`), with measurable wall-clock reduction on both `planRouteNet` hotspots and `pnpm test:slow`.

## Notes for the implementer

- **Exactness is non-negotiable**: Never approximate costs, drop valid detour lines, reorder tie-breaking, or skip `shortSegment` checks. Every optimization must be mathematically equivalent to the baseline.
- **Frozen-only snapshot caching**: NEVER cache mutable `SchematicDocument` instances in module-level WeakMaps without `Object.isFrozen(document)` checks — callers in `edit-engine` tests frequently mutate documents in place or construct non-frozen documents.
- Do not modify anything in `packages/auto-layout/`, `packages/model/`, or `packages/derived/`.
- Write your implementation report to `tasks/T193-router-core-latency/report.md` (untracked; do not commit or push).
