# T160 report — round 1

(Written by the implementer subagent and saved by the reviewer, because the
harness refused the subagent's own write of a `.md` file. The reviewer's
additions are marked.)

## Summary

`scripts/notebook-integration-check.mjs` checks, on demand, the two rewrite
rules that serve auto-canvas under silicon-notebook's Next.js server at
`/canvas`. Stage T builds a throwaway Next.js app with the rules against a stub
upstream; stage A clones a silicon-notebook revision into a temporary
directory, builds it with and without the rule, runs the same transport table
against the real build and starts the notebook without auto-canvas. Helpers are
in `scripts/lib/notebook-integration/` (`sandbox.mjs`, `transport.mjs`,
`modules.mjs`, `steps.mjs`, `stage-t.mjs`, `stage-a.mjs`). No product code
changed.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 Command line | done | |
| 2 Shared helpers | done | Start marker and identity check of the temporary parent, allow-listed child environment, offline guard with its control, process groups, listener ownership, private modules copy with preflight, manifest reader, the shared transport table. |
| 3 Stage T | done | Three configurations; 116 assertions. |
| 4 Stage A | done with deviation | A6 needs one variable beyond the plan: `SILICON_NOTEBOOK_AUTH_OPTIONAL=true` (see Investigation). |
| 5 Docs | done | `docs/testing/README.md`, section "silicon-notebook integration check". |

## Files

Created: `scripts/notebook-integration-check.mjs`,
`scripts/lib/notebook-integration/{sandbox,transport,modules,steps,stage-t,stage-a}.mjs`.
Modified: `docs/testing/README.md`.

## Acceptance results (implementer)

```text
pnpm install --frozen-lockfile --offline → 0
stage T → 0; "stage T: 116 passed, 0 failed"
stage A, candidate claude/canvas-proxy-rewrite-a58b3d (49cd77372), base d3388036b → 0; "stage A: 78 passed, 0 failed"
stage A, negative control (--ref = --base = d3388036b) → 1; "69 passed, 9 failed": A3 (1), A4 (the 6 forwarded rows), A5 (2); A1, A2, A6 ok
--stage X → usage, 2
TMPDIR inside the checkout, its upper-case spelling, a symlink into it → refused, 2, nothing created under the checkout
pnpm lint, format:check, docs:check, typecheck → 0
pnpm deadcode → 1; every finding is in files this task did not touch
```

Behavioural checks:

- After every run no `nb-check-*` directory and no process of the script remained.
- SIGINT during a `next build` in stage T: "interrupted (SIGINT); cleaning up", exit 130, nothing left.
- SIGINT in A6 after both services were up: exit 130, the launcher's backend and frontend both dead, temporary directory gone.
- Owner listeners before and after: 3000 → 41839 / 41839; 8000 → 41838 / 41838; 4310 → 85736 / 85736.
- Found and fixed during the interrupt test: a second `dispose()` returned early and gave a wrong exit code; both callers now share one disposal promise.

## Investigation results

- Malformed paths ending in a slash all get `308` with the raw `Location` equal to the path minus the final slash, and none reached the stub: `/canvas/./` → `/canvas/.`; `/canvas/../` → `/canvas/..`; `/canvas/%2e%2e/` → `/canvas/%2e%2e`; `/canvas/x/../` → `/canvas/x/..`; `/canvas/a%20b/` → `/canvas/a%20b`.
- Rows added from the candidate's own table (`49cd77372`): `/canvas/%2e%2e/api`, `/canvas/%2E%2E/api`, `/canvas/.%2e/api`, `/canvas/..%2Fapi`, `/canvas/a%7Fb` — all 404, not forwarded. The raw DEL row `/canvas/a<0x7f>b` is sendable but answered `400` (Next's HTTP parser rejects it before routing); pinned as 400 with no upstream request. The candidate's raw tab, newline, space and NUL rows cannot be sent by `node:http`. The table is embedded in the script, not read from the candidate at run time.
- A6 environment: the one extra variable is `SILICON_NOTEBOOK_AUTH_OPTIONAL=true`. Without an env file the backend answers every request, including `/api/health`, with 401, so readiness never passed; the notebook's own `.env.example` allows the setting for local tests. `prod.sh`, `extension_services.sh` (it printed `{"state": "disabled"}`) and `python_env.py` otherwise worked with the plan's variables. The SQLite file and logs landed under the clone's `.local`, and both services were in the launcher's process group.
- Candidate: `49cd77372396ca057ba80074c569dcf056a11cdf`, two commits over `d3388036bd999a7012e9dd32f1fa5a3738f72582`; it changes `.env.example`, two deployment documents, `frontend/next.config.mjs`, `frontend/tests/unit/next-proxy.test.mjs`, `packaging/DEPLOY.md`. Its wildcard `source`, verbatim: `/canvas/:path(\.*(?:[^/\\%.\x00-\x20\x7f]|%(?![01][0-9a-fA-F]|2[0eEfF]|5[cC]|7[fF]))(?:(?:[^/\\%.\x00-\x20\x7f]|%(?![01][0-9a-fA-F]|2[0eEfF]|5[cC]|7[fF]))|\.)*|\.{3,})*`
- Source-checkout observation: nothing newer under `frontend/node_modules`; elsewhere only `.local/diagnostics` and `.local/diagnostics/runtime.json`, written by the owner's running server (note only).
- Every other fact the plan states matched: the 308 `Location` values for backslash and `//` paths, the 500 with the upstream down, the single-rule loop.

## Deviations and open questions

- `pnpm deadcode` exits 1; the findings are outside this task.
- Transport rows print one line each, so a stage prints about 120 lines.
- A2 and A4 pass `-H 127.0.0.1` to `next start`; the notebook's own launcher (A6) does not, so its frontend listens on all interfaces. The listener-ownership check still matched.
- Open: should the candidate's malformed-path table be read at run time instead of embedded?

## Reviewer's addition (2026-11-22)

The reviewer's first rerun of stage A failed after every A6 assertion had
passed: `FAIL A: unexpected error: Error: kill EPERM`, thrown from
`groupAlive` while stopping the launcher's process group. On macOS
`kill(-pgid, 0)` answers `EPERM`, not `ESRCH`, while the group holds only
exited members that have not been reaped; the two services are orphans of the
launcher, so that state lasts until the system reaps them. The implementer's
runs did not hit the window; both of the reviewer's did. Cleanup still
completed (no process, no temporary directory, owner PIDs unchanged). Fixed in
`sandbox.mjs`: `EPERM` now means "not gone yet" and the wait continues. See
`review.md`.

# T160 report — round 2

(From the implementer subagent's hand-back; saved by the reviewer.)

## Review findings addressed

- 5 (must-fix): `next start` 15.5.18 reads no variable for its host (`-H` has no `.env()` binding; without it `server.listen(port, undefined)` listens on every interface), and `prod.sh` passes no `-H`, so option (a) is impossible without editing the clone. Took option (b): `SILICON_NOTEBOOK_AUTH_OPTIONAL` is dropped and the seeded admin gets a random `SILICON_NOTEBOOK_ADMIN_PASSWORD` instead of the default `admin`. Readiness is the anonymous `GET /api/ready` → `ready: true` through the frontend. The first assertion after the services are up is `A6 the clone refuses unauthenticated API requests`: `GET /api/health` with no session → 401 through the frontend and on the backend port; on failure A6 stops at once. Observed: ok in every run; listeners frontend `*:<port>` (all interfaces, as expected) and backend `127.0.0.1:<port>`.
- 6 (must-fix): `prepareModules` refuses a source `node_modules` that is not a real directory (`lstat`), and copies nothing in that case. After the copy, the preflight requires a real destination directory whose `realpath` is inside the sandbox. Demonstrated with a fake tree under the system temp directory: `FAIL private modules preflight: the source … is a symlink, not a real directory`, nothing built.
- 7: `rawRequest` rejects on the response's `error`, `aborted` and `close` before completion, and has one deadline for the whole exchange. Checked: a body cut short was rejected after 56 ms, a hanging body at the deadline.
- 8: one shutdown promise per group id; `ESRCH` retires the id at once; every signal checks ownership first; the `EPERM` handling is kept.
- 9: a group still present after the final wait stays owned. Every caller reports `FAIL <step>: process group <id> still present`, and `dispose` returns the leftover ids, which the entry script reports with a non-zero exit.
- 10: listener states none, owned and foreign; a foreign PID fails at once; ownership is re-checked after the readiness answer and after the last probe of every server.
- 11: A6 parses the backend's `paths: database=sqlite path=…` startup line (`COLUMNS=1000` keeps it unwrapped) and requires that exact file to exist with its `realpath` inside `<clone>/.local`.
- 12: A1 uses `git diff --no-renames --name-only`.
- 13: `find` runs through `spawnSync`; a non-zero exit or any stderr output is a FAIL.
- 14 (must-fix): on Node v26 the default `http` agent passes `[{ path: null, … }]`, `https` passes `{ path: null, … }`, and `fetch` passes an array with no path, so the old guard skipped every `http` / `https` connection. A Unix socket now means a non-empty string `path`. The control checks `fetch`, `http.get` and `https.get` separately; each must fail with the guard's refusal and be logged as `192.0.2.1 49152`. Stage T passing shows loopback through the default agents still works.
- 15: the single-rule control evaluates every check before combining the results.

## Acceptance results (implementer)

```text
stage T → 0; 121 passed, 0 failed
stage A, candidate 49cd77372 → 0; 85 passed, 0 failed (three consecutive runs)
  an earlier run failed only on the source node_modules observation (a Vitest cache written from the notebook repository's own worktree; see review finding 16)
stage A, negative control → 1; 76 passed, 9 failed (A3 1, A4 6, A5 2)
--stage X → 2; the three TMPDIR refusals → 2
pnpm lint, format:check, docs:check, typecheck → 0
owner listener PIDs unchanged (3000: 41839, 8000: 41838, 4310: 85736)
```

## Deviations

- Two variables added to A6 beyond the review row: a random `SILICON_NOTEBOOK_ADMIN_PASSWORD` (closes the default-password hole when authentication stays on) and `COLUMNS=1000`.
- The offline-guard control prints three lines (`offline guard active (fetch)`, `(http.get)`, `(https.get)`) instead of one.
- The post-copy destination check of finding 6 cannot be reached from the command line (the source check fires first) and was not demonstrated separately.

# T160 report — round 3

(From the implementer subagent's hand-back; saved by the reviewer.)

## Review findings addressed

- 17 (must-fix): new `assertInsideSandbox(path)` in `sandbox.mjs`: every existing component from the sandbox root down must be a real directory (lstat, no symlink) whose realpath is inside the root. It is called (a) on the modules copy's destination before the first `rm` / `cp`; (b) after the checkout on `<clone>`, `frontend`, `.local`, `frontend/.next` and `frontend/node_modules`, failing before any copy, build or launch; (c) before the A6 launch on `.local`, which is created as a real directory when absent. The database assertion is now bounded by `<realpath(root)>/nb/.local`. Shown with a throwaway repository whose `frontend` is a tracked symlink to a directory holding a sentinel: stage A fails at the path check and the sentinel survives. A 12-case unit check of the helper passes.
- 18: the offline guard classifies `connect`'s first argument as Node 26.7.0's `Socket.prototype.connect` and `normalizeArgs` do: an array is pre-normalised only with the `normalizedArgs` symbol, any object is the options, a string is a pipe only when `Number(s) >= 0` is false, and anything else is a port with the host from a string second argument. A fourth control, `offline guard active (socket.connect)`, uses `connect(" 49152 ", "192.0.2.1")`. The old guard let it through; the new one refuses and logs it.
- 19: `startNext` and the A6 readiness loop check listener ownership before every readiness request; another pid, or a lost listener, fails at once.
- 20: A1 uses `git diff --no-renames --name-only -z`, split on NUL.
- 21: both `ps` calls in A6 get only `PATH`.
- 22: unexpected exceptions and cleanup failures go through the reporter, and the `stage <X>: N passed, M failed` line is printed last, after disposal, so it always agrees with the exit status.
- 23 (must-fix): stage A refuses, after the checkout, before every build and before the A6 launch, a clone holding `<clone>/.env` or `frontend/.env`, `.env.local`, `.env.production`, `.env.production.local`, `.env.development`, `.env.development.local`, `.env.test` or `.env.test.local`; a file, a symlink or a dangling symlink counts. A re-read of `prod.sh`, `python_env.py`, `extension_services.sh` and `autotune.sh` found no other configuration file read by fixed name: `prod.sh` sources only `<root>/.env`, and Python reads no dotenv when `SILICON_NOTEBOOK_ENV_FILE` is empty. Shown with a throwaway repository whose commit has a root `.env`: stage A fails before any build or launch.
- 24: `dispose()` marks the sandbox closing before taking its snapshot. After that, `start()` / `run()` and `ensureOpen()` (used before every stage-A build and launch and before the modules copy) throw `SandboxClosing`. SIGINT during stage T's first `next build` and during the first A5 build: exit 130, no process group of the script left, the temporary root removed.

## Acceptance results (implementer)

```text
stage T → 0; 122 passed, 0 failed
stage A, candidate 49cd77372, twice → 0; 88 passed, 0 failed
stage A, negative control → 1; 79 passed, 9 failed: A3 (1), A4 (6), A5 (2)
--stage X and the three TMPDIR refusals → 2
pnpm lint, format:check, docs:check, typecheck → 0
owner listener PIDs unchanged (3000: 41839, 8000: 41838, 4310: 85736); notebook checkout git status unchanged
```

## Deviations

- `ensureOpen()` is also called by stage A's clone check and by `prepareModules`, not only by `start()`.
- `optionsOf` treats an array without Node's internal symbol as options, as Node does.
- One sentence added to `docs/testing/README.md` about the stage-A refusals.
- During an experiment `pkill -f "sleep 30"` was used to end a test child; see the review's process note.
