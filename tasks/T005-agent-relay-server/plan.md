# T005 — Agent relay on the server

- Branch: `task/T005-agent-relay-server`
- Base: `main` at `98fcbcd`
- Status: approved

## Goal

Live Agent sessions (pairing claim, browser editor WebSocket, MCP/HTTP Agent
requests forwarded to the editor page) run on `apps/server` in plain Node,
without Cloudflare Workers, wrangler or workerd. The Vite dev and preview
servers forward `/api/agent/*` (HTTP and WebSocket) to `apps/server`, as they
already do for `/api/auth`, `/api/projects` and `/api/components`.

Not in this task: deleting `worker/`, the local replica tooling or the wrangler
dependency (T006); simulation (T007). Simulation artifact transfer through the
relay is not ported (see Context).

## Context

- Relay code (Durable Object design): `worker/agent-session.ts` (re-exports),
  `worker/agent-session-runtime.ts` (628, router `routeAgentSessionRequest`,
  env types `AgentSessionRouterEnv` with `AGENT_SESSION`,
  `AGENT_ALLOWED_ORIGIN?`, `SIMULATION_ARTIFACTS?`, the
  `AgentSessionNamespaceLike` interface), `worker/agent-session-do.ts` (2052,
  class `AgentSessionDO`), `worker/agent-artifacts.ts` (616, R2-backed
  simulation artifact store), `worker/bearer.ts`, `worker/same-origin.ts`.
  Tests: `worker/agent-session.test.ts` (2013), `worker/agent-session-status.test.ts`
  (111).
- Cloudflare API surface the relay uses (all calls):
  `state.storage.get/put/deleteAll/setAlarm`, `alarm()` handler,
  `state.blockConcurrencyWhile`, `state.acceptWebSocket(socket, [EDITOR_SOCKET_TAG])`
  (one site, `agent-session-do.ts:894`), `state.getWebSockets(tag?)`,
  `webSocketMessage` / `webSocketClose` handlers, `new WebSocketPair()` with a
  `101` response carrying `webSocket` (`agent-session-do.ts:932-934`). No
  socket attachments. `SIMULATION_ARTIFACTS` is optional
  (`agent-session-runtime.ts:83`, used at `agent-session-do.ts:131`).
- The tests already run `AgentSessionDO` in Node with a fake state
  (`MemoryStorage` with `setAlarm`, `getWebSockets`; `agent-session.test.ts:353-369`,
  `:650`, `:889`, `:918` restart recovery). The class is built for an
  injected state; the Node host supplies a real one.
- Importers of the relay code outside `worker/`:
  `apps/editor/dev/agent-worker.ts` (dev relay entry for wrangler),
  `apps/editor/src/agent/live-simulation.test-support.ts`,
  `packages/agent-adapter/src/simulation-resource.test.ts`.
- Dev wiring today: `apps/editor/dev/agent-relay.ts` starts a wrangler
  `unstable_dev` worker from `dev/agent-worker.ts` + `dev/wrangler.json`
  (R2 `SIMULATION_ARTIFACTS`, Durable Object `AGENT_SESSION`) on first
  `/api/agent/` request or at start with `ICM_E2E_RELAY_AT_START=1`, and
  proxies `/api/agent/` (with `ws: true`) to it. `apps/editor/dev/api-server-proxy.ts`
  (T003/T004) proxies the other API paths to `AUTO_CANVAS_API_URL`.
- Playwright (`playwright.config.ts:11,64-82`) starts the server on port 4311
  against `auto_canvas_test` and the editor with `ICM_E2E_RELAY_AT_START=1`
  and `AUTO_CANVAS_API_URL`. Agent browser specs: `agent-connection.spec.ts`,
  `web-agent-session.spec.ts`, `agent-bus-productivity.spec.ts`,
  `agent-bus-reuse.spec.ts`, `hierarchy.spec.ts` (Agent parts),
  `agent-simulation.spec.ts`, `simulation-workspace.spec.ts`.
- Server from T003/T004: `apps/server/src/app.ts` (`createApp`), `cli.ts`
  (Hono `@hono/node-server`), migrations `001`, `002`, tests on
  `auto_canvas_test`. Prepared on this branch: `ws@8.21.0` and
  `@types/ws@8.18.2` in `apps/server/package.json`, lockfile updated.
- Contract docs: `docs/specs/web-agent-session.md`, `docs/specs/agent-api.md`,
  `docs/specs/server.md`.

## Scope

Owned paths:

- `apps/server/**`
- Move (with `git mv`) `worker/agent-session.ts`, `agent-session-runtime.ts`,
  `agent-session-do.ts`, `agent-artifacts.ts`, `bearer.ts`, `same-origin.ts`
  and their two test files into `apps/server/src/agent-relay/`, and update
  their importers (the three files in Context, plus anything under `worker/`
  that imports them — only import paths there)
- `apps/editor/dev/agent-relay.ts`, `apps/editor/dev/api-server-proxy.ts`,
  `apps/editor/vite.config.ts`, `playwright.config.ts`
- `docs/specs/server.md`, `docs/specs/web-agent-session.md` (only where it
  names Cloudflare/Durable Objects as the host), `apps/server/README.md`,
  `README.md` and `README_zh.md` (only the "Agent relay on the server" status
  lines)
- Root `vitest.config.ts`, `knip.config.js`, `tsconfig*.json` only as needed

Out of scope: `worker/**` other than the moved files and import paths;
`apps/editor/dev/{agent-worker.ts,wrangler.json,local-replica.ts,replica-*}`
may keep working or be left broken only if nothing in `pnpm check`, `pnpm dev`
or Playwright uses them — report which (T006 deletes them); editor product
code; dependencies beyond what is prepared.

## Steps

1. **Move** the relay files and tests into `apps/server/src/agent-relay/`,
   update importers. `pnpm typecheck` and the moved tests pass before
   step 2 (record it).
2. **Node host** in `apps/server/src/agent-relay/host.ts`:
   - Storage: PostgreSQL table from a new migration
     `003-agent-relay.sql` keyed by `(object_name, key)`, values serialized
     with `node:v8` `serialize`/`deserialize` (structured-clone semantics,
     like Durable Object storage), plus a persisted alarm time per object.
     `get`/`put`/`deleteAll`/`setAlarm` with the semantics the class uses.
   - Concurrency: each object name has one instance and one serial queue;
     `fetch`, `alarm`, `webSocketMessage`, `webSocketClose` and
     `blockConcurrencyWhile` run one at a time per object, as in a Durable
     Object.
   - Alarms: scheduled with timers, persisted, re-armed for every stored
     alarm when the server starts.
   - WebSockets: replace the `WebSocketPair` + `101` path with a host
     upgrade path (Node `upgrade` event with `ws`), adapting a `ws` socket
     to the interface the class uses (`send`, `close`, event delivery to
     `webSocketMessage`/`webSocketClose`, tags for `getWebSockets`). Keep the
     change to `agent-session-do.ts` minimal and isolated: an injected accept
     hook or adapter, not a rewrite. Sockets do not survive a server restart;
     the editor's existing reconnect/recovery path must handle it.
   - Namespace: implement `AgentSessionNamespaceLike` so
     `routeAgentSessionRequest` works unchanged.
   - `SIMULATION_ARTIFACTS` is not provided. Investigate: what do artifact
     routes and simulation Agent operations answer without it? They must
     fail with a clear, existing error, not crash. Report the behavior.
3. **Mount** in `createApp`/`cli.ts`: `/api/agent/*` HTTP routes through the
   router; WebSocket upgrades for the editor socket path; the
   `AGENT_ALLOWED_ORIGIN` equivalent from config (default: same origin as the
   request, as today). Same-origin and bearer rules stay as in the Worker.
4. **Dev wiring**: `apps/editor/dev/agent-relay.ts` (or `api-server-proxy.ts`)
   proxies `/api/agent/` HTTP and WebSocket (`ws: true`) to
   `AUTO_CANVAS_API_URL` instead of starting wrangler; `ICM_E2E_RELAY_AT_START`
   no longer starts anything. `pnpm dev` must not require wrangler.
5. **Tests**: the moved Worker tests run in `apps/server` and pass. Add host
   tests: storage round-trip including binary values, restart recovery
   (new host instance, same database), alarm persistence and re-arming,
   per-object serialization, WebSocket upgrade and delivery with a real `ws`
   client, and an end-to-end pairing test through `app` + `ws`.
6. **Browser checks**: the Agent browser specs in Context pass with the
   relay on the server (simulation-dependent cases may stay as they are if
   they already fail or skip without a simulator; report).
7. **Docs**: server spec (relay endpoints, storage, restart behavior, no
   artifacts), web-agent-session spec host wording, server README, README
   status lines.

## Acceptance

```bash
pnpm check     # only the 3 known simulation-artifact-files failures
CI=true pnpm test:local                          # passes
pnpm exec vitest run apps/server                 # all pass, including moved relay tests and new host tests
pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts apps/editor/e2e/agent-bus-productivity.spec.ts apps/editor/e2e/agent-bus-reuse.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts --workers=1   # pass
pnpm mcp:package && pnpm test:desktop-build      # exit 0
git grep -n "unstable_dev" -- apps/editor/dev/agent-relay.ts   # no output
```

Behavioral (Opus verifies): `pnpm server:dev` + `pnpm dev`, pair an MCP
client (`apps/mcp-server` package) with the open editor, place a part through
the Agent, see it on the canvas; restart the server and see the editor
recover the session or ask to pair again, without a crash.

## Notes for the implementer

- The relay's behavior is the contract: claims, scopes, TTLs, rate limits,
  request ledger, recovery. Do not change it while moving it.
- Parameterized SQL only. Keep the host small and documented; it is the only
  Cloudflare-shaped seam left.
- If a Durable Object behavior the class relies on cannot be reproduced,
  stop that part and report it.
