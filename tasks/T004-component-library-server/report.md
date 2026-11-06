# T004 report — round 1

## Summary

Extracted `@icm/component-library` without changing validation or publication
identity behavior. The Node server now serves the Worker's Component Library
HTTP contract from PostgreSQL, including catalog paging/revalidation, native
packages, revision-bound views, publication receipts, duplicate detection,
updates, soft deletion, restoration and admin promotion. Added the Vite proxy,
PostgreSQL contract tests, an editor-client contract test, a real-server browser
journey and server documentation. No commits or branch changes were made.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Moved contract, content identity, diagnostics and entry parsing into `packages/component-library`, including the diagnostics unit test. Existing importers changed only their import paths. Added workspace links and the root typecheck mapping; offline install changed only workspace importer links in the lockfile. Before step 2: typecheck passed, and 13 focused editor/desktop/Worker/shared-package test files passed (74 tests). |
| 2    | done   | Added `002-component-library.sql`: components, receipts, lifecycle, content index/progress, catalog/state, indexes, cascading derived-row cleanup and catalog invalidation/revision trigger. `COLLATE "C"` preserves SQLite binary ordering and ASCII SQL case folding regardless of database locale.                                                                                                                                       |
| 3    | done   | Registered `components.ts` in `createApp`. Ported storage into bounded catalog/content-index and lifecycle modules. PostgreSQL transactions plus library advisory lock `(4310, 2)` preserve Durable Object serialization. The Component Library owns its stricter origin policy; other routes retain their previous policy. SQL values are bound parameters.                                                                                |
| 4    | done   | Ported the four Worker suites to PostgreSQL, retaining validation, history, metadata-only repair, paging, byte bounds, retries, expiry and concurrent publication assertions. Added client-contract, routing/input, exact catalog-revision and binary-order tests. Account-specific omissions are enumerated below. The server build excludes its test-support module.                                                                      |
| 5    | done   | Added `/api/components` to dev/preview proxy. New real-server browser test authors and publishes through the UI, reloads, then finds and places the PostgreSQL record from a fresh browser context. Existing Playwright webServer configuration already starts the real server on `auto_canvas_test`; no config change was needed.                                                                                                          |
| 6    | done   | Extended `docs/specs/server.md` and `apps/server/README.md` with the Component Library contract, storage, tests and manual restart check.                                                                                                                                                                                                                                                                                                   |

## Review findings addressed

Not applicable: round 1; no `review.md` was present.

## Acceptance results

All pnpm commands used `npm_config_store_dir=/Users/huzhifeng/Library/pnpm/store`
to reuse the installed offline store. PostgreSQL and browser/loopback checks ran
with sandbox escalation because local TCP connections are denied in the sandbox.
No dependencies were downloaded, installed at new versions or removed.

```text
pnpm check → 1; only the 3 known simulation-artifact-files failures.
  Formatting, docs links, generated Agent docs, generated components,
  typecheck and lint passed (lint reports repository warnings).
  Test Files: 1 failed | 900 passed | 3 skipped (904)
  Tests: 3 failed | 8806 passed | 135 skipped (8944)
  All failures: apps/editor/src/features/simulation/simulation-artifact-files.test.ts
    keeps diagnostic bytes exportable without classifying them as Explorer outputs (line 42)
    packages a group into category folders without changing artifacts (line 81)
    packages selected source and temporary artifacts into one hierarchy (line 103)
  Each reports: AssertionError: expected false to be true (archive.ok).
  The chained build is not reached after these known failures; separately run below.

pnpm exec vitest run apps/server packages/component-library → 0
  Test Files: 7 passed (7); Tests: 43 passed (43)

pnpm test:desktop-build → 0
  Vite desktop bundle completed; only existing externalization/chunk-size warnings.

pnpm exec playwright test apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/user-components.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts --workers=1
  → 0; 66 passed (3.7m), including both real-server journeys.

git grep -n "user-components/component-library-contract\|user-components/component-publication-content" -- ':!tasks'
  → 1, no output (expected no matches).

Additional verification:
pnpm typecheck (step 1) → 0
pnpm exec vitest run apps/editor/src/features/user-components apps/desktop/src/component-library worker/component packages/component-library --maxWorkers=2 (step 1)
  → 0; 13 files, 74 tests passed.
pnpm --filter @icm/server... build → 0
pnpm build → 0
pnpm typecheck (final) → 0
git diff --check → 0
```

An initial broader step-1 run of editor/desktop tests inside the sandbox had the
three known simulation failures and loopback `EPERM` failures in dev-server
tests. All affected shared-component tests passed in the focused run before
server implementation. The final escalated full check has only the three
expected simulation failures.

Initial implementation checks exposed and fixed a PostgreSQL ambiguous
`processed` column in the content-progress upsert, and the server build's
inclusion of test-support code. Compiler outputs emitted outside `rootDir` by
that failed build were removed; no generated source was hand-edited. The final
server build and full workspace build pass.

## Investigation results

- Shared entry parsing moved unchanged alongside the contract; editor and
  desktop use the same package API. Server runtime imports no editor source.
- Catalog revision advances once for every components INSERT/UPDATE/DELETE,
  including lifecycle changes. Derived projection writes, receipt replays,
  unchanged publications and unchanged lifecycle retries do not advance it.
  PostgreSQL tests assert exact increments, including physical deletion.
- Definitions and timestamps use text to preserve historical serialized bytes
  and Worker timestamp strings. Derived catalog/content rows remain rebuildable;
  malformed historical definitions remain inspectable and manageable.
- A request holds one database transaction and advisory lock through index
  backfills, duplicate checks, receipt replay and writes. Concurrent identical
  creates produce one success and one duplicate conflict.
- Existing browser-server configuration covers the new real-server journey.
  The editor client test binds its own fetch functions to `app.request`; the
  preview/identity helpers use the same bound global fetch and restore it after
  the test. It also recreates the app to verify persisted publication reads.

## Deviations and open questions

The local user is always an admin. The following Worker assertions requiring
anonymous or distinct authenticated accounts cannot be expressed by the server
HTTP surface and were omitted/adapted in the PostgreSQL ports. Original Worker
tests are retained unchanged apart from shared-package import paths.

| Worker case                                                               | Omitted/adapted account-specific assertion                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identical new publications by the same author, variants and other authors | Omitted a second author's successful identical publication; duplicate rejection and same-author variants remain.                                                                                                                           |
| Lost publish reply and key reuse                                          | Omitted a different author's 403 on replay; exact response recovery, changed-payload key rejection and replay after a later update remain.                                                                                                 |
| Complete native snapshot / inconsistent updates                           | Omitted unsigned 401, another author's 403, non-admin update of an official record, and anonymous invisibility after deletion. Native validation and storage-level revalidation remain, as do admin update/deletion and deleted readback.  |
| Sign-in and same-origin saves                                             | Omitted unsigned 401; replaced author expectations with `local`; origin refusal and public readback remain.                                                                                                                                |
| Account deletion removes every authored component                         | Entire case omitted: it requires distinct Alice/Bob accounts and the Worker's internal `delete-author` operation. Account deletion is deliberately outside this server task and has no route.                                              |
| Author ownership and stale edits                                          | Omitted Bob/moderator ownership refusals; local author preservation and stale revision rejection remain.                                                                                                                                   |
| Admin promotion/deletion preserves definitions                            | Omitted non-admin/moderator promotion refusals, non-admin official updates and anonymous deleted discovery/read refusals. Admin promotion, deletion, definition preservation, identity and restoration remain.                             |
| Authors remove/restore while admin removals stay protected                | Omitted another author's refusal, anonymous/stranger deleted invisibility and author refusal to restore an admin removal. Local admin deletion history, official-status restoration, malformed history and retry/revision behavior remain. |
| Deleted discovery and legacy tombstones                                   | Omitted author-only filtering and non-admin legacy restore/promotion refusals. Local admin discovers both historical authors, restores tombstones and promotes malformed history.                                                          |
| Creation order, same-name authors and admin visibility                    | Omitted unsigned deleted-discovery refusal. Distinct historical author ids, facets, filtering, ordering and admin deletion remain.                                                                                                         |
| Unchanged publication after permission/revision checks                    | Omitted Bob's permission refusal; unchanged content/timestamps, receipt recovery and stale revision checks remain.                                                                                                                         |

The existing static-editor test no longer expects `/api/components` to return
404; the new Component Library tests cover that now-implemented route.

No changes were made to the plan, review, Agent relay, simulation behavior or
existing editor/desktop/Worker behavior. The manual restart-both-processes
behavioral acceptance remains for Opus, as specified in the plan.
