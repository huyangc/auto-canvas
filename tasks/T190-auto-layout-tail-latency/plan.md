# T190 — General Auto-Layout Per-Case Tail-Latency Optimization

- Branch: `task/T190-auto-layout-tail-latency`
- Base: `main` at `06e46877` (post-PR #165)
- Status: approved
- Plan review: self-checked against the code and V8 CPU profiles of slowest unsealed cases (`9r4prxnen5`, `qzszatannt`)
- Implementation model: `gpt-6.2-astra` (hard — cross-package caching invariants, exact-equivalence hot-path rewrites, and zero-quality-regression finishing-search optimization)

## Goal

Cut per-case auto-layout tail latency (`p95`, `p99`, `max`, and total 591-case runtime) by **>= 45–60%** through general, principled engine caching, exact-equivalence hot-path optimization, and bounded finishing-search deduplication — with **zero** electrical integrity regressions, **zero** visual regressions, and near-zero readability/crossing drift (`<= +0.5` composite / `<= +2` crossings across 576 paired unsealed cases).

## Context (V8 CPU Profile + Code Facts)

Profiling two representative pre-existing slowest circuits (`9r4prxnen5` 35i: **53.35s**, `qzszatannt` 14i: **38.01s**) on `06e46877` showed:

- **`finishPlacement` accounts for 51.1% of total CPU time**:
  - `9r4prxnen5`: `finishing` called **70×** (`16.9s` + `relocation 8.7s` + `ports 7.1s` + `crossingPolish 6.3s` + `pinJogs 5.8s` + `labelRepair 4.2s` + `rails 4.0s` + `stackRepair 1.6s`) even with 1 finalist.
  - `qzszatannt`: `finishing` called **173×** across 3 finalists (`relocation 10.9s`, `ports 5.2s`, `crossingPolish 3.4s`, `stackRepair 2.5s`, `pinJogs 2.3s`).
- **`preview` / `executeTransaction` accounts for 33.7% of total CPU time**:
  - `packages/auto-layout/src/transaction.ts:12` documents that `preview()` snapshots are read-only inside planning, **but `executeTransaction(..., { dryRun: true })` returns an unfrozen document** (`packages/edit-engine/src/transaction.ts:1277-1291`).
  - Because `isFrozenSnapshot(document)` is `false` on every `preview().document`, **all four existing `@icm/derived` `WeakMap` caches miss 100% of the time**:
    - `packages/derived/src/document-derived-context.ts:102` (`contextCache`)
    - `packages/derived/src/logical-net.ts:335` (`resolveDocumentLogicalNets`)
    - `packages/derived/src/resolved-route-geometry.ts:132` (`resolveRouteGeometry`)
    - `packages/derived/src/mos-bulk.ts:72,116,198`
  - Furthermore, `deriveElectricalTopologyProjection` (`packages/derived/src/electrical-topology-projection.ts:87`) is never cached even for frozen snapshots, so every call to `missingConnections`, `floatingPins`, `terminalPartition`, `equivalentTerminals`, and `auditRouting` rebuilds `DisjointSet` + `deriveStableId` from scratch.
- **`fnv1a64` (`packages/model/src/ids.ts:12-19`) accounts for 6.7% of total CPU time** (`5.6%` self + `1.1%` `TextEncoder#encode`):
  - Allocates a fresh `new TextEncoder()` and `Uint8Array` and runs a `BigInt` loop on every single `deriveStableId` call.
- **`structuredClone` + GC account for 12.9% of total CPU time** (`7.9%` `structuredClone` + `5.0%` GC), largely from cloning full documents/results during redundant `planFrom` / `finish` / `executeTransaction` calls.
- **PR #165 Round 5 non-blocking P2 follow-ups** (natural fit here):
  - `packages/auto-layout/src/place-markers.ts:372-391`: runs `free(i)` before checking `railExit === "sideways"`, paying a full geometry scan on every ordinary vertical MOS rail marker.
  - `packages/auto-layout/src/auto-layout.ts:2332-2342`: `criticalGuards` omits `"VISUAL_CONSTRAINT_VIOLATION"`.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/model/src/ids.ts`
- `packages/model/test/` (or `packages/model/src/ids.test.ts` — verify exact test path)
- `packages/derived/src/electrical-topology-projection.ts`
- `packages/derived/src/document-derived-context.ts`
- `packages/derived/src/electrical-topology-projection.test.ts`
- `packages/auto-layout/src/transaction.ts`
- `packages/auto-layout/src/auto-layout.ts`
- `packages/auto-layout/src/place-markers.ts`
- `packages/auto-layout/src/planning-budget.ts`
- `packages/auto-layout/src/local-reroute.ts`
- `packages/edit-engine/src/transaction.ts`
- `packages/edit-engine/src/transaction-result.ts`
- `packages/edit-engine/src/wire-batch-planner.ts`
- `packages/auto-layout/test/` (targeted unit/regression tests)

Out of scope (do not change):

- External/committed transaction schema validation semantics in `packages/edit-engine/src/transaction.ts` (all committed transactions and external `executeTransaction` callers must keep 100% identical Zod validation and behavior; internal dry-run fast paths may ONLY skip redundant Zod parsing when explicitly opted in by trusted internal dry-run callers, while `planAutoLayout`'s final outer validation still runs full Zod `executeTransaction`).
- Any circuit-specific heuristics, hardcoded IDs, or relaxation of integrity / readability / visual guards.
- `packages/auto-layout/src/apr-detail-place.ts` proxy scoring or stage algorithms.

## Steps

1. **Bit-identical fast `fnv1a64` in `packages/model/src/ids.ts`**:
   - Replace per-call `new TextEncoder()` with a module-level singleton `TextEncoder`.
   - Implement exact 64-bit FNV-1a using two 32-bit unsigned integers (`lo`/`hi`) with `Math.imul` (exact 64-bit multiply by `0x100000001b3`) with a zero-allocation ASCII fast path (`code < 0x80`) and UTF-8 fallback via the singleton `TextEncoder` for non-ASCII strings.
   - Add unit tests proving bit-for-bit identity against the `BigInt` reference implementation across ASCII, empty, long, and multi-byte UTF-8 inputs.

2. **Enable frozen-snapshot caching for `preview()` and `deriveElectricalTopologyProjection`**:
   - In `packages/derived/src/electrical-topology-projection.ts`, cache `deriveElectricalTopologyProjection(document, resolver)` via `registerDocumentCache(new WeakMap<...>())` whenever `isFrozenSnapshot(document)` is true (keyed by revision + resolved symbol context, matching `document-derived-context.ts`'s invalidation discipline).
   - In `packages/auto-layout/src/transaction.ts`:
     - Freeze read-only `preview()` documents (`freezeSnapshot(result.document)` when `result.ok`) so all `@icm/derived` caches (`contextCache`, `logical-net`, `resolved-route-geometry`, `mos-bulk`, `electrical-topology-projection`) actually hit across `auditRouting`, `missingConnections`, `floatingPins`, `routedGuards`, `readabilityMetrics`, `terminalPartition`, and `planRouteNet`.
     - Memoize `terminalPartition(document, resolver)` via `planningMemo` (or frozen-snapshot cache) so `buildPlan` (`auto-layout.ts:3501`) does not recompute the immutable input document's `terminalPartition` on every `planFrom` call.
     - Audit and fix any caller inside `packages/auto-layout` that inadvertently mutates a `preview().document` snapshot in place.

3. **Eliminate redundant `finish()` and `finishPlacement()` work in `packages/auto-layout/src/auto-layout.ts`**:
   - **Deduplicate identical `run` / `alternative` inside `finish()`** (`auto-layout.ts:1544-1581`): when `alternative === run` or both have identical `result.edits` (compare cheap edit-length / serialized key or `editsEqual`), skip the duplicate `repair(alternative)` and `selectRoutingAlternative` overhead completely.
   - **Fast-reject broken trials and avoid wasted work inside `finishPlacement()`** (`auto-layout.ts:2483-2545`):
     - Compute `first = routeSeat(true)`. If `first` is valid and has 0 crossings and 0 unsafe problems and intact connections, evaluate whether `routeSeat(false)` is needed; if `first` and `second = routeSeat(false)` are BOTH refused (`!first.final && !second.final`), return early without calling `finish`, `finalizeFacing`, `rerouteCrossings`, or `finishLabels`.
     - Deduplicate `first` and `second` before calling `finish(...)` when they produce identical `result.edits`.
     - Inside `rerouteCrossings` (`packages/auto-layout/src/local-reroute.ts:115-135`), verify zero-crossing results exit immediately before invoking `preview()` when `crossingsByNet` is already empty on a known document (or pass the already-previewed document when available).
   - **Avoid duplicate `finishFinalist` polishing on identical post-baseline alternate finalists + scale alternate-finalist trial budget**:
     - When an alternate finalist (`!searchFinalist`) lands on the exact same `contactResult` / post-`baseline` edits as an already-polished finalist within the same `selectFinalLayout` pass, return the cached polished result instead of re-running all 8 polishing passes (`relocation`, `ports`, `rails`, `gaps`, `crossingPolish`, `stackRepair`, `pinJogs`, `labelRepair`).
     - Use `reducedBudget = !searchFinalist || (options.attachmentDraft ?? false)` for alternate finalists in `finishFinalist` (`auto-layout.ts:2546`) while keeping 100% full trial budgets on the primary `searchFinalist`.
   - Investigate and record in `report.md` whether skipping `seatLabels()` inside throwaway pre-`finish()` raw routes (`planFrom` when a caller only compares raw routing before `finish()`) is safe (verify whether `routedScore`/`compareRuns` depends on label positions before touching it; do NOT change label scoring if `compareRuns` depends on it).

4. **Fold in PR #165 Round 5 P2 polish**:
   - In `packages/auto-layout/src/place-markers.ts:372-391`, check `railExit(hostInstance, assigned.pinName, resolver, ground) === "sideways"` **before** calling `!free(i)` so ordinary vertical MOS rail hosts skip the extra geometry scan.
   - In `packages/auto-layout/src/auto-layout.ts:2332-2342`, add `"VISUAL_CONSTRAINT_VIOLATION"` to `criticalGuards` and add a focused unit test verifying APR rejects a candidate that introduces a layout constraint violation.

5. **Add focused regression tests**:
   - `fnv1a64` bit-exact equivalence test in `packages/model`.
   - `deriveElectricalTopologyProjection` frozen-snapshot cache hit & invalidation test in `packages/derived`.
   - `finish()` identical-alternative deduplication and APR `VISUAL_CONSTRAINT_VIOLATION` guard test in `packages/auto-layout`.

## Acceptance

Run from the T190 worktree root; all must pass:

```bash
pnpm build
pnpm typecheck
node scripts/lint.mjs
node scripts/format.mjs --check
node scripts/check-markdown-links.mjs
pnpm exec vitest run packages/model packages/derived packages/edit-engine packages/auto-layout packages/spice apps/editor/src/features/auto-layout
pnpm exec vitest run --mode slow --project slow
```

Benchmark & Visual Acceptance (run by Task Lead after implementation):

- Uncontended `--jobs 1` comparison on the top 10 slowest unsealed circuits (`9r4prxnen5`, `p7mrh78gjj`, `r462vjaatg`, `q9hvr9f7yj`, `qzszatannt`, `2rmm2vb45f`, `ycg43babwa`, `qv83v5afdg`, `b9afqhsjzv`, `sm663cbs8b`) vs `06e46877` (`origin/main`): target **>= 45% wall-clock reduction**.
- Full 591-case unsealed A/B evaluation vs `06e46877` (`origin/main`):
  - Zero regressions in `completed` count, `nonEquivalent`, `floatingPins`, `missingConnections`, `unsafeProblems`, `VISUAL_LABEL_OVERLAP`, `VISUAL_SYMBOL_OVERLAP`, `VISUAL_WIRE_THROUGH_SYMBOL`.
  - Readability `composite` and `crossings` neutral or improved (`delta composite <= +0.5`, `delta crossings <= +2`).
  - Substantial per-case latency drop across `p50`, `p90`, `p95`, `p99`, `max`, and count of `>20s` / `>30s` cases.
  - Mandatory visual PNG inspection via `read_file` for any case whose output changes.

## Notes for the implementer

- Do **not** run a full 591-case evaluation inside the Codex round; verify latency on the fast targeted profiling script (`qzszatannt`, `9r4prxnen5`, `sm663cbs8b` via `/Users/huzhifeng/.gemini/antigravity/brain/42277dc4-fc1d-47f2-86eb-52c1d999b4ef/scratch/full-eval-input/` if accessible, or `held-out.slow.test.ts` timings) and leave the full 591-case A/B + PNG inspection to the Task Lead.
- Keep `freezeSnapshot` safe: never freeze caller-owned input `document` passed into `planAutoLayout` — only freeze internal `preview()` output snapshots created by `executeTransaction(..., { dryRun: true })`.
- Follow `CODING_STANDARDS.md`, keep diffs readable and modular, and do not commit, switch branches, or edit `plan.md`.
