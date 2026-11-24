# T179 — Editor supervisor installs its signal handlers before it starts the editor

- Branch: `task/T179-editor-supervisor-signal-race`
- Base: `main` at `dab7cbb`
- Status: approved
- Plan review: self-checked against the code (owner did not ask for a codex plan review); scope and approach as set by the requesting session's brief (fix the cause, keep the 400 ms bound)

## Goal

`scripts/launcher.test.mjs` "editor supervisor kills a process group that
ignores SIGTERM after STOP_TIMEOUT" fails in GitHub Actions (PR 138 head
`dba7752`, run 45415691141, three attempts; once on `main`, run
45364218575): the supervisor exits 7–14 ms after `supervisor.kill("SIGTERM")`.
The cause is a real race in `scripts/lib/editor-supervisor.mjs`: it spawns the
editor first and installs its SIGINT/SIGTERM/SIGHUP handlers afterwards. The
child can start and print before the handlers exist; a signal arriving in that
window kills the supervisor with the default action and orphans the editor's
process group. On a loaded CI runner (every core busy, e.g. alongside
`packages/auto-layout/test/quality.test.ts`) the test's own readiness signal —
the child's first stdout line — routinely lands in that window. When done, the
supervisor cannot be killed by a terminal signal once its child exists, the
test asserts how the supervisor exited so a recurrence names its cause, and
CI passes repeatedly.

## Context

- `scripts/lib/editor-supervisor.mjs:18-38`: `spawn(command, args, { detached: true, stdio: "inherit" })`
  runs first; the `for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(...)`
  loop comes after it. `killGroup` (line 24) reads `child.pid`.
- The supervisor's only event-loop reference is the child (signal handles and
  the escalation timer are unref'd), so it exits when the child group leader
  exits, with `process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1)`.
- Node/libuv reset every signal disposition to default in a spawned child, so
  installing handlers before `spawn` does not change what the child inherits;
  the shell's `trap "" TERM` in the test still makes the group ignore SIGTERM.
- Test: `scripts/launcher.test.mjs:516-547`. It waits for the child's first
  stdout chunk (the group PID), sends SIGTERM, awaits `exit` and expects
  ≥ 400 ms (STOP_TIMEOUT=1 → grace 500 ms, then SIGKILL to the group).
  The `exit` event's `[code, signal]` are currently discarded.
- Evidence gathered while planning:
  - Mechanism, locally: a copy of the supervisor with a 200 ms busy wait
    between `spawn` and the handler loop exits with `[null, "SIGTERM"]` after
    1 ms, 3 of 3 runs. Unmodified, 0 of 60 under `yes` load on macOS.
  - CI (ubuntu runner, full `pnpm test:local`): draft PR 141
    (`diag/supervisor-flake`, PR 138's head `dba7752` plus a diagnostic test
    that runs the scenario 30 times, run of head `7684da9`): 6 of 30 iterations
    ended with the supervisor exiting `[null, "SIGTERM"]` after 4–9 ms while
    `ps -g <group>` still showed `sh` and `sleep` alive (orphaned); the other
    24 exited `[1, null]` after 507–520 ms with the group gone. This matches
    the failing runs exactly (7 ms) and proves the supervisor itself was killed.
    PR 141 is diagnostic only and will be closed unmerged.
- The original hypothesis (state leaking between files of the `modules`
  project, `isolate: false` in `vitest.config.ts`) was checked: every
  non-isolated test file that touches `process.env`, fake timers or
  `process.on` restores them (`git grep` for `process.env.X =`, `stubEnv`,
  `useFakeTimers`, `process.on(`), and a leak could not make an ignored
  SIGTERM fatal to a freshly spawned process. Not the cause.
- Callers: `scripts/dev.sh:19` (the only runtime user); `knip.config.js:52`
  lists the file as an entry. No other tests.

## Scope

Owned paths:

- `scripts/lib/editor-supervisor.mjs`
- `scripts/launcher.test.mjs` (the supervisor test only)
- `tasks/T179-editor-supervisor-signal-race/report.md`

Out of scope: `scripts/dev.sh` and the other launchers, `vitest.config.ts`,
the 400 ms bound and STOP_TIMEOUT semantics.

## Steps

1. In `scripts/lib/editor-supervisor.mjs`, install the three signal handlers
   before `spawn`. The handler body stays the same (forward the signal to the
   group, arm the unref'd SIGKILL escalation once). Declare `child` so the
   handlers can reference it (handlers only run from the event loop, after the
   synchronous `spawn` has assigned it; keep a guard anyway if `child?.pid` is
   undefined). Update the header comment to say the handlers exist before the
   editor does, and why.
2. In the test, keep the ≥ 400 ms assertion and additionally capture
   `const [code, signal] = await once(supervisor, "exit")` and assert the
   supervisor exited on its own (`signal` is `null`, `code` is `1`, since the
   group leader died of SIGKILL), placing that assertion before the timing one
   so a recurrence of the race fails with "killed by SIGTERM" rather than a
   bare duration. Update the test comment: the child's first output now proves
   the supervisor's handlers are installed.
3. Verify the fix closes the window: run the test with the supervisor copy
   that has a busy wait after `spawn` (as in Context) — it must now pass
   (do not commit that copy; describe the check in the report).
4. Write `report.md` with the root cause, the evidence, and the commands run.

## Acceptance

```bash
pnpm test:local scripts/launcher.test.mjs              # expected: all 22 pass
for i in $(seq 1 20); do pnpm test:local scripts/launcher.test.mjs -t "editor supervisor" || break; done  # expected: 20 passes
pnpm lint && pnpm format:check && pnpm test:local      # expected: pass
```

No database or ports are needed beyond the test's own ephemeral ones.

Behavioral checks:

- With a 200 ms busy wait inserted after `spawn` in a temporary copy, the
  supervisor still exits with `[1, null]` after ≥ 400 ms and the group is gone.
- CI on the PR passes; the reviewer reruns the CI job at least twice more.
- The reviewer applies the fixed supervisor to the diagnostic branch of PR 141
  and its 30-iteration loop shows 0 of 30 `SIGTERM` exits in CI.

## Notes for the implementer

- Do not loosen or remove the 400 ms bound, and do not add retries or sleeps.
- Keep the supervisor's exit-status rules unchanged.
