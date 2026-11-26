# T187 — Remove legacy simulation/VACASK/ngspice compilers, skipped simulator tests, and dead simulation fixtures

- Branch: `task/T187-remove-legacy-simulation-vacask`
- Base: `main` at `51990353`
- Status: approved
- Plan review: self-checked against the code (user requested coordinator plan + Codex implementation + review)

## Goal

Remove the retired ngspice/VACASK simulation-execution compilers, rawfile parsers, skipped simulator-execution tests, and simulation-only fixtures from `packages/netlist/`, `fixtures/`, `netlists/`, and `.gitattributes` — cutting ~10,000+ lines of dead simulation code and eliminating the ~109 permanently skipped ngspice/VACASK tests — while strictly preserving:

1. Active SPICE/Spectre/RNL netlist extraction, printing, and model-source authoring (`extract*`, `export*`, `printers*`, `project-model-source*`, `model-source-*`, `vacask-source.ts`, `vacask-project-model.ts`, `vacask-printer.ts`, `source-waveform.ts`, `simulation-ngspice-source-parameters.ts`, `built-in-bodies.ts`, `instance-source.ts`).
2. `project.simulationFolders` round-tripping and legacy schema-48 → 49 migration (`migrateSimulationSetupToSource` in `simulation-source-migration.ts`, backed by `simulation-compile.ts` and `simulation-source-graph.ts`), as required by `docs/specs/agent-api.md` and `fixtures/projects/compatibility-corpus.json`.

## Context

Verified by static reachability analysis against `origin/main` at `51990353`:

- **20 unreachable simulation/VACASK compiler modules in `packages/netlist/src/`** (zero callers from active netlist extraction/export, model-source authoring, `apps/editor`, `packages/rnl`, `packages/auto-layout`, or `migrateSimulationSetupToSource`):
  - `authored-circuit-scopes.ts`
  - `simulation-circuit-source.ts`
  - `simulation-diagnostic.ts`
  - `simulation-native-collection.ts`
  - `simulation-native-current.ts`
  - `simulation-native-devices.ts`
  - `simulation-ngspice-devices.ts`
  - `simulation-ngspice-name-diagnostics.ts`
  - `simulation-parameter-target.ts`
  - `simulation-signal-names.ts`
  - `simulation-source-compile.ts`
  - `simulation-source-map.ts`
  - `simulation-source-ngspice.ts`
  - `simulation-source-projection.ts`
  - `simulation-source-scopes.ts`
  - `vacask-model-symbols.ts`
  - `vacask-run-temperature.ts`
  - `vacask-run-variables.ts`
  - `vacask-source-scopes.ts`
  - `vacask-statement.ts`
- **7 retained simulation/VACASK-adjacent modules in `packages/netlist/src/`** (still needed by active paths):
  - `simulation-source-migration.ts`, `simulation-compile.ts`, `simulation-source-graph.ts` (schema 48 → 49 migration via `packages/project-protocol/src/transforms/simulation-source.ts`).
  - `vacask-source.ts`, `vacask-project-model.ts`, `vacask-printer.ts` (project model-source parsing/printing via `project-model-source.ts`, `model-source-variant.ts`, `model-source-syntax.ts`).
  - `simulation-ngspice-source-parameters.ts` and `source-waveform.ts` (used by `extract-device.ts`, `printed-card.ts`, `vacask-project-model.ts`).
  - `SimulationSourceLocation` is defined in `project-model-source.ts:823` (NOT `simulation-source-map.ts`) and remains intact for `apps/editor`.
- **Test files in `packages/netlist/src/`**:
  - **17 pure simulation/VACASK-execution test files + 4 rawfile test-support files** to delete:
    - `delay-cell-acceptance.test.ts` (**KEEP** `delay-cell-fixture.test-support.ts` — actively imported by `packages/rnl/src/export-ops.test.ts:25`!)
    - `model-contract-acceptance.test.ts`
    - `ngspice-ota-qualification.test.ts`
    - `sg13g2-simulation.test.ts`
    - `simulation-circuit-source.test.ts`
    - `simulation-external-vacask.test.ts`
    - `simulation-native-current.test.ts`
    - `simulation-native-devices.test.ts`
    - `simulation-native.test.ts`
    - `simulation-ngspice-dut-interface.test.ts`
    - `simulation-source-compile.test.ts`
    - `simulation-source-map.test.ts`
    - `simulation-source-projection.test.ts`
    - `simulation-source-scopes.test.ts`
    - `simulation-source-vacask.test.ts`
    - `vacask-run-temperature.test.ts`
    - `vacask-source-scopes.test.ts`
    - `test-support/rawfile.ts`, `test-support/rawfile.test.ts`, `test-support/vacask-rawfile.ts`, `test-support/vacask-rawfile.test.ts`
  - **13 surviving test files** that also contain isolated sub-tests importing deleted simulation compilers or rawfile parsers:
    - `built-in-subcircuits.test.ts`, `canonical-design-netlist.test.ts`, `controlled-current.test.ts`, `gate-cell.test.ts`, `generic-bjt-model.test.ts`, `generic-diode-model.test.ts`, `ideal-comparator.test.ts`, `implicit-mos-supplies.test.ts`, `reviewed-high-voltage.test.ts`, `undefined-generic-model.test.ts`, `simulation-compile.test.ts`, `vacask-printer.test.ts`, `vacask-source.test.ts`.
    - In each of these 13 files, remove ONLY the dead simulation-compiler / ngspice / VACASK-rawfile sub-tests and imports; keep all netlist extraction, SPICE/Spectre export, model-source, and `buildSimulationPlan` tests intact.
- **Dead fixtures & scripts**:
  - `fixtures/ngspice-rawfile/**`: only used by deleted `test-support/rawfile.test.ts`.
  - `fixtures/simulation-acceptance/hosted-sky130-*.json` (3 files): zero active consumers. **KEEP** `fixtures/simulation-acceptance/ota-5t.spi` (used by `apps/editor/src/examples/library-examples.test.ts:546`)!
  - `netlists/ideal-analog-blocks/**` (calls deleted `generateCircuitSource` and runs `ngspice`), `netlists/sg13g2-qualification/**` (only used by deleted `sg13g2-simulation.test.ts`), and all 9 `netlists/vacask-*/**` directories (`vacask-agent-divider`, `vacask-custom-model`, `vacask-device-outputs`, `vacask-divider`, `vacask-profile-section`, `vacask-rc`, `vacask-resistor-noise`, `vacask-sky130`, `vacask-temperature`).
  - `.gitattributes`: remove lines 22–40 (VACASK `.raw` rules + comment); leave lines 41–47 untouched (owned by T184).
  - **KEEP** all `*.icproj.json` files listed in `fixtures/projects/compatibility-corpus.json` (`netlists/ngspice-ota-qualification/source.icproj.json`, `netlists/native-ota-library/legacy-source.icproj.json`, `netlists/native-ota/source.icproj.json`) and `netlists/native-common-source/circuit.spi` (used by `packages/spice/src/import-project-name.test.ts:30`)!
  - `scripts/lib/native-starter-report.py`: only linked from `netlists/native-{ota,ota-library,common-source,rc-filters,rlc-filter}/README.md`. Delete `scripts/lib/native-starter-report.py` and remove the dead links to `native-starter-report.py` and `../vacask-sky130/` in those `netlists/native-*/README.md` files if present so markdown link checks stay clean.
- **Transitive Knip export cleanups expected**:
  - Deleting the 20 files in `packages/netlist/src/` will make some exports in `packages/netlist/src/` (e.g. `source-file-graph.ts`, `vacask-source.ts`, `vacask-printer.ts`, `simulation-compile.ts`, `terminal-current-instrumentation.ts`, `index.ts`) and in `packages/{model,spice,devices,derived}/src/` (e.g. `isSimulationInputPath`, `SimulationRunVariant*`, `SIMULATION_NOISE_*_DENSITY_ID`, `readSimulationExperimentConfig`, `locateSpiceParameterValues`, `standardCellLibraryOfName`) unused or test-only under `pnpm deadcode`. Clean them cleanly (drop `export` if module-local/unused, delete dead helpers, or tag test-only contract exports `@internal` with a concise reason per `knip.config.js`).

## Scope

Owned paths (may be created, edited or deleted):

- `packages/netlist/src/**`
- `packages/model/src/**` (only for exports/helpers made unused or test-only by removing the dead simulation modules)
- `packages/spice/src/**` (only for exports made unused or test-only by removing the dead simulation modules)
- `packages/devices/src/**` (only for exports made unused or test-only by removing the dead simulation modules)
- `packages/derived/src/**` (only for exports made unused or test-only by removing the dead simulation modules)
- `fixtures/ngspice-rawfile/**`
- `fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json`
- `fixtures/simulation-acceptance/hosted-sky130-extended-devices-v1.json`
- `fixtures/simulation-acceptance/hosted-sky130-hvt-pfet-v1.json`
- `netlists/ideal-analog-blocks/**`
- `netlists/sg13g2-qualification/**`
- `netlists/vacask-agent-divider/**`
- `netlists/vacask-custom-model/**`
- `netlists/vacask-device-outputs/**`
- `netlists/vacask-divider/**`
- `netlists/vacask-profile-section/**`
- `netlists/vacask-rc/**`
- `netlists/vacask-resistor-noise/**`
- `netlists/vacask-sky130/**`
- `netlists/vacask-temperature/**`
- `netlists/native-common-source/README.md`
- `netlists/native-ota/README.md`
- `netlists/native-ota-library/README.md`
- `netlists/native-rc-filters/README.md`
- `netlists/native-rlc-filter/README.md`
- `scripts/lib/native-starter-report.py`
- `.gitattributes` (lines 22–40 only)
- `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`
- `apps/editor/src/features/netlist-export/netlist-process.test.ts`
- `packages/edit-engine/src/bus-netlist.test.ts`
- `packages/edit-engine/src/external-model-source.test.ts`
- `tasks/T187-remove-legacy-simulation-vacask/report.md`

Out of scope (do not change):

- `fixtures/simulation-acceptance/ota-5t.spi` (used by `apps/editor/src/examples/library-examples.test.ts`)
- `packages/netlist/src/delay-cell-fixture.test-support.ts` (used by `packages/rnl/src/export-ops.test.ts`)
- `fixtures/projects/compatibility-corpus.json`, `netlists/ngspice-ota-qualification/source.icproj.json`, `netlists/native-ota-library/legacy-source.icproj.json`, `netlists/native-ota/source.icproj.json`, `netlists/native-common-source/circuit.spi`
- `packages/project-protocol/**` (keep schema 48 → 49 migration and all compatibility corpus witnesses passing unchanged)
- `apps/editor/**` (keep all editor code and example tests passing unchanged)
- `.gitattributes` lines 41–49 (owned by T184)
- `package.json`, `pnpm-lock.yaml`

## Steps

1. Delete the 20 unreachable simulation/VACASK compiler source files in `packages/netlist/src/` (`authored-circuit-scopes.ts`, `simulation-circuit-source.ts`, `simulation-diagnostic.ts`, `simulation-native-collection.ts`, `simulation-native-current.ts`, `simulation-native-devices.ts`, `simulation-ngspice-devices.ts`, `simulation-ngspice-name-diagnostics.ts`, `simulation-parameter-target.ts`, `simulation-signal-names.ts`, `simulation-source-compile.ts`, `simulation-source-map.ts`, `simulation-source-ngspice.ts`, `simulation-source-projection.ts`, `simulation-source-scopes.ts`, `vacask-model-symbols.ts`, `vacask-run-temperature.ts`, `vacask-run-variables.ts`, `vacask-source-scopes.ts`, `vacask-statement.ts`) and remove their `export *` lines from `packages/netlist/src/index.ts`.
2. Delete the 17 pure simulation/VACASK-execution test files (`delay-cell-acceptance.test.ts`, `model-contract-acceptance.test.ts`, `ngspice-ota-qualification.test.ts`, `sg13g2-simulation.test.ts`, `simulation-circuit-source.test.ts`, `simulation-external-vacask.test.ts`, `simulation-native-current.test.ts`, `simulation-native-devices.test.ts`, `simulation-native.test.ts`, `simulation-ngspice-dut-interface.test.ts`, `simulation-source-compile.test.ts`, `simulation-source-map.test.ts`, `simulation-source-projection.test.ts`, `simulation-source-scopes.test.ts`, `simulation-source-vacask.test.ts`, `vacask-run-temperature.test.ts`, `vacask-source-scopes.test.ts`) and the 4 rawfile test-support files (`packages/netlist/src/test-support/{rawfile,vacask-rawfile}{.ts,.test.ts}`). Keep `packages/netlist/src/delay-cell-fixture.test-support.ts`.
3. Update the 13 surviving test files in `packages/netlist/src/` (`built-in-subcircuits.test.ts`, `canonical-design-netlist.test.ts`, `controlled-current.test.ts`, `gate-cell.test.ts`, `generic-bjt-model.test.ts`, `generic-diode-model.test.ts`, `ideal-comparator.test.ts`, `implicit-mos-supplies.test.ts`, `reviewed-high-voltage.test.ts`, `undefined-generic-model.test.ts`, `simulation-compile.test.ts`, `vacask-printer.test.ts`, `vacask-source.test.ts`) to remove ONLY the imports and test cases that depended on the deleted simulation compilers or rawfile parsers, keeping every netlist extraction, SPICE/Spectre export, model-source, and `buildSimulationPlan` assertion intact.
4. Delete dead simulation fixtures and scripts:
   - Delete `fixtures/ngspice-rawfile/` (all files).
   - Delete `fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json`, `hosted-sky130-extended-devices-v1.json`, and `hosted-sky130-hvt-pfet-v1.json` (KEEP `fixtures/simulation-acceptance/ota-5t.spi`).
   - Delete `netlists/ideal-analog-blocks/`, `netlists/sg13g2-qualification/`, and all 9 `netlists/vacask-*/` directories.
   - Delete `scripts/lib/native-starter-report.py` and remove dead links to `native-starter-report.py` and `../vacask-sky130/` in `netlists/native-{common-source,ota,ota-library,rc-filters,rlc-filter}/README.md`.
   - Remove lines 22–40 (VACASK `.raw` rules + comment) from `.gitattributes`, leaving lines 41–49 untouched.
5. Run `pnpm typecheck` and `pnpm deadcode` (`knip` and `knip --production`). Clean up every export, type, or dead internal helper in `packages/{netlist,model,spice,devices,derived}/src/` that became unused or test-only as a consequence of steps 1–4:
   - Drop unused re-exports in `packages/netlist/src/index.ts` (for example, re-export only what external packages actually import from `simulation-compile.ts`, `simulation-source-graph.ts`, `vacask-printer.ts`, `vacask-source.ts`).
   - Remove genuinely dead functions/types or drop `export` on module-local helpers (e.g. `reachableCircuitBindings` in `source-file-graph.ts`, `inspectVacaskSourceGraph` in `vacask-source.ts`, `isSimulationInputPath` in `packages/model/src/schema/simulation.ts`, etc.).
   - Tag retained test-only contract helpers (e.g. `readSimulationExperimentConfig`, `locateSpiceParameterValues`, `standardCellLibraryOfName`, `printVacaskWithLocations` if only tested) with `/** @internal ... */` per `knip.config.js` so existing unit tests stay intact without weakening coverage.
6. Run the acceptance commands below and write `tasks/T187-remove-legacy-simulation-vacask/report.md` following `tasks/_template/report.md` (documenting deleted simulator-execution tests per `docs/testing/README.md`).

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm format:check              # expected: exit 0
pnpm docs:check                # expected: exit 0
pnpm agent-docs:generated:check # expected: exit 0
pnpm components:check          # expected: exit 0
pnpm typecheck                 # expected: exit 0
pnpm lint                      # expected: exit 0
pnpm deadcode                  # expected: exit 0
pnpm build                     # expected: exit 0
pnpm test:local packages/netlist packages/model packages/spice packages/devices packages/rnl apps/editor/src/examples/library-examples.test.ts # expected: exit 0
```

Behavioral checks:

- `packages/netlist` runs with only the 4 surviving optional ngspice electrical checks on built-in block models (`block-supplies.test.ts`, `ideal-logic-gate-models.test.ts`, `ideal-signal-block-models.test.ts`), down from ~109 skipped tests.
- `apps/editor/src/examples/library-examples.test.ts` still passes (proving `fixtures/simulation-acceptance/ota-5t.spi` is preserved).
- `packages/rnl/src/export-ops.test.ts` still passes (proving `delay-cell-fixture.test-support.ts` is preserved).
- `packages/project-protocol/src/simulation-setup-migration.test.ts` and `packages/project-protocol/src/raw-simulation-setup-migration.test.ts` still pass (proving schema 48 → 49 migration via `migrateSimulationSetupToSource` still works).
- Note: `packages/project-protocol/src/compatibility-corpus.test.ts` uses `git ls-files` (outside sandbox), so the coordinator will run the full `pnpm test:local` suite during review.

## Notes for the implementer

- Do NOT delete `fixtures/simulation-acceptance/ota-5t.spi`, `packages/netlist/src/delay-cell-fixture.test-support.ts`, or any `*.icproj.json` tracked in `fixtures/projects/compatibility-corpus.json`.
- Do NOT touch `packages/project-protocol/**`, `apps/editor/**`, `package.json`, `pnpm-lock.yaml`, or lines 41–49 of `.gitattributes`.
- Do NOT commit; leave changes in the working tree on `task/T187-remove-legacy-simulation-vacask`.
- Preserve all non-simulation netlist extraction/export/model-source tests in the 13 modified test files in `packages/netlist/src/`.
