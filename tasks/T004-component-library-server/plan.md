# T004 — Component library on the server

- Branch: `task/T004-component-library-server`
- Base: `main` at `af70fb9`
- Status: approved

## Goal

`apps/server` serves the web editor's `/api/components` contract from
PostgreSQL, so publishing, browsing, inserting, updating, deleting and
restoring User Components works without the Cloudflare Worker. The library
keeps the Worker's semantics (it is a shared library with authors, revisions,
a catalog, write receipts and soft deletion); with one local user every
component's author is that user, and the local user is an admin.

Not in this task: the Agent relay and deleting `worker/` (T005), simulation
(T006), the editor's 20-project limit text.

## Context

Contract authority, in this order: Worker code, Worker tests, this summary.

- Worker files: `worker/component-library.ts` (168, routing, origin rule, body
  limit), `worker/component-library-do.ts` (361, storage, list/read/publish),
  `worker/component-management.ts` (140, delete/restore/status),
  `worker/component-catalog.ts` (248, catalog mode, triggers),
  `worker/component-publication-index.ts` (143, duplicate-content index).
  Tests: `worker/component-library.test.ts` (665),
  `component-management.test.ts`, `component-catalog.test.ts`,
  `component-publication.test.ts`, helper
  `component-library.test-support.ts` (uses `node:sqlite`).
- Storage today is SQLite in a Durable Object: `components(id PK, revision,
author_id, author, status shared|official|deleted, created_at, updated_at,
name, definition JSON)`, `component_write_receipts(user_id, request_key,
component_id, request_digest, response_json, created_at; PK(user_id,
request_key); 7-day expiry)`, `component_lifecycle`
  (`component-management.ts:16-24`), `component_content_index` /
  `component_content_progress` (`component-publication-index.ts:19-31`),
  `component_catalog` and `component_catalog_state.revision` maintained by
  triggers (`component-catalog.ts:30-56`). Map these to PostgreSQL tables;
  triggers may become PostgreSQL triggers or explicit writes in the same
  transaction, as long as `catalogRevision` advances exactly when the Worker's
  does.
- Endpoints (details in the Worker):
  - `GET /api/components`: reads are anonymous. Plain mode (`q`, `cursor`,
    `limit` 1–30, `view=summary`, `status=deleted`) → `{entries,
nextCursor}`; catalog mode `catalog=1` (`type`, `order`, `author`,
    `since`, limit ≤128, ~256 KB pages) → `{entries, catalogRevision,
authors, nextCursor}` or `{entries:[], nextCursor:null, catalogRevision,
notModified:true}`; errors `COMPONENT_CATALOG_QUERY`,
    `COMPONENT_CATALOG_CURSOR` (400), `COMPONENT_CATALOG_CHANGED` (409).
  - `GET /api/components/:id` (`view=identity|preview`, `revision`,
    `status=deleted`) → `{entry}` / `{id, revision, status}` / `{id,
revision, symbol}`; 409, 422 `This component needs repair.`, 404.
  - `PUT /api/components/:id` publish/update: stricter origin rule
    (`Sec-Fetch-Site` only `same-origin`/`none`, else 403 `Cross-origin
writes are forbidden`), body ≤128 KiB + 1024, `{revision, definition,
circuit?, idempotencyKey?}`, receipts with replay header
    `x-component-write-recovered: true`, revision conflicts, duplicate
    content `COMPONENT_ALREADY_PUBLISHED`, outcome
    `created|updated|unchanged`, symbol id rewritten to `user-<id>-r<rev>`.
  - `PATCH /api/components/:id` `{revision, action: delete|restore}` or admin
    `{revision, status}`; codes `COMPONENT_NOT_FOUND`, `COMPONENT_FORBIDDEN`,
    `COMPONENT_RESTORE_FORBIDDEN`, `COMPONENT_REVISION_CONFLICT`,
    `COMPONENT_STATUS_INVALID`; other methods 405.
  - Component id pattern `^[a-zA-Z0-9_-]{8,80}$` → 400 `Invalid component ID`.
- Identity: the server's local user (`apps/server/src/app.ts`, T003) is
  `{id:"local", isAdmin:true, ...}`; use it as author and for admin checks.
  The editor needs `user.id` from `/api/auth/me` before publishing
  (`component-library-client.ts:112-120`).
- The editor client uses catalog mode with `since`
  (`component-library-client.ts:144`), the identity and preview views
  (`:199`, `:246`), deleted reads and idempotency keys.
- **Shared validation lives in the editor tree.** The Worker imports
  `apps/editor/src/features/user-components/component-library-contract.ts`
  (189 lines) and `component-publication-content.ts` (84) by relative path;
  their imports are `./component-definition-error`, `@icm/agent-adapter`,
  `@icm/devices`, `@icm/edit-engine`, `@icm/model`. About 30 files import the
  contract, including `apps/desktop/src/component-library.ts`, editor
  `features/user-components/*`, `app/*`, `agent/browser-agent-components.ts`,
  `hosts/native-component*`, `e2e/user-components.spec.ts` and the four
  `worker/component-*` files. `apps/server` compiles with `rootDir: src`
  (T003), so it cannot use the relative-path pattern.
- Server code from T003: `apps/server/src/{app,projects,migrate,db}.ts`,
  migrations in `apps/server/src/migrations/` (next file `002-…sql`), tests in
  `apps/server/src/app.test.ts` against `auto_canvas_test`, Vite proxy in
  `apps/editor/dev/api-server-proxy.ts`, spec `docs/specs/server.md`.
- `apps/editor/e2e/user-components.spec.ts` mocks `**/api/components**` with
  `context.route`; it is not a server test.

## Scope

Owned paths:

- New `packages/component-library/**` (`@icm/component-library`)
- The moved modules and every importer of them, only to change import paths:
  `apps/editor/**`, `apps/desktop/src/**`, `worker/component-*.ts`
- `apps/server/**`, `apps/editor/dev/api-server-proxy.ts`
- `docs/specs/server.md`, `apps/server/README.md`
- Root `tsconfig*.json`, `vitest.config.ts`, `knip.config.js`,
  `pnpm-workspace.yaml` only if needed for the new package; `package.json`
  files for `workspace:*` links (then `pnpm install --offline`)
- New `apps/editor/e2e/user-components-server.spec.ts` and Playwright config
  entries it needs

Out of scope: behavior changes in the editor, desktop or Worker; external
dependencies; `/api/agent/*`; simulation.

## Steps

1. **Extract the shared package.** Move
   `component-library-contract.ts`, `component-publication-content.ts`,
   `component-definition-error.ts` and whatever else their closure needs
   (and the server needs from `component-library-entry.ts`, if any) into
   `packages/component-library/src/` with their unit tests. Export them from
   `@icm/component-library`. Update every importer to the package. No
   behavior change: `pnpm typecheck` and the existing tests of the editor,
   desktop and Worker component code pass before step 2 begins (record the
   result in the report).
2. **Schema.** Migration `002-component-library.sql` with the tables in
   Context, PostgreSQL types, indexes the queries need, and the catalog
   revision mechanism.
3. **Routes.** `src/components.ts` registered in `createApp`, porting the
   Worker's routing, origin rule, body limit, validation (through
   `@icm/component-library`), plain and catalog listing, reads and views,
   publish with receipts and duplicate detection, management. Keep status
   codes, error strings and codes, headers and JSON shapes identical. Use
   transactions where the Worker relies on Durable Object atomicity.
4. **Tests.** Port the four Worker test files' cases to `apps/server`
   (PostgreSQL, `app.request`), dropping only cases that depend on multiple
   real accounts in ways one local user cannot express (list each dropped
   case and why). Add a client-contract test driving the editor's own
   `component-library-client.ts` functions with a `fetchLike` bound to the app:
   publish, catalog list, `since` not-modified, identity and preview views,
   update, delete, restore.
5. **Proxy and browser check.** Add `/api/components` to the Vite dev/preview
   proxy. New `user-components-server.spec.ts` against the real server
   (Playwright `webServer` on `auto_canvas_test`, as in T003): author a
   component, publish it, reload, find it in the User Components library,
   place it on the canvas.
6. **Docs.** Extend `docs/specs/server.md` and `apps/server/README.md`.

## Acceptance

```bash
pnpm check                                   # only the 3 known simulation-artifact-files failures
pnpm exec vitest run apps/server packages/component-library   # all pass
pnpm test:desktop-build                      # exit 0
pnpm exec playwright test apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/user-components.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts --workers=1   # pass
git grep -n "user-components/component-library-contract\|user-components/component-publication-content" -- ':!tasks'   # no output
```

Behavioral (Opus verifies): with `pnpm server:dev` + `pnpm dev`, publish a
component, restart both, find and place it.

## Notes for the implementer

- Step 1 is a pure move; keep the diff of importers to import lines.
- Parameterized SQL only. Keep `author_id`/`user_id` columns as in the
  Worker; every write checks the local user exactly as the Worker checks the
  session user.
- If a Worker behavior cannot be reproduced faithfully on PostgreSQL, stop
  that part and report it rather than inventing a different contract.
