# T187 report — round 2

## Summary

All five review findings are resolved. The four downstream suites now exercise the retained netlist export and model-source APIs. All 95 tests in those suites and every plan acceptance command passed.

## Steps

| Step | Status | Notes                                                                                                                                                                |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Done   | Removed the 20 retired execution compiler modules and their exports in round 1.                                                                                      |
| 2    | Done   | Removed 17 execution test files and four rawfile support/test files. The RNL export suite still exercises the shared delay-cell fixture.                             |
| 3    | Done   | The 13 mixed netlist suites retain extraction, printing, model-source and structured planning coverage. Round 2 migrated the downstream suites listed in the review. |
| 4    | Done   | Removed the specified simulation fixtures, scripts, links and rawfile attributes. The editor example and compatibility corpus still pass.                            |
| 5    | Done   | Typecheck and both Knip modes pass after migrating the remaining compiler consumers.                                                                                 |
| 6    | Done   | Ran all acceptance commands, the four downstream suites, both migration suites and the compatibility corpus.                                                         |

## Review findings addressed

1. The editor model-body edit test re-exports the edited project and uses its locations to map the change from `3*gain` to `4*gain` to the owner. It also verifies that swapping the ports is rejected.
2. Removed the single process-selection test comparing exported cards with retired simulation cards. All remaining process-selection tests pass.
3. Bus tests assert distinct scalar outputs on the exported IR after reopening, migration, copying and slicing. They check the child subcircuit in printed SPICE and retain hierarchy-tracing assertions. Removed the optional four-case ngspice execution test and its deck and voltage-measurement scaffolding. Those cases measured DC voltages through a generated simulation deck.
4. Model-source tests check root-specific inclusion, mapped edits and draft refusal through design export. A saved draft changes only the pending-draft comment in exported text and produces a warning. The suite verifies native inspection and rendering, single emission, Spectre fallback, a located reserved-name conflict and the missing-implementation error. Removed engine-specific folder, hash and simulation source-map checks. The two-engine reachability test became one design-export test.
5. Re-ran the acceptance commands and checked individual suite results and skip locations.

## Acceptance results

```text
pnpm format:check → 0, all matched files use Prettier code style
pnpm docs:check → 0, validated local Markdown links in 74 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, validated 110 components and 106 Razavi symbol assets
pnpm typecheck → 0, no diagnostics
pnpm lint → 0, 2155 files, 0 errors, 3929 warnings
pnpm deadcode → 0, knip and knip --production passed
pnpm build → 0, workspace build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/model packages/spice packages/devices packages/rnl apps/editor/src/examples/library-examples.test.ts → 0, 96 files passed, 1474 tests passed, 5 skipped
pnpm test:local apps/editor/src/features/netlist-export/netlist-code-edit.test.ts apps/editor/src/features/netlist-export/netlist-process.test.ts packages/edit-engine/src/bus-netlist.test.ts packages/edit-engine/src/external-model-source.test.ts → 0, 4 files and 95 tests passed
pnpm test:local packages/project-protocol/src/simulation-setup-migration.test.ts packages/project-protocol/src/raw-simulation-setup-migration.test.ts packages/project-protocol/src/compatibility-corpus.test.ts → 0, 3 files and 12 tests passed
```

## Investigation results

The combined suite’s per-test results show 904 passing netlist tests and four optional ngspice checks skipped across the three files listed in the plan. The fifth skip belongs to the devices package’s reviewed-external library comparison. All 29 RNL export-ops tests and all 15 editor library-example tests passed.

## Deviations and open questions

None. The review’s explicit four-file scope covered the downstream test migrations. The full repository test run remains assigned to the coordinator.
