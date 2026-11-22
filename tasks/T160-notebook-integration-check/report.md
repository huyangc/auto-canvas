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
