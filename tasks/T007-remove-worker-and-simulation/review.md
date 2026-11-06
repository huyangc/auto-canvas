# T007 review

## Round 1 — changes requested (scope widened)

Steps 1 (retarget Worker-backed tests), 3 and 4 (simulation removed from the
Agent API, MCP, relay and editor handlers; generated docs, catalog and OpenAPI
regenerated) are accepted as done. Steps 2 and 5 stopped correctly at scope
gaps in the plan. Opus removed `wrangler` from `apps/editor/package.json`
(`pnpm remove` needs the network), committed round 1 as WIP and rebased onto
`main` after T009 (#10) without conflicts.

| #   | Severity | Where                                               | Finding                                                              | Expected fix                                                                                                                       |
| --- | -------- | --------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | step 2, `apps/editor/vite.config.ts`                | Registers `localReplica`; was outside the owned paths.               | Scope widened. Remove the replica/Worker plugins, then delete `worker/`, replica tooling, analytics and the Gallery helpers.       |
| 2   | must-fix | step 5, `packages/netlist/**`, `apps/local-host/**` | `spice-run` deletion breaks netlist tests; local-host depends on it. | Scope widened to all of `packages/netlist` and `apps/local-host`. Move what kept code needs, retarget tests, delete both packages. |
| 3   | must-fix | `apps/server/README.md`                             | Still describes removed relay simulation/artifact routes.            | Scope widened; update it.                                                                                                          |
| 4   | must-fix | dependencies                                        | Deleted workspace packages must leave `package.json` files.          | Remove the `workspace:*` references; do not touch the lockfile — Opus refreshes it.                                                |

Acceptance: rerun every command in the plan (lane 1).

## Round 2 — accepted

Reviewed: working tree after Codex round 2; acceptance rerun by Opus on lane 1.

All four round-1 findings are addressed. Every changed path is inside the
widened scope. Opus additionally:

- moved the two PDK reference files the device tests read
  (`containers/ngspice/sg13g2/profile.json`,
  `containers/ngspice/cells/sky130_fd_sc_hd.spice`) to `fixtures/pdk/` with a
  README, updated `packages/devices/src/reviewed-external.test.ts`, and
  deleted the rest of `containers/`;
- checked that `pnpm-lock.yaml` has no reference to the deleted packages,
  `wrangler` or `workerd` (`pnpm install` reported it up to date);
- updated the README layout and status lines in both languages.

Acceptance rerun (lane 1):

```text
git ls-files worker packages/simulation-service packages/spice-run containers wrangler.jsonc → 0 entries
pnpm check → 0 (7255 passed)
pnpm mcp:package && pnpm headless:package && pnpm test:desktop-build → 0
pnpm exec vitest run apps/server packages/project-protocol packages/netlist → 0 (1489 passed)
playwright agent-connection, web-agent-session, agent-bus-productivity,
  user-components, user-components-server, cloud-projects-server → 79 passed
```
