# T175 report — round 2

## Summary

Eligible named signal ports keep their local device hosts when the layout is routed and replayed. Ports with one assigned host try staggered distances along the host pin's exit before falling back to the edge. All seven acceptance commands passed.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Host assignment reserves touching contacts first, then consults single-port physical components before using the deterministic fallback. Spare pins prefer their wired cluster. |
| 2 | done | Placement, seat search and blocker repair use the component associations. Placement and repair share the same set of local seat distances. |
| 3 | done | Routing freezes component associations before cleanup and uses them when building independent routing targets. Only touching contacts can license exact contact stubs. |
| 4 | done | The round 1 audit merges named port-bearing components while retaining physical floating-pin checks and counting stranded components. |
| 5 | done | R86 describes the audit. R172 now covers wired host selection, local seat distances and edge fallback direction. |
| 6 | done | Added a facing-gate seating test and extended the reversed-contact regression to run the planner again on the wired result. All eight multi-port fixture tests passed. |

## Review findings addressed

1. **Wired and replayed associations.** Before cleanup, each Base Net records port-to-device pairs for physical components with exactly one signal port. Both placement and routing use these pairs. In the reversed-contact regression, the first port remains paired with B and the second with A after replay. Seat search also offers a local position near B.
2. **Local collisions and edge direction.** A port with one assigned host tries half, one and one and a half offsets, filtering duplicate distances and distances below two grid steps. Blocker repair recognizes all three. A horizontal host exit sets the default left or right fallback. The facing-gate test verifies that two ports whose full-offset seats coincide both fit between the gates at distinct positions.

## Acceptance results

```text
pnpm build → 0 (apps/editor build completed with a Vite chunk-size warning)
pnpm typecheck → 0 (tsc -p tsconfig.check.json --noEmit)
pnpm lint → 0 (oxlint reported 0 errors and 3917 warnings across 2205 files)
pnpm format:check → 0 (All matched files use Prettier code style!)
pnpm docs:check → 0 (Validated local Markdown links in 75 files)
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0 (92 files and 1269 tests passed)
pnpm test:slow → 0 (2 files and 8 tests passed)
```

## Investigation results

The reversed-contact regression from round 1 passes on both the initial layout and its wired replay.

## Deviations and open questions

None.
