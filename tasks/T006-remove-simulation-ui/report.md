# T006 report — round 1

## Summary

Removed the editor's Simulate action, workspace, run history, output/results UI,
canvas probe picking, feature flag and simulation example registry. Removed
local-host/Vite simulation endpoints and most simulator containers, scripts,
configuration, fixtures and documentation. The editor no longer advertises
simulation resources; inherited simulation, file-input and plot requests return
`SIMULATION_UNAVAILABLE`. Netlist export, model editing, Project Code and saved
Project simulation folders remain supported.

Round status: **partial**. Implementation within the owned paths is complete,
with the dependency exceptions below. Full unit acceptance has one out-of-scope
relay failure. Browser acceptance has one non-simulation fixture-entry failure.
No commits, branch changes, dependency changes, lockfile edits, generated-file
edits, or changes to `plan.md` / `review.md` were made.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Disabled the web capability, then removed the capability and all UI gates, including App's test override. Desktop remains without simulation.                                                                                                                                                                                                                                                                         |
| 2    | done    | Removed reachable simulation UI, styles, lazy loading, archives, source drafts, examples registry and canvas interaction wiring. Kept controlled-source picking and Project Code's SPICE tokenizer under their own features. Replaced editor Agent execution/file handlers with unavailable responses and regression coverage. Required probe helpers and legacy relay-test exports are retained as documented below. |
| 3    | done    | `project-snapshot-serializer.test.ts` loads a Project with source folders, changes its schematic through `EditorDocumentController`, saves through the editor serializer, reopens it and compares folder bytes and each file's UTF-8 bytes, including BOM, CRLF, Unicode and whitespace.                                                                                                                              |
| 4    | done    | Removed local-host simulation handler/adapter, CLI option, endpoint tests and Vite plugin/test. Other local-host serving behavior remains covered.                                                                                                                                                                                                                                                                    |
| 5    | partial | Removed simulator-only owned tooling and assets; preserved dependencies of kept/out-of-scope files. Four container assets, three probe files and the listed scripts/fixtures remain.                                                                                                                                                                                                                                  |
| 6    | done    | Removed CI's known-failure exclusion, all simulation standalone entries/project, the root acceptance script and obsolete Knip entries. Playwright config had no simulation-specific entries to remove. The empty page-module registry remains for the shared E2E build script.                                                                                                                                        |
| 7    | done    | Deleted four simulation specs, simulation ADR/user guide and simulation roadmaps; repaired links in owned docs, updated architecture/user/testing docs and README status.                                                                                                                                                                                                                                             |
| 8    | done    | Ran the exact requested sweep. All 611 matches in 98 files are accounted for below; no matches remain in `apps/local-host/src`. The separate Agent directory is excluded by the prescribed command and is accounted for separately.                                                                                                                                                                                   |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

All required commands were run with lane 2:

```text
ICM_E2E_PORT=4273
AUTO_CANVAS_E2E_API_PORT=4321
AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2

pnpm check → exit 1
  Formatting, docs links, generated Agent docs, component generation, typecheck
  and lint passed (0 lint errors; existing warnings remain).
  Test Files: 1 failed | 829 passed | 2 skipped (832)
  Tests: 1 failed | 8306 passed | 122 skipped (8429)
  Failure: worker/agent-session.test.ts:518
  Expected error.stage "prepare"; received "input" (SIMULATION_UNAVAILABLE).
  This test subsequently expects successful prepare/start execution.
  The && chain stops before build; the complete build passed in mcp:package.

CI=true pnpm test:local → exit 1
  Same single worker/agent-session.test.ts failure and counts as above.
  No knownFailingInCi exclusion remains.

pnpm test:desktop-build → exit 0
  Vite desktop build passed. Standard large-chunk warnings only.

pnpm mcp:package → exit 0
  Full workspace build and local npm pack passed.
  output/mcp/analog-canvas-mcp-server-0.17.88.tgz (4 packaged files).

pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/netlist-workflows.spec.ts --workers=1 → exit 1
  20 passed, 1 failed (51.1s).
  Failure: netlist-workflows.spec.ts:286, vector PDF scripts.
  At line 318: "I_out is present"; expected index > 0, received -1.

 git ls-files containers config/vacask-preview-environment.json apps/editor/src/features/simulation → exit 0, output not empty
  139 indexed paths are printed because removals are unstaged.
  Seven paths still exist on disk; they are the protected dependencies below.
```

Additional verification after final cleanup:

```text
pnpm format:check → exit 0
pnpm docs:check → exit 0; Validated local Markdown links in 79 files
pnpm typecheck → exit 0
pnpm lint → exit 0; 2141 files, 0 errors, 2678 warnings
pnpm test:local apps/editor/src/agent/simulation-unavailable.test.ts apps/editor/src/document/project-snapshot-serializer.test.ts apps/editor/src/app/App.test.tsx → exit 0; 3 files, 21 tests passed
git diff --check → exit 0
```

Full acceptance logs and the exact sweep are in the ignored task
[`logs/`](logs/) directory (`round-1-check.log`, `round-1-ci-tests.log`,
`round-1-desktop.log`, `round-1-mcp.log`, `round-1-e2e.log`,
`round-1-static-final.log`, `round-1-focused-final.log`,
`round-1-ls-files.log`, `round-1-sweep.txt`). Playwright retained the screenshot,
trace and error context under
`test-results/netlist-workflows-exports--f8c5a-F-with-its-scripts-in-place/`.

The first sandboxed unit run could not connect to PostgreSQL or listen on
loopback (`EPERM`). Re-running acceptance with approved local access resolved
those environment failures. npm pack initially could not write the default
home cache/log directory; `npm_config_cache=/tmp/t006-npm-cache` resolved it.
The repository launcher exports `npm_config_verify_deps_before_run=false`, but
this installed pnpm reads `pnpm_config_verify_deps_before_run`; using the latter
prevented automatic dependency verification/install attempts. An earlier CI
invocation reported the existing dependencies already up to date. No dependency
or lockfile changes resulted; no explicit dependency install was run.

## Investigation results

### Hierarchy and model sources

The three hierarchy editors import `SimulationSourceLocation` only as a type
for opening/highlighting Project-owned model source. `external-model-source-editor`
also uses `SimulationSourceDiagnostic` from the model schema for model parsing
and application feedback. These are source/netlist concerns, not simulator
execution, so they remain. No runtime `@icm/spice-run` import was found there.
The simulation endpoint's advertised model inventory is no longer queried;
reviewed built-in export/model suggestions and process presets remain.

`terminalCurrentDirectionPartners` is also used by controlled-source properties
and canvas picking, so it moved to
`features/properties/terminal-current-direction.ts`. Project Code still needs
the SPICE tokenizer; the tokenizer moved to
`features/project-code/spice-code-language.ts`. Controlled-source hit/marker
styles moved to `styles/editor-controlled-source-pick.css`, with matching
class names. Their existing behavior tests remain.

### Retained importer dependencies

The plan explicitly says to keep code/assets whose deletion would need a change
outside the owned paths. The seven retained paths from the deletion acceptance
are:

| Retained path                                                          | Required consumer                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `containers/ngspice/hosted-sky130-profile.json`                        | `worker/simulation.ts`, `simulation-ngspice.ts`, worker tests and netlist/simulation-service package tests                                                     |
| `containers/ngspice/sg13g2/profile.json`                               | Worker routing and `packages/devices`, `packages/netlist`, `packages/simulation-service` tests/test support                                                    |
| `containers/ngspice/cells/sky130_fd_sc_hd.spice`                       | `packages/devices/src/reviewed-external.test.ts`                                                                                                               |
| `containers/vacask/host/deploy-preview.sh`                             | `worker/preview-config.test.ts` reads and asserts the script text. Dockerfiles/runtimes are removed; this retained script is not a runnable deployment bundle. |
| `apps/editor/src/features/simulation/source-probe-choices.ts`          | `packages/netlist/src/simulation-native-devices.test.ts` imports it directly                                                                                   |
| `apps/editor/src/features/simulation/simulation-probe-options.ts`      | Required by `source-probe-choices.ts`                                                                                                                          |
| `apps/editor/src/features/simulation/simulation-probe-options.test.ts` | Retained coverage for that required helper                                                                                                                     |

Other retained dependencies:

- `fixtures/ngspice-failures/**` and `fixtures/ngspice-rawfile/**`: package tests
  read these dynamically; deleting them would break out-of-scope packages.
- `fixtures/simulation-acceptance/ota-5t.spi`: a kept Library/netlist structural
  equivalence test reads it. The three `hosted-sky130-*.json` qualification files
  remain because the retained qualification module reads them.
- `scripts/user-components-smoke.mjs` and `scripts/production-dual-engine-smoke*`
  are not named owned deletions in the plan. Their imports require keeping
  `scripts/lib/{preview-simulation-qualification,preview-simulation-validation-core,simulation-smoke-headers,simulator-busy-wait}.mjs`,
  the validation declaration file and the busy-wait test. Their simulator
  endpoints are no longer exposed by this editor; retiring these additional
  entrypoints needs an expanded scope.
- `scripts/lib/native-starter-report.py` is linked by the retained, out-of-scope
  `netlists/native-*/README.md` fixture documentation.
- The four `examples/simulation-*.icproj.json` Projects remain as compatibility,
  netlist and clipboard fixtures. In particular `packages/project-protocol/src/project-copy.test.ts`
  imports the OTA file. Other saved source folders in Library fixture Projects
  are preserved under the keep-Project-data requirement. No simulation example
  registry, menu, source editor or execution entrypoint remains.
- `agent/live-simulation.test-support.ts` still exports `dividerFolder` and
  `HostedSimulationService`, as required by `worker/agent-session.test.ts`.
  Artifact-relay/UI-specific helpers were removed after their owned tests
  retired. `LiveAgentEditorOptions.simulationService` retains the call shape
  required by the worker test, but the real editor host now returns unavailable.

### Test retirement and replacement protection

Deleted simulation workspace/Agent/browser tests test surfaces that are now
unreachable: preparation/execution/history, simulation source editing, artifacts,
outputs, evidence transfer and canvas probes. Their current refusal boundary
is covered by `agent/simulation-unavailable.test.ts`, which checks every
inherited simulation operation, file-input/plot refusals, omitted capabilities
and unchanged Project data. App tests assert that the Simulate affordance is
absent. The serializer regression protects saved folder bytes after a real
schematic edit. Controlled-source picking, Project Code, import/export,
clipboard, recovery and model-source tests remain. Mixed file-resource retry
coverage now uses a normal Project download instead of a retired simulation
file listing. The removed shared standalone setup only prepared deleted
simulator CLI tests.

### Remaining sweep hits

The exact prescribed sweep found **611 matches in 98 files**. Matching lines,
including line numbers, are preserved in `logs/round-1-sweep.txt`. The following
inventory assigns a reason to every matching file; all matching lines in each
file belong to that reason. No local-host source matched.

Reasons:

- **Unavailable wire adapter**: only the inherited Agent request shape and the
  explicit unavailable host remain; no executor or simulation workspace.
- **Model source location**: source diagnostic/location types retained for
  external model editing.
- **Absence regression**: tests assert that retired UI is absent.
- **Project compatibility**: saved source folders and waveform parameters are
  Project data; codec, recovery and whole-Cell clipboard behavior must preserve
  them.
- **Export/model contract**: SPICE/Spectre/RNL dialect syntax, device source
  waveforms, model bindings, process presets and their tests remain in scope to
  keep; these do not execute a simulator.
- **Protected probe helper**: package-test dependency described above, without UI.
- **Fixture data**: saved Projects remain compatibility/netlist/clipboard fixtures;
  no simulation starter registry is exposed.
- **Fixture disclaimer**: comments explicitly describe topology-only fixtures.
- **Legacy compatibility**: existing Gallery metadata/topology handling outside
  the simulation UI removal; no new behavior was added.
- **Protected tooling**: retained entrypoint/importer closure described above.
- **Validation classifier**: retained package/path classifications for inherited
  packages; removing them would change unrelated validation selection.
- **Retirement documentation**: describes unavailable simulation, retained
  Project data, external validation or pending legacy removal.
- **Out-of-scope server contract**: explicitly excluded from this task.

| File                                                                           | Matches | Reason                                          |
| ------------------------------------------------------------------------------ | ------- | ----------------------------------------------- |
| `apps/editor/src/README.md`                                                    | 1       | Retirement documentation                        |
| `apps/editor/src/app/App.test.tsx`                                             | 14      | Absence regression; Project compatibility       |
| `apps/editor/src/app/App.tsx`                                                  | 6       | Unavailable wire adapter; model source location |
| `apps/editor/src/app/agent-workspace-requests.ts`                              | 9       | Unavailable wire adapter                        |
| `apps/editor/src/app/editor-dialogs.tsx`                                       | 3       | Model source location                           |
| `apps/editor/src/app/editor-transaction-commands.test.ts`                      | 4       | Project compatibility                           |
| `apps/editor/src/app/use-agent-hosts.ts`                                       | 12      | Unavailable wire adapter                        |
| `apps/editor/src/demos/demo-project.ts`                                        | 1       | Project compatibility                           |
| `apps/editor/src/demos/routing-demo.ts`                                        | 1       | Project compatibility                           |
| `apps/editor/src/document/browser-recovery-contract.test.ts`                   | 2       | Project compatibility                           |
| `apps/editor/src/document/browser-recovery-store.test.ts`                      | 2       | Project compatibility                           |
| `apps/editor/src/document/project-snapshot-serializer.test.ts`                 | 9       | Project compatibility                           |
| `apps/editor/src/document/recovery-coordinator.test.ts`                        | 1       | Project compatibility                           |
| `apps/editor/src/examples/common-source-amplifier.icproj.json`                 | 1       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/current-mirror-loaded-differential-pair.icproj.json` | 1       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/five-transistor-ota-sky130.icproj.json`              | 76      | Fixture data; Export/model contract             |
| `apps/editor/src/examples/five-transistor-ota.test-support.ts`                 | 3       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/fully-differential-two-stage-op-amp.icproj.json`     | 1       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/library-examples.test.ts`                            | 4       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/simulation-common-source.icproj.json`                | 9       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/simulation-ota.icproj.json`                          | 16      | Fixture data; Export/model contract             |
| `apps/editor/src/examples/simulation-rc.icproj.json`                           | 15      | Fixture data; Export/model contract             |
| `apps/editor/src/examples/simulation-rlc.icproj.json`                          | 8       | Fixture data; Export/model contract             |
| `apps/editor/src/examples/two-stage-op-amp.icproj.json`                        | 1       | Fixture data; Export/model contract             |
| `apps/editor/src/features/clipboard/clipboard.test.ts`                         | 2       | Project compatibility                           |
| `apps/editor/src/features/clipboard/paste-proposal.ts`                         | 1       | Project compatibility                           |
| `apps/editor/src/features/clipboard/project-copy.test.ts`                      | 5       | Project compatibility                           |
| `apps/editor/src/features/clipboard/project-copy.ts`                           | 15      | Project compatibility                           |
| `apps/editor/src/features/clipboard/system-clipboard.test.ts`                  | 7       | Project compatibility                           |
| `apps/editor/src/features/clipboard/system-clipboard.ts`                       | 1       | Project compatibility                           |
| `apps/editor/src/features/clipboard/test-support/dense-copy-fixture.ts`        | 1       | Fixture disclaimer                              |
| `apps/editor/src/features/clipboard/use-circuit-clipboard.ts`                  | 1       | Project compatibility                           |
| `apps/editor/src/features/component-insert/component-parameters.test.ts`       | 9       | Export/model contract                           |
| `apps/editor/src/features/component-insert/component-parameters.ts`            | 5       | Export/model contract                           |
| `apps/editor/src/features/editor-shell/drawing-toolbar.test.tsx`               | 2       | Absence regression                              |
| `apps/editor/src/features/editor-shell/editor-export-commands.test.ts`         | 1       | Export/model contract                           |
| `apps/editor/src/features/hierarchy/cell-manager-dialog.tsx`                   | 2       | Model source location                           |
| `apps/editor/src/features/hierarchy/external-circuit-editor.tsx`               | 2       | Model source location                           |
| `apps/editor/src/features/hierarchy/external-model-source-editor.tsx`          | 5       | Model source location                           |
| `apps/editor/src/features/netlist-export/about-rnl-link.test.tsx`              | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/analog-canvas-extensions-0.4.rnl`     | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/analog-canvas-extensions-0.5.rnl`     | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/convert-import-sources.test.ts`       | 7       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/convert-import-sources.ts`            | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/netlist-code-edit.test.ts`            | 6       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/netlist-process-presets.ts`           | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/netlist-process.test.ts`              | 15      | Export/model contract                           |
| `apps/editor/src/features/netlist-export/netlist-process.ts`                   | 2       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/rnl-import-safety.test.ts`            | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/rnl-netlist-view.test.ts`             | 1       | Export/model contract                           |
| `apps/editor/src/features/netlist-export/rnl-round-trip.test.ts`               | 36      | Export/model contract                           |
| `apps/editor/src/features/project-code/spice-code-language.ts`                 | 1       | Export/model contract                           |
| `apps/editor/src/features/properties/component-identity-properties.test.tsx`   | 1       | Export/model contract                           |
| `apps/editor/src/features/properties/component-identity-properties.tsx`        | 1       | Export/model contract                           |
| `apps/editor/src/features/properties/component-property-details.ts`            | 1       | Export/model contract                           |
| `apps/editor/src/features/selection/test-support/group-drag-fixture.ts`        | 1       | Fixture disclaimer                              |
| `apps/editor/src/features/simulation/simulation-probe-options.test.ts`         | 27      | Protected probe helper                          |
| `apps/editor/src/features/simulation/simulation-probe-options.ts`              | 46      | Protected probe helper                          |
| `apps/editor/src/features/simulation/source-probe-choices.ts`                  | 22      | Protected probe helper                          |
| `apps/editor/src/gallery-client.ts`                                            | 1       | Legacy compatibility                            |
| `apps/editor/src/gallery-topology-match.ts`                                    | 2       | Legacy compatibility                            |
| `apps/editor/src/headless/grade.ts`                                            | 2       | Export/model contract                           |
| `apps/editor/src/headless/local-editor.ts`                                     | 1       | Retirement documentation                        |
| `apps/editor/src/services/preview-editor-services.test.tsx`                    | 1       | Absence regression                              |
| `docs/desktop-distribution-security.md`                                        | 2       | Retirement documentation                        |
| `docs/eda-import.md`                                                           | 1       | Export/model contract                           |
| `docs/overall-product-plan.md`                                                 | 4       | Retirement documentation                        |
| `docs/specs/agent-api.md`                                                      | 4       | Retirement documentation                        |
| `docs/specs/edit-engine.md`                                                    | 2       | Retirement documentation                        |
| `docs/specs/names-and-labels.md`                                               | 3       | Export/model contract                           |
| `docs/specs/netlist-conversion.md`                                             | 7       | Export/model contract                           |
| `docs/specs/netlist-export.md`                                                 | 19      | Export/model contract                           |
| `docs/specs/performance.md`                                                    | 1       | Export/model contract                           |
| `docs/specs/project-file-format.md`                                            | 2       | Retirement documentation                        |
| `docs/specs/rnl-interchange.md`                                                | 4       | Export/model contract                           |
| `docs/specs/schematic-model.md`                                                | 2       | Retirement documentation                        |
| `docs/specs/server.md`                                                         | 1       | Out-of-scope server contract                    |
| `docs/specs/spice-frontend.md`                                                 | 9       | Export/model contract                           |
| `docs/specs/web-agent-session.md`                                              | 6       | Retirement documentation                        |
| `docs/testing/README.md`                                                       | 4       | Retirement documentation                        |
| `docs/testing/contract-matrix.md`                                              | 1       | Retirement documentation                        |
| `docs/user/getting-started.md`                                                 | 1       | Export/model contract                           |
| `docs/user/project-compatibility.md`                                           | 2       | Retirement documentation                        |
| `docs/user/schematic-hierarchy.md`                                             | 1       | Export/model contract                           |
| `docs/user/spice-compatibility.md`                                             | 3       | Export/model contract                           |
| `docs/user/troubleshooting.md`                                                 | 3       | Retirement documentation                        |
| `scripts/convert-project-format.mjs`                                           | 1       | Project compatibility                           |
| `scripts/lib/native-starter-report.py`                                         | 1       | Protected tooling                               |
| `scripts/lib/preview-simulation-qualification.mjs`                             | 13      | Protected tooling                               |
| `scripts/lib/preview-simulation-validation-core.d.mts`                         | 1       | Protected tooling                               |
| `scripts/lib/preview-simulation-validation-core.mjs`                           | 13      | Protected tooling                               |
| `scripts/lib/simulation-smoke-headers.mjs`                                     | 5       | Protected tooling                               |
| `scripts/lib/simulator-busy-wait.mjs`                                          | 5       | Protected tooling                               |
| `scripts/lib/simulator-busy-wait.test.mjs`                                     | 7       | Protected tooling                               |
| `scripts/lib/verify-pr-selection.mjs`                                          | 4       | Validation classifier                           |
| `scripts/production-dual-engine-smoke.mjs`                                     | 18      | Protected tooling                               |
| `scripts/production-dual-engine-smoke.test.mjs`                                | 10      | Protected tooling                               |
| `scripts/user-components-smoke.mjs`                                            | 12      | Protected tooling                               |

The `agent/` directories are excluded by the prescribed grep command. In the
editor Agent directory, remaining names are the unavailable wire host/session
plumbing and its regression, retained Project snapshot/folder-edit compatibility,
netlist/model terminology and the two worker-required legacy test helpers.
`docs/agent/**` remains untouched under the explicit scope exclusion.

## Deviations and open questions

1. **Unit acceptance requires an out-of-scope relay-test update.**
   `worker/agent-session.test.ts:518` expects a missing-folder preparation error,
   then successful preparation/execution. The retired editor correctly returns
   `SIMULATION_UNAVAILABLE` at input. The unchanged test must be retired or
   updated in T007/T005's relay location. Its failure is reported, not excluded
   or weakened.
2. **Browser acceptance has a non-simulation fixture-entry failure.**
   `netlist-workflows.spec.ts:286` opens
   `/editor?example=common-source-amplifier`, then looks for `I_out` and other
   labels in the exported PDF. The captured page is an empty new circuit.
   `git show HEAD:apps/editor/src/app/use-project-entry.ts` already handles only
   `new`/`project`, with no `example` entry, and this task did not modify that
   file or the PDF test. This supports a pre-existing fixture-entry mismatch;
   no baseline checkout/run was performed. Repairing the non-simulation test
   or restoring its removed entry behavior is outside the plan's E2E scope.
3. The deletion acceptance's empty output conflicts with its own protected-
   importer rule and with an unstaged implementation. The seven live paths
   listed above deliberately remain. The rest of the listed indexed paths are
   deleted from the worktree; no files were staged.
4. Some out-of-scope `netlists/native-*` documentation still names removed
   simulation tests, container instructions and `examples/SIMULATION.md`.
   Owned `docs/**` links pass; the netlist fixture documentation needs separate
   cleanup. The preserved deployment script is text required by a worker test,
   not a working deployment after removal of the container bundle.
5. T007 must finish inherited package/API/relay removal and can then remove
   the protected helpers/assets. Expanding simulator-tooling cleanup should
   also name the two retained smoke entrypoints and the fixture documentation.
