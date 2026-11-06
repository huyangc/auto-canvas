# T001 report — round 1

## Summary

Every web path now mounts the editor. Removed the public community pages,
editor publishing/import/comparison UI, Gallery shortcut, phone routing,
analytics tracking/dashboard, policy-page links and Gallery browser specs, including retired cases embedded in other editor specs.
User Components has its own capability; Cloud Project and Agent composition
remain available. Cloud shelf/history is accessible from the editor's shelf
menu through “Browse Cloud Projects…”. Both web and desktop builds pass.

**Status: partial.** The runtime removal is implemented, but complete source
removal and three acceptance conditions are blocked by dependencies outside
the plan's owned paths. Those dependencies were retained rather than breaking
the Worker, package tests or build/census tools. No out-of-scope files were
changed, and no commits, branch changes or dependency changes were made.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Added `capabilities.userComponents` (true on both hosts); replaced all coupled gates. Removed `community` and `localComponents` after investigating their consumers.                                                                                                                                                                                                    |
| 2    | done    | Web keeps identity, Cloud store, canonical serializer, browser delivery, Agent, simulation and external links. Community capability was subsequently removed entirely. Updated service composition test.                                                                                                                                                                |
| 3    | done    | `entries/web.tsx` unconditionally mounts the lazy editor/Agent workspace, account preload, error boundary and service worker. Cloud/new/resume handling is preserved; extracted retained boot/restored-tab handling to `app/use-project-entry.ts`. Disabled the old Gallery-dependent HTML preload and policy plugins in Vite.                                          |
| 4    | done    | Removed community branches, dialogs, publishing hooks/Agent publisher, topology comparison, daily-limit card, examples panel, Gallery chrome and G shortcut. Extracted private identity/Cloud state to `app/use-cloud-projects.ts`. Kept Cloud history with a required private source and shared comparison/branch helpers renamed to `version-diff`/`version-project`. |
| 5    | partial | Deleted retired surfaces/tests/styles and analytics browser code. Retained the legacy source dependency graph used by Worker/package/build/census consumers outside scope, with tests for the retained behavior. Production Knip identifies 10 unused files that cannot all be removed inside this plan.                                                                |
| 6    | partial | Ran the requested source and import sweeps. Remaining references and direct imports are inventoried below. The direct-import no-output criterion is not met.                                                                                                                                                                                                            |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

```text
pnpm typecheck → exit 0
  $ tsc -p tsconfig.check.json --noEmit

pnpm lint → exit 0
  oxlint: 2362 files, 0 errors, 2778 warnings

pnpm format:check → exit 0
  All matched files use Prettier code style!

pnpm build → exit 0
  apps/editor build: Done
  Existing large-chunk / browser-externalization warnings remain.

pnpm test:local → exit 1 (final unrestricted offline run)
  Test Files  3 failed | 931 passed | 3 skipped (937)
  Tests       5 failed | 9046 passed | 136 skipped (9187)

pnpm deadcode → exit 1
  22 unused exports; 7 unused exported types.
  Its first Knip invocation exits before the production invocation.

pnpm exec knip --production --no-progress → exit 1 (supplementary)
  10 unused files; 37 unused exports; 5 unused exported types.

pnpm test:desktop-build → exit 0
  Built successfully offline; existing bundle warnings remain.

git diff --check → exit 0

grep -rlE 'from "(\.\./)+(worker|config)/' apps/editor/src → exit 0
  11 matching files (listed below); required no-output criterion NOT met.

grep -rniE 'gallery|arena|moderation|my-submissions|phone-circuit|analytics' \
  apps/editor/src apps/editor/index.html apps/editor/vite.config.ts → exit 0
  Remaining references inventoried below.

rg -l '/api/(gallery|arena|boards)|/api/analytics' \
  apps/editor/dist/assets --glob '*.js' → exit 1, no output
```

The first sandboxed full test run also encountered `listen EPERM` and related
localhost timeouts. Re-ran the required command with sandbox restrictions lifted
for offline localhost listeners. The final five failures are:

- Three baseline failures in `simulation-artifact-files.test.ts`, unchanged:
  diagnostic artifact export, grouped archive, and selected archive.
- `scripts/lib/ci-validation-plan.test.mjs:123`: expected the Gallery shard
  count to be at least 2; it is now 1 after removing Gallery specs.
- `scripts/lib/validation-gates.test.mjs:323`: the gate catalog still names
  removed Gallery specs (14 catalog references).

The last two failures require edits under `scripts/**`, which the plan forbids.
They were not weakened or bypassed.

Additional focused checks passed: 10 files / 114 tests during implementation;
after final cleanup, 6 files / 54 tests covering editor composition, Agent
project and component hosts, account identity, history comparison and Cloud
file lifecycle. The Agent project-host regression test sends all six retired
community operations and verifies refusal without network reads or mutations.
The route, network absence, User Components entry, Library keyboard/tooltips
and responsive account/header layout were also verified with Playwright:

```text
pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts \
  apps/editor/e2e/chrome-isolation.spec.ts \
  --grep 'every web path|panel tooltips|keeps Library Netlist|compacts the editor header' \
  --workers=1 → exit 0; 4 passed (10.1s)
```

The route check visits `/`, `/editor`, `/g/anything`, `/analytics`, `/privacy`,
`/account` and `/unknown`, verifies the canvas/User Components menu and absence
of Gallery controls, and records no community requests. Other manual checks
remain for Opus as specified in the plan. Mixed browser specs retain their
Cloud refresh/Agent recovery/menu/camera coverage; only retired browsing,
publishing and Arena branches were removed. The standalone local examples
browser spec was removed with its retired page.

### Knip output

The required command's complete diagnostic output follows:

```text
$ knip --no-progress && knip --production --no-progress
Unused exports (22)
renameAccount                            function  apps/editor/src/components/account.tsx:198:23
signOut                                  function  apps/editor/src/components/account.tsx:277:23
SITE_PRIVACY_PATH                                  apps/editor/src/components/site-resource-links.ts:10:14
SITE_OPERATOR                                      apps/editor/src/components/site-resource-links.ts:13:14
GALLERY_DESCRIPTION_LIMIT                          apps/editor/src/features/editor-shell/gallery-publish.ts:38:14
GalleryReadError                         class     apps/editor/src/features/editor-shell/gallery-publish.ts:51:14
updateGalleryEntry                       function  apps/editor/src/features/editor-shell/gallery-publish.ts:291:17
localhostExamplesEnabled                           apps/editor/src/gallery-client.ts:13:10
galleryTagScope                          function  apps/editor/src/gallery-client.ts:343:17
galleryAuthorsOf                         function  apps/editor/src/gallery-client.ts:372:17
galleryNarrowedByline                    function  apps/editor/src/gallery-client.ts:397:17
removeGalleryAuthorEntry                 function  apps/editor/src/gallery-client.ts:408:17
loadGalleryTags                          function  apps/editor/src/gallery-client.ts:735:23
newGalleryShuffleSeed                    function  apps/editor/src/gallery-order.ts:55:17
localhostExamplesEnabled                 function  apps/editor/src/gallery-source.ts:6:17
AgentGalleryEntrySummarySchema  adapter            packages/agent-adapter/src/project-resource.ts:229:14
AgentGalleryFigureSchema        adapter            packages/agent-adapter/src/project-resource.ts:272:14
AgentGalleryEntryReadSchema     adapter            packages/agent-adapter/src/project-resource.ts:282:14
AUTH_STATE_COOKIE                                  worker/auth-do.ts:53:14
AUTH_HANDOFF_COOKIE                                worker/auth-do.ts:55:14
AUTH_HANDOFF_TTL_MS                                worker/auth-do.ts:60:14
editorFetchAs                            function  worker/gallery.test-support.ts:479:17
Unused exported types (7)
GalleryPublicationRecord           interface  apps/editor/src/features/editor-shell/gallery-publish.ts:65:18
PublishSessionUser                 interface  apps/editor/src/features/editor-shell/gallery-publish.ts:154:18
GalleryFeedState                   interface  apps/editor/src/gallery-client.ts:291:18
GalleryLandingPreload              interface  apps/editor/src/gallery-client.ts:326:18
AgentGalleryFigure        adapter  type       packages/agent-adapter/src/project-resource.ts:280:13
AgentGalleryEntrySummary  adapter  type       packages/agent-adapter/src/project-resource.ts:475:13
AgentGalleryEntryRead     adapter  type       packages/agent-adapter/src/project-resource.ts:478:13
[ELIFECYCLE] Command failed with exit code 1.
```

Production unused files (the remaining diagnostic categories are exports/types):

```text
Unused files (10)
apps/editor/build/editor-preload.ts
apps/editor/build/gallery-early-fetch.ts
apps/editor/build/usage-policy-shell.ts
apps/editor/src/examples/library-examples.ts
apps/editor/src/features/editor-shell/gallery-example-commands.ts
apps/editor/src/features/editor-shell/gallery-import.ts
apps/editor/src/features/editor-shell/gallery-publication-permission.ts
apps/editor/src/features/editor-shell/gallery-publish.ts
apps/editor/src/gallery-early-fetch.ts
apps/editor/src/phone-viewing.ts
```

These are newly unused in the production graph, so the plan's “no new unused
files under apps/editor” condition is not satisfied. Build files are outside
scope; source helpers remain required by out-of-scope tests/census/build
consumers, even though the web editor no longer imports them.

## Investigation results

- **`localComponents`:** every use was the dual `community || localComponents`
  gate for User Components access/definition editing, or the corresponding
  host declaration. No consumer used it exclusively for a native library.
  Removed it with `community`; native library selection still uses the existing
  native host/store seams. Both hosts set `userComponents: true`.
- **Sign-in:** GitHub/Google choices point directly to `/api/auth/*/start`;
  email sign-in uses the existing start/verify requests and reloads on success.
  The Worker redirects to its return path (failed sign-in to `/?auth=failed`);
  it does not require the removed account dashboard. Account identity and
  return-to-owner remain in the editor header, with Sign out now calling the
  existing logout client there. Removed the obsolete `/account` navigation and
  privacy link. Shared email allowance handling stays because sign-in uses it.
- **Cloud Project binding:** kept the existing `galleryEntryId` binding field,
  serializer/recovery metadata and optional store-save parameter for HTTP API
  compatibility. The editor no longer derives/passes a publication from an
  active Gallery entry or displays publication status. Save/open/list/delete,
  conflicts and native save remain unchanged. Manual Cloud save no longer
  opens an Arena gate. The private wall and revision UI remain reachable in
  the shelf modal; history loads/restores only through its supplied Cloud
  source. Historical comparison/branch data tests were preserved.
- **Agent operations:** `list-gallery`, `read-gallery-entry`,
  `read-gallery-entries`, `insert-gallery-entry`, `publish-gallery-entry`, and
  `update-gallery-entry` now return `GALLERY_UNAVAILABLE` with no Gallery
  handler/fetch/publisher. Workspace, Cloud Cells, project/netlist code,
  components and simulation remain supported. The package capability type is
  a fixed tuple containing the three Gallery read/list names; editor capability
  metadata retains those names to satisfy the unchanged out-of-scope
  `@icm/agent-adapter` type, but execution is unavailable. User Component
  availability checks remain intact.
- **Shelf/assets:** `shelf-wall.tsx` is private Cloud Project code, not a public
  feed, so it was retained and its shared tile CSS extracted/renamed. No public
  Gallery assets were needed; shared app icons, service worker and the
  third-party fixture license remain.

### Cross-scope dependencies preventing deletion

| Out-of-scope consumer                                                                                   | Source retained in owned paths                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker/gallery-store*.ts`, `worker/gallery-traps*.ts`, Worker tests                                    | `gallery-search.ts`, `gallery-reserved-ids.ts`                                                                                                    |
| `worker/topology-task.ts`                                                                               | `gallery-client.ts` feed type, `gallery-topology-match.ts`, `gallery-topology-selection.ts` and their transitive source/filter/order dependencies |
| `worker/index.ts`, `worker/point-in-time-recovery.ts`                                                   | `analytics/routes.ts`, `analytics/worker.ts`; their server tests remain                                                                           |
| `apps/editor/build/editor-preload.ts` and tests, `build/gallery-early-fetch.ts`, `dev/local-replica.ts` | `phone-viewing.ts`, `gallery-source.ts`, `gallery-early-fetch.ts` and dependencies                                                                |
| `apps/editor/build/usage-policy-shell.ts`                                                               | `usage-policy-note.ts` and shared contact constants                                                                                               |
| `apps/editor/census/gallery-entry.ts`                                                                   | `features/editor-shell/gallery-example-commands.ts`, `gallery-import.ts`, bundled fixture helpers and transitive client/types                     |
| `packages/project-protocol/src/controlled-source-persistence.test.ts`                                   | `features/editor-shell/gallery-publish.ts`, publication permission/context dependencies                                                           |

Per AGENTS.md step 3, stopped the impossible deletion substeps rather than
editing these consumers or introducing replacement compatibility designs.
The Vite plugin registrations were removed within the allowed config scope;
the plugin implementations themselves were left alone.

### Direct-import sweep

```text
apps/editor/src/request-failure.test.ts
apps/editor/src/features/user-components/component-library-contract.test.ts
apps/editor/src/features/user-components/component-publication-operation.test.ts
apps/editor/src/features/user-components/component-publication-host.test.ts
apps/editor/src/agent/component-publication-live.test.ts
apps/editor/src/agent/component-authoring-target-live.test.ts
apps/editor/src/agent/browser-agent-components.test.ts
apps/editor/src/agent/live-simulation.test-support.ts
apps/editor/src/agent/component-management-live.test.ts
apps/editor/src/gallery-client.ts
apps/editor/src/gallery-sources.ts
```

The two legacy production modules are retained by the cross-scope graph above.
The other nine files test retained request-failure/User Components/Agent behavior
against the existing Worker fixtures. Those integration tests were not deleted
or routed through an alias to conceal the imports.

### Remaining source sweep

The sweep contains 864 matching lines in 77 files. Paths below are
relative to `apps/editor/src/`; each matching file is included once.

**Retained legacy dependencies.** Stopped deletion: the out-of-scope graph above still needs these implementations; their tests preserve retained behavior. The browser editor does not mount or import these surfaces.

```text
features/editor-shell/gallery-example-commands.test.ts
features/editor-shell/gallery-example-commands.ts
features/editor-shell/gallery-import.test.ts
features/editor-shell/gallery-import.ts
features/editor-shell/gallery-publication-permission.ts
features/editor-shell/gallery-publish.test.ts
features/editor-shell/gallery-publish.ts
gallery-client.test.ts
gallery-client.ts
gallery-early-fetch.test.ts
gallery-early-fetch.ts
gallery-filters.test.ts
gallery-filters.ts
gallery-focus.test.ts
gallery-focus.ts
gallery-order.test.ts
gallery-order.ts
gallery-reserved-ids.test.ts
gallery-reserved-ids.ts
gallery-scan-request.test.ts
gallery-scan-request.ts
gallery-search.ts
gallery-source.ts
gallery-sources.ts
gallery-topology-match.test.ts
gallery-topology-match.ts
gallery-topology-selection.ts
phone-viewing.ts
usage-policy-note.ts
```

**Agent protocol/refusals.** The six explicit unavailable operations, their regression test, and fixed adapter capability metadata.

```text
agent/agent-service-options.ts
agent/browser-agent-project-host.test.ts
agent/browser-agent-project-host.ts
```

**Cloud/recovery compatibility.** Persisted `galleryEntryId`/snapshot metadata, Cloud transport signatures, old URL recovery normalization and tests; preview tests assert removed controls remain absent.

```text
app/agent-workspace-requests.ts
app/use-project-tab-sessions.ts
document/cloud-project-session.ts
document/document-controller.ts
document/project-workspace.test.ts
document/project-workspace.ts
document/use-project-file-lifecycle.test.tsx
document/use-project-file-lifecycle.ts
document/workspace-reopen.test.ts
document/workspace-reopen.ts
features/editor-shell/cloud-projects.test.ts
features/editor-shell/cloud-projects.ts
services/editor-services.tsx
services/preview-editor-services.test.tsx
services/web-editor-services.test.ts
services/web-editor-services.ts
```

**Retained fixtures, tests and explanatory references.** Existing schematic fixture provenance, editor absence assertions, account/API comments, security redaction of old `/g/` paths, service-worker API-cache exclusion, simulation/headless documentation and geometry comments. These lines introduce no public community control or request.

```text
README.md
agent/agent-action-plan.test.ts
agent/agent-property-parity.test.ts
agent/agent-runtime.tsx
agent/browser-agent-file-host.test.ts
agent/mcp-tools-live.test.ts
agent/session-recovery.test.ts
agent/workspace-agent.tsx
app/App.test.tsx
components/account.tsx
components/bug-report-link.test.tsx
components/bug-report-link.tsx
components/tile-preview.test.tsx
examples/SIMULATION.md
examples/simulation-examples.ts
features/clipboard/clipboard-preview.ts
features/clipboard/clipboard.test.ts
features/clipboard/project-copy.test.ts
features/component-insert/vdd-rail.test.ts
features/instance-display/arrange-instance-labels.ts
features/properties/hidden-terminals.test.ts
features/selection/detached-move.test.ts
headless/artifacts.ts
headless/local-editor.ts
request-failure.test.ts
request-failure.ts
service-worker-cache.test.ts
```

**Substring matches.** `prepareNativeCapture` and `prepareNamedWireSource` contain the case-insensitive substring `arena`; these are retained component/wiring operations.

```text
features/user-components/component-placement.ts
features/wiring/use-wire-interaction.ts
```

## Deviations and open questions

- Complete source deletion requires a revised ownership scope covering the
  Worker, package test, editor build/census/dev consumers listed above.
- The two CI script tests need their retired Gallery gate/shard entries removed
  in a follow-up approved plan. Root/package configuration and tests were left
  untouched.
- The fixed Agent capability tuple needs a package-level change if the obsolete
  read/list names must disappear from advertised metadata as well as execution.
- Knip and the import sweep remain failing acceptance conditions; this report
  does not claim round 1 is fully accepted. The three simulation failures remain
  baseline and are left for the later simulation task.
- `plan.md` and `review.md` were not edited. No files under `worker`, `config`,
  `scripts`, `packages`, desktop/MCP apps or docs were changed. Knip config was
  left unchanged because its analytics Worker entry still points to a retained
  file. Gallery identity fixtures used by surviving browser specs were moved to
  `e2e/account-fixtures.ts` with their identity API behavior preserved.
