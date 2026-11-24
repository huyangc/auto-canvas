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

| Step             | Status              | Notes                                                                                                                                                                                                                                          |
| ---------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Command line   | done                |                                                                                                                                                                                                                                                |
| 2 Shared helpers | done                | Start marker and identity check of the temporary parent, allow-listed child environment, offline guard with its control, process groups, listener ownership, private modules copy with preflight, manifest reader, the shared transport table. |
| 3 Stage T        | done                | Three configurations; 116 assertions.                                                                                                                                                                                                          |
| 4 Stage A        | done with deviation | A6 needs one variable beyond the plan: `SILICON_NOTEBOOK_AUTH_OPTIONAL=true` (see Investigation).                                                                                                                                              |
| 5 Docs           | done                | `docs/testing/README.md`, section "silicon-notebook integration check".                                                                                                                                                                        |

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

## Round 4 of implementation (review round 6: findings R5-1 to R5-3)

(From the implementer subagent's hand-back; saved by the reviewer.)

R5-1, R5-2 and R5-3 are fixed on top of `2eee320`, uncommitted. The acceptance runs below pass, including the negative control. I did not run `pnpm test:local`, and I did not re-run `pnpm deadcode`, which I had not touched since round 1.

**git status --short**

```
 M docs/testing/README.md
 M scripts/lib/notebook-integration/stage-a.mjs
 M scripts/lib/notebook-integration/steps.mjs
 M scripts/notebook-integration-check.mjs
?? scripts/lib/notebook-integration/clone-safety.mjs
?? scripts/lib/notebook-integration/self-check.mjs
```

### What changed per finding

**R5-1: file-level symlinks at write targets**

- **New `clone-safety.mjs`, `cloneTreeProblems(clone, phase)`.** It walks the whole clone, skipping `.git` and `frontend/node_modules`. That directory is populated by the script, so `prepareModules` still checks it is a real directory inside the sandbox and `preflightModules` checks its links.
  - It refuses any symlink that dangles or resolves outside the clone.
  - It refuses any symlink on a write path, even one pointing inside the clone. I derived the write paths by reading `prod.sh`, `extension_services.py`/`.sh` and the revision's tree at the pinned ref. They are `frontend/next-env.d.ts`, `frontend/tsconfig.json`, `frontend/.next`, `release-manifest.json` and `.local`. `.local` covers `logs`, `run/extensions`, the SQLite file, storage and diagnostics.
  - It requires `.local`, `release-manifest.json`, `frontend/.next` and `frontend/node_modules` not to exist in the revision, tracked or not. After the copy and build, `node_modules` and `.next` are allowed as real directories, and the generated files must be regular files.
  - For the launch phase, `.local` must be an empty real directory that the script created.
  - Every message names the path relative to the clone.
- **`stage-a.mjs`, `refuseUnsafeClone(name, paths, phase)`.** It runs at three points:
  - the "start" phase, right after checkout and before the modules copy;
  - before and after every build, in `build()` (these are the "built" checks, so one now runs after each build and not only before the first);
  - in A6 before and after the script creates `.local` (the "launch" phase).
  - The existing dotenv and `assertInsideSandbox` checks are kept. A refusal throws `Refused`, which sets `context.refused`.
- **`notebook-integration-check.mjs`.** A refusal now exits 2.
- **Proof:** new `--stage S` (`self-check.mjs`) makes throwaway git repositories inside the sandbox, clones them, and runs the checks on the clones; the notebook checkout is never touched. In every scenario the outside file is byte-identical afterwards. Output (all `ok`):
  ```
  S next-env-outside: refused (frontend/next-env.d.ts)
  S backend-log-outside: refused (.local/logs/backend.log)
  S symlinked-local: refused (.local)
  S inside-link-allowed: accepted
  S inside-link-on-write-path: refused (frontend/next-env.d.ts is a symlink on a path the run writes)
  S dangling-link: refused (docs-link is a dangling symlink)
  S tracked-release-manifest: refused (release-manifest.json exists)
  S tracked-local: refused (.local exists)
  S launch-fresh-local: accepted
  S launch-local-not-empty: refused (.local is not empty)
  S built-generated-file-redirected: refused (frontend/next-env.d.ts is a symlink resolving outside)
  S built-next-is-a-link: refused (frontend/.next is a symlink resolving outside)
  stage S: 19 passed, 0 failed
  ```
- **Not exercised end to end:** the refusal-to-exit-2 path through the full stage A is not run against a clone, because the later phases need the built notebook. The exit-2 wiring is by code only.

**R5-2: service exits before binding**

- **`steps.mjs`, new `awaitOwnership()`.** The initial ownership wait now stops at once when a launcher-reported PID is dead, or when a foreign process holds a port. A6 in `stage-a.mjs` uses it and prints the reason and log tail.
- **Control:** S runs `awaitOwnership` with a stand-in service that exits immediately and another that sleeps. It returns "exited before binding" in under 10 s.
- **Not proven:** I did not run the old 120 s loop against this control to show it would have failed.

**R5-3: interrupt path**

- **`notebook-integration-check.mjs`.** The signal handler now only marks the interrupt and starts the shared, run-once disposal. A single `finish()` prints the `stage X: N passed, M failed` line and then exits with 130, or 2 after a refusal.
- **Hard stop:** a 60 s timer forces the summary if the stage hangs.
- **Skipped scan:** the source-checkout `find` scan is skipped, with a note, after an interrupt. Without that, the scan ran after the sandbox (and its marker) was already removed and added two spurious FAILs.

### Acceptance

- **Stage T:** exit 0, "stage T: 122 passed, 0 failed".
- **Stage A on the candidate:** exit 0, "stage A: 88 passed, 0 failed".
- **Negative control (`--ref` = `--base` = `d3388036b`):** exit 1, "stage A: 79 passed, 9 failed". The failures are A3 (1), A4 (6) and A5 (2), as before.
- **Stage S:** exit 0, 19 passed.
- **Refusals:** `--stage X` gives usage, exit 2. `TMPDIR` set to `$NB/frontend`, to the upper-case path variant, and to a symlink into it each give the "inside the notebook checkout" refusal, exit 2, and no `nb-check-*` directory is created.
- **Interrupted run during stage T `next build`:** summary line printed ("stage T: 5 passed, 1 failed"), exit 130, no temp dir left.
- **Interrupted run in A6, after "each port is owned":** summary printed ("stage A: 83 passed, 0 failed"), exit 130, process group stopped, 0 `nb-check` dirs left. This is the rerun after the scan fix; the first A6 interrupt showed the two spurious FAILs.
- **Static checks:** `pnpm typecheck` passes; `pnpm lint` has 0 errors and the same 3701 warnings as before; `pnpm format:check` passes; `pnpm docs:check` passes.
- **`pnpm test:local`:** not run. No unit test covers these scripts, and the machine is busy with the other task. Not verified.
- **Machine load:** no run failed by timeout, so no rerun was needed.

### Owner listeners (read-only `lsof`)

| Port | Before | After |
| ---- | ------ | ----- |
| 3000 | 41839  | 41839 |
| 8000 | 41838  | 41838 |
| 4310 | 85736  | 85736 |

Unchanged across all runs, including the interrupt runs. I did not use ports 4273 or 4321 or `auto_canvas_test_2`, and I signalled only process groups my own runs started.

### Deviations and notes

- **Stage S:** `--stage S` is an addition to the plan's stages. Unknown stages such as `X` still exit 2.
- **Dotenv refusals:** these now also exit 2; they exited 1 before.
- **Docs:** I updated the T160 section of `docs/testing/README.md` for the refusals, stage S and the interrupt behaviour.
- **False-positive risk:** the walk refuses any symlink in the revision that resolves outside the clone. The candidate and the base commit pass it, but another revision with such a link would be refused.

## Round 5 of implementation (review round 8: findings R6-1 to R6-5)

(From the implementer subagent's hand-back; saved by the reviewer. A new subagent did this round.)

Nothing is committed, stashed or pushed. I did not edit `review.md`, and nothing under `tasks/**` beyond it was touched.

`git status --short`:

```
 M docs/testing/README.md
 M scripts/lib/notebook-integration/modules.mjs
 M scripts/lib/notebook-integration/sandbox.mjs
 M scripts/lib/notebook-integration/self-check.mjs
 M scripts/lib/notebook-integration/stage-a.mjs
 M scripts/lib/notebook-integration/stage-t.mjs
 M scripts/lib/notebook-integration/steps.mjs
 M scripts/notebook-integration-check.mjs
 M tasks/T160-notebook-integration-check/review.md   (the reviewer's file, already modified before I started)
```

My helper scripts are in the git-ignored `tmp/r8/` (`repro-r61.mjs`, `run-all.sh`, `refusals.sh`, `interrupt.sh`, `make-npmrc-repo.sh`, `e2e-npmrc.sh`, and mutated copies `mut1` to `mut4`).

#### R6-1 (must-fix): npm drops the offline guard

**Reproduced first** (`tmp/r8/repro-r61.mjs`, run on the round-7 code). Each throwaway package under the sandbox has a lifecycle script that connects to 192.0.2.1:49152 (TEST-NET-1, not routed), and in all three cases the guard was lost and the offline log stayed empty:

- a project `.npmrc` with `node-options`: the script saw `NODE_OPTIONS=--dns-result-order=ipv4first`, the connection was attempted unguarded (timeout), offline log `null`;
- the same `.npmrc` in a nested package run by an inner `npm` (the `frontend/.npmrc` case): same result;
- `.npmrc` `script-shell=` pointing at a wrapper that unsets `NODE_OPTIONS`: `NODE_OPTIONS=undefined`, unguarded, log `null`.

**Changes:**

- **`sandbox.mjs` `env()`:** now also sets `npm_config_node_options` to the same guarded value and `npm_config_script_shell=/bin/sh`. I confirmed the mechanism in npm 11.19.0's source (`@npmcli/config/lib/set-envs.js`): npm sets `NODE_OPTIONS` from the effective `node-options` value, and environment settings outrank every `.npmrc` (project, nested, user, global).
- **`sandbox.mjs` positive marker:** the preload's first act is to append `{pid, ppid, argv}` to `<root>/guard-loaded.log` (`NB_CHECK_GUARD_LOADED`). New helpers `guardMark()` and `guardedSince(mark)`.
- **`steps.mjs` checks:** new `guardLoaded()` and `nextCommand()`. These are checked:
  - in stage A after each `npm run build` (a2, a3, a5 twice, a6): the line `<build>: the offline guard was loaded in next build`;
  - in stage T after each `next build`: the same check;
  - in `startNext()`: the pid that owns the port must be in the marker, otherwise the step fails with "the offline guard was not loaded in next start";
  - in A6: `A6 the offline guard was loaded in the frontend (pid N)`.

  The checks look for the process doing the work, not just "any guarded process": npm itself always loads the guard, so a weaker check would pass even when the guard was lost.

- **`steps.mjs` `offlineControl()`:** four npm lifecycle controls now run first in every stage: project `.npmrc` `node-options`, nested package `.npmrc` `node-options`, project `.npmrc` `script-shell`, and `npm exec --call` under a project `node-options`. Each must be refused, appear in the offline log, and leave the probe process in the marker.
- **`self-check.mjs` (stage S) detection controls:** two routes that configuration cannot close must be caught by the marker check: a lifecycle script that runs `NODE_OPTIONS= node …`, and an inner `npm run … --node-options=…` (a command-line flag outranks the environment). Both are detected; the probe in these connects nowhere.

**Proof that it fails without the fix:**

- With the fix removed (`mut1`: the two env lines deleted), stage S gives "4 passed, 4 failed". All four npm controls fail with `exit 4, log [], probe in the guard marker: false`, i.e. the connection was attempted unguarded.
- End to end on a real revision: a throwaway clone of the notebook repo, at the candidate commit 49cd77372 plus one commit adding `frontend/.npmrc` with `node-options` (deleted afterwards).
  - With the fixed code, stage A exits 0 with 98 passed, 0 failed, and every "guard was loaded" line is ok.
  - With the fix removed (`mut4`: env lines deleted, npm controls skipped), stage A exits 1 with 89 passed, 5 failed. The failures are all five builds: `FAIL a2-build: the offline guard was loaded in next build: … guarded since the step began: 21107 /opt/homebrew/bin/npm run build`, and the same for a3, a5, a5 and a6.
  - In that unfixed run `ok no outbound connection attempted` still passed. That is exactly the defect: an empty log proved nothing.

**Other npm routes I examined:**

- `.npmrc` `node-options` at the root, in `frontend/`, in a nested package, or in the user or global config: closed by the environment setting (controls cover the project and nested cases).
- `script-shell`: closed by pinning it in the environment (control covers it).
- `npx` / `npm exec`: same configuration and shell, so closed the same way (control covers it).
- `npm_config_*` precedence: the command line beats the environment, which beats project, user and global files. Only an inner npm given `--node-options` or `--script-shell` on its command line beats us; config cannot close that, so the marker check catches it (stage S control).
- A script that clears `NODE_OPTIONS` itself, or a launcher that does: not an npm setting, caught by the marker (stage S control). This is not a sandbox against a hostile revision.
- `userconfig` / `globalconfig` redirection by a project `.npmrc`: harmless, because the environment still outranks whichever files are loaded.
- `ignore-scripts`: not a way to lose the guard (pre/post scripts get the same environment). Turning it on would skip the notebook's real `prebuild`, so I left it alone.
- `node-gyp`: only used when installing native addons, which never happens here.
- No npm setting picks a different Node binary.

Known limit: the marker covers the main `next build`, `next start` and the A6 frontend. Build workers inherit `NODE_OPTIONS` but are not individually verified.

#### R6-2: a fully exited group could be signalled after its number is reused

- **Change, `sandbox.mjs` `start()` / `stopGroup()`:** every long-running child now starts under a small supervisor. It leads the process group, ignores SIGTERM, and stays alive until it is released. The command's own pid, exit status, signal or spawn error come back over IPC (`handle.ready`, `handle.pid`).
- A group is signalled only while its supervisor has not exited, which means the number is still held by this script's own child. Once the supervisor exits, the group is never signalled again (only probed with signal 0) and is dropped as soon as it is empty. The exit handler follows the same rule.
- Shutdown order: SIGTERM to the group if anything besides the supervisor is in it (checked with `ps`), SIGKILL after 5 s, then release the supervisor.
- `startNext`, `stopServer`, A6 and stage S now use `handle.pid` instead of `child.pid`.
- **Controls (stage S):** `S a group that has fully exited is sent nothing and dropped`, plus the positive case `S a live owned group is signalled and stopped`.
- **Without the fix** (`mut2`: the identity check removed and an unconditional SIGTERM, as in round 7): `FAIL S a group that has fully exited…: signals [{"pgid":8182,"signal":"SIGTERM"}]`.
- **Interrupts still clean up:** SIGINT during A6, after the services were in the owned group, gives exit 130, the temporary root is gone, and no process mentions it. Interrupts during stage T exited 130 the same way in two runs.

#### R6-3: `frontend/node_modules` not rechecked after builds

- **Change:** `modules.mjs` has new `modulesShapeProblems()` (the preflight's rule, now shared with the preflight) and `modulesInClone()`, which adds `assertInsideSandbox`.
- In stage A, `refuseUnsafeClone(..., { modules: true })` runs before and after every build and before the A6 launch; a problem exits 2. In stage T, the shape is checked after each build (`T(x) the private modules are unchanged in shape after the build`).
- **Controls (stage S):** node_modules replaced by a link to a shared tree → refused; a package linked out of the copy → refused; internal links only → accepted.
- **Without the fix** (`mut3`, the function made to return `[]`): both refusal controls fail with `problems []`.

#### R6-4: A5 counted a timed-out build as a rejection

- **Change:** `run()` now returns `timedOut`, and `steps.mjs` has a new `abnormalEnd()`. In A5, a timeout, a signal or a missing status is its own failure, and only a build that ended by itself with a non-zero status counts as a rejection.
- **Control (stage S):** `S a build stopped at its timeout is not counted as a rejection`. It runs a script that prints `CANVAS_PROXY_TARGET` and hangs, with a 3 s timeout.
- **Without the fix** (`mut3`): `FAIL … timedOut true, status -1, signal SIGTERM, reason ""`. The old A5 rule (`status !== 0` and the variable in the output) would have accepted exactly this result.

#### R6-5: stage S failed without `frontend/node_modules`

- **Change:** in `notebook-integration-check.mjs` the source-checkout scan now runs for stages T and A only.
- **Shown:** `--stage S --notebook <an empty directory>` exits 0 with 31 passed.

After an interrupt, the new post-build checks are skipped (`ensureOpen` right after each build), so they do not add misleading failures.

#### Acceptance commands

| Command                                                       | Exit   | Decisive line                                                                                                |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| stage S                                                       | 0      | `stage S: 31 passed, 0 failed`                                                                               |
| stage T                                                       | 0      | `stage T: 132 passed, 0 failed` (was 122)                                                                    |
| stage A, candidate                                            | 0      | `stage A: 98 passed, 0 failed` (was 88)                                                                      |
| stage A, negative control                                     | 1      | `stage A: 89 passed, 9 failed`                                                                               |
| `--stage X`                                                   | 2      | `--stage must be T, A or S` plus usage                                                                       |
| `pnpm typecheck`, `lint`, `format:check`, `docs:check`        | 0 each | —                                                                                                            |
| the three `TMPDIR` refusals (run as `tmp/t160-rerun.sh` does) | 2 each | `…/silicon-notebook/frontend is inside the notebook checkout`; 0 `nb-check-*` directories under the checkout |

- **Negative control failures:** exactly the earlier ones, A3 (1), A4 (6), A5 (2), and nothing new.
- **Why the counts grew:**
  - T gains 10: 4 npm controls, plus 3 builds × (guard check + modules shape check).
  - A gains 10: 4 npm controls, 5 build guard checks, and 1 A6 frontend guard check. The negative control gains the same 10.
  - S now has 31 checks. The new ones are the 4 npm controls, live group, exited group, 2 detection cases, 3 modules cases and the timeout case.
- The final full set ran once, after all edits, with no timeouts or reruns. The lint warnings in the log are in `apps/`, not in these files.

#### Your listener PIDs

Before and after all my runs: 3000 → 41839, 8000 → 41838, 4310 → 85736, unchanged. No `nb-check-*` directory is left in the temp directory, and no process mentions one.

#### Not done or not verified

- `pnpm deadcode` was not run (it was not in this round's list).
- The developer checkout was only read, never written: one `git show` of `frontend/package.json` at 49cd77372, one `git clone` of the repository, and one copy of `frontend/node_modules` for the throwaway end-to-end repository, now deleted.
- I did not diff the notebook checkout's `git status` before and after (it was not asked for this round).
- The guard marker does not individually verify Next's build worker processes.

## Round 6 of implementation (review round 10: findings R7-1 to R7-5)

(From the implementer subagent's hand-back; saved by the reviewer.)

The blocking race (R7-1) is fixed. On the round-9 code (`8f0065e`) the new stop-race control fails: in 12 of 12 runs the command started after the stop and wrote its marker file. On the new code it passes. Nothing is committed, stashed or pushed. I did not edit `review.md` or anything else under `tasks/**`.

`git status --short`:

```
 M docs/testing/README.md
 M scripts/lib/notebook-integration/sandbox.mjs
 M scripts/lib/notebook-integration/self-check.mjs
 M scripts/lib/notebook-integration/stage-a.mjs
 M scripts/lib/notebook-integration/stage-t.mjs
 M scripts/lib/notebook-integration/transport.mjs
 M tasks/T160-notebook-integration-check/review.md   (the reviewer's file, already modified before I started)
```

My helper scripts are in the git-ignored `tmp/r10/`: `old/sandbox.mjs` (the `8f0065e` version), `race-driver.mjs`, `interrupt-at.mjs` and a mutated copy `mut/`.

#### R7-1 (must-fix): start, stop and release protocol

**Reproduced.** `tmp/r10/race-driver.mjs` runs the new stage S stop-race controls against `8f0065e`'s `sandbox.mjs`:

- "a stop right after start()": 12 of 12 runs never spawned when cleanup looked, yet the side effect was written. The command was started after the release and left orphaned.
- The held-back-launch variant fails the same way (the old supervisor ignores the delay).
- "a stop after the command started" passes on the old code too.
- Result on old code: exit 1.

**Changed, in `sandbox.mjs`:**

- **Protocol comment block** above `SUPERVISOR`: the messages in each direction, the supervisor's states, and who may send what when.
- **Supervisor:**
  - The spec still arrives as the first IPC message, never on a command line.
  - On `"stop"` it sets `stopped`, cancels a pending launch, and replies `{stopAck, cancelled, running}`. After that, `launch()` refuses to start anything.
  - On `"release"` it exits only if its command is not alive; otherwise it replies `{releaseRefused}`.
  - When its channel to the script closes, it SIGKILLs its own group, then exits.
  - Stage S-only test hooks travel in the spec: `launchDelayMs` and `ackDelayMs`.
- **`start()`:** accepts `testHooks` (`launchDelayMs`, `ackDelayMs`, `stopAckMs`). `handle.reply(kind)` collects the stop and release replies. A cancelled launch resolves `handle.done` with an error.
- **`stopGroup()`:**
  1. Send `"stop"` and wait for the acknowledgement, bounded by `STOP_ACK_MS` (10 s, because the machine is busy). No acknowledgement means SIGKILL to the group, which is safe because the supervisor is still this script's live child.
  2. Only then read the group's membership with `ps`, which is now final because nothing can start in the group any more. If anything besides the supervisor is there: SIGTERM, then SIGKILL after 5 s.
  3. Send `"release"`. A refusal or no exit within 5 s means SIGKILL to the group.
- **Process `exit` handler:** comment updated. Every send now has a callback, so a closed channel cannot raise an unhandled `error`.

**Orderings and why each is safe:**

- **Stop before the supervisor has run its first line:** spec and `"stop"` wait in the channel in that order. On boot it processes the spec, then the stop, and acknowledges with `running: true`, so the group is SIGTERMed. If boot takes longer than the bound, the group is SIGKILLed with the supervisor in it, so it can spawn nothing.
- **Stop while the launch is pending** (only reachable with the delay hook): the launch is cancelled, the acknowledgement says `cancelled`, and nothing ever runs.
- **Plain stop right after `start()`:** IPC order means the spec is always handled before the stop. This is why the 12 repeated runs all come out "signalled", and why the cancel order needs the delay hook to be forced deterministically.
- **Spawn error:** `{error}` arrives before the acknowledgement (`running: false`), the group is empty, and the release is accepted.
- **Command exits before the acknowledgement:** `{status}` comes first, then the acknowledgement with `running: false`. Leftover descendants are SIGTERMed, then the release follows.
- **Two shutdown callers:** the `stopping` map gives both one shared promise, so only one `"stop"` is sent. A later call on a group whose supervisor has exited only probes it.
- **Synchronous `exit` handler:** it cannot wait for an acknowledgement and needs none. SIGKILL to a group whose supervisor is still a live child is safe (the number is ours) and total (the supervisor dies too, so a launch still queued in its channel never runs). Groups whose supervisor has exited are not signalled.
- **Script killed with SIGKILL** (no handler runs): each supervisor sees its channel close and SIGKILLs its own group.
- **Stated limit:** a command that moved itself to another group escapes all of this. R7-3 now reports such a process for A6.

**Controls (stage S), all pass:**

- "a stop right after start() (12x)": 12 signalled. Afterwards no command alive and no side effect.
- "a stop while the launch is pending (3x)": 3 cancelled.
- "a stop after the command started (3x)": 3 signalled.
- "a supervisor that does not acknowledge a stop is killed with its group": acknowledgement held 3 s against a 300 ms bound. Exactly one SIGKILL, command dead, no side effect.
- "a release while the command runs is refused and the supervisor stays".
- On the old code the first, second and unanswered-stop controls fail. The unanswered-stop control sent SIGTERM rather than SIGKILL there, and the release control cannot run against the old supervisor at all.

**Interrupting real stages during a start** (`tmp/r10/interrupt-at.mjs` sends SIGINT to the check's own pid the moment a line appears):

- Stage T, at "-- (i)", 3 runs: every run exit 130, the t-build that had been started was stopped, temporary root removed, 0 processes mentioning it.
- Stage A, at the line printed in the same tick just before the A6 launcher's `start()`, so the spec was queued when the interrupt arrived (the R7-1 window), 2 runs: exit 130, "ok A6 the owned process group is stopped", root removed, 0 processes mentioning it.

#### R7-2: transport probes after Next lost its port

- **Changed:** `transport.mjs` `transportAssertions()` takes `owner()` and asks it before every probe. At the first answer that is not "owned" it fails "the server owned its port before every probe" and stops. With ownership held it prints that line as ok with the probe count. `stage-t.mjs` and A4 in `stage-a.mjs` pass `sandbox.listenerState(port, pid)`.
- **Control:** "S the transport table stops at the first probe after the listener changed" passes: owner asked once, 0 requests reached the stub.
- **Without the fix** (old `transport.mjs`): the control fails with `asked 0, upstream 48`.

#### R7-3: an A6 service in another group would survive

- **Changed:** `stage-a.mjs` A6 `finally` now checks "A6 both service PIDs are gone after the shutdown" using the new `survivingPids()` (5 s grace). A survivor is reported with its process group and command line and is never signalled.
- **Control:** "S a service moved out of the owned group is reported after the shutdown". The command spawns its own detached grandchild; the owned group is stopped; only the grandchild is reported. Afterwards the control ends the grandchild by its recorded pid, which this run started.
- **Without the fix:** the earlier code had only the group check, which passes in the same situation (the control shows `group gone true` with the survivor present).

#### R7-4: A1 matched fixture `package.json` files

- **Changed:** `stage-a.mjs` has a new `dependencyManifests()`. It matches exactly `package.json`, `package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`, plus `^backend/requirements[^/]*$`.
- **Control:** "S A1 matches the exact manifests and not a fixture's package.json".
- **Without the fix** (old pattern in `mut/`): it also flags `frontend/tests/fixtures/example/package.json` and `docs/package.json`, so the control fails.

#### R7-5: a failing `lsof` looked like an unused port

- **Changed:** `sandbox.mjs` has a new exported `lsofLines()`. `listenerPids()` now uses `spawnSync`.
  - Status 1 with no output is "no match" and gives an empty list.
  - Status 0 is a result, even if lsof warned on stderr.
  - A spawn error, a signal, or any other status (status 1 with a diagnostic included) throws with the diagnostic. The stage then fails at once as an unexpected error instead of waiting.
- **Control:** "S a failing lsof is an error, an unused port an empty list". Cases: binary missing, status 1 with stderr, killed, empty no-match, and a real lsof on an unused port.
- **Without the fix** (`mut/`, which returns `[]` for any failure): the control fails on the first three cases.

#### Acceptance runs (final code)

| Command                                                    | Exit    | Decisive line                                           |
| ---------------------------------------------------------- | ------- | ------------------------------------------------------- |
| stage S                                                    | 0       | `stage S: 41 passed, 0 failed`                          |
| stage T                                                    | 0       | `stage T: 134 passed, 0 failed`                         |
| stage A, candidate                                         | 0       | `stage A: 100 passed, 0 failed`                         |
| stage A, negative control                                  | 1       | `stage A: 91 passed, 9 failed`                          |
| `--stage X`                                                | 2       | `--stage must be T, A or S`                             |
| three `TMPDIR` refusals (as `tmp/t160-rerun.sh` runs them) | 2, 2, 2 | 0 `nb-check-*` directories in the notebook's `frontend` |
| `pnpm typecheck`, `lint`, `format:check`, `docs:check`     | 0 each  | —                                                       |

- **Negative control failures:** exactly A3 (1), A4 (6), A5 (2), nothing new.
- **Why the totals changed:**
  - S goes from 32 to 41: the three stop-race variants, the unanswered stop, the refused release, and the R7-2, R7-3, R7-4 and R7-5 controls.
  - T goes from 132 to 134: one "owned its port before every probe" line each for T(i) and T(ii).
  - A goes from 98 to 100: the A4 ownership line and "A6 both service PIDs are gone after the shutdown". The negative control gains the same two (89 to 91).
- The full set ran once, with no timeout reruns.

#### Your listener PIDs

Before and after all runs: 3000 → 41839, 8000 → 41838, 4310 → 85736, unchanged. No process mentions an `nb-check-` directory afterwards.

#### Not done or not verified

- Running the old-code race driver left a few orphaned `node -e setTimeout(…)` commands. That was the defect itself; they end on their own within 5 s, or 20 s for the one from the release control, and I did not signal them. The release control could not run against the old supervisor at all (its handle has no `reply`), so that driver run ended with an error after the other results.
- The cancel order cannot occur without the test delay hook, because the IPC channel is ordered. That is why the control forces it with the hook rather than by repetition.
- I did not diff the notebook checkout's `git status` this round. `pnpm deadcode` was not run.
