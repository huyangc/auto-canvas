# T154 report — round 1

Written by the reviewer from the implementer's final message (Opus subagent).

## Summary

All ten steps applied on `task/T154-deadcode-simulation`. `pnpm deadcode` exits 0
with both knip passes printing nothing, and CI runs it after `pnpm lint`. 85 files,
+528 / −5,628: 27 files deleted, 3 new, 55 edited. The persisted Project schema
files differ from `HEAD` only by the four named `export` keywords and the three
named type aliases; `migrateSimulationSetupToSource` and the compiler behind
`generateCircuitSource` are untouched.

## Steps

| Step                                                                      | Status | Notes                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Gallery mark (D4)                                                       | done   | `designExtractsNetlist` deleted; the doc block describes the rule `NETLIST_MARK_RULE_VERSION` versions; 2 subject cases deleted, 2 assertions re-expressed on `createDesignNetlistExport(...).status`, 11 duplicate mark lines dropped.                                                                                                                                      |
| 2 Unused exports with no test reader                                      | done   | `simulationLanguageHelp` unexported; `NGSPICE_LANGUAGE_REFERENCE`, `spiceScaleFactor`, `replaceSimulationExperimentConfig` and 3 type aliases deleted; 4 schemas unexported.                                                                                                                                                                                                 |
| 3 Circuit-source editing                                                  | done   | `planCircuitSourceEdit` and `CircuitParameterChange` deleted with `simulation-source-parameters.ts`; the six files rewritten against `planMappedProjectModelEdit` and fixed Project values; ranges asserted on retained output.                                                                                                                                              |
| 4 Native acquisition and editor helpers                                   | done   | 6 modules and 4 test files deleted; `simulationSignalNames` and the `requestedScope` filters gone; the ngspice `nativeTerminalCurrent`/`nativeDeviceOpVectors` and the `isVacaskStatement` re-export gone; tests re-expressed through compiled signals.                                                                                                                      |
| 5 VACASK `nativeTerminalCurrent` (D8)                                     | done   | Function kept, no longer exported; the collision case asserts `SIMULATION_CURRENT_SENSE_UNRESOLVED` from the compiler.                                                                                                                                                                                                                                                       |
| 6 Starter, folder builder, language help, library inspection, values (D8) | done   | Modules and tests deleted; `createSimulationFolder` removed from `@icm/model`, its body moved verbatim into `packages/model/src/simulation-folder.test-support.ts`; 33 test files and `e2e/hierarchy.spec.ts` repointed; the parity case moved to `simulation-ngspice-dut-interface.test.ts`; the printer half of `vacask-values.test.ts` moved to `vacask-printer.test.ts`. |
| 7 Topology correspondence (D2)                                            | done   | `topology-correspondence.ts` and its test, the similarity helpers, `topologyLabels`, `deviceOrigins`, `ElectricalDeviceOrigin`, `vertex`'s topology argument, the expanded-path parameters and `sourceSymbols` deleted; the two exact-graph cases kept.                                                                                                                      |
| 8 Fixed point                                                             | done   | Both knip passes exit 0 with empty output.                                                                                                                                                                                                                                                                                                                                   |
| 9 CI                                                                      | done   | `      - run: pnpm deadcode` directly after `      - run: pnpm lint`.                                                                                                                                                                                                                                                                                                        |
| 10 Format and verify                                                      | done   | Prettier over the changed files; the whole acceptance block run twice.                                                                                                                                                                                                                                                                                                       |

## Acceptance results

Implementer's runs (lane 1); the reviewer's rerun is in `review.md`.

```text
pnpm format:check → 0; pnpm docs:check → 0; pnpm typecheck → 0
pnpm lint → 0 (2148 files, 0 errors, 3844 warnings)
pnpm build → 0
pnpm test:local → 0; 834 files passed, 3 skipped (837); 8682 tests passed, 116 skipped (8798)
pnpm deadcode → 0 (both knip passes silent)
three generated-artifact checks → 0
three migration suites → 0 (9 tests)
schema-check.mjs → 0; agent-api hashes → 0; fixtures diff → 0
agent-api:artifacts:check → exit 1 with main's stale-fixture message, unchanged
27 deleted paths absent; createSimulationFolder absent from @icm/model; no product importer of the fixture
CI step directly after `pnpm lint` → 0
```

## Test cases

Ledger totals: **61 deleted, 35 rewritten, 465 untouched** in 50 test files. All
deleted titles verified absent; every kept assertion present. The reviewer
corrected the ledger's `equivalence.test.ts` row (2 rewritten, not 3) and the
plan's measured figures (see `review.md`).

## Deviations and open questions

- The moved fixture is imported with `../../model/src/…` / `./…` spelling rather
  than the trial patch's `../../../packages/model/src/…` (both are `../`-relative;
  typecheck, lint, tests and knip are green).
- The trial patch does not carry the three new files; the implementer authored
  them: the folder builder's body verbatim, and the two moved tests. The OTA case
  re-expresses the deleted signal table on `compileNgspiceSourceSimulation`'s
  retained vectors.
- The plan-mandated converted-VACASK message assertion (absent from the trial
  patch) is in the tree and passes.
- Not verified: the VACASK and ngspice execution cases stay skipped without the
  binaries.
