# T187 report — round 3

## Summary

Restored SG13G2 export diagnostic coverage and verified ordered bus connections on the IR returned by both SPICE and Spectre export. All 11 focused tests and every plan acceptance command passed.

## Steps

| Step | Status | Notes                                                                                                                                                            |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Done   | Earlier rounds removed the 20 retired execution compiler modules and their exports.                                                                              |
| 2    | Done   | Earlier rounds removed the 17 execution suites and four rawfile support and test files. Round 3 restored the SG13G2 design-export test from one of those suites. |
| 3    | Done   | Strengthened the retained design-export tests for bus hierarchy, migration, copying and slicing.                                                                 |
| 4    | Done   | The fixture and script cleanup was already on the task branch. The editor example, RNL export and compatibility corpus tests passed.                             |
| 5    | Done   | Typecheck and both Knip modes passed.                                                                                                                            |
| 6    | Done   | Re-ran all plan acceptance commands, the two reviewed suites and the migration and compatibility suites.                                                         |

## Review findings addressed

1. Relocated the simulator-independent test from `packages/netlist/src/sg13g2-simulation.test.ts` to `packages/netlist/src/reviewed-high-voltage.test.ts`. SPICE export diagnoses the out-of-range size on M1 and the unsupported HBT parameters `we` and `Nx` on Q1. The test compares the entire project with its pre-export snapshot.
2. The retired ngspice bus tests measured DC voltages through a generated deck. Their replacement in `packages/edit-engine/src/bus-netlist.test.ts` checks exported connectivity. It follows the positive terminals of V0–V3 to the ordered identity and reverse call pins, checks each output against pin 1 of its own load, and checks both ends of each child resistor against the ordered ports. The same assertions run after renaming, reordering and resizing the interface and after copying the transformed hierarchy into another project. The nested, reordered and range slices receive V2/V3, V1/V0 and V2/V3 respectively, with six distinct output loads.
3. Re-ran the requested checks and recorded their results below.

## Acceptance results

```text
pnpm format:check → 0, Prettier passed
pnpm docs:check → 0, local Markdown links validated in 74 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, 110 components and 106 Razavi symbol assets validated
pnpm typecheck → 0, no diagnostics
pnpm lint → 0, 2155 files, 0 errors and 3929 warnings
pnpm deadcode → 0, Knip and production Knip passed
pnpm build → 0, workspace build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/model packages/spice packages/devices packages/rnl apps/editor/src/examples/library-examples.test.ts → 0, 96 files passed, 1475 tests passed and 5 skipped
pnpm test:local packages/netlist/src/reviewed-high-voltage.test.ts packages/edit-engine/src/bus-netlist.test.ts → 0, 2 files and 11 tests passed
pnpm test:local packages/project-protocol/src/simulation-setup-migration.test.ts packages/project-protocol/src/raw-simulation-setup-migration.test.ts packages/project-protocol/src/compatibility-corpus.test.ts → 0, 3 files and 12 tests passed
```

## Investigation results

The per-file test results confirm four optional ngspice skips in netlist. Two belong to the block-supplies suite and one each to ideal-logic-gate-models and ideal-signal-block-models. The fifth skip belongs to the devices reviewed-external suite. All 29 RNL export-ops tests and all 15 editor library-example tests passed.

## Deviations and open questions

None.
