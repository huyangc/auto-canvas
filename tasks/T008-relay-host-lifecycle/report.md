# T008 report — round 1

## Summary

Implemented relay shutdown and idle object eviction. The host owns SSE source
readers so it can cancel streams even while the HTTP adapter holds their response
bodies; cancellation clears the session class's keepalive intervals. CLI shutdown
waits for both relay and HTTP cleanup before ending the PostgreSQL pool, without
revoking persisted sessions.

Idle objects leave the registry only after events, input blockers, sockets, SSE
streams and persistence gates permit it. Empty storage is evicted immediately;
other caches use `AUTO_CANVAS_AGENT_IDLE_MS` (default five minutes). Alarm timers
now belong to the host and recreate evicted objects from PostgreSQL on delivery.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Added SSE tracking/cancellation in `host.ts` and coordinated, guarded shutdown in `cli.ts`. Verified stream completion, cleared keepalive, pool release and persisted-session recovery.                                                                     |
| 2    | done   | Added persistence-gated idle eviction, a storage emptiness getter and host-owned alarm scheduling. Startup schedules persisted alarms without loading all object caches; same-time alarm rescheduling retains its generation guard.                         |
| 3    | done   | Added eight tests in `host-lifecycle.test.ts`, using real PostgreSQL, HTTP and WebSockets plus small idle deadlines. Covered unknown-ID cleanup, eviction/restoration, socket/SSE/request/blocker retention, delayed persistence and alarms after eviction. |
| 4    | done   | Documented idle configuration, alarm lifecycle, SSE shutdown and session recovery in the relay section of `docs/specs/server.md`.                                                                                                                           |

## Review findings addressed

Round 1: no task `review.md` exists. Both PR #8 findings identified by the plan
(SSE shutdown hang and unbounded object registry) are covered by regression tests.

## Acceptance results

All acceptance commands used lane 2:

```text
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2

pnpm check → 0
  Formatting, Markdown links, generated outputs, types, lint, tests and build passed.
  oxlint: 2147 files, 0 errors, 2682 warnings.
  Test Files: 834 passed | 2 skipped (836).
  Tests: 8339 passed | 122 skipped (8461).
  Test duration: 45.55s; final build completed (existing chunk-size warnings).

pnpm exec vitest run apps/server → 0
  Test Files: 10 passed (10).
  Tests: 97 passed (97).
  Duration: 4.14s.

pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts --workers=1 → 0
  13 passed (34.5s).
  Elapsed: 34.515s; cumulative attempt time: 28.442s; slowest attempt: 4.767s.
  13 attempts, no retries, skips or flaky results.

AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 node /tmp/T008-cli-shutdown.mjs → 0
  SIGINT: CLI exited cleanly with open SSE, stream ended, persisted session resumed.
  SIGTERM: CLI exited cleanly with open SSE, stream ended, persisted session resumed.

git diff --check → 0
```

The CLI check used the built server executable, an isolated temporary database
schema, actual process signals and HTTP clients. Each process exited with code
zero within a five-second bound; each resumed session remained active. The helper
is an investigative script outside the repository, not a new required test tool.

The browser run emitted non-failing Vite proxy errors for `/api/auth/providers`
and `/api/auth/me` targeting port 4310 during the test that starts its own local
development relay. All 13 workflows passed. Full-check skips were existing suite
skips; no tests were weakened, deleted or newly skipped.

## Investigation results

No explicit investigation step was required. Regression reproduction before the
fix showed 40 unknown session IDs leaving 40 registry entries, and an SSE client
remaining open after `close()` resolved. Both tests pass after the implementation.

The HTTP adapter locks returned response bodies, so shutdown owns each source
reader and closes a forwarding stream instead of calling `cancel()` on a locked
HTTP body. Idle eviction checks the latest ordered write-behind promise again
after awaiting persistence, preserving the existing output gate and concurrent
event delivery. Storage distinguishes a loaded alarm from a newly scheduled one,
preventing reload from duplicating delivery while allowing same-time rescheduling.

An intermediate existing-host suite run exhausted a Vitest worker's heap. After
preserving repeated-close cleanup behavior for the test that deliberately fails
persistence, the existing host suite and all acceptance commands passed. Initial
sandboxed PostgreSQL access failed with `connect EPERM`; authorized local-network
runs completed successfully.

## Deviations and open questions

None. All repository changes are within the plan's owned paths plus this required
report. No dependencies, generated sources, plan/review files or T007-owned files
were changed. No commits, branch switches, pushes, merges or rebases were made.
