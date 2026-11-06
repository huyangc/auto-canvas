# T009 report — round 2

## Summary

Restored bundled `?example=<id>` boot links. A known example is cloned,
prepared with the selected netlist profile, and installed in the active tab
through `guardDirtyReplacement`, with `Opened example: <name>` status. Unknown
IDs report a status without opening anything; restored workspaces take priority.
Successful opens consume the example URL parameter, and workspace addresses
normalize it away. Example boot requests suppress recent Cloud Project and Agent
startup restoration, including after the URL is consumed.

Retained round 1's server-configured project limit: listings return `limit`, the
Web store and shelf use it, and older responses fall back to 200. Both review
findings are fixed, and every acceptance command passes on lane 2.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Added example boot handling, App dependency wiring, both boot checks, and `OPEN_REQUESTS` normalization. Hook tests cover known IDs, cloning, SKY130/Abstract preparation, guarded replacement, unknown/empty IDs, restored-workspace precedence, and one-time execution under Strict Mode. Workspace tests cover normalized example addresses while preserving route isolation and displaced-tab recovery. |
| 2    | done   | Verified the existing server response, client fallback, Web store limit updates, shelf counts and limit messages, mutation preservation, tests, and server contract.                                                                                                                                                                                                                                        |

## Review findings addressed

1. **Must-fix #1 — finish example boot with the guard and selected profile.**
   `App.tsx` now passes `guardDirtyReplacement` and the selected netlist profile
   to `useBootLink`. The hook clones and prepares the bundled project before
   guarded replacement and status publication. All three previously failing
   example browser cases pass without changing their specs.
2. **Must-fix #2 — decouple the Worker assertion from the editor limit.**
   Removed the editor-limit import and changed only the identified test to
   assert the Worker's own limit remains 20. The neighboring behavioral test
   still fills the Worker store, verifies rejection, deletes a project, and
   verifies creation succeeds again. No Worker production code changed.

## Acceptance results

All acceptance commands used lane 2 and approved local database/listener access:

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
```

```text
pnpm check → 0
  Formatting, Markdown links, generated docs, components, typecheck, lint,
  local tests, and build passed.
  oxlint: 2146 files, 0 errors, 2681 warnings
  Test Files  833 passed | 2 skipped (835)
  Tests       8331 passed | 122 skipped (8453)
  apps/editor build: Done

pnpm exec vitest run apps/server apps/editor/src/app apps/editor/src/features/editor-shell → 0
  Test Files  36 passed (36)
  Tests       258 passed (258)

pnpm exec playwright test apps/editor/e2e/netlist-workflows.spec.ts apps/editor/e2e/netlist-code-edit.spec.ts apps/editor/e2e/rnl-interchange.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/editor-shell.spec.ts --workers=1 → 0
  38 passed (1.3m)
  38 attempts; no retries, failures, skips, or flaky cases.
  Report elapsed time: 79.271 s; cumulative attempt cost: 75.197 s.
  Slowest attempt: 4.049 s — every web path opens the editor without community requests.

pnpm exec vitest run apps/editor/src/app/use-project-entry.test.tsx worker/gallery-cloud-projects.test.ts → 0
  Test Files  2 passed (2)
  Tests       22 passed (22)

pnpm exec vitest run apps/editor/src/document/project-workspace.test.ts apps/editor/src/document/workspace-reopen.test.ts → 0
  Test Files  2 passed (2)
  Tests       11 passed (11)

git diff --check → 0
```

Final acceptance output is in `/tmp/T009-round2-check-local.log`,
`/tmp/T009-round2-vitest.log`, and `/tmp/T009-round2-playwright.log`. Browser
attempt details are in `test-results/e2e-report.json`.

Earlier full-check attempts found a test setup type error (fixed), sandbox
`EPERM` failures for PostgreSQL/listener access (rerun with approved access),
and three outdated workspace assertions (updated as described below).
The latter run's output is preserved in
`/tmp/T009-round2-check-workspace-failures.log`; sandbox output is in
`/tmp/T009-round2-check.log`.

## Investigation results

No explicit investigation steps. Adding `example` to `OPEN_REQUESTS` makes
example links share the plain editor's workspace, as required for restored
workspace precedence. Three existing workspace assertions used `?example=` as
a distinct route. Updated `project-workspace.test.ts` to verify the new example
normalization and use `?workspace=other` for its unrelated-route rejection and
explicit route-change acceptance checks. Changed only the route fixture in
`workspace-reopen.test.ts`; every unsaved-tab recovery assertion remains intact.

The explicit boot-target check is captured once so consuming the example URL
cannot subsequently enable recent Cloud Project startup restoration.

## Deviations and open questions

- No open questions or unresolved acceptance failures.
- Updated the affected workspace unit tests for the planned route behavior;
  no tests were removed, skipped, or weakened. No e2e specs changed.
- `CloudProjectListOutcome.limit` remains optional for alternate service
  providers, with a 200 fallback; HTTP listings always return a parsed limit.
- No dependencies, lockfiles, generated files, `plan.md`, or `review.md` were
  edited this round. The plan's pre-existing working-tree changes remain.
- No commit, push, merge, rebase, or branch switch was performed.
