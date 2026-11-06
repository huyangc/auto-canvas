# T008 — Relay host lifecycle: shutdown and object eviction

- Branch: `task/T008-relay-host-lifecycle`
- Base: `main` at `4125591`
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Runs in parallel with T007 round 2; owned paths are disjoint.
- Status: approved

## Goal

Fix the two findings the codex review raised on PR #8, both in the Node
relay host:

1. **Shutdown hang.** `AgentRelayHost.close()` closes WebSockets but leaves
   open `/api/agent/sessions/:id/events` (SSE) responses and their keepalive
   intervals running, so `server.close()` in `apps/server/src/cli.ts` never
   finishes and SIGINT/SIGTERM cannot release the database pool.
2. **Unbounded registry.** `AgentRelayHost.objects`
   (`apps/server/src/agent-relay/host.ts:208`) keeps a `RelayObject` for
   every session id it has seen, including ids that answer
   `SESSION_NOT_FOUND` and sessions whose storage expired, so memory grows
   with session turnover and with requests for arbitrary ids.

## Context

- Host: `apps/server/src/agent-relay/host.ts` — `RelayObject` (`:32`, per-object
  state, sockets map `:36`, `close()` `:187`), `AgentRelayHost` (`:207`,
  `objects` map `:208`, `close()` `:325-331`). Storage cache and write-behind:
  `apps/server/src/agent-relay/storage.ts`.
- The Durable Object class streams events with a keepalive
  (`agent-session-do.ts:1660` `setInterval`, `:1669` `cancel` handler,
  `:1674` `text/event-stream`, `:1933` `clearInterval`). Cancelling the
  returned response body therefore clears the interval.
- CLI shutdown: `apps/server/src/cli.ts:30-43` (`agentRelay.close()`, then
  `server.close()`, on SIGINT/SIGTERM).
- Host tests: `apps/server/src/agent-relay/host.test.ts`.
- **T007 runs in parallel** and edits `agent-session-do.ts`, the router,
  `host.test.ts` and other relay files.

## Scope

Owned paths: `apps/server/src/agent-relay/host.ts`,
`apps/server/src/agent-relay/storage.ts` (only if eviction needs a flush or
unload hook), `apps/server/src/cli.ts`, a new
`apps/server/src/agent-relay/host-lifecycle.test.ts`, `docs/specs/server.md`
(only the relay lifecycle lines).

Out of scope: `agent-session-do.ts`, `agent-session-runtime.ts`,
`host.test.ts` and every other file (T007). If a fix needs a change there,
stop that part and report it.

## Steps

1. **Shutdown.** The host tracks the `text/event-stream` responses it hands
   out (per object) and, in `close()`, cancels their bodies so the class's
   `cancel` handler clears its keepalive, after closing sockets and before
   flushing storage. Persisted sessions are not revoked: after a restart a
   client can resume as today. `cli.ts` shutdown completes with an open SSE
   client and releases the pool.
2. **Eviction.** Remove a `RelayObject` from `objects` when it is idle: no
   event in flight, no open socket, no open SSE stream, no pending blocker,
   all writes persisted, and either its storage is empty (unknown or expired
   session) or it has been idle longer than a configurable
   `AUTO_CANVAS_AGENT_IDLE_MS` (default 5 minutes). A pending alarm keeps
   its timer in the host's alarm scheduler but must not pin the object; when
   it fires, the object is recreated from storage. A later request for an
   evicted id recreates the object from storage with identical behavior.
3. **Tests** in `host-lifecycle.test.ts` (real PostgreSQL on the lane's
   database, real HTTP and `ws` where relevant):
   - `close()` resolves with an open SSE client; the keepalive stops; the
     pool can be released; a new host resumes the persisted session.
   - Requests for many unknown session ids leave the registry empty
     afterwards.
   - An idle session is evicted after the idle time and then answers its
     next request exactly as before (state preserved).
   - An object with an open socket, SSE stream or in-flight request is not
     evicted; an alarm still fires after eviction.
4. Document the idle setting and shutdown behavior in `docs/specs/server.md`.

## Acceptance

Run with lane 2:

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm check                         # passes
pnpm exec vitest run apps/server   # all pass, including host-lifecycle.test.ts
pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts --workers=1   # pass
```

## Notes for the implementer

- Keep the class's Durable Object semantics unchanged (T005's design:
  concurrent delivery, cache with ordered write-behind, output gates).
- Use fake timers or a small idle value in tests; no test may sleep for
  minutes.
