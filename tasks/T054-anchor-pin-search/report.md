# T054 report — round 1

## Summary

Optimized pin search now anchors each cloned proposal to the input envelope on
the Document grid and rejects proposals outside 1.5 times the quick layout's
width or height before routing. Deduplication uses the anchored poses, and a
post-routing guard checks both the anchor and span. The call site skips pin
search if no quick final document exists. Added the finishing specification
paragraph and placed chain/ring regression tests; default quality is unchanged.

## Steps

| Step | Status | Notes                                                                                                                                                                                           |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Pass quick-result span bounds with the input envelope as anchor; return `contactResult` when `quickRun.final` is missing.                                                                       |
| 2    | done   | Clone every pose map, anchor with an empty fixed set, check span, and deduplicate anchored proposals before `replan`. All instances participate consistently.                                   |
| 3    | done   | Reject routed finals more than half a grid step from the input corner on either axis or outside either span limit.                                                                              |
| 4    | done   | Added one paragraph beside the bounded finishing text describing optimized pin search and its R10/R67 checks.                                                                                   |
| 5    | done   | Added two public-planner regression cases with preview, diagnostics, anchor and span assertions; the chain also pins the rounded default box. Existing expectations and timeouts are unchanged. |
| 6    | done   | Recorded investigation, resulting boxes, default edit comparisons and acceptance counts/times below.                                                                                            |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

```text
pnpm -r build → exit 0; apps/editor build: Done; wall 2.95 s
pnpm exec vitest run packages/auto-layout/test/pin-search.test.ts → exit 0
  Test Files 1 passed (1); Tests 5 passed (5)
  Duration 4.55 s; tests 1.19 s
pnpm exec vitest run packages/auto-layout/test → exit 0
  Test Files 37 passed (37); Tests 593 passed (593)
  Duration 33.57 s; aggregate tests 184.27 s (parallel execution)
pnpm exec prettier --check packages/auto-layout docs/specs/auto-layout.md → exit 0
  All matched files use Prettier code style!
git diff --check → exit 0; no output
```

The build emitted existing Vite configuration, browser externalization and
chunk-size warnings; it completed successfully. No dependencies were changed.

Behavioral checks used the specified four resistors at grid 10, previewed the
public planner edits, and measured `enclosingBox`. Both optimized previews
succeeded with empty diagnostics:

| Case  | Optimized corner (x, y) | Optimized width × height | Absolute corner displacement (x, y) |
| ----- | ----------------------- | ------------------------ | ----------------------------------- |
| chain | (999, 983.627907)       | 202 × 12.360465          | (4.988372, 4.627907)                |
| ring  | (999, 983.627907)       | 202 × 12.360465          | (4.988372, 4.627907)                |

Both corners are within 5 units of the exact input corner
`(994.011628, 979)`. The ring is within the limits `303 × 18.5406975`
(and the plan's rounded height limit of 18.54).

Before implementation, the reproductions matched the plan's faulty optimized
boxes. Captured serialized default-quality edits before and after implementation
and compared them byte for byte: both matched. The pre-change auto-layout tree
was identical to `origin/main` at the plan's base `5c366ac` (verified with
`git diff origin/main HEAD -- packages/auto-layout`). Default edit SHA-256 values
were unchanged:

```text
chain: 9a8ba7ef2108e3e3222d211b8bf731bb75545964a83363a896328b5cec6edb96
ring:  9e4d834261e0f045302e9ca6ed9832c05481cd1852f1b20fd5166f7449a852ef
```

For both reproductions, the optimized result after the fix also has exactly the
same edits as its default result.

## Investigation results

`pinSearch` iterates `document.instances.entries()` to build its search state
and yields a map from `document.instances.map(...)`; it does not filter out
markers, ports, ground or power symbols. If an instance lacks a placement or
resolvable visible bounds, the generator returns without yielding a partial
proposal. Its special treatment of ports and rails restricts orientation
variants, not membership in the pose map.

`searchBounds` measures `enclosingBox(quick, resolver)` across all visible
instance bounds, including markers. The input anchor uses the same
`enclosingBox` function. Both proposal helpers operate on the complete source
document with the complete pose map applied, and the final guard measures the
complete routed document. Thus devices and markers share the same measurement
set throughout; no helper or instance filtering change was necessary.

## Deviations and open questions

None. Changes remain within the owned paths; `auto-layout.ts` changes only the
pin-search call site/eligibility and its required geometry import. No other
search path, default behavior, generated file, dependency, plan or review was
modified. No LLM provider calls were made. No commits or branch changes were made.
