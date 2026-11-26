# T174 report — round 1

## Summary

Transparent single-device subcircuits now display the wrapped device's built-in symbol on callers. The caller retains its child document binding, positional pin connections and SI parameter values. Auto-layout uses the bound child document to distinguish device families.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                           |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Resolved direct and nested wrappers after library filtering. Recovery requires complete, distinct pin connections and exact imported port names. Cycles terminate and ineligible calls keep their existing symbol.                              |
| 2    | done   | Added child document identity to auto-layout family matching.                                                                                                                                                                                   |
| 3    | done   | Documented the wrapper eligibility and binding rules in the SPICE frontend specification.                                                                                                                                                       |
| 4    | done   | Added import coverage for reviewed MOS and PNP devices, primitive and model devices, nested wrappers, reordered ports, bulk defaults and the rejection cases. Verified export and re-import for both fixed-size and parameterized MOS wrappers. |

## Review findings addressed

Round 1 had no review file.

## Acceptance results

```text
pnpm build → 0. apps/editor build: Done. Vite reported a chunk-size warning.
pnpm typecheck → 0. tsc -p tsconfig.check.json --noEmit
pnpm lint → 0. oxlint: 2203 files, 0 errors, 3912 warnings
pnpm format:check → 0. All matched files use Prettier code style!
pnpm docs:check → 0. Validated local Markdown links in 75 files
pnpm vitest run packages/spice packages/netlist packages/derived packages/auto-layout → 0. 208 files passed, 1 skipped. 2886 tests passed, 109 skipped.
pnpm vitest run packages/spice/src/import-reviewed-symbol.test.ts -t '#1450' → 0. 1 test passed, 9 excluded by the name filter.
```

A separate check of the parameterized MOS wrapper fixture using the project symbol resolver, connectivity index and `runErcChecks` returned zero findings.

## Investigation results

The plan listed no investigation steps.

## Deviations and open questions

- The graph comparator's success result is `equal`. It confirms equality across the fixed-size round trip. Its graph builder declines parameterized hierarchies, so the parameterized test checks every exported subcircuit declaration and device card, including expressions and SI overrides, and verifies equal topology after re-import.
- Source binding rejects a caller with the wrong terminal count before producing a project. Tests cover that diagnostic and exercise the hierarchical fallback through direct IR import. For mutually recursive wrappers, project validation reports a hierarchy cycle after symbol resolution terminates.
