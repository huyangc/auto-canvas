# T007 report — round 2

## Summary

Removed the Cloudflare Worker, root Wrangler configuration, replica tooling,
Worker analytics, unused editor Gallery helpers, simulation packages, editor
probe helpers and hosted simulation smoke scripts. Removed every deleted
workspace-package reference from package manifests, TypeScript, Vitest, Knip
and workspace build configuration. Updated the server README and broken
persistence documentation links.

All four must-fix findings are addressed. The remaining plan limitation is
container cleanup: two passive fixtures are still imported by an out-of-scope
device test. They are preserved rather than breaking or changing that test.
The lockfile and installation state are left for Opus as the round 2 plan
requires. No commit, staging, branch change, plan edit or review edit was made.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Round 1 retargeting was accepted by review. The real-server component tests and all six browser specs are rerun below. No additional component assertions were removed in round 2. |
| 2 | done | Removed the Vite replica plugin, `worker/`, both root Wrangler configs, the five replica/Worker dev files, `apps/editor/analytics/`, all unused `gallery-*.ts` helpers/tests and the root replica commands. Wrangler had already been removed by Opus; no package manager dependency command was run. |
| 3 | done | Accepted round 1 implementation remains: netlist owns model-source locations/diagnostics and the private migration rawfile predicate. Legacy-loading and netlist checks pass. |
| 4 | done | Accepted round 1 API/MCP/relay retirement remains. Corrected the server README's retired simulation/artifact claims. Reran all three generators; their outputs did not change. |
| 5 | partial | Deleted both simulation packages, all manifest references, editor probe helpers/tests, simulator qualification/smoke scripts and the VACASK deployment script. Retargeted netlist tests to independent raw-output readers under `src/test-support/`. Preserved two container fixtures required by the out-of-scope device tests; details below. |
| 6 | done | Swept existing tracked/new files with the requested expression. Remaining matches are classified below; no kept operational code imports either deleted package or the Worker. |

## Review findings addressed

1. **Vite replica/Worker registration:** removed the `localReplica` import and
   invocation before deleting its provider. Kept the Node API/Agent proxies,
   netlist conversion plugin, browser Workers and static service worker.
2. **Netlist/local-host dependencies:** removed the unused local-host spice-run
   dependency; moved the two pure rawfile readers and their rejection/fixture
   tests into netlist test support. Retargeted every netlist import from the
   deleted packages. Ngspice compiler tests inspect raw plots directly;
   native model checks compile Project sources directly. Both packages are
   deleted. No simulation execution API was moved into production netlist.
3. **Server README:** removed simulation replies, artifact-storage 503 claims
   and legacy dev Worker instructions; documented retired routes returning 404
   and the current PostgreSQL component browser harness.
4. **Workspace references:** removed `@icm/simulation-service` and
   `@icm/spice-run` from root, editor, MCP server, local-host, agent-adapter and
   netlist manifests. No package manifest still names them. The lockfile and
   `node_modules` were not refreshed, following the explicit round 2 rule.

## Acceptance results

Every acceptance run uses lane 1:
`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
Server/database/browser runs used sandbox escalation for localhost access.
Packaging used `npm_config_cache=/tmp/t007-r2-npm-cache`.

```text
pnpm check
  → exit 0; format, documentation links, generated outputs, component
    generation, typecheck, lint, local tests and workspace build passed.
    oxlint: 1897 files, 0 errors, 2433 warnings.
    734 passed test files, 2 skipped; 7255 passed tests, 116 skipped.

CI=true pnpm test:local
  → exit 0; 734 passed files, 2 skipped;
    7255 passed tests, 116 skipped (7371 total).

pnpm mcp:package && pnpm headless:package && pnpm test:desktop-build
  → exit 0; all three commands completed.

pnpm exec vitest run apps/server packages/project-protocol packages/netlist
  → exit 0; 129 passed files, 1 skipped;
    1489 passed tests, 110 skipped (1599 total).

pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts apps/editor/e2e/agent-bus-productivity.spec.ts apps/editor/e2e/user-components.spec.ts apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts --workers=1
  → exit 0; 79 passed, 0 skipped, 0 retries/flaky cases.
    Elapsed 242.319 s; cumulative attempt time 234.525 s;
    slowest single attempt 8.388 s.

git ls-files worker packages/simulation-service packages/spice-run containers wrangler.jsonc
  → exit 0, 206 index entries; the no-output acceptance condition FAILS.
    204 paths have been deleted on disk but remain unstaged in the index.
    Two paths still exist, both passive device-test fixtures listed below.

pnpm agent-docs:generate
pnpm agent-kit:catalog
pnpm agent-api:artifacts
  → exit 0; generators ran, generated outputs unchanged.

pnpm format:check (after final comment cleanup)
pnpm docs:check (after writing the report)
git diff --check
  → exit 0.
```

Initial attempts and corrections:

- Focused server tests inside the sandbox failed with
  `connect EPERM 127.0.0.1:5432`; the escalated run passed.
- The first full check found two broken links to deleted Worker Project
  storage/handlers. Replaced them with the current server Project handler and
  server contract; the subsequent full check passed.
- The successful browser run logged transient `/api/auth/providers` and
  `/api/auth/me` proxy connection refusals to port 4310 in its standalone
  dev-relay scenario; all 79 cases passed without retries.
- An intermediate typecheck identified stale raw-plot field names and a
  service-specific compiler argument. Corrected them before the successful
  full check. No test was skipped or weakened to pass acceptance.

Raw logs: `/tmp/t007-r2-check.log`, `/tmp/t007-r2-local.log`,
`/tmp/t007-r2-focused.log`, `/tmp/t007-r2-browser.log`,
`/tmp/t007-r2-artifacts.log`, `/tmp/t007-r2-ls-files.log`.
Packaging output is in the round 2 tool transcript.

## Investigation results

### Model sources and netlist coverage

`@icm/netlist` remains the owner of model-source locations and diagnostics;
its Project model-source inspection/export code already owns those concerns.
The migration predicate remains private to legacy setup migration. Project
source folders, legacy transforms and production model/netlist behavior are
unchanged.

`packages/netlist/src/test-support/{rawfile,vacask-rawfile}.ts` contain only
pure readers used by netlist tests. Their original malformed-input, truncated,
nonfinite and captured-file tests moved with them; fixture paths were adjusted
for the new directory. No production export references these readers. Historical
SKY130/SG13 Profile JSON is test data for the existing starter/netlist tests.

The four ngspice compiler execution cases keep the checks for paired noise
plots, finite densities and integrated noise, opposing terminal currents,
all emitted OP/AC vector names, exact divider values and hierarchical current
instrumentation. The harness now joins compiler-produced source and reads raw
plots without a service result adapter.

The optional native device execution case keeps module identity, independently
captured N/P values, exact occurrence/acquisition mappings and repeated-run raw
keys. It now passes the same model bytes as a Project source file to the public
netlist compiler. The removed assertions belong to retired surfaces: GUI probe
picker count, service capability-schema digest validation, output-result schema,
result-adapter OP rows/analysis indices and phantom-row suppression. Netlist
conditional/ambiguous/shadowed model and digest/section rejection assertions
remain. VACASK-dependent checks retain their existing environment gates;
no new skips were introduced and no new electrical qualification is claimed.

Deleted Worker/analytics/Gallery tests cover retired hosted auth, moderation,
Gallery curation/pagination/usage policy, backups/replica, analytics persistence
and Worker runtime wiring. The server now owns Project persistence, component
publication/lifecycle, Agent relay and static routing; their contract suites
remain and passed. Round 1's accepted component coverage migration is retained.
Its dropped/adapted assertions were specifically:

- Account-switch cache clearing and cross-account private/deleted visibility.
- The second-account publication recovery/create-copy path.
- Sign-in-provider/sign-out and anonymous-publication-disabled journeys.
- Another account's deletion denial, foreign-author update denial and fork.
- Cross-editor capture now uses the local principal and local-admin labels;
  offline catalog/focus/retry, stale revisions, recovery and layout remain.

The removed simulation packages' service/executor/result-adapter tests,
probe UI tests and hosted simulator smoke tests have no retained runtime
surface. Their raw-format readers/tests and independent netlist checks survive
as described above. No component/server acceptance coverage was deleted.

### Remaining-reference sweep

Expression: `worker/|wrangler|durable object|simulation-service|spice-run|ngspice|vacask`,
case-insensitive, over existing tracked and new nonignored text files,
excluding this report. The literal grep sweep found 1509 matching lines.
Evidence: `/tmp/t007-r2-sweep.log`.

| Remaining paths / matches | Justification |
| --- | --- |
| `pnpm-lock.yaml` | Explicit round 2 instruction reserves lockfile/installation refresh for Opus. Its deleted-package importer/resolution records remain until then. |
| `containers/ngspice/sg13g2/profile.json`, `containers/ngspice/cells/sky130_fd_sc_hd.spice` | Passive model/profile fixtures still imported by `packages/devices/src/reviewed-external.test.ts`, outside owned paths. No executor/container runtime remains. |
| `packages/netlist/**`, `packages/model/**`, `packages/project-protocol/**` | Preserved dialect/model identities, model-source inspection/export, Project-owned source folders, legacy migration, netlist compilers and compatibility/electrical fixtures. Netlist test support is independent captured-output inspection, not product execution. |
| Other `packages/{devices,components,edit-engine,rnl,spice}/**` | Kept device/model contracts, parameter validation, circuit import/export and source-language semantics. Simulator names describe file dialects or captured electrical evidence; these packages are outside the deletion scope. |
| `apps/editor/src/examples/**`, `netlists/**`, `fixtures/**` | Portable Projects, authored source/model text and independent historical captures. These preserve source-folder round trips and netlist/model evidence. |
| `apps/editor/dev/netlist-conversion.test.ts`, editor netlist-export/project-code/properties files and tests | Supported SPICE dialects, exported process/model names and source/model editing remain product behavior. |
| `apps/server/src/agent-relay/{agent-session-do.ts,agent-session-status.test.ts}`, `apps/server/src/components.ts`, Agent adapter session/file comments | Inherited Durable Object terminology and serialization/message-limit compatibility; the Node relay is retained and its host replacement belongs to T008. |
| `packages/agent-adapter/src/authoring-helper.test.ts` | Regression explanations for retained source/parameter validation use historical ngspice failures. |
| `scripts/desktop-package-security.test.mjs`, `scripts/desktop-security-scanner-contract.mjs`, `scripts/lib/lint-report.test.mjs` | Synthetic `worker/...` archive/diff paths test secret scanning and deleted-file lint handling, not imports or runtime code. |
| `scripts/lib/distribution-security.mjs` | `.wrangler` remains an intentional secret-directory blacklist entry. |
| `scripts/lib/verify-pr-selection.mjs` | Preserved exclusion of simulation/VACASK netlist helpers from symbol-model qualification; those source/model concerns remain. Retired Worker/container runtime path selectors were removed. |
| `scripts/lib/native-starter-report.py` | Historical standalone calculation helper linked by five out-of-scope `netlists/native-*` READMEs. Kept to preserve their captured-evidence provenance and links; no product imports it. |
| `.gitattributes`, `.gitignore` | Fixture byte-preservation rules and historical container staging ignores are outside owned paths. |
| `docs/**`, `README*.md`, `tasks/**`, `.claude/skills/plan-task/SKILL.md`, `flake.nix` | Retained dialect/file-format/electrical evidence, historical migration decisions/task records and out-of-scope repository/environment guidance. Broken live Worker links in the owned persistence spec were corrected. |

## Deviations and open questions

- **Container fixture scope:** deleting
  `containers/ngspice/sg13g2/profile.json` and
  `containers/ngspice/cells/sky130_fd_sc_hd.spice` would break imports at
  `packages/devices/src/reviewed-external.test.ts:4` and `:686`. The widened
  plan still does not own `packages/devices/**`. Following AGENTS.md step 3,
  stopped this part of step 5 and preserved those exact fixture bytes. A
  follow-up needs to authorize retargeting that test to test-owned fixtures
  before the last two container files can be deleted.
- The standalone starter-report helper is still linked from out-of-scope
  netlist evidence READMEs. Removing it requires relocating the evidence helper
  and updating those links; it has no application/runtime caller.
- `git ls-files` inspects the index, so an unstaged implementation cannot meet
  its literal no-output condition even for paths already removed on disk.
  No staging was performed. Opus can verify the final index after review.
- Opus must refresh `pnpm-lock.yaml` and `node_modules`; no install/remove/add,
  network dependency operation or manual generated-file edit was performed.
