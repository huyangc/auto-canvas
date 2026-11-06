# T003 — Single-user server with PostgreSQL: identity and Cloud Projects

- Branch: `task/T003-single-user-server`
- Base: `main` at `f029e53`
- Status: approved

## Goal

Add `apps/server`, a Node server backed by PostgreSQL that serves the web
editor's identity and Cloud Project HTTP contract for one local user, so the
editor's Cloud Save, shelf, version history and restore work without the
Cloudflare Worker. The editor's client code keeps calling the same endpoints;
the Vite dev server forwards them to this server.

Not in this task: `/api/components` (T004), the Agent relay and deleting
`worker/` (T005), simulation (T006). `worker/` stays untouched and its tests
keep passing.

## Context

- Contract source: the Worker. Endpoints, status codes, shapes and
  semantics are summarized below with file references; the Worker code and
  its tests are authoritative where this summary is silent.
- Already prepared on this branch (do not change dependencies):
  `apps/server/package.json` (`@icm/server`, deps `hono@4.13.16`,
  `@hono/node-server@2.1.6`, `pg@8.23.1`, dev `@types/pg@8.23.1`),
  `apps/server/tsconfig.json`, lockfile updated. Add workspace deps
  (`@icm/project-protocol`, `@icm/model`, `@icm/render-svg`,
  `@icm/symbols`, ...) as `workspace:*` entries in `package.json` if needed
  and run `pnpm install --offline` to link them; that is allowed.
- PostgreSQL 16 runs locally on `127.0.0.1:5432`; databases `auto_canvas`
  (dev) and `auto_canvas_test` (tests) exist, owned by the OS user, no
  password (`postgresql:///auto_canvas`). Tests may drop and recreate
  their own schema objects in `auto_canvas_test`.
- `apps/local-host/src/index.ts` is an existing small Node static server for
  `apps/editor/dist` (path traversal guard, MIME types, COOP header); reuse
  its approach for serving the built editor.
- Vite dev wiring: `apps/editor/vite.config.ts` plugins; `apps/editor/dev/agent-relay.ts`
  shows how a dev plugin adds a `server.proxy`/`preview.proxy` entry.

### Identity (single user)

Worker: `worker/auth-do.ts:590-697`, `worker/auth.ts`; editor:
`apps/editor/src/components/account.tsx`, `account-menu-view.tsx`.

- `GET /api/auth/me` → 200 `{user}` with a fixed `SessionUser`
  `{id, displayName, email: null, provider: "local", role: "user", isAdmin: true}`
  (`auth-do.ts:177-196`). `id` is `"local"`; `displayName` comes from the
  `users` table (default from env `AUTO_CANVAS_USER_NAME`, else
  `"Local user"`). `cache-control: no-store`.
- `GET /api/auth/providers` → `{github:false, google:false, email:false}`.
  `loadAccountState` then shows no sign-in menu (`account.tsx:117-120`);
  Cloud Projects call `/api/auth/me` directly
  (`app/use-cloud-projects.ts:40`).
- `POST /api/auth/profile` `{displayName}` (trimmed 1–40) → `{user}`;
  400 `invalid-display-name`. `POST /api/auth/logout` → `{ok:true}` (no-op).
  Every other `/api/auth/*` path → 404 `{"error":"Not found"}`.
- Same-origin rule for every non-GET (`worker/same-origin.ts:2-11`): 403 when
  an `Origin` header differs from the request origin, or `Sec-Fetch-Site` is
  present and not `same-origin`/`same-site`/`none`.

### Cloud Projects

Worker: `worker/gallery-cloud-projects.ts`,
`worker/gallery-store-cloud-projects.ts`; storage schema
`worker/gallery-do.ts:206-235,274-276`; editor client
`apps/editor/src/features/editor-shell/cloud-projects.ts`,
`components/shelf-wall.tsx`. Every error body is `{"error": string}`.

- Tables (map to PostgreSQL): `cloud_projects(id PK, user_id, name,
created_at, updated_at, revision int default 1, schema_version int,
project_text, preview_svg default '', gallery_entry_id null, favorite
bool)`, index `(user_id, updated_at)`; `cloud_project_versions(id PK =
"<projectId>:<revision>", project_id, revision, name, saved_at,
schema_version, project_text, preview_svg)`, unique `(project_id,
revision)`, cascade on project delete. Use `timestamptz` and return ISO
  strings. Ids: 10 chars from `23456789abcdefghjkmnpqrstvwxyz`
  (`worker/gallery-store.ts:19-32`).
- Summary `{id, name, updatedAt, revision, schemaVersion, galleryEntryId:
null, favorite}`; open payload adds `projectText`.
- `GET /api/projects` → `{projects}` ordered `updated_at DESC, id DESC`,
  `no-store`. Limit: `AUTO_CANVAS_PROJECT_LIMIT` (default 200) instead of
  the Worker's 20; list returns all of them.
- `POST /api/projects` `{name (trim ≤120, null→""), projectText,
galleryEntryId?}` → 201 `{project}`. 400 `invalid-fields`, 413 `too-large`
  (> 2 MiB UTF-8), 400 `invalid-project` (parse failure), 409
  `{error:"project-limit", projects}`. `galleryEntryId` is accepted for
  client compatibility, validated as a non-empty string if present, and
  ignored (stored null): there is no Gallery.
- `GET /api/projects/:id` → `{project: openPayload}`, 404 `not-found`.
- `PUT /api/projects/:id` with `If-Match: revision-<n>` → 200 `{project}`;
  428 `expected-revision-required`; 404; 409 `{error:"revision-conflict",
project: currentSummary}`; 400/413 as POST. Order (`store:126-204`):
  not found → 404; if name, schema version and normalized text equal the
  stored row → 200 current summary even with a stale If-Match, nothing
  snapshotted; revision mismatch → 409; else in one transaction copy the
  current row into versions, update with `revision+1` (compare-and-swap),
  prune versions to the newest 3.
- `PATCH /api/projects/:id` `{favorite: boolean}` → 200 `{project:
openPayload}`; `DELETE` → 200 `{deleted: id, projects}` (hard delete with
  versions).
- Server normalizes text with `serializeProject(parseProject(text))` and
  stores `schema_version = CURRENT_PROJECT_FILE_VERSION`
  (`gallery-cloud-projects.ts:116-121`). Preview SVG rendered on create and
  on each changed update with the Worker's `renderPreview`
  (`worker/gallery-requests.ts:193-205`, using `prepareDocumentFormulaArtifacts`,
  `renderDocumentSvg`, `createProjectSymbolResolver`, `builtInSymbols`);
  render failure stores `""`. Port this into `apps/server`, do not import
  from `worker/`.
- `GET /api/projects/:id/preview.svg?v=<rev>` → SVG, `cache-control:
private, max-age=31536000, immutable` when `v` equals the current
  revision, else `private, no-cache`; 404 when missing or empty.
- History (`gallery-cloud-projects.ts:165-219`, `store:228-274`), all
  `private, no-store`: `GET /api/projects/:id/versions` → `{versions:
[{versionId, versionNo, name, createdAt, author:"", tags:[]}], revision}`
  newest first; `GET .../versions/:vid/project` → `{projectText}`;
  `GET .../versions/:vid/preview.svg`; `POST .../versions/:vid/restore`
  with the client's `If-Match` and no body behaves as a PUT of that
  version's name and text (428 / 409 / 200 with revision+1, displaced draft
  becomes a version, favorite kept). `:vid` is URL-decoded and contains `:`.
- Unknown method or path under `/api/projects` → 404 `{"error":"Not found"}`.
- Worker tests to port: `worker/gallery-cloud-projects.test.ts` (limit,
  previews, revisions `:197`, history/restore `:237`, idempotency `:814`;
  skip the Gallery binding cases `:465-688`), and the me/providers/profile/
  logout cases of `worker/auth.test.ts`.

## Scope

Owned paths:

- `apps/server/**` (new code, tests, SQL migrations, README)
- `apps/editor/vite.config.ts` and a new `apps/editor/dev/api-server-proxy.ts`
- Root `package.json` scripts, `vitest.config.ts`, `tsconfig*.json`,
  `knip.config.js` (only to include `apps/server`)
- `README.md` (dev instructions), new `docs/specs/server.md` (contract
  summary in the shape of `docs/specs/spec.template.md`), `docs/specs/README.md`
  and `docs/README.md` (link it)
- A new browser spec `apps/editor/e2e/cloud-projects-server.spec.ts` and the
  Playwright config entries it needs

Out of scope: `worker/**`, `apps/editor/src/**` (report any client change
you believe is needed instead of making it), `packages/**`, `/api/components`,
`/api/agent/*`, `/api/simulate`, dependencies beyond linking workspace
packages.

## Steps

1. **Server skeleton.** `src/app.ts` exports `createApp({db, user, limits})`
   returning a Hono app; `src/db.ts` (pg Pool from `DATABASE_URL`, default
   `postgresql:///auto_canvas`); `src/migrate.ts` applying ordered SQL files
   from `src/migrations/` inside a transaction, tracked in a
   `schema_migrations` table, run at startup; `src/cli.ts` (`PORT` default
   4310, `HOST` default `127.0.0.1`, optional `EDITOR_ROOT` to serve a built
   editor with SPA fallback to `index.html`); `GET /api/health` → `{ok:true}`
   after the database answers.
2. **Identity** routes and the same-origin guard as specified.
3. **Cloud Projects** routes, storage, preview rendering, history and
   restore as specified.
4. **Tests** in `apps/server/src/*.test.ts` against `auto_canvas_test`
   (`AUTO_CANVAS_TEST_DATABASE_URL`, default `postgresql:///auto_canvas_test`),
   using `app.request(...)`. Port the Worker cases listed in Context. Add a
   client-contract test that drives the editor's own client functions
   (`listCloudProjects`, `openCloudProject`, `saveCloudProject`,
   `deleteCloudProject` from `apps/editor/src/features/editor-shell/cloud-projects.ts`)
   with a `fetchLike` bound to the Hono app, covering create, update,
   conflict and delete. Tests fail (not skip) when the database is
   unreachable, with a message naming the URL.
5. **Dev wiring.** `api-server-proxy.ts` adds a Vite `server.proxy` and
   `preview.proxy` for `/api/auth`, `/api/projects`, `/api/health` to
   `AUTO_CANVAS_API_URL` (default `http://127.0.0.1:4310`); register it in
   `vite.config.ts` so the narrower `/api/agent/` relay proxy still wins.
   Root scripts: `server:dev` (build and run the server against
   `auto_canvas`), `server:migrate`. `pnpm build` builds the server.
6. **Browser check.** `cloud-projects-server.spec.ts`: with the server
   running (Playwright `webServer` entry using `auto_canvas_test`), place a
   part, save to Cloud, reload, open it from the shelf, see the part, save
   again and see version history list the earlier revision.
   Investigate: does any editor UI require a signed-in account state (from
   `loadAccountState`) before Cloud Save or the shelf works when providers
   are all false? Report what you find; if a client change is needed,
   describe it instead of making it.
7. **Docs.** `docs/specs/server.md` (endpoints, single-user identity,
   configuration, limits, what is deliberately not implemented), README
   dev section (`pnpm server:dev` then `pnpm dev`), `apps/server/README.md`
   (configuration table).

## Acceptance

```bash
pnpm check                                    # only the 3 known simulation-artifact-files failures
pnpm exec vitest run apps/server              # all pass against auto_canvas_test
pnpm --filter @icm/server build               # exit 0
pnpm exec playwright test apps/editor/e2e/cloud-projects-server.spec.ts --workers=1   # pass
pnpm exec playwright test apps/editor/e2e/editor-shell.spec.ts --grep 'every web path' --workers=1   # pass
```

Behavioral (Opus verifies): `pnpm server:dev` + `pnpm dev`, save a circuit,
restart both, reopen it from the shelf.

## Notes for the implementer

- Keep handlers close to the Worker's behavior and wording so the editor
  client's branches (401, 404, 409 with `project`/`projects`, 428) work
  unchanged.
- Use parameterized SQL only. Keep `user_id` columns so multi-user can come
  later; every query filters by the user.
- No rate limiting, no cookies, no third-party sign-in.
