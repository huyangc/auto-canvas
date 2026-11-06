# Single-user server

Node 24+ and PostgreSQL 16. From the repository root, after
`pnpm install --frozen-lockfile`:

```bash
pnpm start  # build, start in the background, wait for health, print the editor URL
pnpm stop  # stop the process listening on PORT (default 4310)
pnpm dev   # background API + foreground Vite hot reload; Ctrl+C stops both
```

`npm run start`, `npm run stop` and `npm run dev` also work; dependencies must
be installed with pnpm. The launchers check PostgreSQL before building. When
`psql` and `createdb` are available they create a missing `auto_canvas` database,
owned by the connecting user, without changing existing databases. Create
`auto_canvas_test` separately before tests. Custom `DATABASE_URL` databases
must already exist. Without `psql`, connectivity is checked by server startup.

The built app is served at <http://127.0.0.1:4310> by default, including the
API and Agent relay. Development serves Vite on <http://localhost:5173>, proxying
to the configured API host/port (`AUTO_CANVAS_API_URL` can override it).
`pnpm dev:editor` runs only Vite; `pnpm server:dev` still builds and runs only
the server in the foreground, and `pnpm server:migrate` applies migrations
and exits. For the manual persistence check below, use `pnpm dev`.

Copy [`.env.example`](../../.env.example) to `.env` at the repository root
to customize configuration. `pnpm start`, `pnpm stop` and `pnpm dev` source
this optional file as Bash with automatic export before applying defaults.
Exported shell values take precedence (including empty values); quote values
containing spaces or shell syntax. A missing `.env` is fine. Git ignores `.env`
and tracks `.env.example`, which lists server and launcher settings and defaults.
Direct server commands and tests do not load `.env` through these launchers.

Logs append to `.local/logs/server.log` or `.local/logs/server-dev.log`.
`SKIP_BUILD=1 pnpm start` reuses existing builds. `START_TIMEOUT` controls the
health wait (default 60 seconds); `STOP_TIMEOUT` controls the shutdown grace
period before SIGKILL (default 10 seconds). Both accept non-negative integer
seconds. Start refuses occupied ports and reports their processes. Stop finds
the listener by port, without a PID file, and reports "not running" if absent.
Port inspection requires `lsof` (macOS/Linux) or `ss` (Linux); health checks
require `curl`. An interrupted or failed launch cleans up the processes it started.

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
| `AUTO_CANVAS_AGENT_IDLE_MS`     | `300000`                         | Agent session idle timeout in milliseconds                        |
| `AGENT_ALLOWED_ORIGIN`          | request origin                   | Optional allowed browser origin for Agent HTTP/WebSocket requests |
| `EDITOR_ROOT`                   | unset                            | Built editor directory; enables static assets and SPA fallback    |
| `AUTO_CANVAS_API_URL`           | `http://127.0.0.1:4310`          | Vite dev/preview proxy target; configured in the editor process   |
| `AUTO_CANVAS_TEST_DATABASE_URL` | `postgresql:///auto_canvas_test` | Contract and browser test database                                |
| `START_TIMEOUT`                 | `60`                             | Launcher health wait in seconds                                   |
| `STOP_TIMEOUT`                  | `10`                             | Launcher shutdown grace period in seconds                         |
| `SKIP_BUILD`                    | `0`                              | Set to `1` to skip the build in `pnpm start`                      |
| `PGCONNECT_TIMEOUT`             | `5`                              | PostgreSQL CLI connection timeout in seconds                      |

`pnpm start` always sets `EDITOR_ROOT=apps/editor/dist`; `pnpm dev` unsets it
and defaults `AUTO_CANVAS_API_URL` to the configured server URL.

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

For the manual persistence check, run `pnpm dev`, author and publish
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
