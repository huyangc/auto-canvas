# T161 report — round 1

(Written by the implementer subagent; saved here by the reviewer because the harness refused the subagent's own write of a `.md` file. Text unchanged.)

## Summary

`apps/server` has a second, opt-in identity mode. With `AUTO_CANVAS_AUTH=notebook` and a loopback `AUTO_CANVAS_NOTEBOOK_API`, every API request needs a silicon-notebook bearer token. The server checks it with notebook's `GET /api/me` and caches the answer for at most 60 s from the start of validation. The notebook user (upserted into `users`) owns the Projects and Components the request touches. In this mode the server answers only under `/@notebook/<base path>/`, the Agent relay is never constructed, and every API response except the two public `GET` probes is `private, no-store`. With the variable unset or `local`, the routes, headers and database queries are the ones `main` produces. The new `standalone-mode.test.ts` passes unchanged against `origin/main`'s server sources, which supports this. There is no schema change. `cli.ts` is now a thin wrapper around `startServer()` in `server-main.ts`.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 `auth-config.ts` | done with deviation | `readAuthConfig(env)` as specified. It also rejects a value containing `?`, `#` or `@` anywhere, because an empty query, fragment or user part leaves no trace in the parsed `URL`. Error messages name the variable and never contain its value. |
| 2 `notebook-identity.ts` | done | `parseBearer` plus `createNotebookIdentity`. One `AbortController` deadline covers headers and body. The body is read through a 64 KiB cap with a fatal UTF-8 decoder. Validations share by key and are capped at 32 in flight. The clock is read again after `onProfile`. The cache evicts the oldest inserted entry. Errors carry only the status. |
| 3 `identity.ts` | done | `SessionUser`, plus a Hono `ContextVariableMap` augmentation for `sessionUser`. The local object is unchanged. |
| 4 `app.ts` | done | Local registration was moved verbatim into `registerLocal`. Notebook mode is in `registerNotebook` in the plan's order; the cross-site check and the HEAD rule share one middleware, cross-site first. The default relay is still constructed first in local mode, with the un-normalized base path as before, and is never evaluated in notebook mode. Readiness is registered only in notebook mode. |
| 5 `projects.ts` | done | `userOf(c)` is called once per handler and passed on, including into `save`. No query changed. |
| 6 `components.ts` | done with deviation | The accessor is now `(c) => Promise<LocalUser \| null>`, called at the same two points. There is a new `originGuard` parameter with default `true`; local mode passes `true`, notebook mode `false`. |
| 7 `integration-mount.ts` | done | `stripIntegrationMount(url)`. |
| 8 `server-main.ts` + `cli.ts` | done with deviation | `startServer({env, argv, createDb, log})`. The configuration is read and the base path normalized before `createDb`; `createDb(env.DATABASE_URL)` is the same as before when `env = process.env`. It resolves after the listen callback and rejects on a server `error`. Local mode runs the same sequence as before. In notebook mode the `fetch` wrapper strips the mount and answers 404 outside it, the `upgrade` listener writes the exact 404 bytes, and no relay is constructed. `close()` is idempotent. `cli.ts` keeps its shebang and installs SIGINT/SIGTERM only when a server started. |
| 9 `scripts/server-mode-check.mjs` | done | All five groups, plus a check that no token appears in captured server output. Isolated schemas are dropped at the end. |
| 10 Docs | done | `docs/specs/server.md` "Notebook identity mode" section; `apps/server/README.md` table rows and subsection; `.env.example` lists both variables, commented out. |
| 11 Ordinary tests | done | Six new test files; details below. None needs `dist`. |

Test files:

- `auth-config.test.ts`
- `notebook-identity.test.ts`
- `notebook-auth.test.ts`
- `standalone-mode.test.ts`
- `integration-mount.test.ts`
- `server-main.test.ts`, which carries `// @vitest-environment node`

## Files

Modified:

- `apps/server/src/app.ts`, `cli.ts`, `components.ts`, `projects.ts`
- `docs/specs/server.md`, `apps/server/README.md`, `.env.example`

Created:

- `apps/server/src/auth-config.ts`, `identity.ts`, `notebook-identity.ts`, `integration-mount.ts`, `server-main.ts`
- `apps/server/src/auth-config.test.ts`, `notebook-identity.test.ts`, `notebook-auth.test.ts`, `integration-mount.test.ts`, `standalone-mode.test.ts`, `server-main.test.ts`
- `scripts/server-mode-check.mjs`
- `tasks/T161-notebook-identity/report.md`

## Review findings addressed

None (round 1).

## Acceptance results

```text
pnpm install --frozen-lockfile --offline → 0
pnpm exec vitest run apps/server → 0; 18 files, 220 tests passed; apps/server/dist absent (verified with ls)
pnpm test:local scripts/launcher.test.mjs → 0; 22 passed
pnpm build → 0
node scripts/server-mode-check.mjs → 0
  ok local mode: identity routes unchanged (unset and local)
  ok restart: profile, component, project and version survive
  ok configuration errors: refused before any connection
  ok notebook mode: only /@notebook serves; readiness, save and upgrade refusal; relay never built
  ok local mode: /@notebook paths expose nothing; /@notebook base path refused
  ok server output: no bearer token value logged
git diff --stat main -- <protected paths> → empty (also empty against origin/main)
pnpm typecheck → 0; pnpm lint → 0 (0 errors); pnpm format:check → 0; pnpm docs:check → 0
pnpm deadcode → 1: Unused files (3): apps/server/src/agent-relay/bearer.ts, apps/server/src/agent-relay/same-origin.ts, scripts/lib/editor-supervisor.mjs (pre-existing: knip on an extracted origin/main tree reports the same three; no T161 file is listed)
```

Other checks:

- The new server test files were run three more times in a row: 75/75 each time.
- `standalone-mode.test.ts` also passes 7/7 against an extracted copy of `origin/main`'s `apps/server/src`.
- No test schemas were left behind in `auto_canvas_test`.

Behavioural checks:

- `pnpm start`: not run, because the brief forbids it and port 4310. The script's local-mode groups (fixed identity answers, and a save/restart on a pre-populated schema) and the unchanged `app.test.ts` editor-client tests are a partial substitute. Serving the real editor through `pnpm start` is unverified.
- Token values: the script asserts that its random token values are absent from captured server stdout and stderr (passed). This report contains no token value.

## Investigation results

None in the plan.

## Plan facts that turned out wrong

- On `main`, `GET /api/projects` runs the local-user INSERT twice, because both `/api/projects` and `/api/projects/*` match the bare path. `GET /api/auth/me` runs it once. The standalone test records exactly that.
- Component ids must be 8–80 characters (`COMPONENT_LIBRARY_ID`), so a short id gets a 400 before the origin guard; the tests use valid ids.
- All other code facts matched.

## Deviations and open questions

Deviations:

1. `readAuthConfig` also rejects `?`, `#` or `@` anywhere in the API value.
2. `originGuard` defaults to `true`.
3. `identity.ts` adds the `ContextVariableMap` augmentation.
4. `startServer` rejects on a listen error instead of crashing through an unhandled event.

Open questions:

1. The launchers (`scripts/start.sh` and the rest, out of scope) health-check `/api/health`. That path is 404 in notebook mode, so `pnpm start` with `AUTO_CANVAS_AUTH=notebook` would time out. This presumably belongs to T162/T164 or a launcher task.
2. The authorization window starts at the start of validation, so a slow notebook answer shortens the cache entry (tested: a 4 s answer gives a 56 s entry).

# T161 report — round 2

(From the implementer subagent's hand-back; saved by the reviewer.)

## Review findings addressed

- **Finding 6 (must-fix):** the notebook `/api/me` lookup no longer uses the global `fetch` by default. It uses a direct `node:http` / `node:https` request with dedicated no-keep-alive agents that have no `proxyEnv`; an injected `fetch` still replaces it, as before. All step-2 rules hold: only `Authorization` is set, redirects are not followed, one `timeoutMs` deadline, 64 KiB cap, nothing secret in errors. Measured on Node v26.7.0 with everything pointed at a counting trap and `NO_PROXY` unset: global `fetch` → trap; `http.get` with the global agent → trap; `http.get` with `new http.Agent({ keepAlive: false })` → direct; the same with `proxyEnv: process.env` → trap; `https.get` with the default agent → trap; with a dedicated `https.Agent` → direct. `scripts/server-mode-check.mjs` has a new proxy group: a control `fetch` reaches the trap; the notebook-mode server authenticates with zero trap connections and one stub lookup. The group fails (503) with the old transport. `docs/specs/server.md` says the lookup is a direct connection that ignores proxy settings.
- **Finding 7 (must-fix):** the notebook-mode upgrade refusal attaches a socket `error` handler before writing the 404. A test resets 50 upgrade connections and the server still answers; without the fix it raises unhandled `EPIPE`.
- **Finding 8 (should-fix):** `startServer` has one cleanup path for everything after `createDb`: close the relay if built, end the pool, rethrow. Tests cover a missing `EDITOR_ROOT` and a failing `connect`; the bind-failure test is unchanged.

## Acceptance results

```text
rm -rf apps/server/dist && pnpm exec vitest run apps/server → 18 files, 224 tests
pnpm test:local scripts/launcher.test.mjs → 22 tests
pnpm build → 0
node scripts/server-mode-check.mjs → 0, seven "ok" lines
protected paths diff → empty
pnpm typecheck, lint, format:check, docs:check → 0
```

Process note: `pnpm build` without removing `apps/server/dist` does not re-emit an unchanged source file (incremental build info), so `dist` was removed before the final build.
