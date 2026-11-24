# T164b review

## Round 1 — accepted

Reviewed: the working tree on `task/T164b-notebook-managed-start` over
`ec6222d` (2026-11-24): Part 1 read in full; `stage-m.mjs` read for its
cleanup (extension stop, process groups, signals by pid only after the
recorded `ps` identity, database drops), its redaction of every URL, password
and token it prints, and its TOML derivation; the refactor judged by stage A's
normalised output, which is identical before and after. Acceptance rerun by
Opus on lane 2.

| #   | Severity | Where                  | Finding                                                                                                                                                                                                                                                                                                                       | Outcome                             |
| --- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | fixed    | `docs/specs/server.md` | The catalog-guard paragraph did not mention the new transaction-local `search_path` pin.                                                                                                                                                                                                                                      | One sentence added by the reviewer. |
| 2   | note     | `stage-m.mjs`          | 1,441 lines, over the review threshold. It is one stage's phases sharing one context; splitting it would spread that context over modules for no reuse.                                                                                                                                                                       | Kept.                               |
| 3   | note     | the owner's checkout   | The implementer once listed the owner's `.local/diagnostics/` directory (names and times; nothing opened or written).                                                                                                                                                                                                         | Reported to the owner.              |
| 4   | note     | `pnpm test:local`      | The reviewer's full run had 8 failing files (5 s timeouts in component-library and publication tests, and "Cannot use a pool after calling end" after them) while another implementer ran packaging and builds on the machine (load average 35–43 on 18 cores). The 8 files passed together on a rerun; none is touched here. | None here; CI is the arbiter.       |

Acceptance rerun:

```text
pnpm build / build:notebook-editor                                  → 0
vitest run (guarded-database, migration-guard, notebook-launcher)   → 0   181 passed, 0 skipped
pnpm test:local                                                     → 1   9118 passed, 8 failed (finding 4)
vitest run (the 8 failing files together)                           → 0   38 passed
pnpm typecheck / lint / format:check / docs:check / deadcode        → 0
stage S                                                             → 0   70 passed
stage T                                                             → 0   141 passed
stage A (--ref b5850d6…, --base d3388036b)                          → 0   105 passed
stage M (--ref b5850d6…)                                            → 0   112 passed
owner ports 3000/8000/4310, notebook checkout status                → unchanged
databases named auto_canvas_it_* afterwards                         → 0
```

## Round 2 — accepted

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 140 at `b35e26f` (one
P1, three P2), each checked and found valid, and the fixes an opus subagent
made; each new stage S control fails on the old behaviour (shown by the
implementer with a copy of the check rebuilt with it). Acceptance rerun by
Opus.

| #   | Severity | Where                            | Finding                                                                                                                                             | Fix                                                                                                                                                                                                                                                    |
| --- | -------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5   | P1 fixed | `stage-m.mjs`, `managedService`  | A listener on the canvas port was recorded as the canvas before any ownership check; a replacement process could later be signalled by the cleanup. | `managedCanvas` / `canvasOwnershipProblem`: recorded only when it descends from the recorded service worker, is in its process group, runs `apps/server/dist/cli.js --require-canvas-database`, and kept its `ps` identity while checked (M2 and M-b). |
| 6   | P2 fixed | `stage-m.mjs`, database creation | A `CREATE DATABASE` in flight when an interrupt began could finish after the cleanup read the list, leaving a database.                             | `databaseLedger`: no create after the shutdown began; in-flight creates are awaited (10 s), then cancelled by backend pid; every database created is dropped.                                                                                          |
| 7   | P2 fixed | `stage-m.mjs`, M-ext             | A probe without an HTTP answer counted as safe.                                                                                                     | `misroutingProblems`: every probe needs a numeric status before its body is checked; a probe without one fails, named.                                                                                                                                 |
| 8   | P2 fixed | `stage-m.mjs`, M8                | The 75 s deadline started after the `/api/me` probe and a late poll got a full budget.                                                              | `firstRefusal`: measured from the logout's 204, each poll capped at the time left, a 401 after 75 s does not count.                                                                                                                                    |

Rerun: stage S 74 passed (four new controls); stage M 112 passed (M8: first
401 after 62.8 s); typecheck, lint, format, docs, deadcode 0; no
`auto_canvas_it_` database left.

## Round 3 — accepted

Reviewed: codex `gpt-6.2-sol` PR review round 2 of PR 140 at `e9c1b13` (one
P1, five P2) and a re-review of the same head (round 3: the same findings and
one new P3), each checked and found valid, and the fixes an opus subagent
made; each new stage S control fails on a copy of the check with that one fix
reverted. Acceptance rerun by Opus.

| #   | Severity | Where                                | Finding                                                                                                                                 | Fix                                                                                                                                                                                                                                  |
| --- | -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9   | P1 fixed | `stage-m.mjs`, the extension stop    | The clone's `extension_services.py stop` ran without revalidation; a symlink to another checkout would stop that checkout's companions. | `runExtensionStop`: the clone, `scripts/` and the script are checked with the sandbox's own path checks (`assertRealDir`, new `assertRealFile`) right before spawning; a refusal runs nothing, is reported, and the cleanup goes on. |
| 10  | P2 fixed | `stage-m.mjs`, supervisor and worker | Their pids were recorded from `state.json` without an ownership check.                                                                  | `managedCompanions`: the supervisor must be this clone's `extension_services.py _supervise --state-dir <clone>/…`, the worker its child running this clone's `extension_service_worker.py <supervisor pid>`, identities stable.      |
| 11  | P2 fixed | the database cleanup                 | Cancellation and drops had no deadlines.                                                                                                | One admin session with connect, query and statement timeouts and an overall budget; measured worst case against a PostgreSQL that never answers: 10 s (30 s with a create in flight).                                                |
| 12  | P2 fixed | `dropDatabases`                      | A failing first drop skipped the second.                                                                                                | Each drop on its own; the names still present are queried and reported.                                                                                                                                                              |
| 13  | P2 fixed | M2, M-b                              | Readiness was polled only after the notebook was ready; a late `ready` passed.                                                          | `readinessWatch` from the launch on; the first `ready` must come within 90 s (observed 2.5 s).                                                                                                                                       |
| 14  | P2 fixed | M7, M8, M-ext                        | A 200 HTML page or a JSON object without `projects` counted as an empty list.                                                           | `projectList`: 200, JSON, a `projects` array of entries with string ids, or the check fails naming the response.                                                                                                                     |
| 15  | P3 fixed | M-ext                                | A JSON body passed when the content type was missing or in another case.                                                                | JSON by a case-insensitive type or by a body that parses.                                                                                                                                                                            |

Rerun: stage S 81 passed (seven new controls); stage M 114 passed;
typecheck, lint, format, docs, deadcode 0; no `auto_canvas_it_` database
left.
