# T161 — Notebook identity mode for the server

- Branch: `task/T161-notebook-identity`
- Base: `main` at `387a3de`
- Lane: 1 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`)
- Status: approved (revision 4; codex gpt-6.2-astra plan review: three rounds, verdict approve)
- Parent plan: the silicon-notebook integration plan (version 7, codex-approved and confirmed by the owner on 2026-11-22; kept outside the repository). This task is its work package W2 and this file is self-contained.

## Goal

Add an opt-in second identity mode to `apps/server`. With `AUTO_CANVAS_AUTH=notebook` the server has no user of its own: every API request must carry the bearer token of a silicon-notebook session, the server asks notebook's `GET /api/me` (on a loopback address) who that is, and uses that user's id as the owner of Projects and Components. With the variable unset or `local` the server behaves exactly as today. No schema change.

This is the server half of "the same users in both products". The editor half is T162; nothing in `apps/editor` changes here.

## Context

Verified on `main` at `387a3de`.

- `apps/server/src/app.ts`
  - `createApp` options (`:8-25`); the default `agentRelay = new AgentRelayHost(db, undefined, undefined, basePath)` is constructed whenever the caller passes none. The `AgentRelayHost` constructor throws on an invalid `AUTO_CANVAS_AGENT_IDLE_MS` (`agent-relay/host.ts:318-331`).
  - Global middleware (`:30-54`): for non-GET requests outside `/api/agent/` and `/api/components` it rejects when `Origin` differs from the request URL's origin or `Sec-Fetch-Site` is not `same-origin` / `same-site` / `none`; it also answers HEAD on identity and project routes with 404.
  - `app.all("/api/agent/*", …)` (`:55`); `GET /api/health` → `SELECT 1` → `{"ok":true}` (`:56-59`).
  - Three middleware registrations call `ensureUser()` for `/api/auth/*`, `/api/projects`, `/api/projects/*` (`:60-71`); `ensureUser()` / `sessionUser()` (`:72-91`) hard-code the user `local`; `registerComponents(app, db, async () => { await ensureUser(); return sessionUser(); }, basePath)` (`:92-100`); `/api/auth/me`, `/providers`, `/profile`, `/logout` (`:101-122`); `registerProjects(app, db, "local", limits.projectLimit)` (`:123`).
  - With a base path, a wrapper app redirects the bare base to `base/` and mounts the app (`:125-133`). A mounted Hono route still sees the full prefixed path, which is why the existing code slices `basePath.length` off `c.req.path`.
- `apps/server/src/projects.ts`: `registerProjects(app, db, userId: string, limit)` (`:196`). Every handler closes over that one `userId` and every data query filters by it (`:204-315`); `save(c, db, userId, …)` (`:85-92`). Current preview: `private, max-age=31536000, immutable` when `?v=` equals the revision, else `private, no-cache` (`:246-260`).
- `apps/server/src/components.ts`: `registerComponents(app, db, sessionUser: () => Promise<LocalUser>, basePath)` (`:16-20`). Invalid ids and unsupported methods return before any user lookup (`:22-28`, `:95-97`); GET looks the user up and passes `admin` and `userId` to the library (`:49-94`); PUT/PATCH run their own origin guard (`:98-106`) before the user lookup and the 401 (`:107-112`). Role rules for manage operations: `component-management.ts:50-69` (only the author or an administrator; a non-administrator may only delete or restore their own, and may restore only what they deleted themselves).
- `apps/server/src/cli.ts`: top-level script: `createDb()`, `await migrate(db)`, then (unless `--migrate`) construct and start `AgentRelayHost`, `createApp`, optionally `serveEditor`, `serve(...)` with a `fetch` wrapper that applies `publicUrl` and rebuilds the `Request` when the URL changed (`:24-33`), `agentRelay.attach(server)` for WebSocket upgrades, and SIGINT/SIGTERM shutdown.
- `apps/server/src/agent-relay/host.ts`: `start()` reads and re-arms persisted alarms (`:333-360`); `attach()` installs the `upgrade` listener (`:440-479`).
- `apps/server/src/base-path.ts`: a base-path segment must match `[A-Za-z0-9._~-]+`, so `@notebook` can never be part of a base path.
- `apps/server/src/static-editor.ts:34-53`: static files and the SPA fallback; 404 for `/api` paths and for a missing path that has a file extension.
- Tests: `apps/server/src/app.test.ts` builds the app with `createApp({ db, user })` on an isolated schema and sends `Origin: http://localhost` on every request. `apps/server/src/base-path.test.ts` asserts that health plus unrelated misses perform exactly one query. `vitest.config.ts` collects `apps/**/*.test.ts` in ordinary runs and sets no timeout override (default 5 s); `pnpm check` runs `test:local` before `build`, so an ordinary test must not need `dist`.
- `scripts/base-path-proxy.mjs` is the existing example of a build-backed check: a Node script that spawns `apps/server/dist/cli.js` on an isolated schema and is run explicitly, not by Vitest.
- silicon-notebook (`/Users/huzhifeng/workspace/silicon-notebook`, read-only reference): `GET /api/me` returns a JSON object with string fields `id`, `email`, `display_name`, `role` (`"admin"` for administrators), `username` (`backend/app/models/identity.py:28-36`, `backend/app/api/system_routes.py:96-98`). A request without a bearer token may return the seeded administrator when that deployment allows anonymous use; an invalid non-empty token returns 401 (`backend/app/api/deps.py:221-253`). Every notebook installation's seeded administrator has the fixed id `user-local`.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/server/src/app.ts`, `projects.ts`, `components.ts`, `cli.ts`
- new: `apps/server/src/auth-config.ts`, `identity.ts`, `notebook-identity.ts`, `integration-mount.ts`, `server-main.ts`
- new tests: `apps/server/src/auth-config.test.ts`, `notebook-identity.test.ts`, `notebook-auth.test.ts`, `integration-mount.test.ts`, `standalone-mode.test.ts`, `server-main.test.ts`
- new: `scripts/server-mode-check.mjs` (build-backed check, modelled on `scripts/base-path-proxy.mjs`)
- `docs/specs/server.md`, `apps/server/README.md`, `.env.example`
- `tasks/T161-notebook-identity/report.md`

Out of scope (do not change):

- `apps/editor/**`, `packages/**`, `integrations/**`, every other file under `scripts/`
- `apps/server/src/public-url.ts`, `base-path.ts`, `static-editor.ts`, `migrate.ts`, `db.ts`, `index.ts`, `migrations/**`, everything under `agent-relay/`
- every existing test file: they must pass unchanged
- dependencies and `pnpm-lock.yaml`

## Steps

1. **`auth-config.ts`.** `readAuthConfig(env)` returns `{ mode: "local" }` only when `AUTO_CANVAS_AUTH` is unset or exactly `local`; `{ mode: "notebook", notebookApi: URL }` when it is exactly `notebook`; throws for every other value, **including the empty string**. In notebook mode `AUTO_CANVAS_NOTEBOOK_API` is required and must be `http:` or `https:`, host `127.0.0.1`, `localhost` or `[::1]`, with no path other than `/`, no query, fragment or credentials. Every error message names the offending variable and never echoes its value.

2. **`notebook-identity.ts`.** `createNotebookIdentity({ notebookApi, onProfile, fetch = globalThis.fetch, now = Date.now, timeoutMs = 5000, capacity = 10_000 })` returns `{ resolve(request): Promise<{ ok: true; profile } | { ok: false; status: 401 | 503 }> }` where `profile` is `{ id, displayName, isAdmin }` and `onProfile: (profile) => Promise<void>`.
   - Token gate: export a pure `parseBearer(header: string | null): string | null` and use it. Accept only a header that matches `^Bearer ([A-Za-z0-9._~+/=-]{1,512})$` exactly (case-sensitive scheme, one space, an ASCII token; notebook issues URL-safe ASCII session tokens). Everything else — no header, another scheme, an empty token, any whitespace including non-ASCII whitespace such as U+0085 or U+00A0, any control or non-ASCII character, 513 characters — is `401` with no outbound request and no hook call. The strict ASCII grammar matters: notebook strips the token before deciding whether to fall back to its anonymous administrator, and Python's notion of whitespace is wider than JavaScript's.
   - Cache key: SHA-256 hex of the token. A live entry returns its profile.
   - Miss: at most one validation per key at a time (later callers await the same promise); at most 32 validations in flight overall, a further distinct token gets `503`; a slot is released when its validation settles, whatever the outcome.
   - Validation: `GET new URL("/api/me", notebookApi)` sending only `Authorization: Bearer <token>`, `redirect: "manual"`, one deadline of `timeoutMs` that covers the headers **and** reading the body, body capped at 64 KiB (a larger or stalled body is a failure). Status 200 with a JSON object whose `id` is a non-empty string of at most 200 characters other than `local`, and whose `display_name` and `role` are strings: success. Status 401: `401`. Everything else (network error, timeout, any 3xx, 5xx, other 4xx, non-JSON, wrong shape, oversized body): `503`.
   - `displayName` is `display_name` trimmed and cut to 80 characters, or the `id` when that is empty. `isAdmin` is `role === "admin"`.
   - On success call `await onProfile(profile)`. If it throws: `503`, nothing cached. **After it returns, re-read the clock: if `now() >= validationStart + 60_000`, return `503` and cache nothing** — a slow hook must not hand a profile to callers after its authorization window has passed.
   - Otherwise cache with expiry `validationStart + 60_000`. Hits never extend it. Keep at most `capacity` entries, evicting the oldest inserted. Failures are not cached.
   - Never put the token, the `Authorization` header or the response body in a log line or error.
   - These limits are additions to the parent plan and are deliberate: the id length cap and the reserved id `local` (it protects the standalone user's rows), the 80-character display name (a display field; identity is the id), the 64 KiB body cap.

3. **`identity.ts`.** `type SessionUser = { id: string; displayName: string; email: null; provider: "local" | "notebook"; role: "user" | "admin"; isAdmin: boolean }`. Local mode's object stays byte-identical to today (`provider: "local"`, `role: "user"`, `isAdmin: true`).

4. **`app.ts`.** Add the option `auth?: AuthConfig` (default `readAuthConfig(process.env)`), plus test seams `notebookFetch?`, `now?`, `notebookTimeoutMs?`.
   - **Local mode must not change**: the same middleware and routes in the same order, the three `ensureUser()` registrations, the constant project owner `"local"`, the component accessor called at the same points as today, the default relay construction. No notebook object is constructed and no extra query runs. `base-path.test.ts`'s one-query assertion must keep passing untouched.
   - **Notebook mode** registers none of the local-only pieces (`ensureUser` middleware, the local origin comparison at `:38-44`, the relay route, the local auth handlers) and does not construct an `AgentRelayHost` (do not evaluate the default). Registration order, with paths taken relative to the base path:
     1. Outermost middleware on `*`: `await next()`, then for every response whose base-relative path is `/api` or under `/api/`, set `Cache-Control: private, no-store` — except a `GET` on `/api/health` or `/api/integration/ready.json`. Being outermost, it also covers the early 404, 403, 401 and 503 below.
     2. `/api/agent` and `/api/agent/*`, any method: `404 {"error":"Not found"}`.
     3. Any `/api/*` request with `Sec-Fetch-Site: cross-site`: `403 {"error":"forbidden"}`.
     4. The existing HEAD rule for identity and project routes (404).
     5. `GET /api/health` — unchanged, body `{"ok":true}`. `GET /api/integration/ready.json` — after `SELECT 1`, `200 {"ok":true,"mode":"notebook"}`. Neither needs a token. Only the method `GET` is public: Hono dispatches `HEAD` to a GET handler, so these two handlers must check `c.req.method` and let a `HEAD` fall through to the identity step (an unauthenticated `HEAD` on either is `401`).
     6. Every other `/api/*` request: resolve the identity. `401 {"error":"unauthorized"}` or `503 {"error":"identity-unavailable"}` end the request; otherwise store the `SessionUser` on the context.
     7. Handlers: `GET /api/auth/me` → `{ user }` (`provider: "notebook"`, `role` `"admin"` or `"user"`, `email: null`), `cache-control` as set by (1); `GET /api/auth/providers` → the same body as local mode; `POST /api/auth/profile`, `POST /api/auth/logout` → `409 {"error":"managed-by-notebook"}`; components; projects.
   - `onProfile`: `INSERT INTO users(id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`.
   - `GET /api/integration/ready.json` is not registered in local mode.

5. **`projects.ts`.** `registerProjects` takes `userOf: (c: Context) => string` instead of `userId: string`; each handler calls it once and passes the result on (including into `save`). Local mode passes `() => "local"`. No query changes.

6. **`components.ts`.** The accessor becomes `(c: Context) => Promise<LocalUser | null>` (or equivalent) so notebook mode returns the context's user; it is still called at exactly the points where `sessionUser()` is called today. Add a parameter `originGuard: boolean`; local mode passes `true` (today's guard), notebook mode `false`.

7. **`integration-mount.ts`.** `stripIntegrationMount(url: URL): URL | null`: when the pathname is exactly `/@notebook/` or starts with `/@notebook/`, return a copy without that first segment, everything else preserved; otherwise `null`. It receives an already-canonical `URL`.

8. **`server-main.ts` and `cli.ts`.** Move the body of `cli.ts` into `export async function startServer({ env = process.env, argv = process.argv, createDb = defaultCreateDb, log = console.log }): Promise<{ address, close(): Promise<void> } | null>` (`null` for `--migrate`); `cli.ts` becomes a thin wrapper that calls it and installs the SIGINT/SIGTERM handlers. This is what lets ordinary tests exercise the real wiring without a build.
   - `readAuthConfig(env)` runs first; on a bad configuration `startServer` rejects **before** `createDb` is called.
   - Local mode: the same sequence as today — the listening log line, relay construction, `start()` before `createApp`, `attach()` after `serve`, and the idempotent shutdown that closes the relay and the HTTP server together and then ends the pool. `--migrate` still migrates, ends the pool and returns without constructing a relay. `cli.ts` keeps its shebang and installs the two `process.once` handlers only when a server was started.
   - Notebook mode: no relay is constructed, started, attached or closed. In the `fetch` wrapper, after `publicUrl`, apply `stripIntegrationMount`; `null` → `404 {"error":"Not found"}`; otherwise dispatch a `Request` built from the stripped URL and the original request, so method, headers and body are preserved. Register an `upgrade` listener that writes `HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` and ends the socket.

9. **`scripts/server-mode-check.mjs`** (run after `pnpm build`; spawns `apps/server/dist/cli.js` on a free port and an isolated schema, cleans up; exits non-zero on the first failed assertion):
   - Local mode (variable unset, then `local`): status, body, `cache-control` and absence of `Set-Cookie` for `GET /api/auth/me`, `GET /api/auth/providers`, `POST /api/auth/profile`, `POST /api/auth/logout` equal fixed expectations written in the script from today's behaviour; the same with `Authorization: Bearer x`; `GET /api/integration/ready.json` → 404.
   - Startup on a pre-populated schema: seed (through a first run) a renamed `local` profile, a project with two saves, a published component; stop; start again; the profile, the component, the current project text and the historical version's text are identical.
   - `AUTO_CANVAS_AUTH` set to `""`, to `Notebook`, and to `notebook` without `AUTO_CANVAS_NOTEBOOK_API`: non-zero exit, stderr names the variable, and no connection was attempted (run with a `DATABASE_URL` whose port is closed and assert the error is the configuration error, not a connection error).
   - Notebook mode with `AUTO_CANVAS_BASE_PATH=/canvas`, `EDITOR_ROOT` pointing at a two-file fixture (`index.html`, `assets/a.js`) and an in-script notebook stub: `/canvas/`, `/canvas/assets/a.js`, `/canvas/api/health` → 404; the same three under `/@notebook` → the fixture's exact bytes and `{"ok":true}`; readiness → 200 without a token; an authenticated `POST /@notebook/canvas/api/projects` with a JSON body → 201 and the project is listed; a raw `Upgrade: websocket` request → the bytes `HTTP/1.1 404`; with `AUTO_CANVAS_AGENT_IDLE_MS=nonsense` the server still starts (the relay is never constructed).
   - Local mode with a seeded project, for base path empty and `/canvas`, each with and without `EDITOR_ROOT`: `GET /@notebook/canvas/api/projects` and `/@notebook/canvas/api/auth/me` return neither project data nor the user object; `GET /@notebook/canvas/api/integration/ready.json` → 404 in all four; `AUTO_CANVAS_BASE_PATH=/@notebook/canvas` → non-zero exit.

10. **Docs.** `docs/specs/server.md`: a "Notebook identity mode" section with the rules above; the two variables; that the Agent relay is off in this mode; the `/@notebook` mount and the readiness path; the authorization lag — at most 60 seconds from the start of the last validation after notebook revokes a session, disables an account or changes a role **on its server**, and that a browser sign-out which only cleared local storage does not revoke the session; that a canvas database belongs to one notebook installation, because every installation's seeded administrator has the id `user-local` and repointing a database would hand one administrator the other's projects; and that standalone behaviour is unchanged. `apps/server/README.md`: both variables in the table, the one-installation rule, a pointer to the spec. `.env.example`: both variables, commented out.

11. **Ordinary tests** (new files; none needs `dist`; real PostgreSQL on an isolated schema as `app.test.ts` does; the notebook stub is a real `node:http` server on an ephemeral loopback port; inject `now` and a short `timeoutMs`, never wait real seconds).
    - `auth-config.test.ts`: unset and `local` → local; `notebook` with each valid host form → notebook; `""`, `Local`, `notebook ` , `oidc` → throw naming `AUTO_CANVAS_AUTH`; notebook mode with the API variable missing, non-loopback, with a path, a query, a fragment, credentials, or a non-HTTP scheme → throw naming `AUTO_CANVAS_NOTEBOOK_API` without echoing the value.
    - `notebook-identity.test.ts`:
      - gate, on `parseBearer` directly (a `Request` cannot carry some of these): `null`, `""`, `"Bearer "`, `"bearer x"`, `"Basic x"`, `"Bearer  x"`, tokens containing a space, a tab, NUL, DEL, U+0085, U+00A0, a non-ASCII letter, a 513-character token → `null`; a 512-character token and one using every allowed punctuation character → the token. Through `resolve` with a real `Request`, for the representable cases (no header, empty bearer, another scheme, an inner space, U+00A0, 513 characters) → `401`, zero stub requests, zero `onProfile` calls. The stub is configured to answer a request without `Authorization` with an administrator profile, to prove that path is unreachable.
      - upstream: stub 401 → `401`; stub down, 302, 500, 200 without `id`, 200 with `id: "local"`, 200 non-JSON, valid headers then a stalled body, a body over 64 KiB, a response slower than `timeoutMs` → `503`; zero `onProfile` calls in every case.
      - hook: `onProfile` rejects → `503`, not cached, and the next call validates again and succeeds; `onProfile` held until the injected clock passes start + 60 s → `503` for the original caller and for a second caller that joined after the deadline, nothing cached.
      - cache: one stub call for many hits; expiry at start + 60 s when the stub took 4 s (injected clock); a hit just before expiry while the stub is down still succeeds and does not extend the entry; after expiry with the stub returning 401 → `401`, with the stub down → `503`; a rotated token is a separate entry; two concurrent calls with one token → one stub call; 33 distinct tokens concurrently → exactly one `503`, and after they settle a 34th validates normally; with `capacity: 2`, the oldest entry is evicted first.
    - `notebook-auth.test.ts` (`createApp` in notebook mode; tokens for Alice, Bob and an administrator):
      - `users` rows: after Alice's first request there is one row with her id and display name; rejected tokens leave the table unchanged; no row with id `local` is ever created by notebook-mode requests.
      - object isolation: Alice saves a project twice, so one historical version exists, and Alice can fetch that version's project text and preview. Bob, using Alice's project id and version id: open, `preview.svg`, PUT with `If-Match`, PATCH favorite, DELETE, `versions`, `versions/:vid/project`, `versions/:vid/preview.svg`, `versions/:vid/restore` → all `404`; afterwards Alice's project, revision and version are unchanged. Bob's list is empty.
      - components, with explicit outcomes: any signed-in user lists and reads shared components; the author publishes and updates; another ordinary user's update, delete, restore or promote → `403`; the author deletes and restores their own; after an administrator deletes it the author's restore → `403` and the administrator's restore succeeds; only the administrator promotes to `official`; the deleted list shows an ordinary user only their own and shows the administrator all; every operation without a token → `401`.
      - `Sec-Fetch-Site: cross-site` with a valid token → `403`; `same-origin`, `same-site`, absent → normal.
      - a project save and a component PUT and PATCH sent with `Origin: http://notebook.example:3000` to a request URL on another host succeed in notebook mode; the same three against a local-mode app are still `403`.
      - `Cache-Control: private, no-store` on: the current preview with `?v=<revision>`, a historical preview, one component, the deleted list, `GET /api/auth/me`, and on the early responses — an agent 404, a cross-site 403, a missing-token 401, an identity 503, an unauthenticated `HEAD /api/projects`, and unauthenticated `HEAD` on `/api/health` and on `/api/integration/ready.json` (both `401`). With base path `/canvas` as well. `GET /api/health` keeps its own headers and the body `{"ok":true}`.
      - `/api/agent/kit`, `POST /api/agent/sessions`, `GET /api/agent/openapi.json` → `404` with and without a token; `createApp` in notebook mode with `AUTO_CANVAS_AGENT_IDLE_MS=nonsense` does not throw.
      - readiness `200 {"ok":true,"mode":"notebook"}` without a token while the stub is down; with a failing database query → not 2xx.
      - `POST /api/auth/profile`, `/logout` → `409`; `GET /api/auth/me` → the notebook user; the administrator has `isAdmin: true`, `role: "admin"`.
    - `standalone-mode.test.ts` (`createApp` with no auth option, and with `{ mode: "local" }`): fixed expectations (written out, not computed from the app) for status, body and `cache-control` of the four auth routes; the same with `Authorization: Bearer x`; no `Set-Cookie` anywhere; `GET /api/integration/ready.json` → `404`; with a spied `db.query`, the number and text of queries for `GET /api/auth/me`, `GET /api/projects`, a component GET with an invalid id (zero user queries) and a rejected cross-origin component PUT (zero user queries) equal what `main` issues; the set of file names in `apps/server/src/migrations/` is exactly the three on `main` and each has the SHA-256 recorded in the test.
    - `integration-mount.test.ts`: `/@notebook/canvas/api/x?y=1` → `/canvas/api/x?y=1`; `/@notebook/` → `/`; `/@notebook`, `/@notebookx/a`, `/canvas/api/x`, `/` → `null`.
    - `server-main.test.ts` (calls `startServer` in-process on port 0). Put `// @vitest-environment node` at the top of this file: `@hono/node-server`'s `serve()` replaces the global `Request` and `Response`, and that annotation is what moves a file into the repository's isolated Vitest project (`vitest.config.ts:18-31`) so the replacement cannot leak into other test files. Cases: bad configuration rejects and the injected `createDb` was never called; `--migrate` returns `null` after migrating even with an invalid relay setting — set it with `vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "nonsense")` and restore it afterwards, because `AgentRelayHost` reads `process.env` directly and an injected `env` object would not reach it; notebook mode strips the mount and preserves method, `Authorization` and a JSON body on an authenticated project save; the query string is preserved, shown by a request whose result depends on it (`GET /@notebook/canvas/api/components?status=deleted` returns a component the caller deleted, and the same path without the query does not); unmounted paths 404; a raw upgrade receives `HTTP/1.1 404`; `close()` resolves and the port is released; local mode starts and serves `/api/health` as today.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test
pnpm exec vitest run apps/server                    # expected: all pass WITHOUT a prior build, including every existing test file unchanged
pnpm test:local scripts/launcher.test.mjs           # expected: all pass
pnpm build                                          # expected: exit 0
node scripts/server-mode-check.mjs                  # expected: exit 0, prints one line per group
git diff --stat main -- apps/server/src/app.test.ts apps/server/src/base-path.test.ts apps/server/src/migrations apps/server/src/public-url.ts apps/server/src/agent-relay apps/server/src/index.ts   # expected: empty
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm deadcode   # expected: exit 0
```

Behavioural checks:

- With no new variable set, `pnpm start` serves the editor and saves a project exactly as before.
- `grep -rn "Bearer" tasks/T161-notebook-identity/report.md` and the server's stdout/stderr captured by `server-mode-check.mjs` contain no token value.

## Notes for the implementer

- Why the origin comparison is dropped in notebook mode: the credential is a header the browser never attaches by itself, so a cross-site page has nothing to ride on; and behind silicon-notebook's Next.js proxy the `Host` header is the upstream address, so the comparison would reject every legitimate write. Do not "fix" this by reading `X-Forwarded-Host`; `public-url.ts` is out of scope on purpose.
- Do not add a session table, a cookie, a login or exchange endpoint, or a migration.
- Do not add dependencies; validate the `/api/me` payload by hand.
- Suggested order, so the diff can be read in two passes: steps 1–3 and their tests first, then steps 4–9 and theirs.
- The Nginx-style regression (`base-path-proxy.mjs --check`, the prefixed Playwright spec) is run by T162 and T164 in disposable build directories, not here.
- If a step cannot be done as written, stop that step and record why in the report.
