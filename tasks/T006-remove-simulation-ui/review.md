# T006 review

## Round 1 — accepted

Reviewed: Codex round 1 on `task/T006-remove-simulation-ui` (lane 2), rebased
by Opus onto `main` after T005 (#8); acceptance rerun by Opus on lane 2.

All changes are inside the owned paths; nothing under `packages/`,
`apps/mcp-server/`, `apps/server/` (before rebase), `worker/` or
`docs/agent/` changed. No Simulate entry remains in the editor; a new test
loads a Project with dormant simulation folders, edits the schematic, saves and
gets the folder bytes back unchanged. Editor Agent simulation operations answer
`SIMULATION_UNAVAILABLE`.

| #   | Severity | Where                                                                                                                                                   | Finding                                                                                       | Resolution                                                                                                    |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `apps/server/src/agent-relay/agent-session.test.ts` (moved by T005), `host.test.ts`                                                                     | Two relay tests still expected the editor to simulate; out of T006's paths before the rebase. | Fixed by Opus after the rebase: both assert `SIMULATION_UNAVAILABLE` passes through and the session survives. |
| 2   | must-fix | `scripts/codex-task.sh`                                                                                                                                 | pnpm 11 reads `pnpm_config_verify_deps_before_run`, not the `npm_config_` form set in #7.     | Fixed by Opus: both forms exported; workflow doc updated.                                                     |
| 3   | note     | `apps/editor/e2e/netlist-workflows.spec.ts:286`                                                                                                         | Fails: `?example=` was removed with the Gallery examples in T001, not by T006.                | Follow-up T009 (restore bundled-example links).                                                               |
| 4   | note     | `features/simulation/{simulation-probe-options*,source-probe-choices}.ts`, three `containers/ngspice` files, `containers/vacask/host/deploy-preview.sh` | Kept because `worker/`, the relay or packages still import or read them.                      | T007 removes them with `worker/` and the simulation packages.                                                 |
| 5   | note     | README conflict on rebase                                                                                                                               | T005 removed the "Agent relay not done" line; T006 rewrote the simulation line.               | Kept both changes.                                                                                            |

Acceptance rerun (lane 2, after rebase):

```text
pnpm check → 0  (8315 passed, no excluded tests)
CI=true pnpm test:local → 0 (8315 passed)
pnpm test:desktop-build → 0;  pnpm mcp:package → 0
playwright editor-shell, cloud-projects-server, user-components-server,
  netlist-workflows, agent-connection → 22 passed, 1 failed (finding 3)
```
