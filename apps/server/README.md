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
ledger is `schema_migrations`; the local profile and Projects survive restarts.
Use `pnpm build` to build all apps, or `pnpm --filter @icm/server... build` to
build the server and its workspace dependencies.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql:///auto_canvas` | PostgreSQL connection URL |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `4310` | HTTP port |
| `AUTO_CANVAS_USER_NAME` | `Local user` | Initial display name; persisted profile takes precedence |
| `AUTO_CANVAS_PROJECT_LIMIT` | `200` | Positive integer, maximum Projects for the local user |
| `EDITOR_ROOT` | unset | Built editor directory; enables static assets and SPA fallback |
| `AUTO_CANVAS_API_URL` | `http://127.0.0.1:4310` | Vite dev/preview proxy target; configured in the editor process |
| `AUTO_CANVAS_TEST_DATABASE_URL` | `postgresql:///auto_canvas_test` | Contract and browser test database |

For a built editor, run `EDITOR_ROOT=apps/editor/dist node apps/server/dist/cli.js`.
Unknown `/api/*` requests never fall back to HTML. The server is intended for a
single local user: it has no authentication challenge, cookies or sign-in
providers. See the [HTTP contract](../../docs/specs/server.md).

```bash
pnpm exec vitest run apps/server
pnpm exec playwright test apps/editor/e2e/cloud-projects-server.spec.ts --workers=1
```

Contract tests create and remove an isolated schema in the test database and
fail with its URL when PostgreSQL is unreachable. Browser tests start a server
on port 4311 against the test database and remove their own saved Project.
