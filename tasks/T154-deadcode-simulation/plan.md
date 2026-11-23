# T154 — Dead code, slice B: simulation remnants in `packages/netlist`; CI runs `pnpm deadcode`

- Branch: `task/T154-deadcode-simulation`
- Base: `main` at `a97ce3d` (T153 and PR 106 merged)
- Status: approved (owner, 2026-11-23: D2 delete; one PR incl. the CI gate; test-only product code is
  deleted with the test cases whose subject it is — no tags, no test-support home for product code. Measured
  consequence: the folder builder becomes test code in `simulation-folder.test-support.ts` so that 94 cases
  of live behaviour keep their only tests; see `tmp/deadcode/t154-owner-rule.md`'s context in Context)
- Plan review: codex gpt-6.2-astra, 6 rounds, approved (r1: 1 P1, 5 P2, 2 P3; r2: 2 P1; r3: approved; r4: 2 P1
  after the owner's answers; r5: 1 open item; r6: approved — raw output in `logs/plan-review-r1.txt` … `r6.txt`)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`, `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
- Follows: T153 (`tasks/T153-deadcode-cleanup/plan.md`, outline at its end; plan review r1 finding 3).
  Test ledger: [`test-ledger.md`](test-ledger.md); schema checker: [`schema-check.mjs`](schema-check.mjs).

## Decisions for the owner

Decided by the owner:

1. **D2 — topology correspondence: delete.** `compareTopologyCorrespondence` and the topology-similarity helpers
   it alone used in `equivalence.ts` (`matchElectricalTopologies`, `electricalGraphTopologySimilarity`, the
   matcher's `preference` ordering and returned `mapping`) have no product caller, nor does anything only they read:
   `compareElectricalTopologies`, `topologyGraph`, `topologyLabels` with the `topologyLabel`/`vertex` topology
   argument, and `deviceOrigins` with `ElectricalDeviceOrigin` (read only by `topology-correspondence.ts` and the
   test that moved with it). Production reads only `compareElectricalGraphs`
   (`apps/editor/src/features/netlist-export/rnl-import.ts:132,205`, `apps/editor/e2e/rnl-interchange.spec.ts`).
   All of them go.
2. **D4 — `designExtractsNetlist`: delete it and its test code** ("如果主功能没用的话，测试代码也删掉"). The function
   (a two-line wrapper over `createDesignNetlistExport` + `unfinishedDrawingDiagnostics`, both product) has no
   product caller. Measured: 15 call sites in 5 test files — 2 cases have the mark as their subject (deleted),
   2 assertions are its only statement of a live rule and move to `createDesignNetlistExport`'s status, the other
   11 duplicate a live assertion the case already makes (call dropped). No test-support file.
3. **D8 — code used only by tests goes with its tests** ("只有测试用的代码，一律把测试用例一并删掉"). Measured per
   symbol:
   - VACASK `nativeTerminalCurrent` has a same-file product caller (`nativeTerminalSignals`, reached by
     `compileSourceSimulation` from `generateCircuitSource`'s `input` branch), so the function stays product
     code and only its `export` (and the re-export at `simulation-native-devices.ts:23`) goes. The 3 cases that
     called it directly keep their subject and re-express the 5 expectations through
     `compileSourceSimulation(...).signals`.
   - `createSimulationFolder` has **no product caller** once `simulation-starter.ts` (its only non-test caller)
     is deleted: it is deleted from `packages/model` and its 2 subject cases with it. Its 94 fixture uses in 33
     files keep their cases: the folder builder moves, as test code, into
     `packages/model/src/simulation-folder.test-support.ts`, so those files change one import line and no case
     body (`test-ledger.md` lists the exceptions). The 5 template-subject cases the previous revision kept are
     deleted (their subject is the fixture's text); one of them asserted compiler/export parity, and that case
     stays as `simulation-ngspice-dut-interface.test.ts`.
4. **Simulation compiler: keep** (earlier owner decision). `generateCircuitSource` stays, with the
   `netlists/*/verify.mjs` knip entries. The full compiler branches behind it remain reachable only statically;
   what the owner's rule implies for them beyond this task is measured in `tmp/deadcode/t154-owner-rule.md`
   section D (≈3,079 source lines behind `generateCircuitSource`'s never-supplied `input`); not planned here.
5. **CI.** `- run: pnpm deadcode` goes into `.github/workflows/ci.yml` directly after `pnpm lint`. One PR.
6. **Follow-ups outside this task** (test-only exports found while measuring, which the rule would also retire;
   not deleted here): `IDEAL_LOGIC_TARGETS`, `spiceIdealLogicSubcircuit`
   (`packages/netlist/src/ideal-logic-gate-models.ts`), `IDEAL_SIGNAL_TARGETS`, `spiceIdealSignalSubcircuit`
   (`packages/netlist/src/ideal-signal-block-models.ts`), `SimulationStructuredSetup`, `SimulationRawSetup`
   (`packages/model/src/schema/types.ts`).

## Goal

`pnpm deadcode` exits 0 on the branch — both knip passes report no finding and no hint and print nothing — and
CI runs it after `pnpm lint`. The code removed is the simulation authoring that the fork's simulation UI used
(T006/T007: new-experiment starter and its folder builder, save/parameter editors, VACASK language help and
post-processing, source-parameter editing of generated Circuit source, signal-name tables and their unused scope
filter, model-library inspection and its conditional-candidate mode) plus Gallery leftovers (topology
correspondence, the extractability mark). No product code is kept alive for tests: the two functions that had
only test callers are deleted, and what remains (VACASK `nativeTerminalCurrent`) is product code that simply
loses its `export`. Kept unchanged: the persisted Project format (four `export` keywords and three unused type
aliases only), legacy-Project migration, the Agent API and its generated artifacts, netlist export/import,
shared-model edits from the Code panel, and the simulation compiler. No user-visible behavior changes.

## Context

Verified on `a97ce3d` (this worktree; trial applied, measured and reverted).

- **Knip on `main`.** `node tasks/T153-deadcode-cleanup/knip-expect.mjs` passes: the default pass reports
  20 exports + 3 types, the production pass 32 exports + 3 types (frozen in
  `tasks/T153-deadcode-cleanup/knip-expected.json`), all under `packages/model/src/{schema,simulation-source-authoring.ts}`,
  `packages/netlist/src` and `packages/spice/src/{expression,simulation-language}.ts`. PR 106 added none.
  `pnpm deadcode` exits 1 (the first pass fails, so the second never runs).
- **What reaches the simulation code in the product.** Outside `packages/netlist`, product code imports only
  `SimulationSourceLocation`, `SimulationSourceDiagnostic` (types; editor model-source editors, `edit-engine`),
  `planMappedProjectModelEdit` (`apps/editor/src/features/netlist-export/netlist-code-edit.ts:175`; defined at
  `packages/netlist/src/project-model-source.ts:743` — the retired `planCircuitSourceEdit` delegated model-body
  edits to it), `projectElectricalGraph`/`compareElectricalGraphs` (`rnl-import.ts:3-5,127`),
  `readSimulationExperimentConfig` and `migrateSimulationSetupToSource`
  (`packages/project-protocol/src/transforms/simulation-source.ts:43`, legacy loading).
  `createSimulationFolder`'s only non-test caller is `simulation-starter.ts` (`:42,56,75`), deleted here; its
  other callers are 34 test files. Migration reaches `buildSimulationPlan` (`simulation-compile.ts`),
  `inspectSimulationSourceGraph` (`simulation-source-graph.ts`) and `unquoteSimulationToken`
  (`packages/spice/src/simulation-language.ts:427`, which step 2 does not touch). `generateCircuitSource` is
  reached from `netlists/ideal-analog-blocks/verify.mjs:86` (knip entry), which pulls in
  `simulation-source-compile.ts`, `simulation-source-ngspice.ts` and the native device/current modules.
  Everything this plan deletes is reachable from none of these (knip, both passes, at the fixed point below).
- **Code knip cannot judge.** Unused parameters, optional fields, result members and JSON fixtures are not
  exports, so knip does not flag them. Four became unconsumed and were checked by grep: (a) `matchElectricalGraphs`'
  `preference` parameter and its result's `mapping` — no caller passes or reads them (`compareElectricalGraphs`
  and `compareElectricalTopologies` use only the status) → deleted with D2; the graph's `deviceOrigins`,
  `topologyLabels` and the topology-only comparison are read only by the deleted correspondence and its moved test
  → deleted too; (b) the `conditionalCandidates` mode of `primitiveModels`
  (`authored-circuit-scopes.ts:95`) — only the deleted `authoredModelSymbols` passed `true`; the resolver's other
  caller (`simulation-native-devices.ts:128`) and its tests pass one argument → deleted; (c) the `requestedScope`
  filter of `simulationSignals` (`simulation-signal-names.ts:21`) — only the deleted voltage picker passed it;
  the compiler (`simulation-source-compile.ts:589`) and `simulation-source-compile.test.ts:425` pass two
  arguments → deleted; (d) `packages/netlist/src/test-support/{sky130,sg13g2}-profile.json` — read only by
  `simulation-starter.test.ts:4-5` → deleted. The product `nativeTerminalCurrent` keeps its
  `nativeTerminalSignals` caller.
- **Persisted schemas.** `SimulationSourceDraftSchema` (`packages/model/src/schema/simulation-source.ts:27`) is nested
  directly in the folder input (`SimulationSourceInputSchema.drafts`, `:43`) → `ProjectSimulationFolderSchema` →
  `project.ts:123 simulationFolders`. `SimulationSourceDeviceOperatingPointSchema` (`:232`) is a member of the
  version-1 experiment configuration (`SimulationExperimentConfigSchema`, `:244-260`), which is parsed from the
  folder's `experiment.json` file text by `readSimulationExperimentConfig`
  (`packages/model/src/simulation-source-authoring.ts`). `SimulationVoltageProbeAnchorSchema` (`schema/simulation.ts:82`)
  and `SimulationRunPlanAxisSchema` (`:328`) are members of `SimulationVoltageProbeSchema` (`:103`) and
  `SimulationRunPlanSchema` (`:356`), used by the same experiment configuration and the legacy simulation-setup
  schemas (`:524`). All four lose `export` only; the type aliases `SimulationRunPlanAxis`, `SimulationVoltageProbeAnchor`,
  `SimulationRawFile` (`schema/types.ts:90,93,102`) have no users and go. `schema-check.mjs` compares each of the
  three files with `git show HEAD:<path>` after applying exactly those removals.
  Legacy migration tests: `packages/project-protocol/src/{simulation-setup-migration,raw-simulation-setup-migration,simulation-folders-migration}.test.ts`.
- **Agent API artifacts.** Nothing in `packages/agent-adapter` changes. On `main`, `pnpm agent-api:artifacts:check`
  exits 1 (`agent-circuit-response.schema.json is stale`; the response-schema and OpenAPI fixtures differ from the
  generated values, the request schema matches) — pre-existing, out of scope. The generated values match
  `tasks/T153-deadcode-cleanup/agent-api-hashes.expected` (`node tasks/T153-deadcode-cleanup/agent-api-hashes.mjs`).
- **Doc and spec references.** `docs/specs/netlist-export.md:458-459,472` name `designExtractsNetlist`; those
  mentions go with the function (the rule they describe stays `NETLIST_MARK_RULE_VERSION`'s).
- **T153's acceptance checker.** `tasks/T153-deadcode-cleanup/knip-expect.mjs` and `knip-expected.json` describe the
  state between T153 and T154. T154 leaves them unchanged as T153's record (run after T154 they report the 58 frozen
  findings as missing; nobody runs them then). Knip does not flag them or this folder's `schema-check.mjs`:
  `tasks/*/*.mjs!` is a root entry. `agent-api-hashes.mjs` / `.expected` stay valid and this plan's acceptance uses them.
- **Auto-layout** is not touched, so no `pnpm test:slow` evidence is needed.
- **Baseline measured on `a97ce3d`** (lane 1 defaults, after `pnpm build`): `pnpm typecheck` 0; `pnpm build` 0;
  `pnpm lint` 0 (0 errors, 3,898 warnings); `pnpm format:check` 0; `pnpm docs:check` 0; `pnpm agent-kit:catalog:check`,
  `pnpm agent-docs:generated:check`, `pnpm components:check` 0; `pnpm test:local` 0 — 844 files passed, 3 skipped
  (847); **8,801 tests passed, 117 skipped (8,918)**; `pnpm deadcode` 1; agent-api hashes match; `--check` exits 1
  with the message above.
- **Trial (all steps applied to `a97ce3d`, then reverted).** Both knip passes exit 0 with no output. Diff:
  **+528 / −5,628 lines in 85 files** — 27 files deleted (−4,076: 13 source modules, 12 test files, 2 JSON
  fixtures), 3 new files (+207: one test-support fixture, two tests), 55 edited (+321 / −1,552):

  | Area                                                 | Source       | Tests         |
  | ---------------------------------------------------- | ------------ | ------------- |
  | `packages/netlist`                                   | +26 / −2,897 | +325 / −2,496 |
  | `packages/model`                                     | +4 / −148    | +123 / −65    |
  | `packages/spice`                                     | +1 / −8      | —             |
  | `packages/edit-engine`                               | —            | +21 / −20     |
  | `apps/editor`                                        | +1 / −1      | +29 / −25     |
  | `packages/agent-adapter`, `project-protocol` (tests) | —            | +3 / −2       |
  | `docs/specs/netlist-export.md`                       | +2 / −3      |               |
  | `.github/workflows/ci.yml`                           | +1           |               |

  Of the 55 edited files, 25 change only the fixture import (one line); 30 change behaviour (the deletions, the
  re-expressed assertions and the CI step). Tests (by title; `it.each` counts once): **61 deleted, 35 kept and
  rewritten, 465 untouched** (untouched counted per file) in 50 test files — see [`test-ledger.md`](test-ledger.md).
  `pnpm test:local`: 834 files passed, 3 skipped (837); **8,682 tests passed, 116 skipped (8,798)** — 119 fewer
  passing and 1 fewer skipped than `main` (`it.each` rows counted). Every Acceptance command exited 0.

## Scope

Owned paths (may be edited, created or deleted):

- `packages/netlist/src/**` (including `test-support/{sky130,sg13g2}-profile.json`)
- `packages/model/src/schema/{simulation-source,simulation,types}.ts` (the four `export` keywords and three type
  aliases only), `packages/model/src/{simulation-source-authoring.ts,simulation-source-authoring.test.ts}`,
  new `packages/model/src/simulation-folder.test-support.ts`
- `packages/spice/src/{expression,simulation-language}.ts` (`spiceScaleFactor`, `NGSPICE_LANGUAGE_REFERENCE`,
  `simulationLanguageHelp` only)
- the test files that import the retired folder builder: `packages/edit-engine/src/*.test.ts`,
  `packages/agent-adapter/src/service.test.ts`, `packages/project-protocol/src/simulation-folders-migration.test.ts`,
  `packages/model/src/schema.test.ts`, `apps/editor/src/**/*.test.ts(x)`, `apps/editor/e2e/hierarchy.spec.ts`
  (one import line each, unless the ledger names a case)
- `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`,
  `packages/edit-engine/src/external-model-source.test.ts`
- `docs/specs/netlist-export.md` (the three `designExtractsNetlist` mentions)
- `.github/workflows/ci.yml` (one step)
- `tasks/T154-deadcode-simulation/report.md`

Out of scope (do not change):

- Any schema shape in `packages/model/src/schema/**`; `packages/project-protocol/**` (except the one import);
  `packages/agent-adapter/**` (except the one import); `fixtures/agent-api/**` (pre-existing staleness).
- `migrateSimulationSetupToSource` and the declarations it reaches (above); `planMappedProjectModelEdit`;
  `generateCircuitSource` and the compiler behind it; `eda/**`, `netlists/**`, `knip.config.js`.
- `packages/auto-layout/**`.
- `tasks/T153-deadcode-cleanup/**` (T153's record), `tasks/T154-deadcode-simulation/{plan.md,test-ledger.md,schema-check.mjs}`.

## Steps

Each step takes a removal together with its importers, its `index.ts` lines and its tests, so that it should
end green: after every step `pnpm typecheck` exits 0 and the tests of the files it touched pass
(`pnpm exec vitest run <files>`). The planning trial verified the end state, not each intermediate checkpoint; if a
step is red, finish the next step's matching part before moving on and say so in the report. Knip is green only
after step 8. [`test-ledger.md`](test-ledger.md) names every test case to delete, rewrite or leave and counts,
per file, the cases left untouched.

1. **Gallery mark (D4).** Delete `designExtractsNetlist` from `packages/netlist/src/export.ts`; run
   `prettier --write` (it formats only files that exist) so the mangled import narrows to
   `{ createDesignNetlistExport, unfinishedDrawingDiagnostics }`. Rewrite the doc block so it describes the rule
   `NETLIST_MARK_RULE_VERSION` versions (export ready, no `unfinishedDrawingDiagnostics`) without naming the
   function; drop the mentions in `docs/specs/netlist-export.md:458-459,472`. In the five test files delete the
   mark-subject cases ("answers no while connectivity is still missing", "gives the same answer as the export the
   editor performs"), add the two re-expressed assertions (`createDesignNetlistExport(project).status` is
   `"ready"` in "warns when a model card names a reviewed SKY130 subcircuit, and still exports it (#1249)";
   `"blocked"` in "blocks a drawing whose process fields are missing") and drop the other 11 mark lines.
2. **Unused exports with no test reader.** `packages/spice`: unexport `simulationLanguageHelp`
   (`simulation-language.ts:339`), delete `NGSPICE_LANGUAGE_REFERENCE` (`:25`) and `spiceScaleFactor`
   (`expression.ts:27`). `packages/model`: unexport the four schemas; delete the three type aliases and
   `replaceSimulationExperimentConfig`. Run `node tasks/T154-deadcode-simulation/schema-check.mjs`.
3. **Circuit-source editing.** Delete `planCircuitSourceEdit` and `CircuitParameterChange` from
   `simulation-circuit-source.ts` (and the imports only they used), `simulation-source-parameters.ts` and its test, in
   the same step rewrite the cases the ledger lists in `simulation-circuit-source.test.ts`,
   `simulation-source-vacask.test.ts` (the multi-binding case and the simulator-gated VACASK run), `simulation-external-vacask.test.ts`,
   `model-contract-acceptance.test.ts`, `netlist-code-edit.test.ts` and `external-model-source.test.ts`:
   - model-body edits call `planMappedProjectModelEdit(preview.text, next, preview.modelLocations ?? [], preview.modelSnapshots ?? [])`
     and keep the owner-update and rejection assertions the ledger lists (secondary binding → `unused-source`; pending
     draft → "saved model draft"; shared body `4*gain` update; port-reorder rejection; converted VACASK body →
     `MODEL_SOURCE_EDIT_REQUIRES_OWNER` **with a message containing "Converted model text requires an edit at its
     native owner"** — that fixture also has a pending draft, and the draft guard
     (`project-model-source.ts:789`) returns the same code, so the code alone would still pass if the
     converted-text guard (`:784`) stopped firing);
   - parameter edits become fixed Project values (captured from the pre-T154 build): `waveform: "sin"`,
     `dc: "{BIAS}"`, `acMagnitude: "1"`, `acPhase: "-90"`, `offset: "0"`, `amplitude: "1"`,
     `frequency: "1000"` for `' dc=(BIAS) mag=1 phase=-90 type="sine" sinedc=0 ampl=1 freq=1k'`; `w = "{(WIDTH * 2) * 1u}"` for `(WIDTH * 2)`
     on the OTA's first `w`; `value = "1000000"` for VACASK `1M`;
   - range assertions on the retained output: the ngspice VDD body range follows `\nVDD vdd 0` and selects ` DC 1.8`;
     each VACASK binding's resistor `value` range names its Document and Instance `R` and selects `1000` / `2000`;
     the op-amp's `gain` range selects `123`.
4. **Native acquisition and editor helpers.** Delete `simulation-native-save-edit.ts`, `simulation-native-parameter-edit.ts`,
   `simulation-ngspice-save-edit.ts`, `simulation-native-source-signals.ts`, `simulation-native-voltage.ts`,
   `simulation-ngspice-signal-names.ts` and `simulationSignalNames` with their `index.ts` lines and tests; remove the
   `requestedScope` parameter and both filters of `simulationSignals`; delete `nativeDeviceOpVectors` and the ngspice
   `nativeTerminalCurrent` (`simulation-ngspice-devices.ts:119-206`) and the `index.ts` block `:42-46`; remove the
   `isVacaskStatement` re-export at `index.ts:56` (keep its definition in `vacask-statement.ts` and the compiler's
   direct imports); remove the re-export at `simulation-native-devices.ts:23`. In the same step rewrite the tests:
   the saves become an authored `save <selectors>` line right after `control` (what `nativeAcquisitionEdit` inserted);
   `simulation-native-devices.test.ts`'s library summary becomes the fixed
   `[{ name: "core", primitives: [{ path: [], module: "sp_bsim4v8" }] }]`; `simulation-source-vacask.test.ts`'s VACASK
   run gets an authored `parameters VBIAS=1` line after the title; `sg13g2-simulation.test.ts` uses
   `nativeDeviceOpFields(d).map(({ vector }) => vector)` and drops the ngspice `nativeTerminalCurrent` expectation;
   the OTA compile assertion moves to a new `ngspice-ota-qualification.test.ts`.
5. **VACASK `nativeTerminalCurrent` (D8).** Do not export it: keep `function nativeTerminalCurrent(...)` in
   `simulation-native-current.ts` with its doc, and delete the direct import in the two test files. Re-express its five
   expectations through the compiler's signals, as the ledger lists: an authored `save` of the D/G sense selectors
   resolves to that device's Canvas terminal; the unit voltage-source factor keeps the native branch
   (`signals["X1:V1:flow(br)"]`, no `__icm_sense_` in the generated text), the `-` terminal resolves through its sense,
   and `m = "3"` set on the Project instance makes the `+` terminal resolve through its sense; the collision case
   asserts `SIMULATION_CURRENT_SENSE_UNRESOLVED`.
6. **Starter, folder builder, VACASK language help, library inspection, values (D8).** Delete `simulation-starter.ts`,
   `vacask-language.ts`, `vacask-postprocess.ts`, `vacask-values.ts`, `simulation-native-migration.ts` with their
   `index.ts` lines and tests, `inspectNativeModelLibrarySymbols` (`vacask-model-symbols.ts:31`) and its test file,
   `authoredModelSymbols` (`authored-circuit-scopes.ts:171`), the `conditionalCandidates` mode of `primitiveModels`
   (`:95`), and `test-support/{sky130,sg13g2}-profile.json`. Delete `createSimulationFolder` from
   `simulation-source-authoring.ts` (leaving `readSimulationExperimentConfig` and its imports) and
   `simulation-source-authoring.test.ts`. Add `packages/model/src/simulation-folder.test-support.ts`: the builder's
   body verbatim as test code (same `createSimulationFolder` name and options, `ProjectSimulationFolderSchema.parse`,
   the starter text and `experiment.json`), documented as a fixture. In the same step: point every test file that
   called it at that module (one import line each — `../`-relative for `packages/*` and `apps/*`, `./` inside
   `packages/model/src`) and drop the name from its `@icm/model` import; delete the five template-subject cases of
   `simulation-starter.test.ts` and keep its compiler/export-parity case as `simulation-ngspice-dut-interface.test.ts`
   (a `dutFolder()` helper using `analyzeDesignNetlist` + the fixture, asserting the preview/compiled/exported
   `.subckt` headers agree); move the printer half of `vacask-values.test.ts` into `vacask-printer.test.ts`
   (`vacaskProjectValue` leaves `1000000`, `0.001`, `0.0000508`, `10000`, `1e-9`, `255`, `-10`, `-0.000001` unchanged);
   delete the migration case of `simulation-native.test.ts`.
7. **Topology correspondence (D2).** Delete `topology-correspondence.ts` and its test with the `index.ts` lines,
   `matchElectricalTopologies`, `electricalGraphTopologySimilarity`, the `preference` parameter and the `mapping` result
   of `matchElectricalGraphs` (it returns the status; unexport it), `compareElectricalTopologies`, `topologyGraph`,
   `topologyLabel`, the `ElectricalGraph.topologyLabels` and `.deviceOrigins` fields with their construction,
   `ElectricalDeviceOrigin`, the `topology` argument of `vertex()` and its call sites, the `instancePath`/`referencePath`
   parameters of `expand` (this also drops the now-unused `sourceSymbols` parameter of `electricalGraphFromIR` and its
   construction in `projectElectricalGraph`), and the imports only they used. `compareElectricalGraphs` reads
   `labels`, `edges`, `bucket` and `cards` and nothing else. Keep in the exact-graph describe two cases whose
   subject survives: "exact comparison tells a reviewed SKY130 MOS wrapper from its primitive" (the retired
   topology describe's first case, kept with only its exact assertion `compareElectricalGraphs(a, b) ===
"different"`; its `compareElectricalTopologies` assertions go) and "keeps exact identity strict across
   renamed, reordered, and global supply terminals" (renamed/reordered/global OTA pair `"different"`, a copy
   `"equal"`). Delete the other topology-subject cases, including the moved repeated-child case (its subject,
   the device-origin paths, is gone).
8. **Fixed point.** Both knip passes exit 0 with no output; if not, the finding is a symbol this plan missed: stop and
   report it.
9. **CI.** In `.github/workflows/ci.yml` add `      - run: pnpm deadcode` directly after `      - run: pnpm lint`.
10. **Format and verify.** `pnpm exec prettier --write` on every changed file that still exists
    (`git status --short | awk '{print $2}'` after removing deleted paths); run Acceptance. The report lists every
    test case it deleted, rewrote or moved (matching the ledger) and anything that differs from it, with the reason.

## Acceptance

Run from the repository root, one command at a time, with lane 1's variables exported
(`export ICM_E2E_PORT=4173 AUTO_CANVAS_E2E_API_PORT=4311 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
and before committing (new files added with `git add -N` so that `git diff` sees them). Each line must exit 0.

```bash
pnpm format:check
pnpm docs:check
pnpm typecheck
pnpm lint                                      # 0 errors
pnpm build
pnpm test:local                                # trial: 834 files passed, 3 skipped (837); 8,682 passed, 116 skipped (8,798)
pnpm deadcode
out=$(pnpm exec knip --no-progress 2>&1); s=$?; test "$s" = 0 && test -z "$out"                  # default pass: status 0, no output
out=$(pnpm exec knip --production --no-progress 2>&1); s=$?; test "$s" = 0 && test -z "$out"     # production pass: status 0, no output
pnpm agent-kit:catalog:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm exec vitest run packages/project-protocol/src/simulation-setup-migration.test.ts packages/project-protocol/src/raw-simulation-setup-migration.test.ts packages/project-protocol/src/simulation-folders-migration.test.ts
git diff --quiet HEAD -- packages/auto-layout fixtures/agent-api knip.config.js   # untouched
test -z "$(git diff --name-only HEAD -- packages/project-protocol packages/agent-adapter | grep -v 'service.test.ts\|simulation-folders-migration.test.ts')"   # only the two fixture imports
node tasks/T154-deadcode-simulation/schema-check.mjs                                              # schema files: only the named removals
pnpm --filter "@icm/agent-adapter..." build
node tasks/T153-deadcode-cleanup/agent-api-hashes.mjs | diff - tasks/T153-deadcode-cleanup/agent-api-hashes.expected
out=$(pnpm agent-api:artifacts:check 2>&1); s=$?; test "$s" = 1 && printf '%s' "$out" | grep -q "agent-circuit-response.schema.json is stale"   # the failure main has, unchanged
left=0; for p in simulation-native-migration.ts simulation-native-parameter-edit.test.ts simulation-native-parameter-edit.ts simulation-native-save-edit.test.ts simulation-native-save-edit.ts simulation-native-source-signals.test.ts simulation-native-source-signals.ts simulation-native-voltage.test.ts simulation-native-voltage.ts simulation-ngspice-save-edit.ts simulation-ngspice-signal-names.test.ts simulation-ngspice-signal-names.ts simulation-source-parameters.test.ts simulation-source-parameters.ts simulation-starter.test.ts simulation-starter.ts topology-correspondence.test.ts topology-correspondence.ts vacask-language.test.ts vacask-language.ts vacask-model-symbols.test.ts vacask-postprocess.ts vacask-values.test.ts vacask-values.ts test-support/sky130-profile.json test-support/sg13g2-profile.json; do if test -e "packages/netlist/src/$p"; then echo "still present: $p"; left=1; fi; done; test "$left" = 0
test ! -e packages/model/src/simulation-source-authoring.test.ts
node -e 'import("@icm/model").then((m) => process.exit("createSimulationFolder" in m ? 1 : 0))'   # not in the built namespace (the barrel is `export *`)
test -z "$(grep -rl "simulation-folder.test-support" packages apps --exclude-dir=node_modules --exclude-dir=dist | grep -v '\.test\.\|\.spec\.')"   # no production importer
test "$(git diff --name-only --diff-filter=D HEAD | wc -l | tr -d ' ')" = 27   # exactly those 27 deletions
grep -A1 -x "      - run: pnpm lint" .github/workflows/ci.yml | grep -qx "      - run: pnpm deadcode"
```

Behavioral checks:

- Opening a legacy Project with simulation setups still migrates them (the three migration test files above,
  unchanged and passing).
- A model-body edit in the Code panel still updates the shared owner, and a port reorder, a pending draft or a
  converted body is still refused (`netlist-code-edit.test.ts`, `external-model-source.test.ts`,
  `simulation-external-vacask.test.ts`; the ledger lists the assertions).
- A terminal-total current still resolves in the compiler's signals, and a renamed terminal is still reported as
  `SIMULATION_CURRENT_SENSE_UNRESOLVED` (`simulation-native-devices.test.ts`, `simulation-native-current.test.ts`).
- RNL import still compares the electrical graphs (`rnl-import.ts`; `equivalence.test.ts`).
- `node netlists/ideal-analog-blocks/verify.mjs <ngspice>` still imports (`generateCircuitSource` is kept); running
  it needs ngspice and is optional evidence.

Reviewer (Opus): auto-layout source is not touched, so no `pnpm test:slow` run is needed; if the diff touches
`packages/auto-layout`, it is out of scope.

## Notes for the implementer

- **The review surface is the fixture rewrite, not the deletions.** The 27 deleted modules only need their
  reachability checked (knip and the greps do that). Of the 55 edited files, 25 are a one-line import change and can
  be skimmed; read the 30 that change behaviour: the six files whose cases were rewritten (ledger), the six modules
  (three schemas, `simulation-source-authoring.ts`, `equivalence.ts`, `simulation-circuit-source.ts`,
  `authored-circuit-scopes.ts`, `simulation-signal-names.ts`), the two tests for the retired mark, and `ci.yml`.
- **No product code is kept for tests.** `createSimulationFolder`'s body lives on only as test support
  (`packages/model/src/simulation-folder.test-support.ts`, matched by knip's `!**/*.test-support.ts!`), never
  imported by product code and no longer exported from `@icm/model`. Do not move any other product code there.
- Work from this plan and the ledger; the planning trial's scratch is not in your worktree.
- Never delete a schema constant or change a schema's shape; only the named `export` keywords and type aliases go
  (`schema-check.mjs` fails otherwise).
- Knip flags an export used only in its own file in the default pass: drop `export`, do not delete. Delete only what
  has no user at all — check with `grep -rnw` across the whole repository, including `tasks/`, `eda/`, `netlists/`
  and `tools/`, which import packages by path. Knip does not see unused parameters, fields or JSON fixtures; the plan
  names the ones this slice leaves unconsumed.
- When a declaration is deleted, check the line after it: a multi-line arrow `const` or a union type can leave a
  valid-but-dangling expression that `tsc` does not flag but that runs at import time (removing only the first line
  of `designExtractsNetlist` leaves its body as statements — delete the whole declaration and let `prettier` narrow
  the import).
- Run `pnpm build` before `pnpm test:local`; script tests import `packages/*/dist`.
- The VACASK/ngspice execution cases are skipped without `VACASK_BIN`/`NGSPICE_BIN`; their rewritten inputs equal
  what the retired helpers produced.
- Test-Impact trailer: `tests-updated`.
