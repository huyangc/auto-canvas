# T002 report — round 1

## Summary

Removed upstream CI/gates, hosted delivery/release tooling, unused Gallery
scripts/build modules/census/source helpers, and the upstream skill/reference
process. Added the specified local `pnpm check`, rewrote README in Chinese
(32 lines), and repaired documentation links and maps. Kept local MCP/headless
packaging, desktop behavior, native simulation code, Worker dependencies and
regression fixtures.

Status: **partial**. The plan excludes the formatter from edits, but deleting
`references/` makes its required glob fail before the rest of `pnpm check`.
All later checks were run separately: the final unit run has exactly the three
known simulation failures. The Gallery regression corpus and one migration
helper must remain because kept tests consume them.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Removed `.github/`, validation catalog and gate/CI commands/tests; retained CI-named libraries required by local tests/lint.                                                                                                                                                                                                                               |
| 2    | done    | Removed hosted deploy/release scripts and exclusive helpers; retained MCP packaging integrity and native-runner candidate verification libraries with their regression tests.                                                                                                                                                                              |
| 3    | partial | Removed Gallery tooling, census, three build modules/tests and 11 unused source helpers/tests. Rewrote the controlled-source persistence test around JSON payload/server serialization. Retained corpus fixtures and format-migration helper because kept tests require them.                                                                              |
| 4    | done    | Removed `.agents/`, root `references/`, setup/reference tooling, named docs/specs and upstream changelog. Updated review standards and documentation links. Historical deployment ADR now points readers to the local workflow.                                                                                                                            |
| 5    | partial | Removed retired root scripts and added the exact `check` chain. Removed Knip census entries; classified the Library fixture registry as test-only after its Gallery type importer was deleted. Reviewed Vitest/Playwright; no deleted Vitest entry remains, and Playwright's retired timing-command comment was updated. Formatter scope conflict remains. |
| 6    | done    | Chinese README covers purpose, APR, manual refinement, origin, license, install/dev/check, layout and workflow. Documentation map lists existing targets.                                                                                                                                                                                                  |
| 7    | done    | Swept all kept tracked files; every remaining hit is classified below.                                                                                                                                                                                                                                                                                     |

## Review findings addressed

Round 1: no task `review.md` exists.

## Acceptance results

```text
pnpm check → 2
  [error] No files matching the pattern were found: "references/**/*.json".
  All matched files use Prettier code style!
  Stops at format:check; later checks were run individually, not removed.

pnpm mcp:package → 0 (npm_config_cache=/private/tmp/t002-npm-cache)
  pnpm build completed successfully.
  analog-canvas-mcp-server-0.17.88.tgz
  output/mcp/analog-canvas-mcp-v0.17.88

pnpm headless:package → 0
  Bundled the headless workspace into output/headless/analog-canvas-headless.mjs

pnpm test:desktop-build → 0
  Vite built successfully; existing large-chunk warning only.

pnpm deadcode → 1
  39 unused exports; 5 unused exported types; no unused files.
  The first Knip failure prevents the chained production check.

pnpm exec knip --production --no-progress → 1 (additional diagnostic)
  48 unused exports; 5 unused exported types; no unused files.

git ls-files .github .agents references config/validation-gates.json apps/editor/census → 0
  No output.
```

Additional checks to complete the evidence after `pnpm check` stopped:

```text
pnpm docs:check → 0; Validated local Markdown links in 86 files
pnpm agent-docs:generated:check → 0; 6 outputs, 0 stale
pnpm components:check → 0; 110 components, 38 electrical descriptors,
  66 subcircuit descriptors; 106 Razavi symbol assets, 1 semantic primitive
pnpm typecheck → 0
pnpm lint → 0; 2274 files, 0 errors, 2776 warnings
pnpm test:local → 1 (final run with local loopback permissions)
  Test Files  1 failed | 894 passed | 3 skipped (898)
  Tests       3 failed | 8764 passed | 135 skipped (8902)
  All failures: apps/editor/src/features/simulation/simulation-artifact-files.test.ts
    :42 keeps diagnostic bytes exportable without classifying them as Explorer outputs
    :81 packages a group into category folders without changing artifacts
    :103 packages selected source and temporary artifacts into one hierarchy
  Each expects archive.ok === true and receives false.
pnpm exec prettier --check package.json knip.config.js playwright.config.ts
  packages/project-protocol/src/controlled-source-persistence.test.ts → 0
  All matched files use Prettier code style!
git diff --check / git diff --cached --check → 0
```

The initial sandboxed unit run could not serve local HTTP harnesses and was
terminated before retrying with loopback permissions. An intermediate full run
exposed file-based corpus readers that the import scan missed; the corpus was
restored before the final run. That intermediate run also had one transient
Ngspice health assertion (401 instead of 503); it passed on the final full run.
MCP's first packaging attempt could not write npm's user cache; directing the
cache to writable temporary storage resolved it without changing source or
installing dependencies. Logs are in `/private/tmp/t002-*.log` for this session.

`pnpm dev` behavioral verification remains assigned to Opus by the plan.

## Investigation results

No explicit “Investigate:” step was present. Import/deletion audit results:

| Retained path                                                                                                                                     | Kept consumer / reason                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/ci-package-build.mjs`                                                                                                                | `scripts/test-standalone-setup.mjs` builds/verifies local standalone-test dependencies.                                                                                                                                                                                    |
| `scripts/lib/verify-pr-selection.mjs`                                                                                                             | `scripts/lib/lint-report.mjs` imports `changedLines`. Its gate-dependent test file was removed; local lint-report tests remain.                                                                                                                                            |
| `scripts/lib/mcp-release-integrity.mjs` and test                                                                                                  | `scripts/package-mcp.mjs` requires packaging hash/integrity checks.                                                                                                                                                                                                        |
| `scripts/lib/preview-candidate.mjs` and `scripts/preview-candidate.test.mjs`                                                                      | `scripts/run-native-simulation-examples.mjs` verifies served candidate bytes; native scripts stay for T004.                                                                                                                                                                |
| `scripts/prepare-gallery-format-migration.mjs`                                                                                                    | Kept `scripts/convert-project-format.test.mjs` dynamically imports and tests lossless bounded migration preparation.                                                                                                                                                       |
| `fixtures/gallery-redline/*.icproj.json` (six files) and README                                                                                   | Kept edit-engine topology/route/angled-wire tests, project-protocol bound-format migration tests, and MCP results tests read individual files or enumerate the entire corpus. README now describes frozen offline maintenance, with the removed refresh procedure deleted. |
| `apps/editor/src/gallery-search.ts`, `gallery-reserved-ids.ts`, `gallery-client.ts`, `gallery-topology-match.ts`, `gallery-topology-selection.ts` | Direct Worker imports, including type imports.                                                                                                                                                                                                                             |
| `apps/editor/src/gallery-filters.ts`, `gallery-order.ts`, `gallery-scan-request.ts`, `gallery-sources.ts`, `gallery-focus.ts`                     | Transitive dependencies of retained Worker-facing Gallery helpers; associated tests remain.                                                                                                                                                                                |
| `apps/editor/src/gallery-source.ts`                                                                                                               | `apps/editor/dev/local-replica.ts` still imports the local-replica constant; dev files are out of scope.                                                                                                                                                                   |
| `apps/editor/src/usage-policy-note.ts`                                                                                                            | Worker auth/usage/rate-limit modules and editor request-failure code still import it.                                                                                                                                                                                      |
| `apps/editor/analytics/{routes,worker}.ts`                                                                                                        | Worker-owned analytics stays unchanged.                                                                                                                                                                                                                                    |
| `config/agent-mcp-distribution.json`, `config/gallery-*.json`                                                                                     | Explicitly preserved packaging/Worker contracts.                                                                                                                                                                                                                           |
| `scripts/lib/distribution-security.mjs`, `native-example-runner.mjs`, `png-io.mjs`, `razavi-fidelity.mjs`, `razavi-reference-authority.mjs`       | Preserved external or generator/native/desktop consumers; unchanged.                                                                                                                                                                                                       |
| `apps/editor/src/examples/library-examples.ts`                                                                                                    | Kept clipboard, netlist, component-source and fixture tests use it. Its only production-tree dependency was a type import in deleted Gallery commands. Knip now classifies it with test fixtures for production analysis.                                                  |

Recursive grep audited proposed deletion names, followed by a whole-repository
relative-import resolution scan. The final scan found no remaining relative
imports of removed files. File-read consumers require retaining the corpus as
listed above. No generated outputs changed: the Agent generator reports zero
stale outputs, so regeneration was unnecessary.

The controlled-source persistence test still verifies all control identities
and directions through repeated saves, both SPICE/Spectre netlists, a portable
payload plus server parse/serialize boundary, unfinished controls, migration
rejection and invalid-control rejection. Only the retired Gallery publication
wrapper/status assertion was removed.

### Sweep classifications

The requested expression found **189 hits in 64 kept tracked files**. The scan
excluded Worker, dependencies, task records, AGENTS.md and CLAUDE.md, and did not
traverse ignored build output or other checkouts. Each row accounts for every
matching line in that file; no retained hit is an active removed root command.
Stale comments and out-of-scope upstream documentation are explicitly noted.

| File                                                                   | Hits | Justification                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.claude/skills/plan-task/SKILL.md`                                    | 1    | Out of scope; “Investigate:” contains the substring `gate:`.                                                                                                                                           |
| `.gitattributes`                                                       | 1    | Out of scope; harmless attributes for the retired skill path.                                                                                                                                          |
| `apps/desktop/README.md`                                               | 2    | Out of scope; stale upstream workflow links remain for desktop follow-up.                                                                                                                              |
| `apps/desktop/SOURCES.md`                                              | 3    | Desktop attribution, owner links and RNL links/tests; desktop is explicitly preserved.                                                                                                                 |
| `apps/desktop/scripts/accept-local-components.mjs`                     | 1    | Desktop attribution, owner links and RNL links/tests; desktop is explicitly preserved.                                                                                                                 |
| `apps/desktop/src/external-links.test.ts`                              | 2    | Desktop attribution, owner links and RNL links/tests; desktop is explicitly preserved.                                                                                                                 |
| `apps/desktop/src/external-links.ts`                                   | 2    | Desktop attribution, owner links and RNL links/tests; desktop is explicitly preserved.                                                                                                                 |
| `apps/editor/analytics/routes.test.ts`                                 | 4    | Out of scope; Worker-owned analytics tests retain their fixture origin.                                                                                                                                |
| `apps/editor/e2e/agent-simulation.spec.ts`                             | 1    | Preserved browser tests: Agent Kit output paths, owner-credit UI and RNL URLs.                                                                                                                         |
| `apps/editor/e2e/chrome-isolation.spec.ts`                             | 1    | Preserved browser tests: Agent Kit output paths, owner-credit UI and RNL URLs.                                                                                                                         |
| `apps/editor/e2e/rnl-interchange.spec.ts`                              | 4    | Preserved browser tests: Agent Kit output paths, owner-credit UI and RNL URLs.                                                                                                                         |
| `apps/editor/src/agent/agent-property-parity.test.ts`                  | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/agent/live-simulation.test-support.ts`                | 2    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/agent/use-agent-session.ts`                           | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/app/App.test.tsx`                                     | 4    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/app/editor-app-chrome.tsx`                            | 7    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/app/editor-dialogs.tsx`                               | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/components/account-menu-view.tsx`                     | 3    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/components/account.tsx`                               | 2    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/components/chunk-import.test.tsx`                     | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/components/site-resource-links.ts`                    | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/component-insert/vdd-rail.test.ts`           | 2    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/editor-shell/editor-export-commands.test.ts` | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/netlist-export/about-rnl-link.test.tsx`      | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/netlist-export/rnl-canvas-package.lock.json` | 6    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/netlist-export/rnl-viewer.test.ts`           | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/features/netlist-export/rnl-viewer.ts`                | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/services/preview-editor-services.test.tsx`            | 1    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/styles.css`                                           | 8    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/editor/src/styles/editor-chrome.css`                             | 5    | Preserved product/test behavior: owner attribution, OAuth `.github` properties, RNL URLs, fixture origins, or ordinary `gate:` identifiers; source scope only permits deleting unused Gallery helpers. |
| `apps/local-host/src/index.ts`                                         | 1    | Out of scope; retained RNL content-security-policy origin.                                                                                                                                             |
| `apps/mcp-server/src/installation.test.ts`                             | 2    | Out of scope; retained MCP default/fixture origins and Agent Kit virtual `references/` paths.                                                                                                          |
| `apps/mcp-server/src/operation-session.ts`                             | 1    | Out of scope; retained MCP default/fixture origins and Agent Kit virtual `references/` paths.                                                                                                          |
| `apps/mcp-server/src/resources.test.ts`                                | 2    | Out of scope; retained MCP default/fixture origins and Agent Kit virtual `references/` paths.                                                                                                          |
| `config/gallery-sources.json`                                          | 1    | Explicitly preserved Gallery source config; unrelated dataset GitHub Pages URL.                                                                                                                        |
| `containers/ngspice/host/README.md`                                    | 1    | Out of scope; native simulator infrastructure belongs to T004.                                                                                                                                         |
| `containers/vacask/host/README.md`                                     | 1    | Out of scope; native simulator infrastructure belongs to T004.                                                                                                                                         |
| `containers/vacask/host/deploy-preview.sh`                             | 2    | Out of scope; native simulator infrastructure belongs to T004.                                                                                                                                         |
| `docs/agent/distribution.generated.json`                               | 22   | Agent Kit virtual output paths, not the deleted repository-root upstream skill references.                                                                                                             |
| `docs/agent/distribution.json`                                         | 22   | Agent Kit virtual output paths, not the deleted repository-root upstream skill references.                                                                                                             |
| `docs/agent/http-kit/README.md`                                        | 2    | Agent Kit virtual output paths, not the deleted repository-root upstream skill references.                                                                                                             |
| `docs/specs/rnl-interchange.md`                                        | 2    | RNL GitHub Pages URLs; RNL stays.                                                                                                                                                                      |
| `fixtures/gallery-redline/README.md`                                   | 1    | Historical snapshot provenance; kept regression corpus still has out-of-scope consumers.                                                                                                               |
| `packages/agent-adapter/src/agent-docs.generated.ts`                   | 24   | Out of scope; Agent Kit virtual `references/` paths and generated projections stay.                                                                                                                    |
| `packages/agent-adapter/src/agent-kit.test.ts`                         | 5    | Out of scope; Agent Kit virtual `references/` paths and generated projections stay.                                                                                                                    |
| `packages/agent-client/src/connector-store.test.ts`                    | 2    | Out of scope; existing server defaults and connector fixture origins stay.                                                                                                                             |
| `packages/agent-client/src/connector-store.ts`                         | 1    | Out of scope; existing server defaults and connector fixture origins stay.                                                                                                                             |
| `packages/derived/src/connectivity-index.ts`                           | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/derived/src/diagnostics/erc.ts`                              | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/derived/src/visual.ts`                                       | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/edit-engine/src/hierarchy-planner.test.ts`                   | 2    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/netlist/src/equivalence.test.ts`                             | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/netlist/src/equivalence.ts`                                  | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `packages/netlist/src/gate-cell.test.ts`                               | 1    | Out of scope; electrical gate identifiers, object fields and a historical comment are unrelated to removed validation gates.                                                                           |
| `scripts/format.mjs`                                                   | 1    | Explicitly excluded from edits; stale required references glob blocks `pnpm check` (see deviations).                                                                                                   |
| `scripts/format.test.mjs`                                              | 1    | Preserved formatter test creates its own temporary `references/one.json`; no dependency on deleted root files.                                                                                         |
| `scripts/lib/native-example-runner.mjs`                                | 2    | Native simulation runner allowlist and its tests are explicitly out of scope (T004).                                                                                                                   |
| `scripts/lib/verify-pr-selection.mjs`                                  | 1    | Retained dependency of lint-report; stale header mentions removed command. Imported lib modules are excluded from edits.                                                                               |
| `scripts/lint.mjs`                                                     | 1    | Explicitly preserved lint script; stale comment mentions removed command.                                                                                                                              |
| `scripts/native-example-runner.test.mjs`                               | 2    | Native simulation runner allowlist and its tests are explicitly out of scope (T004).                                                                                                                   |
| `scripts/package-mcp.mjs`                                              | 1    | Explicitly preserved packaging; README embeds the retained MCP bootstrap origin.                                                                                                                       |
| `scripts/rnl-canvas-package.test.mjs`                                  | 1    | Preserved RNL package URL test.                                                                                                                                                                        |
| `wrangler.jsonc`                                                       | 5    | Explicitly out of scope until T003; Worker schema and upstream endpoint config remain.                                                                                                                 |
| `wrangler.preview.jsonc`                                               | 3    | Explicitly out of scope until T003; Worker schema and upstream endpoint config remain.                                                                                                                 |

### Knip output

Ordinary mode (`pnpm deadcode`):

```text
$ knip --no-progress && knip --production --no-progress
Unused exports (39)
renameAccount                            function  apps/editor/src/components/account.tsx:198:23
signOut                                  function  apps/editor/src/components/account.tsx:277:23
SITE_PRIVACY_PATH                                  apps/editor/src/components/site-resource-links.ts:10:14
SITE_OPERATOR                                      apps/editor/src/components/site-resource-links.ts:13:14
GRID_INCOMPATIBLE                                  apps/editor/src/features/clipboard/paste-proposal.ts:73:14
localhostExamplesEnabled                           apps/editor/src/gallery-client.ts:13:10
galleryTagScope                          function  apps/editor/src/gallery-client.ts:343:17
galleryAuthorsOf                         function  apps/editor/src/gallery-client.ts:372:17
galleryNarrowedByline                    function  apps/editor/src/gallery-client.ts:397:17
removeGalleryAuthorEntry                 function  apps/editor/src/gallery-client.ts:408:17
dailyOpenLimit                           function  apps/editor/src/gallery-client.ts:648:23
loadGalleryTags                          function  apps/editor/src/gallery-client.ts:735:23
GALLERY_FILTERS_KEY                                apps/editor/src/gallery-filters.ts:69:14
STORED_GALLERY_ORDERS                              apps/editor/src/gallery-order.ts:13:14
newGalleryShuffleSeed                    function  apps/editor/src/gallery-order.ts:55:17
EXAMPLE_HOSTS                                      apps/editor/src/gallery-source.ts:2:14
localhostExamplesEnabled                 function  apps/editor/src/gallery-source.ts:6:17
AgentGalleryEntrySummarySchema  adapter            packages/agent-adapter/src/project-resource.ts:229:14
AgentGalleryFigureSchema        adapter            packages/agent-adapter/src/project-resource.ts:272:14
AgentGalleryEntryReadSchema     adapter            packages/agent-adapter/src/project-resource.ts:282:14
producePackageBuild                      function  scripts/lib/ci-package-build.mjs:106:17
buildRemainingPackages                   function  scripts/lib/ci-package-build.mjs:143:17
formattedPaths                           function  scripts/lib/verify-pr-selection.mjs:18:17
unitSourcePaths                          function  scripts/lib/verify-pr-selection.mjs:25:17
unitTestCommand                          function  scripts/lib/verify-pr-selection.mjs:36:17
buildBoundaryGates                       function  scripts/lib/verify-pr-selection.mjs:67:17
lintPaths                                function  scripts/lib/verify-pr-selection.mjs:77:17
strictUnitRun                            function  scripts/lib/verify-pr-selection.mjs:99:17
censusPaths                              function  scripts/lib/verify-pr-selection.mjs:142:17
censusChecks                             function  scripts/lib/verify-pr-selection.mjs:150:17
PRODUCT_FILE_LINE_LIMIT                            scripts/lib/verify-pr-selection.mjs:163:14
oversizedProductFiles                    function  scripts/lib/verify-pr-selection.mjs:185:17
browserSpecPaths                         function  scripts/lib/verify-pr-selection.mjs:201:17
testStartLines                           function  scripts/lib/verify-pr-selection.mjs:230:17
changedBrowserCases                      function  scripts/lib/verify-pr-selection.mjs:246:17
AUTH_STATE_COOKIE                                  worker/auth-do.ts:53:14
AUTH_HANDOFF_COOKIE                                worker/auth-do.ts:55:14
AUTH_HANDOFF_TTL_MS                                worker/auth-do.ts:60:14
editorFetchAs                            function  worker/gallery.test-support.ts:479:17
Unused exported types (5)
GalleryFeedState                   interface  apps/editor/src/gallery-client.ts:291:18
GalleryLandingPreload              interface  apps/editor/src/gallery-client.ts:326:18
AgentGalleryFigure        adapter  type       packages/agent-adapter/src/project-resource.ts:280:13
AgentGalleryEntrySummary  adapter  type       packages/agent-adapter/src/project-resource.ts:475:13
AgentGalleryEntryRead     adapter  type       packages/agent-adapter/src/project-resource.ts:478:13
[ELIFECYCLE] Command failed with exit code 1.
```

Production mode (run separately because the ordinary command exits nonzero):

```text
Unused exports (48)
cacheSessionUser             function  apps/editor/src/components/account.tsx:61:17
renameAccount                function  apps/editor/src/components/account.tsx:198:23
deleteAccount                function  apps/editor/src/components/account.tsx:230:23
SITE_PRIVACY_PATH                      apps/editor/src/components/site-resource-links.ts:10:14
SITE_OPERATOR                          apps/editor/src/components/site-resource-links.ts:13:14
prepareNetlistExample        function  apps/editor/src/features/netlist-export/netlist-process.ts:683:17
localhostExamplesEnabled               apps/editor/src/gallery-client.ts:13:10
warmGalleryPreviews          function  apps/editor/src/gallery-client.ts:83:17
primeGalleryPreview          function  apps/editor/src/gallery-client.ts:101:23
announceGalleryChange        function  apps/editor/src/gallery-client.ts:123:17
subscribeGalleryRefresh      function  apps/editor/src/gallery-client.ts:142:17
galleryAuthorsOf             function  apps/editor/src/gallery-client.ts:372:17
galleryNarrowedByline        function  apps/editor/src/gallery-client.ts:397:17
removeGalleryAuthorEntry     function  apps/editor/src/gallery-client.ts:408:17
galleryQueryFromFilters      function  apps/editor/src/gallery-client.ts:457:17
galleryFeedQueryKey          function  apps/editor/src/gallery-client.ts:509:17
loadGalleryFeed              function  apps/editor/src/gallery-client.ts:513:23
loadGalleryEntry             function  apps/editor/src/gallery-client.ts:688:23
loadGalleryTags              function  apps/editor/src/gallery-client.ts:735:23
withLoadedTail               function  apps/editor/src/gallery-client.ts:754:17
galleryCountLabel            function  apps/editor/src/gallery-client.ts:774:17
GALLERY_FILTERS_KEY                    apps/editor/src/gallery-filters.ts:69:14
createDefaultGalleryFilters  function  apps/editor/src/gallery-filters.ts:94:17
galleryFiltersNarrowQuery    function  apps/editor/src/gallery-filters.ts:117:17
galleryFilterSearch          function  apps/editor/src/gallery-filters.ts:208:17
storedGalleryFilters         function  apps/editor/src/gallery-filters.ts:249:17
isPageReload                 function  apps/editor/src/gallery-filters.ts:316:17
resolveGalleryFilters        function  apps/editor/src/gallery-filters.ts:336:17
withoutGalleryFocus          function  apps/editor/src/gallery-focus.ts:16:17
galleryFocusPlacement        function  apps/editor/src/gallery-focus.ts:28:17
galleryOrderPreference       function  apps/editor/src/gallery-order.ts:29:17
rememberGalleryOrder         function  apps/editor/src/gallery-order.ts:42:17
galleryShuffleSeed           function  apps/editor/src/gallery-order.ts:65:17
localhostExamplesEnabled     function  apps/editor/src/gallery-source.ts:6:17
comparisonCandidate          function  apps/editor/src/gallery-topology-match.ts:27:23
scanGalleryTopologyMatches   function  apps/editor/src/gallery-topology-match.ts:73:23
evaluateSubmissionGates      function  packages/derived/src/submission-gates.ts:54:17
producePackageBuild          function  scripts/lib/ci-package-build.mjs:106:17
buildRemainingPackages       function  scripts/lib/ci-package-build.mjs:143:17
formattedPaths               function  scripts/lib/verify-pr-selection.mjs:18:17
unitTestCommand              function  scripts/lib/verify-pr-selection.mjs:36:17
buildBoundaryGates           function  scripts/lib/verify-pr-selection.mjs:67:17
lintPaths                    function  scripts/lib/verify-pr-selection.mjs:77:17
censusPaths                  function  scripts/lib/verify-pr-selection.mjs:142:17
censusChecks                 function  scripts/lib/verify-pr-selection.mjs:150:17
oversizedProductFiles        function  scripts/lib/verify-pr-selection.mjs:185:17
browserSpecPaths             function  scripts/lib/verify-pr-selection.mjs:201:17
changedBrowserCases          function  scripts/lib/verify-pr-selection.mjs:246:17
Unused exported types (5)
GalleryFeedState          interface  apps/editor/src/gallery-client.ts:291:18
GalleryLandingPreload     interface  apps/editor/src/gallery-client.ts:326:18
AgentGalleryFigure        type       packages/agent-adapter/src/project-resource.ts:280:13
AgentGalleryEntrySummary  type       packages/agent-adapter/src/project-resource.ts:475:13
AgentGalleryEntryRead     type       packages/agent-adapter/src/project-resource.ts:478:13
```

## Deviations and open questions

1. **Formatter scope conflict:** the required deletion of root `references/`
   conflicts with `scripts/format.mjs:10`, which unconditionally gives Prettier
   `references/**/*.json`. The plan explicitly excludes `format` from script
   edits. Left the formatter and the exact required `check` chain unchanged;
   a follow-up plan must authorize removing/replacing that obsolete glob.
2. **Corpus deletion cannot preserve kept checks:** retained all six fixture
   snapshots and their README because out-of-scope packages/MCP tests consume
   them. Deleting or rewriting those tests would violate the task's hard
   rules. The plan's importer-retention rule takes precedence over blindly
   deleting this directory; removing it needs a separately scoped migration.
3. **Retained Gallery migration helper:** removing it would break the explicitly
   kept format converter's regression test. No kept assertion was weakened.
4. **Remaining unused exports/types:** full Knip output is above. In particular,
   removed CLI consumers leave exports in retained `ci-package-build` and
   `verify-pr-selection` libraries unused. The scope excludes any library a
   kept script imports, and Gallery modules with Worker consumers cannot be
   deleted. No unused file remains in either mode; further pruning needs scope
   for those retained modules/out-of-scope packages and Worker code.
5. Only the 78 deletions covered by the exact `git ls-files` acceptance command
   were staged, so that command accurately returns no indexed paths. Other
   changes remain unstaged for review. No commit, push, merge, rebase or branch
   switch was performed. No dependencies, lockfile, task plan/review, protected
   product contracts, Worker code or runtime configuration were changed.
