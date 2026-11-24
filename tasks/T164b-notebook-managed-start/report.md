# T164b report — round 1

## Summary

Part 1 closes the seven non-blocking findings of the code review of T164
(PR 135). Part 2 adds stage M to `scripts/notebook-integration-check.mjs`: in
a disposable silicon-notebook clone at `origin/master` (`b5850d6`), built with
`CANVAS_PROXY_TARGET` and configured with the auto-canvas plugin as a managed
companion service, silicon-notebook starts this checkout's canvas, and two
notebook users get separate, authenticated canvases through the notebook's
origin; the stage then covers the external mode with a misrouted upstream, and
partial and full rollback. One opus subagent implemented both parts in place.

## Steps

| Step                        | Status | Where                                                                                                                                                                                            |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Part 1.1 pinned search_path | done   | `apps/server/src/migrate.ts`; tests "the schema a guarded migration writes to" with `recordedStart()` (query order, both flags; the effect with `a` absent and with `a` created after the guard) |
| Part 1.2 NUL in credentials | done   | `guardedPostgresUrl`; unit cases                                                                                                                                                                 |
| Part 1.3 relative node      | done   | `serve.sh`, `init-db.sh`; launcher cases from the directory holding `bin`                                                                                                                        |
| Part 1.4 unusable log       | done   | `serve.sh`; launcher cases (a directory, a read-only file, the default path a directory)                                                                                                         |
| Part 1.5–1.6 README         | done   | link to `blob/master`; rollback order and the observed partial rollbacks                                                                                                                         |
| Part 1.7 migration count    | done   | `migration-guard.test.ts`                                                                                                                                                                        |
| Refactor                    | done   | `scripts/lib/notebook-integration/notebook-clone.mjs` (clone, guards, modules, build, `.next` removal, `.local`, launch wait and stop); stage A calls it                                         |
| Shared pieces               | done   | `sandbox.env(extra, { envFile: false })`, `sandbox.beforeDispose`, `rawRequest` headers/body, gates with an `init` argument, `tripleGate`; four stage S controls                                 |
| Stage M                     | done   | `scripts/lib/notebook-integration/stage-m.mjs`; the entry script's usage, checks and dispatch                                                                                                    |
| Docs                        | done   | `docs/testing/README.md` (stage M), a link from `docs/specs/server.md`                                                                                                                           |

## Investigation results

- silicon-notebook's settings ignore unknown `.env` keys
  (`SettingsConfigDict(… extra="ignore" …)` in `backend/app/core/config.py` at
  `b5850d6`).
- A bare full SHA resolves as `--ref` in the clone; no fetch of remote-tracking
  refs is needed.

## What stage M observed

- The companion is ready about 6 s after the launch; the canvas port is held
  by `node apps/server/dist/cli.js --require-canvas-database` with the offline
  guard loaded, in the service worker's process group, not the launcher's.
- Signed out: `/canvas/api/projects` 401; `/canvas` is exactly the notebook
  build's `index.html`.
- Two registered users: A creates, reads back, saves with `If-Match`, reopens;
  B gets 404 on A's project; neither list shows the other's project.
- After A signs out, `/api/me` is 401 at once and the canvas refuses A's token
  62.7 s later (its 60 s authorisation window); B still gets 200.
- Stop: the launcher's group, then `extension_services.py stop`; within 10 s
  the companions, the canvas's group and the three listeners are gone.
- External mode, then a standalone canvas on the same port with a seeded
  project: through the notebook `/canvas`, `/canvas/api/projects` and
  `/canvas/api/auth/me` answer the standalone canvas's page shell (HTML, no
  JSON), `/canvas/../api/projects` and `/canvas/%2e%2e/api/projects` 404; no
  body holds the seeded project or the standalone user.
- Partial rollback, plugin entry removed but the target still built in:
  `/canvas` 500, the notebook itself unaffected. Target removed but the entry
  kept: the canvas runs (its own probe 200), `/canvas` through the notebook 404. Both removed: `/canvas` 404, `/` 200.

## Deviations

1. Part 1.1 also tests a race variant (another session creates `a` after the
   guard): the plan's variant passes without the fix; this one does not.
2. Stage M also requires `apps/editor/dist/index.html` (the standalone canvas
   of M-ext serves it).
3. `--base` is a usage error for stage M.
4. A6's launch wait and stop moved to the shared module too; stage A's
   normalised output is identical before and after (107 unique lines, 105
   checks).
5. `sandbox.beforeDispose` and a bounded runner for `extension_services.py
stop`, so an interrupt still stops the companions before the sandbox is
   removed.
6. The "no plugin" configuration is a TOML file holding only a comment.
7. The TOML files are derived from the shipped examples by exact
   substitutions; the stage fails if an example changes shape.
8. `.local` and `release-manifest.json` are removed (validated, after a
   complete stop) before each of the five launches and before the second
   build.
9. M-ext's `serve.sh` gets the managed service's `env` and `env_from`, not
   the notebook's whole environment.
10. `stage-m.mjs` is 1,441 lines.

## Interrupt run

SIGINT once the managed canvas was ready: exit 130 after 4.6 s; the recorded
supervisor, worker and canvas pids are gone; no `auto_canvas_it_m_` database;
the sandbox removed.

## A rule incident, reported by the implementer

Once, it listed (`ls -la`) the owner's
`/Users/huzhifeng/workspace/silicon-notebook/.local/diagnostics/` to look into
a "newer in source checkout" note of stage A. No file was opened or written.
The note itself appears in stage A runs from before this task; the owner's
running notebook writes that directory.

## Not done or not verified

- If a stage's cleanup throws during an interrupt-time dispose, the FAIL line
  it prints is not counted in the summary (stage M's cleanup catches its own
  errors).
