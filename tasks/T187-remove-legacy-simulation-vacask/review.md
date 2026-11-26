# T187 review

- Verdict: approved (round 5)
- Reviewer: coordinator (Antigravity)
- Reviewed commit base: `origin/main` (`b9f90e8e`)

## Review rounds resolved

- **Round 2**: Migrated 4 downstream test files (`netlist-code-edit.test.ts`, `netlist-process.test.ts`, `bus-netlist.test.ts`, `external-model-source.test.ts`) to retained export/model-source APIs and confirmed keeping the 4 optional ngspice electrical checks on surviving built-in block models.
- **Round 3 (PR #160 Codex P2 fixes — round 1)**:
  1. Restored the simulator-independent SG13G2 `createDesignNetlistExport` diagnostic test (previously `sg13g2-simulation.test.ts:10-75`) into `packages/netlist/src/reviewed-high-voltage.test.ts`.
  2. Strengthened `packages/edit-engine/src/bus-netlist.test.ts` (`expectCallWiring`, `expectBusPassWiring`) to assert exact ordered source-to-pin, child-resistor, and load-resistor connectivity across SPICE and Spectre exports for identity, reverse, migrated, copied, and sliced bus hierarchies.
- **Round 4 (PR #160 Codex P2 fixes — round 2)**:
  1. Asserted `slice_pass` child resistor endpoints (`R0`, `R1`) in both SPICE and Spectre exports in `packages/edit-engine/src/bus-netlist.test.ts`.
  2. Asserted all four transistor cards (`MN1`, `MN2`, `MP1`, `MP2`) inside `.subckt nor2` in `packages/netlist/src/gate-cell.test.ts`.
  3. Restored the implicit-ground-with-wired-VDD test case in `packages/netlist/src/implicit-mos-supplies.test.ts` via `createDesignNetlistExport`.
- **Round 5 (PR #160 Codex P2 fixes — round 3)**:
  1. Extended `packages/edit-engine/src/bus-netlist.test.ts` (`exportedCellLines`, `expectResistorWiring`, `expectCallWiring`) to assert ordered child resistor and subcircuit call lines in the emitted SPICE and Spectre text in addition to `exported.ir`.
  2. Asserted all four MOSFET cards (`M1`–`M4`) and tail resistor (`RT`) inside `.subckt ota` in `packages/netlist/src/gate-cell.test.ts`.
  3. Added a `createDesignNetlistExport` test in `packages/netlist/src/built-in-subcircuits.test.ts` asserting two `d-flip-flop` instances share a single `.subckt d_flip_flop` definition and preserve `VDD VSS D CK Q QBAR` call order.

## Checks run by reviewer

- `pnpm format:check` — exit 0
- `pnpm docs:check` — exit 0 (73 files)
- `pnpm typecheck` — exit 0
- `pnpm lint` — exit 0 (0 errors)
- `pnpm deadcode` — exit 0 (both `knip` and `knip --production` passed)
- `pnpm test:local packages/edit-engine/src/bus-netlist.test.ts packages/netlist/src/gate-cell.test.ts packages/netlist/src/built-in-subcircuits.test.ts` — exit 0 (all 90 tests passed)

## Findings

None.
