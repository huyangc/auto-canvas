# T160 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T160-notebook-integration-check` on
2026-11-22; every acceptance command rerun by the reviewer in the
implementer's worktree. Implementation by a Claude Sonnet subagent (the
owner's standing instruction since 2026-11-16); the plan had five rounds of
codex `gpt-6.2-astra` review before implementation.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `scripts/lib/notebook-integration/sandbox.mjs` (`groupAlive`, `stopGroup`) | Stage A ended with `FAIL A: unexpected error: Error: kill EPERM` in both of the reviewer's first two runs, after all A6 assertions had passed. On macOS `kill(-pgid, 0)` returns `EPERM` while a group holds only exited, not yet reaped members; the code treated anything but `ESRCH` as an unexpected error. The implementer's report said stage A passed, which was true of its runs: the defect is a timing race. | Fixed by the reviewer (about ten lines): `EPERM` means "not gone yet", so the wait continues, and a signal that returns `EPERM` is not an error. Three consecutive stage A runs on the candidate then passed, 78/78 each. |
| 2 | note | plan, Acceptance | The plan listed `pnpm deadcode` with expected exit 0; it exits 1 on `main` for reasons unrelated to this task (same note as T161). | None here. |
| 3 | note | stage A, A6 | `SILICON_NOTEBOOK_AUTH_OPTIONAL=true` is needed for the clone to answer `/api/health` without an env file. The setting applies only to the disposable clone on loopback ports, with its own SQLite file. | Accepted; recorded in the script's comment and the report. |
| 4 | note | transport table | The candidate's malformed-path table is embedded, not read from the candidate at run time. That keeps stage T independent of the notebook change; stage A runs the same table against the real build, so a weaker candidate pattern is still caught. | Accepted. |

Read in full: `sandbox.mjs`, `modules.mjs`; the stub, raw client and manifest
reader in `transport.mjs`; the clone, launch and cleanup code of `stage-a.mjs`.
Checked specifically: the temporary parent is resolved and compared by
`dev`/`ino` before `mkdtemp`; child environments are built from an allow-list
with `SILICON_NOTEBOOK_ENV_FILE` and `MODEL_SERVICES_CONFIG` empty; every
long-running child leads its own process group and only owned group ids are
signalled; `npm run stop` is never called; the modules copy is checked for
escaping symlinks before anything runs from it.

Acceptance rerun (after finding 1 was fixed):

```text
stage T → 0; 116 passed, 0 failed
stage A, candidate claude/canvas-proxy-rewrite-a58b3d, base d3388036b → 0; 78 passed, 0 failed (three consecutive runs)
stage A, negative control (--ref = --base = d3388036b) → 1; 69 passed, 9 failed: A3 (1), A4 (6 forwarded rows), A5 (2)
--stage X → 2
TMPDIR=$NB/frontend → 2; TMPDIR in upper case → 2; TMPDIR as a symlink into the checkout → 2; no nb-check-* directory under the checkout
pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0; pnpm typecheck → 0
```

Owner's environment, before and after the reviewer's runs: the listeners on
3000, 8000 and 4310 kept their PIDs; `git status --short` of the notebook
checkout was identical; no process of the script and no temporary directory
remained.

Not rerun by the reviewer: the two interrupt (SIGINT) checks; the implementer's
results for them are in the report.

## Round 2 — changes-requested

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 113 at the round-1 head
(two P1, six P2, one P3), each checked against the code by the reviewer and
found valid. Finding 5 is one the reviewer should have raised in round 1: the
implementer's report said plainly that the A6 frontend listens on all
interfaces, and the reviewer accepted it as a note.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 5 | must-fix | `scripts/lib/notebook-integration/stage-a.mjs` (A6, `A6_EXTRA_ENV`) | A6 starts the notebook clone with `SILICON_NOTEBOOK_AUTH_OPTIONAL=true`, and the notebook's launcher starts `next start` without a host, so the frontend listens on every interface. For as long as A6 runs, any machine that can reach this host can use the clone as its seeded administrator through the frontend's `/api/*` proxy. The data is a throwaway, but an unauthenticated service on the network is not acceptable on the owner's machine. | The clone must not be reachable from another machine without credentials. **Investigate**, in this order, and take the first that works without editing any file in the clone: (a) make the launcher's `next start` bind loopback through its environment (for example `HOSTNAME`, or whatever `next start` 15.5.18 reads when `-H` is absent — check the installed source, then verify with `lsof` that the listener's address is `127.0.0.1`); (b) keep authentication **on** (drop `SILICON_NOTEBOOK_AUTH_OPTIONAL`) and prove readiness another way: an authenticated `GET /api/health` after signing in with the fresh database's bootstrap account, or an endpoint the notebook serves without a session (read `backend/app/main.py` and the routes for one; `/api/ready` is mentioned in the notebook's README). If the frontend still listens on all interfaces under (b), say so and add an assertion that an unauthenticated request to a protected endpoint through the frontend is 401. Whatever is chosen, add the assertion `A6 the frontend listener is loopback-only` or `A6 the clone refuses unauthenticated API requests`, and record in the report what was tried. If neither works, A6 prints `FAIL A6: <reason>` and you report it; do not keep the current behaviour. |
| 6 | must-fix | `scripts/lib/notebook-integration/modules.mjs` (`copyModules`, `preflightModules`) | If the source `frontend/node_modules` is itself a symlink, the preserving `cp` copies the link; `walk` then follows it and the containment check uses the external directory as its boundary, so the stages would run the owner's modules in place. | Before copying, require the source to be a real directory (`lstat`), and after copying require the destination root to be a real directory (`lstat`, not a symlink) whose `realpath` is inside the sandbox root; otherwise FAIL the preflight. Add both to the preflight's problem list. Demonstrate with a throwaway directory whose `node_modules` is a symlink (use `--notebook` pointing at a fake tree under the system temp directory) and put the command and its output in your final message. |
| 7 | should-fix | `transport.mjs` (`rawRequest`) | A response whose headers arrive and whose body is cut short never settles the promise: only `end` and the request's `error` are handled. | Reject on the response's `error`, `aborted` and on `close` before `end`; add an overall deadline for the whole exchange. |
| 8 | should-fix | `sandbox.mjs` (`stopGroup`, `run`, `dispose`) | Two overlapping `stopGroup` calls for one group (a build timeout plus the normal path, or an interrupt) both pass the ownership check; one can send `SIGKILL` after the other saw `ESRCH` and forgot the id. | One shutdown promise per group id (later callers await it); retire the id the moment absence (`ESRCH`) is observed, before any further signal can be sent. Keep the `EPERM` handling added in round 1 (`EPERM` = not gone yet). |
| 9 | should-fix | `sandbox.mjs` (`stopGroup` result), `stage-t.mjs`, `stage-a.mjs`, the entry script | When a group is still present after the final wait, `stopGroup` forgets it and returns `false`, and most callers ignore the result, so a stage can report success with a process left behind. | Keep an unverified group in the owned set (so the exit handler still knows it); make every caller turn a `false` into a `FAIL <step>: process group <id> still present`, and make `dispose` report it so the script's exit status is non-zero. |
| 10 | should-fix | `stage-a.mjs` (A6 and `startNext`), `sandbox.mjs` (`listenerIs`) | A foreign process on a probed port is treated as "not ready yet" and waited on for up to two minutes; and once ownership matched it is never checked again, so a later answer could come from a replacement listener. | Distinguish three states — no listener, the expected PID, another PID — and fail at once on another PID. Re-check ownership immediately after the readiness answer and after the last probe of each server (the answers are trusted only if ownership held at both ends). |
| 11 | should-fix | `stage-a.mjs` (A6 "the database and logs are the clone's") | The check passes when any `.sqlite`-like file exists under the clone and the log mentions the clone's path anywhere. | Extract the database path the backend prints at startup (its first log lines name the resolved absolute db, storage and log paths) and assert that exact file exists and its `realpath` is inside `<clone>/.local`. |
| 12 | should-fix | `stage-a.mjs` (A1) | `git diff --name-only` reports only the destination of a rename, so moving a protected manifest out of its location passes. | Use `--no-renames` (both paths then appear) and keep the same protected list. |
| 13 | should-fix | `steps.mjs` (source-checkout observation) | `find` warnings on stderr with exit 0 are dropped, so an incomplete scan prints `ok`. | Capture stderr; non-empty stderr or a non-zero exit is the FAIL the plan asked for. |

Keep everything else as it is. Rerun the whole Acceptance section of the plan
except `pnpm deadcode`, and the three refusal runs.
