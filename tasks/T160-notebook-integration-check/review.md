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
