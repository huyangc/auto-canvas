# Single-user PostgreSQL server

Status: `accepted`

Primary owner: `apps/server`

The local Node server implements identity, private Cloud Project, shared Component Library and Agent relay APIs
consumed by the web editor. Project file semantics belong to
[Project file format](project-file-format.md); browser recovery belongs to
[persistence and recovery](persistence-and-recovery.md).

## Rules

- One persisted user, `local`, owns all API operations. Its session has
  `provider: "local"`, `email: null`, `role: "user"`, `isAdmin: true`.
  No cookies, credentials, rate limiting or third-party sign-in are required.
- All queries scope Projects by user. Versions cascade on Project deletion.
- Identity and Project non-GET requests reject a differing Origin or a Sec-Fetch-Site other
  than `same-origin`, `same-site` or `none` with 403 `forbidden`.
- Saves parse and canonically serialize Project text, storing the current
  Project file version. A changed update atomically snapshots the displaced
  revision, increments the revision and retains the newest three snapshots.
- PUT requires `If-Match: revision-<n>` (428 if absent/invalid). A missing
  Project returns 404, an identical normalized save returns the current
  summary even with a stale revision, and a changed stale save returns 409
  `revision-conflict` with the current summary. Identical saves render no
  thumbnail and produce no history.
- Preview rendering prepares formula artifacts and releases them after
  rendering. Render failure stores an empty preview without blocking Save.
- Startup runs ordered SQL migrations in one transaction, tracked in
  `schema_migrations`. PostgreSQL owns all persistent state.

## URL prefix

`AUTO_CANVAS_BASE_PATH` is empty by default (root behavior). `/canvas/`
normalizes to `/canvas`; `/` also means root. Nonempty prefixes consist of
slash-separated unreserved ASCII path segments, excluding `.` and `..`.
Invalid values fail startup/build. Apply the same value to the server, editor
build and launchers; changing it requires rebuilding editor assets.

All endpoint paths below are relative to that prefix. With `/canvas`, only
`/canvas/api/*` answers API requests; `/canvas` redirects to `/canvas/` (308,
retaining its query). Static editor and SPA fallback stay inside `/canvas/`;
unknown prefixed API/asset paths and all paths outside the prefix return 404.
Reverse proxies must preserve the prefix and Host, including WebSocket upgrades.
At the Node boundary, a loopback peer may supply a single `X-Forwarded-Proto`
(`http` or `https`) for TLS termination. Other peers and malformed scheme
headers cannot change the public request origin. Forwarded host/path are ignored.

## Contract

Identity and Project errors have `{error: string}`; Component Library errors may add a `code`. Agent errors retain their typed transport envelope. Unknown
paths/methods outside the Component Library return 404 `Not found`.
Project ids are ten characters drawn from `23456789abcdefghjkmnpqrstvwxyz`.
A Project summary is `{id, name, updatedAt, revision, schemaVersion,
galleryEntryId: null, favorite}`; an open payload adds `projectText`.
Timestamps are ISO strings from PostgreSQL `timestamptz`.

| Endpoint                                          | Result                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/health`                                 | `{ok:true}` after a database query succeeds                                       |
| `GET /api/auth/me`                                | `{user}`, `cache-control: no-store`                                               |
| `GET /api/auth/providers`                         | `{github:false, google:false, email:false}`                                       |
| `POST /api/auth/profile`                          | `{displayName}` trimmed to 1–40 characters → `{user}`; 400 `invalid-display-name` |
| `POST /api/auth/logout`                           | `{ok:true}`; identity stays local                                                 |
| `GET /api/projects`                               | `{projects, limit}`, newest `updated_at` then id first; all Projects; `no-store`  |
| `POST /api/projects`                              | `{name, projectText, galleryEntryId?}` → 201 `{project}` summary                  |
| `GET /api/projects/:id`                           | `{project}` open payload; 404 `not-found`; `no-store`                             |
| `PUT /api/projects/:id`                           | Same body as POST, revision gate → `{project}` summary                            |
| `PATCH /api/projects/:id`                         | `{favorite: boolean}` → `{project}` open payload                                  |
| `DELETE /api/projects/:id`                        | Hard delete → `{deleted: id, projects}`                                           |
| `GET /api/projects/:id/preview.svg`               | SVG; 404 `not-found` when missing/empty                                           |
| `GET /api/projects/:id/versions`                  | `{versions, revision}` newest first                                               |
| `GET /api/projects/:id/versions/:vid/project`     | `{projectText}`                                                                   |
| `GET /api/projects/:id/versions/:vid/preview.svg` | Historical SVG                                                                    |
| `POST /api/projects/:id/versions/:vid/restore`    | No body; same revision gate and save semantics as PUT; favorite kept              |

Names are trimmed, at most 120 characters; null/missing names become `""`.
`galleryEntryId`, if present, must be a non-empty string and is ignored.
Invalid fields yield 400 `invalid-fields`; Project text over 2 MiB UTF-8 yields
413 `too-large`; a parse failure yields 400 `invalid-project`.
`GET /api/projects` returns the configured `AUTO_CANVAS_PROJECT_LIMIT` as
`limit` (default 200 Projects). Clients receiving an older response without
`limit` fall back to 200. Exceeding the limit yields 409
`{error:"project-limit", projects}` without evicting a Project.

Version entries are `{versionId, versionNo, name, createdAt, author:"", tags:[]}`;
`versionId` is `<projectId>:<revision>` and is URL-encoded in routes.
All history responses use `private, no-store`. Current previews use
`private, max-age=31536000, immutable` when query `v` equals the current
revision, otherwise `private, no-cache`.

Configuration and commands are in the [server README](../../apps/server/README.md).
Vite dev and preview forward `/api/auth`, `/api/projects`, `/api/components`,
`/api/health` and `/api/agent/` (HTTP and WebSocket) while retaining the browser's
Host/Origin. Gallery, simulation execution and account deletion are deliberately
unimplemented by this server.

## Agent relay

The [Agent session contract](web-agent-session.md) and [Agent API](agent-api.md)
retain their pairing, bearer, editor-secret, scopes, TTLs, rate limits and
request ledger behavior. `/api/agent/sessions`, `/api/agent/claims` and
`/api/agent/connectors/resume` handle pairing and recovery. The session routes
`circuit`, `files` and `projects` forward requests to the editor;
`events`, `control`, `status` and `activity` retain their existing behavior.
`GET /api/agent/sessions/:id/editor` upgrades through Node's HTTP server and `ws`.
The OpenAPI, kit and MCP manifest routes are served by the same router.

`AGENT_ALLOWED_ORIGIN` defaults to the public request origin (including the
Host preserved by Vite). Origin and bearer checks belong to the relay router;
Agent routes do not inherit the identity/Project write guard.

Migration `003-agent-relay.sql` stores each object's keys in
`agent_relay_storage(object_name, key, value)` using Node V8 serialization in
`bytea`, preserving binary and structured-clone values. Alarms are persisted
separately in `agent_relay_alarms`. One Node process owns the live objects;
multiple simultaneous relay processes sharing these tables are unsupported.
Each object's entire cache loads behind `blockConcurrencyWhile`. Events
interleave at awaits; cached storage completes without yielding to another
I/O event. Writes persist in issue order. HTTP responses, WebSocket handshakes
and messages wait for the writes made so far; persistence failure prevents
successful output. Only `blockConcurrencyWhile` blocks event delivery.

Startup re-arms every persisted alarm, including overdue alarms and sessions
not yet accessed. Sockets do not survive restart: the editor reconnects using
its stored proof, or asks to pair again if the session expired. Session state
and request ledger survive; in-flight mutations retain the existing recovery
rules. The browser Project remains authoritative.

Simulation execution and artifact transfer are removed. `/simulation`,
`/artifacts/{fileId}` and `/artifact-status` return 404; the relay forwards
Circuit, File and Project operations only.

`AUTO_CANVAS_AGENT_IDLE_MS` sets the idle object cache lifetime in milliseconds
(default `300000`, five minutes; a non-negative safe integer). An object is
evicted only after events and input blockers finish, sockets and SSE streams
close, and all writes persist. Empty storage is evicted immediately under the
same conditions. Eviction preserves persisted session state; the next request
loads it again. Alarms live in the host scheduler without retaining object
caches and recreate an evicted object when they fire.

SIGINT/SIGTERM stop the relay, close editor sockets and cancel SSE response
bodies (clearing their keepalive intervals), then finish events and flush
storage. The HTTP server can close with an SSE client connected, allowing the
CLI to release its PostgreSQL pool. Shutdown does not revoke persisted sessions;
clients can resume after restart under the existing authorization rules.

[Host tests](../../apps/server/src/agent-relay/host.test.ts) use PostgreSQL and
real WebSockets to cover persistence, alarms, output gates, pairing, restart
and the concurrent HTTP/editor reply path.
[Lifecycle tests](../../apps/server/src/agent-relay/host-lifecycle.test.ts)
cover SSE shutdown, idle eviction, active-object retention and alarm delivery
after eviction using real PostgreSQL, HTTP and WebSockets.

## Acceptance criteria

- [Server contract tests](../../apps/server/src/app.test.ts) exercise the real
  PostgreSQL schema, identity, validation, concurrency, retries, previews,
  history, restore, ownership, and the editor's own Cloud Project client.
- [Browser workflow](../../apps/editor/e2e/cloud-projects-server.spec.ts)
  saves a placed part, reloads, opens from a fresh browser's shelf and reads
  the earlier revision after a changed save with all providers disabled.

## Component Library

The public library keeps authors and revisions; each new record is authored by
`local`, whose admin privileges also permit promotion and management. Reads
need no sign-in. Validation and exact publication content identity live in
`@icm/component-library`, shared with the editor, desktop and Worker.

| Endpoint                                           | Result                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/components`                              | `{entries, nextCursor}`; `q`, `cursor`, `limit` (1–30), `view=summary`, `status=deleted`                                                                  |
| `GET /api/components?catalog=1`                    | Summary catalog with `catalogRevision`, `authors`, `nextCursor`; `type`, `order`, `author`, `since`; limit at most 128                                    |
| `GET /api/components/:id`                          | `{entry}`, including native circuit resources when present                                                                                                |
| `GET /api/components/:id?view=identity&revision=N` | `{id, revision, status}`; stale revision returns 409                                                                                                      |
| `GET /api/components/:id?view=preview&revision=N`  | `{id, revision, symbol}`; stale revision returns 409; malformed history returns 422 `This component needs repair.`                                        |
| `PUT /api/components/:id`                          | `{revision, definition, circuit?, idempotencyKey?}` → `{entry, outcome: created / updated / unchanged}`                                                   |
| `PATCH /api/components/:id`                        | `{revision, action: delete / restore}` or `{revision, status: shared / official / deleted}` → `{entry}`; unchanged retries also have `outcome: unchanged` |

Component ids match `^[a-zA-Z0-9_-]{8,80}$`; invalid ids return 400
`Invalid component ID`, unsupported methods return 405 `Method not allowed`.
PUT/PATCH require matching Origin when supplied and Sec-Fetch-Site, when
supplied, must be `same-origin` or `none` (403 `Cross-origin writes are forbidden`).
Bodies over 128 KiB + 1024 bytes return 413; definition validation also enforces
128 KiB. Published symbol ids are `user-<id>-r<revision>`.

Writes and derived-index backfills run in a PostgreSQL transaction protected
by a library advisory lock, preserving Durable Object serialization. The
catalog trigger invalidates that record's summary and increments its revision
once per component INSERT, UPDATE or DELETE, including management changes.
Unchanged publication and lifecycle retries do not change the catalog revision.
Catalog pages bound accumulated summary bytes to 256 KiB, retaining a single
oversized historical row intact. Query/cursor errors return 400 with
`COMPONENT_CATALOG_QUERY` or `COMPONENT_CATALOG_CURSOR`; a cursor from an older
catalog revision returns 409 `COMPONENT_CATALOG_CHANGED`. A matching `since`
returns empty entries, null cursor, the revision and `notModified: true`.

Seven-day per-user write receipts replay the original JSON and status with
`x-component-write-recovered: true`; reusing a key for another request returns 409. Duplicate new content by the same author returns 409
`COMPONENT_ALREADY_PUBLISHED` with `existing: {id, revision}`. Updates compare
exact normalized package content; unchanged definitions retain revision and
timestamps. Soft deletion retains the definition and previous status; restore
returns to that status. The local admin can inspect deleted records and repair
or manage historical malformed definitions through metadata views.

[Component contract tests](../../apps/server/src/component-library.test.ts),
[catalog tests](../../apps/server/src/component-catalog.test.ts),
[publication tests](../../apps/server/src/component-publication.test.ts),
[lifecycle tests](../../apps/server/src/component-management.test.ts) and
[editor client test](../../apps/server/src/component-client.test.ts) use real
PostgreSQL. The [browser workflow](../../apps/editor/e2e/user-components-server.spec.ts)
authors, publishes, reloads and places from a fresh browser context.
