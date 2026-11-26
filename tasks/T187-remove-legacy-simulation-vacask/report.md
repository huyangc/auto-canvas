# T187 report — round 5

## Summary

The three round 5 regression tests check the text returned by `createDesignNetlistExport`. They cover hierarchical bus wiring in SPICE and Spectre, the internal topology of the Cell-bound OTA, and two D flip-flop instances sharing one SPICE definition.

## Steps

| Step | Status | Notes                                                                                                                                                                        |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Done   | Earlier rounds removed the 20 retired compiler modules and their exports.                                                                                                    |
| 2    | Done   | Earlier rounds removed the 17 execution suites and four rawfile test and support files with their retired APIs. Active export contracts retain coverage in the suites below. |
| 3    | Done   | Round 5 strengthened export assertions in the three test files named in the review.                                                                                          |
| 4    | Done   | Earlier rounds removed simulator-only fixtures and scripts. The editor example, RNL exports and compatibility corpus passed with the retained fixtures.                      |
| 5    | Done   | Typecheck and both Knip modes passed.                                                                                                                                        |
| 6    | Done   | Ran all nine plan acceptance commands, the round 5 focused tests, and the migration and corpus tests.                                                                        |

## Review findings addressed

1. The bus tests retain the IR assertions and read the emitted cards within the parent and child subcircuit boundaries. Both dialects must declare ports in order, connect each child resistor to its two expected ports, and print each parent call with the expected source and load nets. The checks run for identity, reverse, migrated, copied and sliced hierarchies.
2. The OTA test captures the SPICE body with its exact interface. It checks M1 through M4 and RT, including model and component parameters. The mirror and tail nets must be distinct and recur at the expected device terminals.
3. The repeated D flip-flop test requires a ready export, exactly one definition of d_flip_flop and two complete call lines. Each call must connect the supplies followed by its own D, CK, Q and QBAR nets in order.

## Acceptance results

```text
pnpm format:check → 0, all matched files passed
pnpm docs:check → 0, validated local Markdown links in 73 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, 110 components and 106 Razavi symbol assets validated
pnpm typecheck → 0, no diagnostics
pnpm lint → 0, 2142 files, 0 errors and 3929 warnings
pnpm deadcode → 0, Knip and production Knip passed
pnpm build → 0, workspace build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/model packages/spice packages/devices packages/rnl apps/editor/src/examples/library-examples.test.ts → 0, 96 files passed, 1477 tests passed and 5 skipped
pnpm test:local packages/edit-engine/src/bus-netlist.test.ts packages/netlist/src/gate-cell.test.ts packages/netlist/src/built-in-subcircuits.test.ts → 0, 3 files and 90 tests passed
pnpm test:local packages/project-protocol/src/simulation-setup-migration.test.ts packages/project-protocol/src/raw-simulation-setup-migration.test.ts packages/project-protocol/src/compatibility-corpus.test.ts → 0, 3 files and 12 tests passed
```

## Investigation results

Four optional netlist electrical checks require ngspice. The fifth skipped test, in the devices reviewed-external suite, requires the standard-cell SPICE library configured by `ICM_STD_CELL_SPICE`.

## Deviations and open questions

None.
