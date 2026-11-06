# T006 — Remove simulation from the editor, hosts and tooling

- Branch: `task/T006-remove-simulation-ui`
- Base: `main` at `00149a1`
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Runs in parallel with T005 (Agent relay); owned paths are disjoint.
- Status: approved

## Goal

auto-canvas draws and edits schematics; it does not simulate. Remove the
inherited simulation from the editor and its hosts: the Simulate entry and
workspace, run history, waveforms and results, simulation examples, the
editor's Agent simulation handlers, the local-host and Vite simulation
endpoints, simulator containers, simulator/qualification scripts and their
fixtures, and the simulation user docs. The 3 inherited failing tests in
`simulation-artifact-files.test.ts` disappear with their code, and CI no
longer needs to exclude them.

**Keep:** the Project file format and model, including simulation source
folders stored in Projects (they load and save unchanged; the editor just no
longer shows or runs them); netlist export (SPICE/Spectre/RNL) and its
process/model presets; device model binding and external model sources used
by netlist export and hierarchy; Project Code; everything outside the owned
paths.

The packages `@icm/simulation-service` and `@icm/spice-run`, the Agent API
simulation operations in `@icm/agent-adapter`/`agent-client`/`mcp-server`,
Agent docs, `worker/` and `apps/server` are **not** touched here; T007
removes what remains after this task and T005 merge. Editor-side Agent
simulation operations answer a clear "unavailable" error, as T001 did for
Gallery operations.

## Context

Verified on `main` at `98fcbcd`:

- Capability: `capabilities.simulation` (`apps/editor/src/services/editor-services.tsx`);
  web sets `true` (`services/web-editor-services.ts`), desktop `false`
  (`services/preview-editor-services.ts`).
- Editor simulation UI: `apps/editor/src/features/simulation/` (~100 files
  including code workspace, run archive, artifact store, probe options,
  problem view, example cards), `app/editor-simulation-surface.tsx`,
  `app/use-simulation-surface.ts`, wiring in `app/App.tsx`,
  `app/editor-dialogs.tsx`; examples `src/examples/SIMULATION.md`,
  `src/examples/simulation-examples.ts`.
- Editor Agent handlers: `agent/browser-agent-simulation-host.ts`,
  simulation parts of `agent/browser-agent-file-host.ts` and
  `agent/use-agent-session.ts`; test support
  `agent/live-simulation.test-support.ts` (also imported by
  `worker/agent-session.test.ts`, which T005 moves to
  `apps/server/src/agent-relay/` — see Notes).
- `features/hierarchy/{external-model-source-editor,external-circuit-editor,cell-manager-dialog}.tsx`
  import `@icm/simulation-service`/`@icm/spice-run`. Investigate whether
  these uses are simulation or model-source/netlist concerns; keep the
  latter.
- Hosts: `apps/local-host/src/{simulation-endpoint,simulation-adapter}.ts`
  and tests, `--simulation-url` in `cli.ts`, `simulationHandler` in
  `index.ts`; Vite plugin `apps/editor/dev/local-simulation.ts` registered at
  `apps/editor/vite.config.ts:11,74`.
- Tooling: `containers/` (ngspice, simulation, vacask); scripts
  `analyze-/build-/run-native-simulation-examples*`, `native-*`,
  `package-ngspice-harness`, `package-vacask-*`, `vacask-*`, `sg13g2-*`,
  `production-sg13g2-smoke`, `preview-simulation-smoke*`,
  `simulation-acceptance*`, `simulation-control-runtime.test`,
  `simulation-source-native.test`, `simulation-stream-r2.test`,
  `model-source-smoke`, and their `scripts/lib` modules (`vacask*`,
  `preview-simulation*`, `native-example*`, `simulator-busy-wait*`,
  `simulation-smoke-headers`, `preview-candidate*`, ...). Root
  `package.json` script `sim:accept:roundtrip`; `vitest.config.ts`
  `standaloneTests` list and `knownFailingInCi`;
  `config/vacask-preview-environment.json`; fixtures `fixtures/ngspice-failures`,
  `fixtures/ngspice-rawfile`, `fixtures/simulation-acceptance`.
- Docs: `docs/specs/simulation*.md` (4), `docs/user/analog-simulation.md`,
  `docs/adr/simulation.md`, plus links to them from other docs.
- Baseline `pnpm check` on `main`: only the 3 `simulation-artifact-files`
  failures.

## Scope

Owned paths:

- `apps/editor/src/**` (simulation UI, wiring, examples, editor Agent
  simulation handlers and their tests), `apps/editor/e2e/**` (simulation
  specs: `agent-simulation.spec.ts`, `simulation-workspace.spec.ts`, and
  simulation cases in other specs), `apps/editor/dev/local-simulation.ts`,
  `apps/editor/vite.config.ts` (only the simulation plugin lines)
- `apps/local-host/**`, `apps/desktop/**` (only simulation leftovers)
- `containers/**`, simulation `scripts/**` and `scripts/lib/**` listed in
  Context, `config/vacask-preview-environment.json`, the three fixtures
- Root `package.json` scripts, `vitest.config.ts`, `knip.config.js`,
  `playwright.config.ts` (only simulation entries)
- `docs/**` except `docs/agent/**` and `docs/specs/server.md`;
  `README.md`/`README_zh.md` status lines about simulation

Out of scope: `packages/**`, `apps/mcp-server/**`, `apps/server/**`,
`worker/**`, `docs/agent/**`, generated files, dependencies. If a deletion
needs a change there, keep the code and report it.

## Steps

1. Turn simulation off: remove `capabilities.simulation` (all hosts false
   first, then delete the flag and every branch it gated).
2. Delete the editor simulation feature, surface, wiring and examples; make
   editor Agent simulation operations return a clear unavailable error with
   a regression test (like `GALLERY_UNAVAILABLE` in
   `agent/browser-agent-project-host.ts`). Investigate and report the
   `features/hierarchy` imports (Context).
3. Keep Projects' simulation folders round-tripping: a test that loads a
   Project with simulation source folders, edits something else, saves, and
   gets the folders back byte-identical.
4. Remove the local-host and Vite simulation endpoints.
5. Delete containers, simulator scripts and libs, config and fixtures that
   only simulation uses (check importers repo-wide; keep anything a kept file
   or `worker/`/`packages`/`apps/server` imports and report it).
6. Remove `knownFailingInCi` from `vitest.config.ts` once
   `simulation-artifact-files.test.ts` is gone; drop simulation entries from
   `standaloneTests`, `package.json`, `knip.config.js`, `playwright.config.ts`.
7. Delete the simulation docs, fix links, update README status lines.
8. Sweep: `grep -rniE "simulat|ngspice|vacask|waveform" apps/editor/src apps/local-host/src scripts docs --exclude-dir=agent`
   and justify every remaining hit in the report.

## Acceptance

Run with lane 2:

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm check                      # passes with no failing test
CI=true pnpm test:local         # passes
pnpm test:desktop-build         # exit 0
pnpm mcp:package                # exit 0
pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/netlist-workflows.spec.ts --workers=1   # pass
git ls-files containers config/vacask-preview-environment.json apps/editor/src/features/simulation   # no output
```

Behavioral (Opus verifies): no Simulate button or simulation panel; opening
a Project that has simulation folders and saving it keeps them.

## Notes for the implementer

- T005 runs at the same time in another worktree and moves
  `worker/agent-session*.ts` to `apps/server/src/agent-relay/`. Do not touch
  `worker/` or `apps/server/`. `apps/editor/src/agent/live-simulation.test-support.ts`
  is imported by the relay tests: if it must change or go, keep exporting
  what `worker/agent-session.test.ts` imports and report it.
- Prefer deleting over flagging, as in T001.
