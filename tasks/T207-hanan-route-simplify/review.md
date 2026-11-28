# T207 Review — Round 1

- Verdict: `needs-fix`
- Reviewer: coordinator (code review + test failure root-cause analysis + 131-case empirical benchmark)

## Empirical Benchmark & Test Summary (Round 1)

- The core algorithms (`hanan-astar.ts` and `route-simplify.ts`) deliver major empirical gains across 130 real analog circuits vs `origin/main`:
  - `human-30` (`n=30`, 29 valid): crossings `252 -> 228 (-24)`, bends `574 -> 547 (-27)`, wireLength `166,950 -> 158,810 (-8,140)`, readability mean `1.3211 -> 1.1234` (9/0 crossing better/worse).
  - `loadbench-101` (`n=101`, 101 valid): crossings `619 -> 535 (-84)`, readability mean `0.8279 -> 0.7174` (39/1 crossing better/worse).
- However, 14 existing tests fail across 5 files because R175 was wired into initial routing, quick mode (`options.search === undefined`), and pre-R148 deep rerouting — preempting R14 (`blocker-repair`), R10 refusal, quick-mode invariance, and R148 (`rerouteRailCrossings`). Every one of those 14 failures is resolved cleanly by adjusting the call-site gating and phase order, with **zero** changes to existing test files.

## Must-Fix Findings

### 1. Gate R175 finishing passes on search/optimized mode (`packages/auto-layout/src/auto-layout.ts:785-920`)
- **Problem**: `planAutoLayout(doc, resolver)` with `options.search === undefined` is quick mode (equivalent to `{ search: { seed: 1, evaluations: 0 } }`), yet `routeSelectedFinalist` is still invoked at line 477. Running `simplifyRoutes` when `options.search === undefined` breaks quick-mode invariance (`packages/auto-layout/test/symmetry.test.ts:391-394`, 1 failure).
- **Required fix**:
  - Use the exact repo search-mode predicate already used at line 473:
    `const searchMode = (options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) > 0;`
  - Only run R175 passes (finishing Hanan rescue, Hanan deep signal reroute, and `simplifyRoutes`) when `searchMode` is `true`. When `searchMode` is `false`, `routeSelectedFinalist` must behave identically to `origin/main` (preserving the early exit when `!auditRouting(final, resolver).crossings` and skipping R175 entirely).

### 2. Do not preempt R14 blocker-repair / R10 refusal in initial `routeDocument` (`packages/auto-layout/src/route.ts`, `packages/auto-layout/src/auto-layout.ts`)
- **Problem**: Running `hanan-fallback` unconditionally inside `routeDocument` rescues blocked nets during initial placement/routing **before** R14 (`blocker-repair`) can move obstructing devices out of the way, before R10 opposing-stub refusal checks run (`route-quality.test.ts`), and changes provisional scores before `local-loop-amplifier` comparisons (11 failures total: 9 in `blocker-repair.test.ts`, 1 in `route-quality.test.ts`, 1 in `local-loop-amplifier.test.ts`). Architecturally, R14 should move blocking devices first; Hanan maze rescue should only fire after placement and blocker-repair if a net still remains unjoined (or when explicitly requested via an option).
- **Required fix**:
  - In `packages/auto-layout/src/route.ts`, add `hananRescue?: boolean` (default `false`) to `routeDocument`'s `options` parameter, and only execute the `hanan-fallback` retry inside `routeDocument` when `options.hananRescue === true`.
  - In `packages/auto-layout/src/auto-layout.ts` (`routeSelectedFinalist`), when `searchMode` is `true` and the finished layout still has `missingConnections(final, resolver) > 0` or `floatingPins(final, resolver).length > 0`, run a guarded finishing rescue pass that retries the unjoined non-protected base net(s) via `planRouteNet(..., { netScope: "base", components: "physical", crossingCost: 100 * grid, pathSearch: "hanan-fallback", reservedIds })` (removing any fallback stub labels/routes of that net first, replaying from `source`, and accepting only if `missingConnections + floatingPins.length` strictly decreases with zero new `unsafeProblems` and preserved `terminalPartition`).
  - Update the direct `routeDocument` rescue unit test in `packages/auto-layout/test/route-simplify.test.ts` to pass `{ hananRescue: true }` (and keep an end-to-end test verifying that `planAutoLayout` in search mode rescues an otherwise-unroutable net without preempting quick mode).

### 3. Run Hanan deep crossing reroute AFTER R148 `rerouteRailCrossings` (`packages/auto-layout/src/local-reroute.ts`, `packages/auto-layout/src/auto-layout.ts`)
- **Problem**: Adding the `hanan-fallback` candidate inside the pre-R148 `rerouteCrossings(..., { deep: true })` pass detours signal wires around crossed rails before R148 (`rerouteRailCrossings`) can move the rail trunk itself, causing both 41-device R148 tests in `packages/auto-layout/test/global-route-order.test.ts` (2 failures) to observe 0 calls to `rerouteRailCrossings`.
- **Required fix**:
  - In `packages/auto-layout/src/local-reroute.ts`, add a `hanan?: boolean` flag (default `false`) to `rerouteCrossings`'s options (`{ deep = false, hanan = false } = {}`) and only try the trunk-free `pathSearch: "hanan-fallback"` candidate in `rerouteNets` when `hanan` is `true` (when `hanan` is `true`, you may either try only the `hanan-fallback` candidate or `trunkTracks` + `hanan-fallback`, keeping runtime fast and avoiding redundant trunk replays already tried in the first deep pass).
  - In `packages/auto-layout/src/auto-layout.ts` (`routeSelectedFinalist`), preserve the exact phase order:
    1. `negotiateFinalist` (existing)
    2. `rerouteCrossings(..., { deep: true })` (existing trunk tracks, `hanan: false`)
    3. `rerouteRailCrossings` (R148 — runs whenever rail crossings remain after trunk tracks!)
    4. When `searchMode && !stopped()` and `auditRouting(currentDoc, resolver).crossings > 0`: run `rerouteCrossings(..., { deep: true, hanan: true })` through `acceptFinishedSignals` (note: do not invoke `rerouteCrossings` a second time with `{ deep: true }` if `global-route-order.test.ts` asserts `signalPass.mock.calls.filter(c => c[5]?.deep)` has length `1`! Check `global-route-order.test.ts:243` — it asserts `signalPass.mock.calls.filter((call) => call[5]?.deep)` has length `1`! Therefore expose a separate exported helper e.g. `rerouteHananCrossings(...)` in `local-reroute.ts` or pass `{ hanan: true }` with `deep: false` / dedicated entry so the existing `rerouteCrossings(..., { deep: true })` spy count stays `1`!).
    5. When `searchMode && !stopped()`: run `simplifyRoutes` through `acceptFinishedSignals(..., simplifying = true)`.
  - Update R175 in `docs/specs/auto-layout.md` to document this exact post-R148 finishing order and search-mode gating.

## Verification Required

- All 14 previously failing tests across `blocker-repair.test.ts`, `global-route-order.test.ts`, `local-loop-amplifier.test.ts`, `route-quality.test.ts`, and `symmetry.test.ts` MUST pass with **zero** modifications to any existing test file.
- Re-run all 10 acceptance commands from `tasks/T207-hanan-route-simplify/plan.md` (including `pnpm agent-docs:generated:check`, `pnpm components:check`, and `pnpm deadcode`, which were skipped in Round 1) and update `tasks/T207-hanan-route-simplify/report.md`.

---

# T207 Review — Round 2

- Verdict: `approved`
- Reviewer: coordinator (full diff review + independent 10-command acceptance + 131-case corpus benchmark on `human-30` and `loadbench-101`)

## Verification of Must-Fix Findings

1. **Search-mode gating (`packages/auto-layout/src/auto-layout.ts:473-485, 774-960`)**: Verified. Uses `(options.search?.evaluations ?? (options.quality === "optimized" ? 1 : 0)) > 0`, keeping default quick mode and explicit `{ evaluations: 0 }` byte-identical (`symmetry.test.ts` and SHA-256 baseline check pass).
2. **Opt-in `hananRescue` + finishing rescue (`packages/auto-layout/src/route.ts:511-645, 912-1000`, `auto-layout.ts:890-908`)**: Verified. Initial routing and R14 blocker-repair keep the pattern router by default; search/optimized finishing runs `rescueUnjoinedNets` only on remaining incomplete nets. All 11 `blocker-repair`, `route-quality`, and `local-loop-amplifier` tests pass unmodified.
3. **Post-R148 Hanan deep crossing reroute (`packages/auto-layout/src/local-reroute.ts:102-145, 303-335`, `auto-layout.ts:944-990`)**: Verified. Preserves negotiation → deep trunk tracks → R148 `rerouteRailCrossings` → post-R148 trunk-free Hanan crossing repair → `simplifyRoutes`. Both 41-device tests in `global-route-order.test.ts` pass unmodified.

## Independent Acceptance & Benchmark Results (Round 2)

- All 10 acceptance commands passed (`pnpm build`, `pnpm vitest run packages/edit-engine packages/auto-layout`: 192 files / 2,290 tests, `pnpm test:slow`: 6 files / 18 tests in `73.39s`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm agent-docs:generated:check`, `pnpm components:check`, `pnpm deadcode`).
- Empirical before/after corpus comparison vs `origin/main`:
  - `human-30` (`n=30`, 29 both valid): crossings `252 -> 248 (-4)` (4/0 better/worse), bends `574 -> 568 (-6)`, wireLength `166,950 -> 167,840 (+890)`, readability mean `1.3211 -> 1.2935`.
  - `loadbench-101` (`n=101`, 101 both valid): crossings `619 -> 545 (-74, -12.0%)` (33/0 better/worse, 0 crossing regressions), bends `1629 -> 1690 (+61)`, wireLength `435,231 -> 443,111 (+7,880)`, readability mean `0.8279 -> 0.7339 (-11.4%)`.
