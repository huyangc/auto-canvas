# T173 report — round 3

## Summary

The diode-connected clamp regression selects MCTS, with zero crossings and zero avoidable jogs in the committed drawing. The ported MOS differential regression passes its draft-geometry, connectivity and routing-safety checks. Its selected strategy is still `convention`, which finishes with zero crossings. This strategy assertion is the only failing acceptance test.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | The existing extractor recognizes the clamp and the two parallel bridge transistors. |
| 2 | done | Branch origins account for the posed conducting-pin offset, including during mirror polish. Shorter branches match shared-gate and polarity rows. Outer gates account for port nets, and parallel devices share a centered stack. |
| 3 | done | Verified the existing MCTS dispatch, symmetry check and strict portfolio comparison through end-to-end tests. |
| 4 | partial | Added coverage for collinear conducting pins, shared-gate rows, outward external gates, centered 60-unit bridge spacing and both strategy decisions. The ported differential selection assertion fails. |
| 5 | done | Updated R171 with the axis, row, spacing and gate-facing rules. |
| 6 | done | Ran all seven acceptance commands and recorded their results below. |

## Review findings addressed

1. **Conducting-pin alignment and clamp rows.** The two PMOS devices now share a row even though only one has a resistor above it. The resistor, PMOS and NMOS share a conducting-pin x coordinate through mirror changes. The diode-connected fixture uses the three-signal-pin op-amp. The existing explicit-supply clamp fixture also passes its transaction and connectivity checks.
2. **Outward-facing input gates and bridge rows.** Both port-driven input transistors face outward in the SPICE-style four-port regression. The two bridge channels are horizontal, centered between the columns and 60 units apart vertically. Their mean row is halfway between the input transistor and tail source rows, which are 120 units apart. The requested end-to-end MCTS win remains open.

## Acceptance results

```text
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build → exit 0, apps/editor build: Done
pnpm typecheck → exit 0, tsc -p tsconfig.check.json --noEmit
pnpm lint → exit 0, oxlint: 2202 files, 0 errors, 3912 warnings
pnpm format:check → exit 0, All matched files use Prettier code style!
pnpm docs:check → exit 0, Validated local Markdown links in 75 files
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → exit 1, 1260 passed, 1 failed
  mcts-placement.test.ts > commits a complete, safe ported MOS bridges drawing
  Expected: "mcts"
  Received: "convention"
pnpm test:slow → exit 0, 2 test files passed, 8 tests passed
```

## Investigation results

On the ported regression, the initial MCTS route has one crossing between the input net `inp` and the source-column net `left`. It also incurs two input/output port-order violations. The initial `convention` route has one crossing and zero port-order violations.

| Ported differential route | Crossings | Bends | Wire length | Routed score |
| --- | ---: | ---: | ---: | ---: |
| Initial MCTS | 1 | 3 | 1080 | 11763.97 |
| Initial convention | 1 | 8 | 1060 | 5417.76 |
| Finished convention | 0 | 6 | 1220 | 1041.13 |

An exploratory sweep sent 864 arrangements through `planLayoutOnce` with fixed device placements. It varied column order, column gap (140, 180, 220), row pitch (120, 160, 200), each horizontal bridge pose and a common vertical shift (−20, 0, 20). None produced a valid zero-crossing routed draft. The result applies to the sampled arrangements on the shared-ground fixture.

Verified the built-in pin coordinates with the symbol resolver and model transform, with no mirror applied.

| Symbol | At 0° | At 90° | At 270° |
| --- | --- | --- | --- |
| Resistor and capacitor | 1 at (0, −20), 2 at (0, 20) | 1 right, 2 left | 1 left, 2 right |
| NMOS | D at (10, −20), S at (10, 20) | D right, S left | D left, S right |
| PMOS | D at (10, 20), S at (10, −20) | D left, S right | D right, S left |
| Op-amp | OUT at (30, 0) | OUT down at (0, 30) | OUT up at (0, −30) |

## Deviations and open questions

The strict portfolio gate retains the lower-scoring incumbent on the ported differential circuit. The regression continues to require an MCTS win. Changing the shared router, port-order metric or portfolio gate falls outside this round's placement changes.

The clamp win is verified on the synthetic diode-connected fixture. A separate check of a locally cached imported `vhg3q4gax7` project encountered an undrawn supply connection at the final connection gate. An end-to-end MCTS win on that imported snapshot remains unverified.
