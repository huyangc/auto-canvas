# T207 report — round 2

## Summary

Restricted R175 to final routing in search and optimized layouts. Placement and blocker repair keep the pattern router. A selected placement can recover an incomplete base net before the final R10 check. Hanan crossing repair now runs after R148, followed by guarded signal-wire simplification.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | Done | Retained the opt-in bounded Hanan A* implementation and its pattern, determinism and exact-clearance tests. |
| 2 | Done | Added explicit rescue and crossing-repair options. The public planner enables Hanan only for selected search-mode finalists. |
| 3 | Done | Kept the replayed geometry, connectivity, rail and readability guards. Search finalists can simplify both crossing-free and crossed drawings. |
| 4 | Done | Updated R175 after R148 to describe the search predicate and finishing order. |
| 5 | Done | Exercised the direct rescue option and the separate crossing pass. Added a public planner test with fixed devices and a named net. All five files with round-1 regressions passed with their original assertions. |

## Review findings addressed

1. Shared the existing search-mode predicate between compaction and R175. An explicit zero budget and default quick planning both skip the new passes.
2. Initial routing retries with Hanan only on explicit opt-in. After placement selection, rescue considers base nets with missing connections or floating pins, skips protected geometry, removes generated label stubs and retries the frozen pins against the remaining wires. Each accepted transaction replays from source within the edit limit, strictly reduces the combined defect count, preserves the terminal partition and name claims, and has zero unsafe routing problems.
3. Preserved negotiation, deep signal trunk trials and the R148 rail pass in their existing order. A separate trunk-free Hanan trial runs against remaining crossings, then simplification runs against the resulting document. Both use the existing finished-signal acceptance path.

## Acceptance results

Run from the task worktree on branch `task/T207-hanan-route-simplify` at `f45c0797`.

```text
pnpm build → 0, apps/editor build: Done
pnpm vitest run packages/edit-engine packages/auto-layout → 0, 192 files and 2,290 tests passed
pnpm test:slow → 0, 6 files and 18 tests passed
pnpm typecheck → 0, tsc -p tsconfig.check.json --noEmit
pnpm lint → 0, oxlint checked 2,182 files with 0 errors and 4,284 warnings
pnpm format:check → 0, All matched files use Prettier code style!
pnpm docs:check → 0, validated local Markdown links in 73 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components, 38 electrical descriptors, 66 subcircuit descriptors, 106 Razavi symbol assets and 1 semantic primitive
pnpm deadcode → 0, both Knip modes completed with one informational unused-tag hint
```

## Investigation results

In the new end-to-end fixture, an immovable resistor obstructs a named signal on a one-unit grid. Default planning returns the R10 connection refusal. With one search evaluation the returned edits replay with zero missing connections, zero unsafe routing problems, the original terminal partition, and no remaining fallback labels or stub routes.

## Deviations and open questions

The latest review moves automatic Hanan rescue from initial routing to finishing and splits crossing repair into two phases around R148. The explicit Hanan crossing pass tries only the trunk-free candidate because the preceding deep pass already explored trunk tracks. The round-1 circuit benchmark and wall-clock A* latency were not measured in this round.
