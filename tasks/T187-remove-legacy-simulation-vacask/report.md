# T187 report — round 4

## Summary

Closed the three round 4 coverage gaps in the design-export tests. The tests now check both lanes inside the sliced-bus child, all four transistor cards in the Cell-bound NOR gate, and implicit ground propagation alongside a wired VDD port.

## Steps

| Step | Status | Notes                                                                                                                                                            |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Done   | Earlier rounds removed the 20 retired compiler modules and their exports.                                                                                        |
| 2    | Done   | Earlier rounds removed the 17 simulator-execution suites and four rawfile test and support files. The retired execution and rawfile APIs have no active callers. |
| 3    | Done   | Round 4 restored design-export coverage for the three cases below. The SG13G2 diagnostics and whole-bus wiring checks from round 3 also passed.                  |
| 4    | Done   | Earlier rounds removed the execution fixtures and scripts. The editor example and RNL export suites passed with their retained fixtures.                         |
| 5    | Done   | Typecheck and both Knip modes passed.                                                                                                                            |
| 6    | Done   | Ran every plan acceptance command, the three focused suites, and the migration and compatibility suites.                                                         |

## Review findings addressed

1. In `bus-netlist.test.ts`, each SPICE and Spectre export now checks R0 and R1 against their ordered input and output ports inside `slice_pass`. Swapping the child lanes fails even if the parent calls remain correctly wired.
2. In `gate-cell.test.ts`, the SPICE test reads the body of `.subckt nor2` and checks the four MOS cards, including model, bulk connection, length and width. It captures the generated internal net from MP1 and requires MP2 to use that same net.
3. In `implicit-mos-supplies.test.ts`, restored the explicit-VDD fixture from the base revision. The design export must be ready, emit `X1 VDD VSS dut`, declare those same child ports in order, and connect both NMOS bodies to VSS. A pre-export snapshot verifies the project survives export unchanged.

## Acceptance results

```text
pnpm format:check → 0, Prettier passed
pnpm docs:check → 0, validated local Markdown links in 74 files
pnpm agent-docs:generated:check → 0, 6 outputs and 0 stale
pnpm components:check → 0, 110 components and 106 Razavi symbol assets validated
pnpm typecheck → 0, no diagnostics
pnpm lint → 0, 2155 files, 0 errors and 3929 warnings
pnpm deadcode → 0, Knip and production Knip passed
pnpm build → 0, workspace build completed with a Vite chunk-size warning
pnpm test:local packages/netlist packages/model packages/spice packages/devices packages/rnl apps/editor/src/examples/library-examples.test.ts → 0, 96 files passed, 1476 tests passed and 5 skipped
pnpm test:local packages/edit-engine/src/bus-netlist.test.ts packages/netlist/src/gate-cell.test.ts packages/netlist/src/implicit-mos-supplies.test.ts → 0, 3 files and 24 tests passed
pnpm test:local packages/project-protocol/src/simulation-setup-migration.test.ts packages/project-protocol/src/raw-simulation-setup-migration.test.ts packages/project-protocol/src/compatibility-corpus.test.ts → 0, 3 files and 12 tests passed
```

## Investigation results

The four optional netlist electrical checks require ngspice. The fifth optional check, in the devices reviewed-external suite, requires the external standard-cell SPICE library. The round 4 cases exercise exported circuit topology through the design-export API.

## Deviations and open questions

None.
