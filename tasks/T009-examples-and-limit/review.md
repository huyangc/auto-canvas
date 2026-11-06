# T009 review

## Round 1 — changes requested (scope widened)

Step 2 (server-configured limit with a 200 fallback) is done and its tests
pass. Step 1 stopped correctly on the plan's `App.tsx` restriction.

| #   | Severity | Where                                   | Finding                                                                                                    | Expected fix                                                                                                                                                                           |
| --- | -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | step 1, `apps/editor/src/app/App.tsx`   | The example boot needs `guardDirtyReplacement` and the selected netlist profile (`prepareNetlistExample`). | Scope widened: you may change the `useBootLink(...)` call site in `App.tsx` to pass them. Finish step 1 as the original did; the three example browser specs must pass.                |
| 2   | must-fix | `worker/gallery-cloud-projects.test.ts` | "enforces the same limit the editor displays" pins the editor's limit to the Worker's 20.                  | Scope widened for this one assertion only: make it independent of the editor's display limit (the Worker still enforces 20; T007 deletes `worker/`). Change nothing else in `worker/`. |

Acceptance: rerun every command in the plan.

## Round 2 — accepted

Reviewed: working tree after Codex round 2; acceptance rerun by Opus on lane 2.

Every changed path is inside the widened scope. `App.tsx` changes only the
boot-target flag (now also `example`, captured once at startup so the
recent-project restore cannot replace an opened example) and the
`useBootLink(...)` arguments. The example boot mirrors the original: clone,
`prepareNetlistExample` with the selected profile, guarded replace, status,
and `example` removed from the address; an unknown id only reports it.
`GET /api/projects` returns `limit`; the editor uses it with a 200 fallback.
The Worker assertion no longer reads the editor's limit; nothing else in
`worker/` changed.

Acceptance rerun (lane 2):

```text
pnpm check → 0 (8331 passed)
playwright netlist-workflows, netlist-code-edit, rnl-interchange,
  cloud-projects-server, editor-shell → 38 passed
```
