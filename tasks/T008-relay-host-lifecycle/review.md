# T008 review

## Round 1 — accepted

Reviewed: working tree after Codex round 1 (lane 2, in parallel with T007);
acceptance rerun by Opus on lane 2.

Every changed path is in scope (`host.ts`, `storage.ts`, `cli.ts`, the new
`host-lifecycle.test.ts`, `docs/specs/server.md`); nothing T007 owned was
touched.

- Shutdown: the host wraps each `text/event-stream` response it returns,
  tracks it per object and cancels it in `close()`, which runs the class's own
  `cancel` handler and clears the keepalive. Persisted sessions are not
  revoked.
- Eviction (`checkIdle`): an object is evicted only when not busy (no events,
  blockers, sockets or streams, not failed), after its pending writes flush;
  it rechecks business after the await and retries if new writes arrived;
  failed writes block eviction; it is marked stopped before removal. Unknown
  or expired sessions (empty storage) go immediately, others after
  `AUTO_CANVAS_AGENT_IDLE_MS` (default 5 minutes). Alarms are owned by the
  host scheduler, so an evicted object's alarm still fires and recreates it.

| #   | Severity | Where                                   | Finding                                                                                                                    | Resolution                          |
| --- | -------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | note     | `worker/gallery-publishing.test.ts:544` | Failed once in the full parallel run (200 vs 401); passes 3/3 alone. Timing flake in a Worker test unrelated to `host.ts`. | `worker/` is deleted by T007 (#11). |

Acceptance rerun (lane 2):

```text
pnpm check → 1 only for finding 1 (8338 passed)
pnpm exec vitest run apps/server → 0 (97 passed)
playwright agent-connection, web-agent-session → 13 passed
```
