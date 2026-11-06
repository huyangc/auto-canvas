# T011 — Serve auto-canvas under a path prefix (/canvas)

- Branch: `task/T011-base-path`
- Base: `main` at `074541c` (after T010, #13)
- Lane: 1
- Status: approved

## Goal

auto-canvas will be deployed on the same host as silicon-notebook:
`https://notebook.example.com/` stays silicon-notebook (Nginx → Next.js, which
owns `/`, `/api/*`, `/mcp`), and `https://notebook.example.com/canvas/` is
auto-canvas. Add one setting, `AUTO_CANVAS_BASE_PATH` (default empty = `/`,
unchanged behavior), that makes the server, the built editor, the launchers
and every link the app generates live under that prefix. With
`AUTO_CANVAS_BASE_PATH=/canvas`, Nginx forwards `/canvas/` to the server
**without stripping the prefix**.

## Context

- silicon-notebook layout (from its `docs/deployment-and-configuration.md`
  and `frontend/next.config.mjs`): Nginx forwards all paths to Next.js on
  3000; Next.js rewrites `/api/:path*` and `/mcp` to FastAPI. auto-canvas must
  never answer outside its prefix.
- Server: `apps/server/src/app.ts` (`createApp`, routes `/api/auth`,
  `/api/projects`, `/api/components`, `/api/health`, `/api/agent/*`),
  `apps/server/src/cli.ts` (relay `attach(server)` for WebSocket upgrades,
  `EDITOR_ROOT` static editor via `static-editor.ts` with SPA fallback).
- Relay builds links from the request origin:
  `apps/server/src/agent-relay/agent-session-runtime.ts:163-196`
  (`allowedOrigin = env.AGENT_ALLOWED_ORIGIN ?? url.origin`,
  `agentMcpBootstrapManifest(url.origin)`); check every other place in the
  relay and `packages/agent-adapter` that turns an origin into a URL (pairing
  links, manifest `ANALOG_CANVAS_API_URL`, kit/OpenAPI server URLs).
- Agent client: `packages/agent-client/src/http-client.ts:108` `joinUrl` concatenates, so
  a base URL with a path already works; the MCP server takes the editor URL
  from `ANALOG_CANVAS_API_URL`.
- Editor: `apps/editor/vite.config.ts:59` `base: "/"`; absolute `/api/...`
  requests in 8 files: `features/user-components/component-library-client.ts`,
  `features/editor-shell/cloud-projects.ts`, `agent/agent-service-options.ts`,
  `agent/connection-guidance.generated.ts` (generated — fix its generator),
  `agent/use-agent-session.ts` (also the editor WebSocket URL),
  `components/account-menu-view.tsx`, `components/shelf-wall.tsx`,
  `components/account.tsx`. Service worker registration already receives
  `import.meta.env.BASE_URL` (`entries/web.tsx:45`,
  `entries/web-service-worker.ts`); check its scope and cache keys. Other
  absolute paths to check: `index.html`, PWA manifest, icons, fonts, RNL
  package assets, workers (`new URL(..., import.meta.url)` is fine).
- Launchers (T010): `scripts/lib/launcher.sh` (health URL
  `$launcher_url/api/health`, printed URL), `scripts/start.sh`,
  `scripts/dev.sh`, `.env.example`.
- Playwright: 163 `page.goto("/...")` calls assume the root; keep them as
  they are and add a dedicated prefix test instead.
- No Nginx on this machine; test with a small Node reverse proxy.

## Scope

Owned paths: `apps/server/**`, `apps/editor/**`, `packages/agent-adapter/**`
and `packages/agent-client/**` (only URL building), the Agent docs generator
and its outputs if a generated file holds root-absolute paths, `scripts/**`
(launchers and their tests), `.env.example`, `playwright.config.ts` (only to
run the new spec), `docs/specs/server.md`, `docs/specs/web-agent-session.md`
(URL rules), `apps/server/README.md`, `README.md`, `README_zh.md`.

Out of scope: dependencies, product behavior at the root (empty base path
must behave exactly as today).

## Steps

1. **Configuration.** One normalized value: `AUTO_CANVAS_BASE_PATH` accepts
   `""`, `/canvas`, `/canvas/` (normalize to `/canvas`; reject anything that is
   not `/` followed by URL-path-safe segments). Read by the server, the
   launchers and the editor build.
2. **Server.** Mount every route under the prefix (`074541c/api/...`,
   WebSocket upgrades at `074541c/api/agent/...`, static editor and SPA
   fallback at `074541c/`); requests outside the prefix get 404 (never the
   editor, never another app's path). A request for `074541c` without the
   trailing slash redirects to `074541c/`. The relay builds every public URL it
   emits (pairing/manifest/kit) from the request origin **plus** the base
   path. `AGENT_ALLOWED_ORIGIN` keeps meaning an origin.
3. **Editor.** Vite `base` comes from `AUTO_CANVAS_BASE_PATH` at build time
   (`074541c/` or `/`). Route every API and WebSocket request through one
   helper based on `import.meta.env.BASE_URL` (no root-absolute `/api/`
   string left in `apps/editor/src` outside tests); fix the generator of
   `connection-guidance.generated.ts` rather than the file. Service worker
   registered at, scoped to and caching under the base. Dev: the Vite proxy
   forwards `074541c/api` (HTTP and WebSocket) to the server.
4. **Launchers.** `start.sh` builds the editor with the base path, waits for
   `074541c/api/health`, prints `http://HOST:PORT<base>/`; `stop.sh` unchanged
   (by port); `dev.sh` passes the base to Vite. `.env.example` documents the
   setting.
5. **Tests.**
   - Server unit tests with base `/canvas`: routes answer under the prefix,
     404 outside, redirect without trailing slash, static fallback stays
     inside, relay manifest/pairing URLs include `/canvas`.
   - Editor unit test: the API helper with and without a base.
   - A Node script or Vitest integration test that starts the built app with
     `AUTO_CANVAS_BASE_PATH=/canvas` behind a tiny reverse proxy which serves a
     stand-in "notebook" for `/` and `/api/*` and forwards `/canvas/*`
     unchanged (HTTP and WebSocket) to the server; assert the stand-in
     answers `/api/health` and auto-canvas answers `/canvas/api/health`.
   - New Playwright spec `apps/editor/e2e/base-path.spec.ts` against that
     setup (or against `pnpm start` with the base): open `/canvas/`, place a
     part, save to Cloud, reload, reopen from the shelf, open User
     Components; no request leaves `/canvas/` except to the stand-in on
     purpose. Run it only when an env flag is set if it needs its own servers.
6. **Docs.** `apps/server/README.md`: "Deploying beside silicon-notebook"
   with the Nginx `location /canvas/` block (WebSocket upgrade headers,
   `proxy_buffering off`, read timeout ≥ 300 s, no prefix stripping) placed
   before the catch-all to Next.js; server spec and session spec URL rules;
   README / README_zh one line under configuration.

## Acceptance

```bash
pnpm check                                     # passes (empty base: unchanged behavior)
pnpm exec vitest run apps/server scripts       # pass, including base-path tests
AUTO_CANVAS_BASE_PATH=/canvas pnpm start       # prints http://127.0.0.1:4310/canvas/
curl -sf http://127.0.0.1:4310/canvas/api/health   # {"ok":true}
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4310/api/health   # 404
curl -sf http://127.0.0.1:4310/canvas/ | grep -q 'src="/canvas/'           # assets under the prefix
pnpm stop
<the reverse-proxy integration test command>   # passes
<the base-path Playwright command>             # passes
pnpm start && curl -sf http://127.0.0.1:4310/api/health && pnpm stop   # empty base still works
```

## Notes for the implementer

- Empty base path is the regression guard: existing tests and Playwright
  specs must pass unchanged.
- Leave no processes running.
