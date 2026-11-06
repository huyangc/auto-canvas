# Single-user server

Node 24+ and PostgreSQL 16. Create `auto_canvas` and `auto_canvas_test`, owned by
your OS user, before starting. From the repository root:

```bash
pnpm server:migrate
pnpm server:dev
# In another terminal:
pnpm dev
```

Startup also applies ordered SQL migrations transactionally. The migration
ledger is `schema_migrations`; the local profile, Projects, Component Library and Agent session state survive restarts.
Use `pnpm build` to build all apps, or `pnpm --filter @icm/server... build` to
build the server and its workspace dependencies.

| Variable                        | Default                          | Purpose                                                           |
| ------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                  | `postgresql:///auto_canvas`      | PostgreSQL connection URL                                         |
| `HOST`                          | `127.0.0.1`                      | Bind address                                                      |
| `PORT`                          | `4310`                           | HTTP port                                                         |
| `AUTO_CANVAS_USER_NAME`         | `Local user`                     | Initial display name; persisted profile takes precedence          |
| `AUTO_CANVAS_PROJECT_LIMIT`     | `200`                            | Positive integer, maximum Projects for the local user             |
| `AGENT_ALLOWED_ORIGIN`          | request origin                   | Optional allowed browser origin for Agent HTTP/WebSocket requests |
| `EDITOR_ROOT`                   | unset                            | Built editor directory; enables static assets and SPA fallback    |
| `AUTO_CANVAS_API_URL`           | `http://127.0.0.1:4310`          | Vite dev/preview proxy target; configured in the editor process   |
| `AUTO_CANVAS_TEST_DATABASE_URL` | `postgresql:///auto_canvas_test` | Contract and browser test database                                |

For a built editor, run `EDITOR_ROOT=apps/editor/dist node apps/server/dist/cli.js`.
Unknown `/api/*` requests never fall back to HTML. The server is intended for a
single local user: it has no authentication challenge, cookies or sign-in
providers. See the [HTTP contract](../../docs/specs/server.md).

```bash
pnpm exec vitest run apps/server packages/component-library
pnpm exec playwright test apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts --workers=1
```

Contract tests create and remove an isolated schema in the test database and
fail with its URL when PostgreSQL is unreachable. Browser tests start a server
on port 4311 against the test database and remove their own saved Project.

The Vite dev/preview proxy forwards `/api/components` to this server. User
Components support browsing, catalog filters, revision-bound identity/preview,
publishing complete native circuit packages, idempotent publication retries,
updates, promotion, soft deletion and restoration. Every new record belongs to
the persisted local profile; the local user is an admin. Definitions, receipts,
lifecycle history and derived catalog/content indexes live in PostgreSQL.
Migration `002-component-library.sql` creates these tables and catalog triggers.

For the manual persistence check, start both processes above, author and publish
a User Component, restart both processes, then open User Components, find the
published name and place it on the canvas. The real-server browser test checks
the author/publish/reload/find/place path without API mocks and soft-deletes its
published record afterward. The component browser suite also uses isolated PostgreSQL schemas for
publication recovery, catalog and lifecycle checks.

The Agent relay also runs here in plain Node. Vite dev and preview forward
`/api/agent/` HTTP and WebSocket traffic to `AUTO_CANVAS_API_URL`; they do not
start a Worker. `ICM_E2E_RELAY_AT_START` has no effect. Pair an MCP client with
the editor's Agent connection panel, then use its Circuit resource to place a
part. Restart the server: the editor reconnects with its existing proof or asks
to pair again after expiry.

Migration `003-agent-relay.sql` stores V8-serialized per-session values and
alarm times in PostgreSQL. The host loads an object's cache before delivering
events, persists writes in order, and gates HTTP/WebSocket output on those
writes. HTTP and editor messages can interleave while awaiting replies. Run a
single relay process per database; live sockets are held only by that process.
Simulation and artifact transfer routes are retired and return 404. The relay
serves the retained Agent operations through the editor connection.
