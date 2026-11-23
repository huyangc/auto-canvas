# T154 test ledger

Every test case in the test files T154 changes, measured by the trial on `a97ce3d` (HEAD vs the trial's
working tree). Cases are counted by title; an `it.each` counts once (row counts show in `pnpm test:local`).
**Deleted** cases exercise only deleted code, or a fixture the owner's rule retires with it. **Rewritten** cases
keep every assertion on surviving code; setup that used a retired helper is replaced by the fixed value that
helper produced (plan, step 6), or the case moves to the file named. **Untouched** cases are counted per file,
not listed: they are byte-identical. Most fixture edits are one import line — `createSimulationFolder` now comes
from `packages/model/src/simulation-folder.test-support.ts`, so the 94 cases that build folders through it keep
their bodies unchanged (25 files change only that import).

## Assertions kept on surviving contracts

Shared-model edits through `planMappedProjectModelEdit` (`packages/netlist/src/project-model-source.ts:743`,
which the Code panel calls at `apps/editor/src/features/netlist-export/netlist-code-edit.ts:175`), called with
the preview's `text`, `modelLocations` and `modelSnapshots`:

- `external-model-source.test.ts`, "ignores unincluded model bindings in %s execution and the active circuit
  view" (ngspice): editing `R1 A 0 1k` → `2k` in the included secondary binding is `{ matched: true, ok: true }`
  and its `modelUpdates[0].id` is `unused-source`; with a pending draft on that source the same edit is
  `{ matched: true, ok: false }` with a message containing "saved model draft".
- `netlist-code-edit.test.ts`, "writes a mapped model-body edit to the shared owner used by every experiment"
  (for both the `op` and `ac` folders): `3*gain` → `4*gain` in the generated view is `{ matched: true, ok: true }`
  with `modelUpdates[0].files[0].text` containing `4*gain`; reordering the ports (`amp A B` → `amp B A`) is
  `{ matched: true, ok: false }`.
- `simulation-external-vacask.test.ts`, "compiles the applied owned closure once with native parameter/node
  identity and mapped ownership": editing the converted helper body (`r=1000000` → `r=2000000`) is
  `{ matched: true, ok: false, code: "MODEL_SOURCE_EDIT_REQUIRES_OWNER" }`.

Source ranges of the retained `generateCircuitSource`:

- `simulation-circuit-source.test.ts`, "prints ngspice source parameters without passing through the native
  grammar": the VDD source-body range follows `\nVDD vdd 0` and selects exactly ` DC 1.8`.
- `simulation-source-vacask.test.ts`, "shows the exact compiled multi-binding files": in each binding the resistor
  `value` range names that binding's Document and Instance `R` and selects `1000` (binding `a`) or `2000` (`b`).

The extractability rule after `designExtractsNetlist` is deleted (D4) — its subject cases are gone, the rule is
asserted on the live export:

- `export.test.ts`, "warns when a model card names a reviewed SKY130 subcircuit, and still exports it (#1249)":
  `createDesignNetlistExport(project).status` is `"ready"` (the case's "still exports it" claim).
- `export.test.ts`, "blocks a drawing whose process fields are missing": `createDesignNetlistExport(project).status`
  is `"blocked"` (beside the `analyzeDesignNetlist` error codes the case already asserted).
- The other 11 cases that called the mark already assert `createDesignNetlistExport`'s status or
  `unfinishedDrawingDiagnostics` directly; their mark line is simply dropped.

`nativeTerminalCurrent` is no longer exported (D8) — its rule is asserted through the compiler's own signals
(`compileSourceSimulation(...).signals`, which the editor reads):

- `simulation-native-devices.test.ts`, "uses exact occurrence paths and returns separate model-native save
  selectors and raw keys": four expectations named up front (`X1:M1`/`x1:M1` × `D`/`G`), each required to be
  exactly one sense before the save line is authored; then each of the four signal keys must be defined, labelled
  `I(X1/M1.D)` etc., and target `{ documentId: "dut", occurrence: [], terminal: { instanceId: "mos", pinName } }`.
  Suppressing the `G` sense makes the case fail at the count, not silently drop its own assertion.
- `simulation-native-devices.test.ts`, "keeps unit voltage-source branches native and senses other terminal-total
  currents": a unit factor keeps the native branch (`signals["X1:V1:flow(br)"]` on the `+` terminal, no
  `__icm_sense_` in the generated text); the `-` terminal (a terminal-total current) resolves through its sense;
  an explicit `m = "3"` on the Project instance makes the `+` terminal resolve through its sense too.
- `simulation-native-current.test.ts`, "rejects collisions without changing stable identities or lending model id
  semantics": the renamed terminal makes the compile fail with `SIMULATION_CURRENT_SENSE_UNRESOLVED`.

Exact-graph comparison after the topology code goes (D2) — `compareElectricalGraphs` reads `labels`, `edges`,
`bucket` and `cards` only:

- `equivalence.test.ts`, "exact comparison tells a reviewed SKY130 MOS wrapper from its primitive" (the retired
  topology describe's first case, kept with only its exact assertion): a reviewed SKY130 hierarchical wrapper
  and its primitive MOS card are `"different"` exact netlists.
- `equivalence.test.ts`, "keeps exact identity strict across renamed, reordered, and global supply terminals"
  (retitled from the topology case, in the exact-graph describe): a renamed, reordered OTA with global supply
  rails is `"different"`, a copy `"equal"`.

Totals (test cases by title; an `it.each` counts once): **61 deleted, 35 kept and rewritten, 465 untouched** in the 48 test files T154 changes.

| File                                                                 | Status  | Deleted | Rewritten                        | Untouched |
| -------------------------------------------------------------------- | ------- | ------- | -------------------------------- | --------- |
| `apps/editor/src/agent/agent-session-client-pairing.test.ts`         | edited  | 0       | 0                                | 12        |
| `apps/editor/src/agent/agent-session-client-revisions.test.ts`       | edited  | 0       | 0                                | 13        |
| `apps/editor/src/agent/mcp-tools-live.test.ts`                       | edited  | 0       | 0                                | 21        |
| `apps/editor/src/app/App.test.tsx`                                   | edited  | 0       | 0                                | 18        |
| `apps/editor/src/app/editor-transaction-commands.test.ts`            | edited  | 0       | 0                                | 15        |
| `apps/editor/src/document/project-snapshot-serializer.test.ts`       | edited  | 0       | 0                                | 7         |
| `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`  | edited  | 0       | 1                                | 12        |
| `apps/editor/src/features/netlist-export/netlist-process.test.ts`    | edited  | 0       | 0                                | 26        |
| `packages/agent-adapter/src/service.test.ts`                         | edited  | 0       | 0                                | 29        |
| `packages/edit-engine/src/external-model-source.test.ts`             | edited  | 0       | 1                                | 27        |
| `packages/edit-engine/src/project-transaction.test.ts`               | edited  | 0       | 0                                | 38        |
| `packages/model/src/schema.test.ts`                                  | edited  | 0       | 0                                | 41        |
| `packages/model/src/simulation-source-authoring.test.ts`             | deleted | 2       | 0                                | 0         |
| `packages/netlist/src/built-in-subcircuits.test.ts`                  | edited  | 0       | 0                                | 28        |
| `packages/netlist/src/canonical-design-netlist.test.ts`              | edited  | 0       | 0                                | 4         |
| `packages/netlist/src/delay-cell-acceptance.test.ts`                 | edited  | 0       | 0                                | 2         |
| `packages/netlist/src/equivalence.test.ts`                           | edited  | 4       | 3 (2 retitled in place, 1 moved) | 10        |
| `packages/netlist/src/export.test.ts`                                | edited  | 2       | 9                                | 19        |
| `packages/netlist/src/gate-cell.test.ts`                             | edited  | 0       | 0                                | 12        |
| `packages/netlist/src/generic-bjt-model.test.ts`                     | edited  | 0       | 1                                | 4         |
| `packages/netlist/src/generic-diode-model.test.ts`                   | edited  | 0       | 1                                | 7         |
| `packages/netlist/src/implicit-mos-supplies.test.ts`                 | edited  | 0       | 0                                | 6         |
| `packages/netlist/src/model-contract-acceptance.test.ts`             | edited  | 0       | 1                                | 13        |
| `packages/netlist/src/mos-body-findings.test.ts`                     | edited  | 0       | 1                                | 12        |
| `packages/netlist/src/reviewed-high-voltage.test.ts`                 | edited  | 0       | 0                                | 3         |
| `packages/netlist/src/sg13g2-simulation.test.ts`                     | edited  | 0       | 1                                | 1         |
| `packages/netlist/src/simulation-circuit-source.test.ts`             | edited  | 3       | 6                                | 2         |
| `packages/netlist/src/simulation-external-vacask.test.ts`            | edited  | 0       | 1                                | 12        |
| `packages/netlist/src/simulation-native-current.test.ts`             | edited  | 0       | 1                                | 5         |
| `packages/netlist/src/simulation-native-devices.test.ts`             | edited  | 0       | 3                                | 3         |
| `packages/netlist/src/simulation-native-parameter-edit.test.ts`      | deleted | 2       | 0                                | 0         |
| `packages/netlist/src/simulation-native-save-edit.test.ts`           | deleted | 7       | 0                                | 0         |
| `packages/netlist/src/simulation-native-source-signals.test.ts`      | deleted | 5       | 0                                | 0         |
| `packages/netlist/src/simulation-native-voltage.test.ts`             | deleted | 3       | 0                                | 0         |
| `packages/netlist/src/simulation-native.test.ts`                     | edited  | 1       | 0                                | 5         |
| `packages/netlist/src/simulation-ngspice-signal-names.test.ts`       | deleted | 1       | 1                                | 0         |
| `packages/netlist/src/simulation-source-compile.test.ts`             | edited  | 0       | 0                                | 14        |
| `packages/netlist/src/simulation-source-parameters.test.ts`          | deleted | 3       | 0                                | 0         |
| `packages/netlist/src/simulation-source-vacask.test.ts`              | edited  | 0       | 2                                | 11        |
| `packages/netlist/src/simulation-starter.test.ts`                    | deleted | 9       | 1                                | 0         |
| `packages/netlist/src/topology-correspondence.test.ts`               | deleted | 8       | 0                                | 0         |
| `packages/netlist/src/undefined-generic-model.test.ts`               | edited  | 0       | 1                                | 2         |
| `packages/netlist/src/vacask-language.test.ts`                       | deleted | 7       | 0                                | 0         |
| `packages/netlist/src/vacask-model-symbols.test.ts`                  | deleted | 2       | 0                                | 0         |
| `packages/netlist/src/vacask-printer.test.ts`                        | edited  | 0       | receives 1 moved case            | 24        |
| `packages/netlist/src/vacask-run-temperature.test.ts`                | edited  | 0       | 0                                | 5         |
| `packages/netlist/src/vacask-values.test.ts`                         | deleted | 2       | 1                                | 0         |
| `packages/project-protocol/src/simulation-folders-migration.test.ts` | edited  | 0       | 0                                | 2         |

### `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`

- rewritten: writes a mapped model-body edit to the shared owner used by every experiment

### `packages/edit-engine/src/external-model-source.test.ts`

- rewritten: ignores unincluded model bindings in %s execution and the active circuit view

### `packages/model/src/simulation-source-authoring.test.ts`

- deleted: guides %s authoring without imposing a DUT
- deleted: quotes DUT interface names without changing pin order, case or punctuation

### `packages/netlist/src/equivalence.test.ts`

- deleted: keeps unknown black-box identities distinct even with identical interfaces
- deleted: uses the authored MOS polarity with arbitrary process model names
- deleted: ranks the same topology above a partial or unrelated circuit without treating values as structure
- deleted: retains recognizable transistor polarity while ignoring model spelling
- rewritten: matches reviewed SKY130 MOS wrappers to primitives without confusing polarity or pin roles → exact comparison tells a reviewed SKY130 MOS wrapper from its primitive
- rewritten: finds the same five-transistor OTA across renamed, reordered, and global supply terminals → keeps exact identity strict across renamed, reordered, and global supply terminals (moved to packages/netlist/src/equivalence.test.ts)

### `packages/netlist/src/export.test.ts`

- deleted: answers no while connectivity is still missing
- deleted: gives the same answer as the export the editor performs
- rewritten: refuses an interface-only legacy model even when experiments contain its body
- rewritten: warns when a model card names a reviewed SKY130 subcircuit, and still exports it (#1249)
- rewritten: blocks a drawing whose process fields are missing
- rewritten: writes the fourth node from the supply the author drew
- rewritten: writes a stranded body on the supply, not on the Net it was left on
- rewritten: reads an absent netlist record as an empty one
- rewritten: refuses a drawing whose wire was never finished
- rewritten: takes an explicit NoConnect as the author's own answer
- rewritten: leaves a node somebody named alone

### `packages/netlist/src/generic-bjt-model.test.ts`

- rewritten: defines NPN and PNP once in the Cell of placed transistors, and says so

### `packages/netlist/src/generic-diode-model.test.ts`

- rewritten: defines DIODE once in the Cell of a placed diode, and says so

### `packages/netlist/src/model-contract-acceptance.test.ts`

- rewritten: round-trips gain and refuses generated-body edits in %s → maps the gain parameter and prints the generated body in %s

### `packages/netlist/src/mos-body-findings.test.ts`

- rewritten: names the PMOS and the VDD pin the export adds, as information

### `packages/netlist/src/sg13g2-simulation.test.ts`

- rewritten: offers only measured PSP operating-point fields on the actual %s OSDI instance

### `packages/netlist/src/simulation-circuit-source.test.ts`

- deleted: rejects a mixed parameter and topology paste atomically
- deleted: accepts multiple numeric edits with shifting text offsets in one plan
- deleted: does not let an expression escape its Circuit slot: %s
- rewritten: prints and edits ngspice source parameters without passing through the native grammar → prints ngspice source parameters without passing through the native grammar
- rewritten: adds, changes and removes AC/phase and waveforms while keeping source nodes locked → prints AC/phase and waveform parameters on a source
- rewritten: prints an unresolved model slot without crashing or assigning a model
- rewritten: keeps incomplete circuits editable without inventing defaults or relaxing export → prints incomplete circuits without inventing defaults or relaxing export
- rewritten: locates persisted numeric parameters and maps reviewed micrometres back to canonical SI → locates persisted numeric parameters in reviewed micrometres without changing the Project
- rewritten: round-trips native parameter references through Canvas and reviewed PDK units → prints a native parameter reference stored in canonical SI as reviewed PDK units

### `packages/netlist/src/simulation-external-vacask.test.ts`

- rewritten: compiles the applied owned closure once with native parameter/node identity and mapped ownership

### `packages/netlist/src/simulation-native-current.test.ts`

- Setup: shared fixture helper `choose` authors the save statement the retired `nativeAcquisitionEdit` inserted; its 5 cases are otherwise unchanged.
- rewritten: rejects collisions without changing stable identities or lending model id semantics

### `packages/netlist/src/simulation-native-devices.test.ts`

- rewritten: uses exact occurrence paths and returns separate model-native save selectors and raw keys
- rewritten: keeps unit voltage-source branches native and senses other terminal-total currents
- rewritten: executes public compiler plus native OP helper and matches independently captured N/P output keys and values

### `packages/netlist/src/simulation-native-parameter-edit.test.ts`

- deleted: preserves existing bytes and title: %j
- deleted: precedes includes, conditional/local scope and control without inspecting a broken draft

### `packages/netlist/src/simulation-native-save-edit.test.ts`

- deleted: keeps exact-case selectors and deduplicates quoted/space variants, before the trailing comment
- deleted: does not reinterpret quoted control/node names or embedded comments as structural blocks
- deleted: extends multiline selectors without splitting parentheses or deleting comments
- deleted: inserts in the selected block and after its clear, not into the previous analysis scope
- deleted: appends a control block after an existing circuit without altering the title or CRLF
- deleted: rejects an invalid selector without mutating source: %s
- deleted: keeps incomplete, legacy and context-free fragments editable instead of guessing an insertion

### `packages/netlist/src/simulation-native-source-signals.test.ts`

- deleted: uses exact-case native node names and declared modules, not SPICE instance prefixes
- deleted: does not expose definition-local or conditional instances as top-level nodes
- deleted: follows native includes and quotes unusual identifiers without folding them
- deleted: does not invent branch currents for ambiguous or unknown masters or duplicate instances
- deleted: keeps invalid authored identifiers repairable without throwing from Helper

### `packages/netlist/src/simulation-native-voltage.test.ts`

- deleted: distinguishes case-sensitive authored occurrences without introducing JSON output configuration
- deleted: resolves formal port aliases to top-level nodes and the same terminal/base Net anchor
- deleted: refuses deleted anchors, stale binding/call paths and wrong occurrences instead of silently saving ground

### `packages/netlist/src/simulation-native.test.ts`

- deleted: explicitly converts safe legacy metadata and retains unsupported intent without data loss

### `packages/netlist/src/simulation-ngspice-signal-names.test.ts`

- deleted: inserts ngspice acquisitions without native control syntax and without duplicating saves
- rewritten: retains real OTA Canvas voltage mapping on the ngspice path → compiles the real OTA qualification Project on the ngspice path (moved to packages/netlist/src/ngspice-ota-qualification.test.ts)

### `packages/netlist/src/simulation-source-parameters.test.ts`

- deleted: keeps DC, AC and transient clauses independent with native expressions
- deleted: parses PWL pairs and complete PULSE clauses without inventing timestep defaults
- deleted: does not apply incomplete or unsupported clauses: %s

### `packages/netlist/src/simulation-source-vacask.test.ts`

- rewritten: shows the exact compiled multi-binding files and reverses mega without SPICE milli interpretation → shows the exact compiled multi-binding files
- rewritten: executes the PUBLIC compiler with reversed include order and run point $point/$bias

### `packages/netlist/src/simulation-starter.test.ts`

- deleted: creates a genuine ngspice %s starter without VACASK syntax
- deleted: preserves the selected analysis template for a %s folder
- deleted: preserves a drawn top-level circuit and allows text without any Canvas binding
- deleted: uses the exported DUT name and ordered ports for a textual TB without creating a Cell
- deleted: wraps a Cell with pins as a DUT and runs one without as the testbench (#1489)
- deleted: selects the advertised cell-library Profile for a gate-only circuit and refuses unsupported or mixed masters
- deleted: takes the one Profile that qualifies every PDK device the Cell uses
- deleted: takes the SKY130 Profile for SKY130's high-voltage DMOS devices (#1485)
- deleted: asks for a Profile when none or several qualify
- rewritten: keeps ngspice DUT interfaces identical to the existing supply-first Netlist and starter → keeps ngspice DUT interfaces identical to the existing supply-first Netlist (moved to packages/netlist/src/simulation-ngspice-dut-interface.test.ts)

### `packages/netlist/src/topology-correspondence.test.ts`

- deleted: returns a verified partial witness above the recursive size limit
- deleted: finds a full witness under renaming, reordering, passive reversal and equivalent units
- deleted: ranks W/L/m and model changes by degree without confusing them with topology
- deleted: retains the common branch but excludes changed device types and polarity
- deleted: cannot map all series devices onto parallel devices or collapse distinct nets
- deleted: maps a true partial subcircuit despite added external devices
- deleted: keeps distinct occurrence paths when the same child Cell is instantiated twice
- deleted: reports a bounded search instead of inventing a complete correspondence

### `packages/netlist/src/undefined-generic-model.test.ts`

- rewritten: carries NMOS and PMOS stand-ins in a netlist handed out, and says SW needs a card

### `packages/netlist/src/vacask-language.test.ts`

- deleted: shares inspectable postprocess helpers without evaluating or inventing measurements
- deleted: does not skip the first declaration of an included file when allocating names
- deleted: maps selectors to exact native node identity, not a lowercased display alias
- deleted: allocates case-sensitive analysis identities without inserting electrical defaults
- deleted: checks proven argument errors without rejecting unfamiliar native programs
- deleted: does not treat quoted/commented or embedded control words as boundaries
- deleted: runs helper-authored sources, RCL, OP/AC/TRAN/Noise and a DC sweep in native VACASK

### `packages/netlist/src/vacask-model-symbols.test.ts`

- deleted: proves conditional output identity without evaluating a branch or accepting unknown alternatives
- deleted: uses selected sections and local model shadows without evaluating geometry

### `packages/netlist/src/vacask-values.test.ts`

- deleted: translates literals inside expressions without changing native names, grouping or powers
- deleted: leaves unsupported/incomplete input repairable: %s
- rewritten: preserves %s in Project SI and the reprinted native circuit → prints canonical Project SI %s unchanged (moved to packages/netlist/src/vacask-printer.test.ts)
