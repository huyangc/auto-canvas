# T005 report — round 2

## Summary

Implemented the plain Node Agent relay, PostgreSQL storage and alarms, real
WebSocket hosting, server mounting, Vite proxy replacement and documentation.
The corrected concurrency design lets HTTP handlers await editor replies while
WebSocket events continue to run. Storage uses an object-local cache with
ordered persistence and output gates.

Partial acceptance: all 89 server tests and all 17 required browser tests pass;
MCP packaging and the desktop build pass. Full test acceptance is blocked by
three obsolete Wrangler tests in an unowned file. The additional simulation
browser checks also expose the excluded artifact-transfer behavior and an
unrelated simulation-download timeout. No tests were removed, skipped or
weakened to obtain a pass.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | done    | Round 1's accepted moves/import changes retained. Before step 2, reran `pnpm typecheck` and both moved test files: exit 0, 38 tests passed.                                                                                                                                                                                                                        |
| 2    | done    | Added `agent-relay/host.ts`, `storage.ts` and migration `003-agent-relay.sql`. Cached V8-serialized values, ordered write-behind, HTTP/handshake/socket output gates, concurrent event delivery, `blockConcurrencyWhile`, persisted/re-armed alarms and tagged real `ws` sockets. Added only an injected socket-opening seam to the existing session class.        |
| 3    | done    | Mounted `/api/agent/*` in `createApp`; CLI starts alarm recovery and attaches WebSocket upgrades. `AGENT_ALLOWED_ORIGIN` preserves the router's default request-origin behavior. Agent routes retain their own authorization/origin checks instead of inheriting the Project write guard. Shutdown rejects pending socket forwards before closing database access. |
| 4    | partial | `localAgentRelay()` now forwards HTTP/WebSocket traffic to `AUTO_CANVAS_API_URL`, preserving Host/Origin; no Wrangler import or startup remains. Removed the obsolete Playwright startup flag. Existing proxy tests require an out-of-scope edit, explained below.                                                                                                 |
| 5    | done    | Added nine host tests; all 89 tests in `apps/server` pass, including the 38 moved tests. Covers binary clone isolation, ordered persistence, blockers/output gates, failed persistence, restart recovery, alarms (including re-scheduling the same deadline), real socket pairing/delivery/close and concurrent request reuse.                                     |
| 6    | partial | All 17 explicitly required browser tests pass. Also ran all three remaining Context specs: 50 passed, two simulation cases failed; details below. Manual behavioral acceptance remains for Opus as specified in the plan.                                                                                                                                          |
| 7    | done    | Updated server spec/README, the session spec's host wording and the two root README Agent status lines.                                                                                                                                                                                                                                                            |

## Review findings addressed

| Finding                           | Status    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — corrected concurrency         | addressed | Events interleave while handlers await replies; only explicit blockers hold new event delivery. Cache operations do not wait for database I/O. Writes persist in order and gate HTTP/socket output.                                                                                                                                                                                                                                        |
| 2 — steps 3–7                     | partial   | Implementation, documentation and focused acceptance completed. Full-suite acceptance needs authorization to update the unlisted proxy test file, and the simulation limitations remain reported.                                                                                                                                                                                                                                          |
| 3 — round-1 wait graph            | addressed | `host.test.ts` pairs through the real app and a real `ws` client, sends a Circuit snapshot to the real editor service, and resolves the waiting HTTP fetch through `webSocketMessage`, inside a five-second test deadline (relay timeout is 30 seconds). A second test admits concurrent duplicate/changed requests while the first awaits its reply, preserving `REQUEST_IN_PROGRESS` / `REQUEST_ID_REUSED` without duplicate forwarding. |
| 4 — rerun acceptance / no install | addressed | Ran every acceptance command. Did not issue an install command or change dependencies/lockfile. See the environment note below.                                                                                                                                                                                                                                                                                                            |

## Acceptance results

Final executions used the restored dependencies and local PostgreSQL. Commands
that require PostgreSQL, HTTP/WebSocket listeners or Chrome ran with sandbox
network access. Automatic approval review did not reject an action.

```text
pnpm check → 1
  Formatting, Markdown links, generated docs, component generation,
  typecheck and lint passed (0 lint errors).
  Test Files 2 failed | 901 passed | 3 skipped (906)
  Tests      6 failed | 8823 passed | 135 skipped (8964)
  Failures: 3 obsolete apps/editor/dev/agent-relay.test.ts tests,
            3 known simulation-artifact-files.test.ts failures.
  Stops at tests, so its final build stage does not run.
  The separate required packaging command successfully ran pnpm build.

CI=true pnpm test:local → 1
  Test Files 1 failed | 901 passed | 3 skipped (905)
  Tests      3 failed | 8822 passed | 135 skipped (8960)
  Only failures: apps/editor/dev/agent-relay.test.ts, each at line 33:
    TypeError: proxy.configure is not a function

pnpm exec vitest run apps/server → 0
  Test Files 9 passed (9)
  Tests      89 passed (89)

pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/web-agent-session.spec.ts apps/editor/e2e/agent-bus-productivity.spec.ts apps/editor/e2e/agent-bus-reuse.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts --workers=1 → 0
  17 passed (48.8s)

pnpm mcp:package && pnpm test:desktop-build → 0
  Full workspace build succeeded.
  Packaged analog-canvas-mcp-server-0.17.88.tgz.
  Desktop Vite build succeeded.

 git grep -n "unstable_dev" -- apps/editor/dev/agent-relay.ts → 1
  No output, as required (grep exit 1 means no match).

pnpm exec playwright test apps/editor/e2e/hierarchy.spec.ts apps/editor/e2e/agent-simulation.spec.ts apps/editor/e2e/simulation-workspace.spec.ts --workers=1 → 1
  50 passed, 2 failed (3.3m).
  agent-simulation.spec.ts:304:
    Expected ARTIFACT_TRANSFER_PENDING, received ARTIFACT_STORAGE_UNAVAILABLE.
  simulation-workspace.spec.ts:964:
    Timed out after 60000ms waiting for a download of selected source files.

pnpm typecheck → 0
pnpm lint -- --quiet apps/server → 0 (0 errors, 0 warnings)
pnpm deadcode → 1
  Reports unused exports/types in untouched account/Gallery/adapter/script
  code; no new host/storage export is listed. Left outside-scope code alone.
git diff --check → 0
```

Browser timing above is the Playwright elapsed time for each run; neither run
used retries. No attempt was killed before completion. The extra browser run
retained failure traces/screenshots under `test-results/`.

Final logs:

- `/tmp/t005-check-acceptance.log`
- `/tmp/t005-ci-acceptance.log`
- `/tmp/t005-server-acceptance.log`
- `/tmp/t005-e2e.log`
- `/tmp/t005-e2e-additional.log`
- `/tmp/t005-mcp-acceptance.log`
- `/tmp/t005-desktop-acceptance.log`

Early focused checks caught and fixed a binary-view aliasing bug: V8
`deserialize()` may expose a typed-array view into its serialized buffer, so
cache reads now deserialize a copied buffer. The new isolation assertion
covers both mutation after put and mutation after get. An early full-suite
run also exposed Hono's global Request/Response replacement leaking from the
new embedded-server tests; those listeners now set
`overrideGlobalObjects: false`, and the final suites no longer have that
unrelated container-test failure. Final results supersede those early runs.

## Investigation results

### Behavior without `SIMULATION_ARTIFACTS`

The Node host does not provide a bucket.

- Authenticated artifact GET and editor-authenticated PUT return the existing
  HTTP 503 `{ok:false,error:{code:"ARTIFACT_STORAGE_UNAVAILABLE",...}}`.
  Existing credential and scope checks still run first. The host test proves
  GET/PUT failure and unauthorized GET rejection through app + HTTP.
- Authorized `GET /artifact-status` retains the existing usage projection;
  a fresh session reports zero bytes/files. It does not advertise bucket
  availability.
- Simulation operations still forward to the editor; they do not fail merely
  because the relay lacks artifact storage. The host test proves an editor
  preparation failure returns the existing typed result (`ok:false`, stage
  `prepare`) without crashing or terminating the session. Moved tests also
  retain their simulator-network fixtures and simulation forwarding coverage.
- The additional Agent simulation browser test gets through authoring and
  the fixture-backed run, then fails at artifact transfer with
  `ARTIFACT_STORAGE_UNAVAILABLE`. Transfer is deliberately not ported by this
  plan. The other extra browser failure waits for a simulation source-file
  ZIP download and does not exercise the relay. Its packaging path also has
  the three known unit failures. It was not changed or qualified as passing.

### Retained legacy dev files

`dev/agent-worker.ts` still resolves its imports through the moved relay files;
`dev/wrangler.json` remains intact. Neither is loaded by normal `pnpm dev`,
`pnpm check` product wiring, or Playwright. Local replica files remain unchanged
and opt-in with `ICM_LOCAL_REPLICA=1`; they still use Wrangler. No legacy file
was deliberately broken. The obsolete unit tests mock Wrangler but no longer
match the product's proxy behavior.

### Environment

Started on `task/T005-agent-relay-server` with the accepted round-1 moves and
Opus's plan/review changes already present; retained them. No branch changes,
commits, dependency-manifest edits, lockfile changes or generated-file edits
were made in this round.

The supplied `npm_config_verify_deps_before_run=false` did not reliably disable
this pnpm 11 build's automatic dependency verification. One later invocation
attempted an automatic install and aborted with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` before removing modules. Inspection
of the installed pnpm implementation showed it reads
`pnpm_config_verify_deps_before_run`; all final commands set that variable to
`false` as well. No explicit installation or dependency repair was performed.

## Deviations and open questions

- The remaining unit blocker is `apps/editor/dev/agent-relay.test.ts`. It
  asserts lazy Wrangler startup, pre-start and shutdown, whereas the required
  replacement is a direct server proxy. The plan owns `agent-relay.ts` but
  omits its test file. Per AGENTS.md's owned-path rule, the test file was left
  unchanged and a scope-extension request was sent; no answer was received
  before this report. Authorize that file to replace obsolete expectations
  with dev/preview target, Host/Origin and WebSocket proxy assertions. Nothing
  was disabled in Vitest to hide these failures.
- Full acceptance is therefore incomplete: CI-mode tests must pass, and
  `pnpm check` must return to only the three known simulation failures after
  the proxy tests are updated. The two extra simulation browser failures
  remain explicit limitations, not passing evidence.
- The live host is intentionally one Node process per database. Horizontal
  object ownership across processes is not part of this plan.
- Opus's manual MCP placement/restart acceptance remains outstanding. The
  required browser suite proves MCP/HTTP pairing and editing; host tests
  prove new-host recovery and reconnection with the same database.
