# T009 — Restore bundled-example links and show the server's project limit

- Branch: `task/T009-examples-and-limit`
- Base: `main` at `f8e259f`
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Runs in parallel with T007; owned paths are disjoint.
- Status: approved

## Goal

Two small regressions from earlier tasks:

1. **`?example=<id>` links.** T001 deleted the Gallery entry hook, and with it
   the boot path that opened a bundled example from `/editor?example=<id>`.
   Three browser specs still depend on it and fail. Restore the link for the
   bundled library examples only (no Gallery, no network).
2. **Project limit.** The editor hard-codes `CLOUD_PROJECT_LIMIT = 20` in its
   shelf counts and limit messages; the server allows
   `AUTO_CANVAS_PROJECT_LIMIT` (default 200). The editor should show the
   server's limit.

## Context

- Bundled examples: `apps/editor/src/examples/library-examples.ts`
  (`LibraryProjectExample`, `libraryProjectExamples`,
  `createLibraryExampleProject`). Since T001 they are only used by tests.
- Original behavior (analog-canvas, before T001):
  `app/use-gallery-entry.ts` read `example` from the address on boot (unless a
  workspace was restored) and opened it with `openLibraryExample`
  (`features/editor-shell/gallery-example-commands.ts:317-325`):
  `structuredClone(example.project)`, `prepareLibraryExample`, then
  `replaceActiveProject` behind `guardDirtyReplacement`, status
  `Opened example: <name>`. `App.tsx` and `use-agent-hosts.ts` treated
  `search.has("example")` as a boot request.
- Current boot code: `apps/editor/src/app/use-project-entry.ts` (`useBootLink`,
  handles `new=1`, `project`, workspace restore), and
  `document/project-workspace.ts:77` `OPEN_REQUESTS = ["resume","project","new"]`
  (requests the address carries only until opened).
- Failing specs: `apps/editor/e2e/netlist-workflows.spec.ts:286`
  (`/editor?example=common-source-amplifier`), and the `?example=` uses in
  `netlist-code-edit.spec.ts` and `rnl-interchange.spec.ts`.
- Limit: `features/editor-shell/cloud-projects.ts:15` (`CLOUD_PROJECT_LIMIT`),
  used by `services/web-editor-services.ts:27` (`projectStore.limit`) and
  `components/shelf-wall.tsx:230,318`. Server: `apps/server/src/projects.ts`
  `GET /api/projects` returns `{projects}` (`:204`); the limit comes from
  `AUTO_CANVAS_PROJECT_LIMIT` (`apps/server/src/cli.ts`/`app.ts`). Contract:
  `docs/specs/server.md`.

## Scope

Owned paths: `apps/editor/src/app/use-project-entry.ts`,
`apps/editor/src/document/project-workspace.ts` (only `OPEN_REQUESTS`),
`apps/editor/src/app/App.tsx` and `app/use-agent-hosts.ts` (only the boot
request check), `apps/editor/src/examples/**`, a new small module for opening
an example if needed, `apps/editor/src/features/editor-shell/cloud-projects.ts`,
`apps/editor/src/services/web-editor-services.ts`,
`apps/editor/src/components/shelf-wall.tsx`, their unit tests,
`apps/server/src/projects.ts` and its tests, `docs/specs/server.md`, the
three e2e specs (only if a spec needs a change beyond the restored link;
report why).

Out of scope: everything else, in particular `worker/`,
`apps/server/src/agent-relay/`, `packages/`, `apps/mcp-server/`,
simulation code, Agent code beyond the one boot check (T007 runs in
parallel on those).

## Steps

1. Restore `?example=<id>` boot for `libraryProjectExamples`: open the
   example in the active tab exactly as the original did (clone, prepare,
   guarded replace, status), only when no workspace was restored; an unknown
   id shows a status message and opens nothing. Add `example` to
   `OPEN_REQUESTS` so the address drops it after opening. Unit-test the boot
   path (known id, unknown id, restored workspace wins).
2. `GET /api/projects` also returns `limit` (the configured number). The
   editor reads it when listing and uses it for `projectStore.limit` and the
   shelf messages; a response without `limit` falls back to 200. Update
   server and client tests and `docs/specs/server.md`.

## Acceptance

Run with lane 2:

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm check                      # passes
pnpm exec vitest run apps/server apps/editor/src/app apps/editor/src/features/editor-shell   # pass
pnpm exec playwright test apps/editor/e2e/netlist-workflows.spec.ts apps/editor/e2e/netlist-code-edit.spec.ts apps/editor/e2e/rnl-interchange.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/editor-shell.spec.ts --workers=1   # pass
```

## Notes for the implementer

- Keep it small: no Examples panel or menu; only the link.
- T007 runs at the same time in another worktree and deletes `worker/`,
  simulation packages and Agent simulation code. Do not touch them.
