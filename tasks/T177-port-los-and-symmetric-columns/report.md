# T177 report — round 2

## Summary

Six of seven acceptance commands pass. The gallery evaluation of `38m8wdesbh` produced four crossings, down from the review's 17. Both tails sit on the axis, all ten pairs mirror, and the audit reports zero label overlaps, symbol overlaps, missing connections and floating pins. Terminal equivalence passes. The synthetic complementary folded-cascode test still fails its NMOS column-order and crossing assertions.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Scoped the obstruction check in initial placement and seat search. The M6/M14 regression, all R72 blocker-repair cases and the R164 edit fingerprint pass. |
| 2 | done | The private-gate axis-tail test and shared-gate negative control pass. |
| 3 | partial | Both sweep directions and eligible adjacent swaps use the inward/outward tie-breaker. Multi-column half compaction and reflection reserve local gate-port space. The fixture's cross-row column order remains unresolved. |
| 4 | done | The folded-cascode test verifies separate physical components for the three sources on each rail, local rail-port positions and terminal equivalence. The R62 tests pass. |
| 5 | done | Updated R71 and R89 to describe stub distances, sweep ties and gate-port clearance. R88 and R172 retain the round 1 updates. |
| 6 | partial | The long-stub and private-gate regressions pass. The routed OTA still exceeds its crossing limit and both NMOS inputs fail the inward-column assertion. |

## Review findings addressed

1. The obstruction guard covers decoupled ports and ordinary single-host stubs longer than 40 units. The R146 directional seat follows the same short-stub rule. For ordinary multi-host nets, host-relative search candidates retain their previous behavior. The R164 output net has three device pins, and applying the guard to its longer search candidates changed its edit fingerprint even after restoring short seats.
2. The row optimizer compares crossing-plus-span cost first and inward/outward preference second for both the best sweep and adjacent swaps. It also compares the two initial orders by those scores. The suggested swap cannot fix the fixture with its actual row membership, detailed below.
3. For multi-column symmetric halves, gate-port eligibility is determined before removing port instances from the half document. Both compaction passes use the same spacing constraint. An aisle gets 40, 80 or 120 units according to the number of sides facing a local gate port. Reflection also retains clearance beside an axis run and between inward-facing partners.

## Acceptance results

```text
pnpm build → 0, apps/editor build: Done
pnpm typecheck → 0, tsc -p tsconfig.check.json --noEmit
pnpm lint → 0, oxlint: 2207 files, 0 errors, 3939 warnings
pnpm format:check → 0, All matched files use Prettier code style!
pnpm docs:check → 0, Validated local Markdown links in 75 files
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 1, 93 files passed, 1 failed. 1275 tests passed, 1 failed.
pnpm test:slow → 0, 2 files passed, 8 tests passed
```

## Investigation results

- On the synthetic OTA, the actual left-half rows are `[P1, M26]`, `[F1, M1, A1]`, `[C1, M21]` and `[S1]`. There is no row containing both `C1` and `M1`. Because `M21` is pinned, `C1` is the only free device in its row. The review's proposed equal-cost swap of `C1` and `M1` is unavailable. The routed NMOS input drains are 260 units from the axis and the output cascode drains are 190 units away. The fixture has ten crossings against a limit of four. Its rail, connectivity, geometry and label assertions pass.
- Ran the repository's quick evaluator on the local human gallery project `38m8wdesbh.json`. The selected layered result has four crossings, zero rail crossings, zero wires through symbols, and zero detected label or symbol overlaps. The human reference has two crossings.

## Deviations and open questions

- Resolving the synthetic fixture requires a plan decision on cross-row column alignment or row assignment. The specified same-row preference is implemented. The failing assertions and original fixture remain in place.
- A stage caller can supply a document containing only devices before symmetric folding begins. That candidate lacks the port instances needed to identify local gate ports. The full-document layered candidate used by the gallery evaluation receives those instances. Propagating the original document through the stage caller would require a change outside the owned paths.
