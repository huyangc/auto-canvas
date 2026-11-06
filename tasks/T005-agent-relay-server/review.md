# T005 review

## Round 1 — changes requested (plan error)

Reviewed: working tree on `task/T005-agent-relay-server` after Codex round 1.

Step 1 (move) is accepted as done: eight files moved with `git mv`, importers
updated, `pnpm typecheck` and the 38 moved tests passed before step 2.

Codex correctly stopped step 2. The plan's concurrency rule was wrong: a
completion-serial queue deadlocks `forwardToEditor` (`agent-session-do.ts:1845`,
awaits at `:1899`) against the `webSocketMessage` that resolves it
(`:455`, `:549-577`). Durable Objects do not serialize whole handlers; they
interleave at `await`s and only gate events during storage operations. The
plan's step 2 now states the corrected design.

The acceptance failures in round 1 were environmental, not code: pnpm 11's
`verify-deps-before-run` saw a lockfile it considered changed (Opus had
reformatted it with Prettier after installing), tried to reinstall inside the
offline sandbox and emptied `node_modules`. Opus repaired `node_modules`
(`pnpm install --frozen-lockfile --offline`) and runs round 2 with
`npm_config_verify_deps_before_run=false` (also added to
`scripts/codex-task.sh` in PR #7).

| #   | Severity | Where       | Finding                                                                                                                                                   | Expected fix                                                                                                                                                                |
| --- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | plan step 2 | Concurrency rule corrected (Durable Object semantics, see plan).                                                                                          | Implement the host per the corrected step 2: concurrent delivery, in-memory storage cache with ordered write-behind, output gate, blocking only in `blockConcurrencyWhile`. |
| 2   | must-fix | steps 3–7   | Not started because of #1.                                                                                                                                | Complete them as planned.                                                                                                                                                   |
| 3   | must-fix | host tests  | Add a test reproducing the round-1 wait graph (a `fetch` awaiting an editor reply that `webSocketMessage` delivers) and show it resolves without timeout. | Test in `apps/server/src/agent-relay/`.                                                                                                                                     |
| 4   | note     | environment | `node_modules` restored; do not install.                                                                                                                  | Rerun every acceptance command.                                                                                                                                             |

## Round 2 — accepted

Reviewed: working tree after Codex round 2; acceptance rerun by Opus on lane 1.

All changes are inside the owned paths. The Durable Object class differs from
`worker/agent-session-do.ts` only by an optional `openWebSocket` seam (the
`WebSocketPair` path is kept) and import paths. `host.ts` delivers events
concurrently, holds them only during `blockConcurrencyWhile`, serves storage
from a per-object cache with ordered write-behind to PostgreSQL
(`003-agent-relay.sql`, V8-serialized `bytea`), gates HTTP and socket output on
persisted writes, and re-arms stored alarms at startup. The round-1 wait graph
is covered by a real `ws` pairing test.

| #   | Severity | Where                                                                   | Finding                                                                                                       | Resolution                                                                                   |
| --- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | must-fix | `apps/editor/dev/agent-relay.test.ts`                                   | Tested the removed wrangler startup (3 failures); the file was missing from the plan's owned paths.           | Fixed by Opus: two tests of the new proxy (target from `AUTO_CANVAS_API_URL`, `ws`, Origin). |
| 2   | note     | `agent-simulation.spec.ts:304`, `simulation-workspace.spec.ts:964`      | Fail because the relay has no artifact storage (`ARTIFACT_STORAGE_UNAVAILABLE`). Browser tests are not in CI. | T006 deletes both specs.                                                                     |
| 3   | note     | `apps/editor/dev/agent-worker.ts`, `dev/wrangler.json`, replica tooling | Still present, no longer used by `pnpm dev` or Playwright.                                                    | T007 deletes them with `worker/`.                                                            |

Acceptance rerun (lane 1):

```text
CI=true pnpm test:local → 0 (8824 passed)
pnpm exec vitest run apps/server → 0 (89 passed)
format:check, docs:check, agent-docs:generated:check, components:check, lint → 0
pnpm mcp:package (includes pnpm build) → 0;  pnpm test:desktop-build → 0
playwright agent-connection, web-agent-session, agent-bus-productivity,
  agent-bus-reuse, cloud-projects-server, user-components-server → 17 passed
```
