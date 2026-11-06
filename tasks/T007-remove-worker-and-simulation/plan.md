# T007 — Delete the Cloudflare Worker and the remaining simulation code

- Branch: `task/T007-remove-worker-and-simulation`
- Base: `main` at `f8e259f`
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
- Runs in parallel with T009; see Notes for the shared files.
- Status: approved

## Goal

`apps/server` now serves everything the editor and Agents use, and the editor
no longer simulates. Remove what is left of both:

1. **The Cloudflare Worker**: `worker/` (about 100 files), root
   `wrangler.jsonc` / `wrangler.preview.jsonc`, the local replica tooling
   (`apps/editor/dev/{agent-worker.ts,wrangler.json,replica-wrangler.json,local-replica.ts,replica-import.ts}`,
   root scripts `dev:replica`, `replica:import`), the Worker-only analytics in
   `apps/editor/analytics/`, the editor's Gallery helpers that only the Worker
   imported, and the `wrangler` dependency.
2. **The simulation code**: `@icm/simulation-service`, `@icm/spice-run`, the
   Agent API simulation operations and artifact transfer (`@icm/agent-adapter`,
   `@icm/agent-client`, `apps/mcp-server` tools, the relay's simulation
   forwarding and `agent-artifacts.ts`, the editor's simulation-unavailable
   handlers), the simulation helpers and container files T006 kept, and the
   simulation Agent docs.

**Keep:** loading legacy Projects (their simulation setups migrate to source
folders on load), Projects' simulation source folders (they round-trip
unchanged), netlist export with model sources, every other Agent operation,
and all behavior the Worker's tests covered that `apps/server` now owns.

## Context

Verified on `main` after T006 (#9):

- Importers of `worker/` outside it: `apps/server/src/component-library.test-support.ts`,
  `apps/desktop/src/component-library.test.ts`,
  `apps/editor/e2e/user-components.spec.ts`,
  `apps/editor/analytics/persistence-contract.test.ts`,
  `apps/editor/src/request-failure.test.ts`, `apps/editor/src/gallery-client.ts`,
  `apps/editor/src/features/user-components/component-publication-{operation,host}.test.ts`,
  `apps/editor/src/agent/{component-publication-live,component-authoring-target-live,component-management-live,browser-agent-components}.test.ts`,
  `apps/editor/src/agent/live-simulation.test-support.ts`,
  `packages/component-library/src/component-library-contract.test.ts`,
  `packages/simulation-service/src/sg13g2-execution.test.ts`. Most of these
  tests run the editor's component and Agent code against the Worker's
  in-memory component library; `apps/server` now implements that contract
  (`apps/server/src/component-library.ts`, its test support, tests on
  `auto_canvas_test`).
- `wrangler` users: `apps/editor/package.json` (devDependency),
  `apps/editor/dev/{local-replica,replica-import}.ts`,
  `apps/editor/analytics/persistence-contract.test.ts`,
  `scripts/lib/distribution-security.mjs`, root `wrangler*.jsonc`.
- Simulation importers outside the two packages: editor
  `app/App.tsx`, `app/editor-dialogs.tsx`,
  `features/hierarchy/{external-model-source-editor,external-circuit-editor,cell-manager-dialog}.tsx`
  (types `SimulationSourceLocation`, `SimulationSourceDiagnostic` for opening
  and diagnosing Project-owned model sources — a netlist/model concern, per
  T006's investigation), `features/simulation/source-probe-choices.ts` and
  `simulation-probe-options*` (kept by T006), `agent/live-simulation.test-support.ts`;
  `apps/server/src/agent-relay/agent-artifacts.ts`;
  `apps/mcp-server/src/{local-workspace,prepare-plot,prepared-summary,operations,artifact-download}.ts`;
  `packages/agent-adapter/src/{schema,openapi,simulation-resource,file-resource}.ts`;
  `packages/agent-client/src/http-client.ts`.
- Legacy loading: `packages/project-protocol/src/transforms/simulation-source.ts`
  calls `migrateSimulationSetupToSource` in
  `packages/netlist/src/simulation-source-migration.ts`, which imports one
  pure function, `deckRequestsRawfile`, from `@icm/spice-run`
  (`packages/spice-run/src/deck.ts:58`). Tests:
  `project-protocol/src/{simulation-setup-migration,raw-simulation-setup-migration}.test.ts`,
  `netlist/src/simulation-source-*.test.ts`.
- Generated outputs: Agent docs (`pnpm agent-docs:generate` →
  `packages/agent-adapter/src/agent-docs.generated.ts`,
  `apps/mcp-server/src/resources.generated.ts`, `docs/agent/*.generated.*`),
  Agent kit catalog (`pnpm agent-kit:catalog`), OpenAPI artifacts
  (`pnpm agent-api:artifacts`). Sources in `docs/agent/` include
  `simulation-specs.md`, `simulation-result-handoff.md`,
  `simulation-evidence-storage.md`.
- Contracts: `docs/specs/agent-api.md`, `docs/specs/web-agent-session.md`,
  `docs/specs/server.md`.

## Scope

Owned paths: `worker/**`, root `wrangler*.jsonc`, `apps/editor/dev/**` (the
replica and Worker files), `apps/editor/analytics/**`, `packages/simulation-service/**`,
`packages/spice-run/**`, `packages/agent-adapter/**`, `packages/agent-client/**`,
`packages/netlist/**` (only the migration helper), `packages/component-library/**`
(tests), `apps/mcp-server/**`, `apps/server/src/agent-relay/**` except
`host.ts`, `apps/server/src/component-library.test-support.ts` and other
server tests, `apps/desktop/**` (tests), `apps/editor/src/**` except the T009
files below, `apps/editor/e2e/**` except the three T009 specs,
`docs/agent/**`, `docs/specs/**` except `server.md` sections T009 edits,
`scripts/**`, `containers/**`, root `package.json` and `knip.config.js`,
`vitest.config.ts`, `tsconfig*.json`, `pnpm-workspace.yaml`,
`apps/editor/package.json` and `pnpm-lock.yaml` (only to remove `wrangler`
and the deleted packages).

Out of scope (T009 runs in parallel): `apps/editor/src/app/use-project-entry.ts`,
`apps/editor/src/document/project-workspace.ts`, `apps/editor/src/examples/**`,
`apps/editor/src/features/editor-shell/cloud-projects.ts`,
`apps/editor/src/services/web-editor-services.ts`,
`apps/editor/src/components/shelf-wall.tsx`, `apps/server/src/projects.ts`,
`apps/editor/e2e/{netlist-workflows,netlist-code-edit,rnl-interchange}.spec.ts`.
Also out of scope: `apps/server/src/agent-relay/host.ts` (T008 follows),
`packages/model/**`, `packages/project-protocol/**` except tests that import
deleted packages.

## Steps

1. **Retarget Worker-backed tests first.** For each test that imports
   `worker/`, run the same editor/desktop/package code against
   `apps/server` (its component-library app on `auto_canvas_test`, as
   `apps/server/src/component-client.test.ts` does) or against a local fake
   when the test does not need a server. Drop only assertions that need
   multiple accounts or a Worker-only feature (Gallery, auth providers,
   analytics) and list each in the report. The suite passes before step 2.
2. **Delete the Worker** and the replica/analytics tooling. Remove the
   editor's Gallery helpers that nothing imports any more (`gallery-*.ts`,
   `gallery-source.ts`, `usage-policy-note.ts` if unused, ...). Remove
   `wrangler` from `apps/editor/package.json` with
   `pnpm --filter @icm/editor remove wrangler --offline` (report if pnpm needs
   the network; do not change other dependencies).
3. **Move model-source types and the deck helper.** Move
   `SimulationSourceLocation`, `SimulationSourceDiagnostic` (and anything else
   the kept editor/netlist code uses) to the package that owns model sources
   (investigate: `@icm/netlist` or `@icm/model`; report the choice), and
   `deckRequestsRawfile` into `packages/netlist/src/simulation-source-migration.ts`
   or a sibling. Update importers. Legacy-loading tests pass.
4. **Remove simulation from the Agent API**: operations, schemas, OpenAPI
   paths, artifact transfer, MCP tools, the relay's simulation forwarding and
   `agent-artifacts.ts`, the editor's unavailable handlers and the
   `/simulation` and `/artifacts` relay routes. Regenerate Agent docs,
   catalog and OpenAPI artifacts with their scripts after editing the
   `docs/agent` sources. Document the removed operations in
   `docs/specs/agent-api.md`.
5. **Delete** `packages/simulation-service`, `packages/spice-run`, T006's kept
   simulation helpers and container files, and their references (workspace,
   tsconfig, knip, vitest).
6. **Sweep**: `grep -rniE "worker/|wrangler|durable object|simulation-service|spice-run|ngspice|vacask"`
   over kept files; justify each remaining hit in the report.

## Acceptance

Run with lane 1:

```bash
pnpm check                                   # passes
CI=true pnpm test:local                      # passes
pnpm mcp:package && pnpm headless:package && pnpm test:desktop-build   # exit 0
pnpm exec vitest run apps/server packages/project-protocol packages/netlist   # pass
pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts apps/editor/e2e/agent-bus-productivity.spec.ts apps/editor/e2e/user-components.spec.ts apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts --workers=1   # pass
git ls-files worker packages/simulation-service packages/spice-run containers wrangler.jsonc   # no output
```

## Notes for the implementer

- T009 runs in parallel in another worktree. Do not edit its files (Out of
  scope). `App.tsx` and `use-agent-hosts.ts` are shared: T009 changes only
  the boot check for `?example=`; keep your edits there to imports and the
  simulation handlers.
- Retarget tests before deleting the code they import, so coverage moves
  instead of disappearing.
- If a dependency removal needs the network, stop that part and report it.
