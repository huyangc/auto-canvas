# T185 — Notebook top-bar user menu and group-shared circuit & component libraries

- Branch: `integrate_canvas_notebook`
- Base: `main` at `4fc06e18`
- Status: approved (scope and product decisions confirmed by owner on 2026-11-26)
- Plan review: self-checked against `apps/server`, `apps/editor`, `scripts/notebook-editor-build.test.mjs`, and `silicon-notebook` `origin/master`

## Goal

Complete the Silicon Notebook ↔ Auto-Canvas integration so that:

1. **Notebook mode top-bar user menu**: When running inside Silicon Notebook (`VITE_AUTO_CANVAS_AUTH=notebook`), the Canvas editor's top bar displays the signed-in Silicon Notebook user's avatar and display name, **My Cloud Projects**, **Auto-save to Cloud**, and a direct **返回 Silicon Notebook** (or **返回笔记本「name」** / **返回 Silicon Notebook 群组** depending on entry context) navigation control.
2. **Group-shared and per-notebook Cloud Projects and Component Libraries with admin approval**: Both Silicon Notebook groups and individual notebooks have shared circuit project libraries and component libraries hosted in Auto-Canvas PostgreSQL (`007-group-shared-libraries.sql`: `group_projects`, `group_components`, `notebook_projects`, `notebook_components`).
   - Any group member (or user with notebook read access) can browse approved circuits/components, open an independent copy of a circuit in Canvas, or place an approved component onto their schematic.
   - Regular members (`member` / notebook `reader`) can upload/submit a circuit project or user component; it enters `pending` review and is not visible in the approved library until a group admin (`admin`/`owner`), notebook manager (`owner` / `can_manage_notebook` / `can_manage_content`), or system admin approves it.
   - Group admins / notebook managers / system admins can publish directly as `approved`, inspect/preview `pending` submissions, approve or reject them with an optional review note, and remove library entries.
   - Authors can view their own submissions (`pending` / `approved` / `rejected` with review notes) and withdraw `pending` or `rejected` items.
3. **Two-way entries**:
   - In Canvas: scope switchers inside **Cloud Projects** (`我的项目` / `本笔记本电路库` / `群组电路图库`) and **User Components** (`Library` / `My shelf` / `本笔记本器件库` / `群组器件库`), plus URL deep-linking `/canvas/?group=<groupId>&view=projects|components` and `/canvas/?notebook=<notebookId>&notebookName=<name>&view=projects|components`.
   - In Silicon Notebook (tracked in `integrations/silicon-notebook/group-page-entry.patch`): group-page entries jumping directly to `/canvas/?group=<groupId>&view=projects|components` and a workspace center **`电路库`** tab (`问答 | 知识库 | 记忆 | 深度报告 | 电路库`) embedding the current notebook's circuit & component library when `auto_canvas.integration.available` is reported by `/api/system/extensions`.
   - Workspace side panel (`integrations/silicon-notebook/ui/auto-canvas/workspace-plugin.tsx`): forwards the active notebook id and name when opening Canvas.
4. **Local joint trial**: Launch an isolated local Silicon Notebook + Auto-Canvas instance on non-conflicting ports (`13000` / `18000` / `14310`) without touching daily services (`3000` / `8000` / `4310`), then stop and clean up after verification.

## Context

- `apps/server/src/notebook-identity.ts`: validates Bearer tokens via loopback-only direct HTTP `GET /api/me`. We extract/share the direct loopback HTTP helper for `GET /api/groups?scope=mine` and `GET /api/groups/:groupId`.
- `apps/server/src/migrations/`: latest migration is `006-account-administration.sql`. Tests in `server-main.test.ts` and `standalone-mode.test.ts` list applied migration names and must include `007-group-shared-libraries.sql`.
- `scripts/notebook-editor-build.test.mjs`: enforces that **zero** modules under `apps/editor/src/notebook/` are rendered in the standard build, and pins `STORAGE_CONSUMERS` strictly. All notebook-only UI modules must stay lazy-loaded behind `import.meta.env.ICM_NOTEBOOK` and avoid new browser storage globals.
- `apps/editor/e2e/editor-fixtures.ts`: `projectTabAction(page, "Open Cloud Project…")` already handles `header-account-menu` → `My Cloud Projects` when the header account menu is visible.

## Scope

Owned paths:

- `tasks/T185-notebook-group-libraries/plan.md`
- `apps/server/src/migrations/007-group-shared-libraries.sql` (new)
- `apps/server/src/notebook-identity.ts` (export loopback direct HTTP helper)
- `apps/server/src/notebook-groups.ts` (new)
- `apps/server/src/group-libraries.ts` (new)
- `apps/server/src/group-libraries.test.ts` (new)
- `apps/server/src/app.ts`
- `apps/server/src/server-main.test.ts`
- `apps/server/src/standalone-mode.test.ts`
- `apps/editor/src/accounts/header-account-menu.tsx`
- `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/editor-dialogs.tsx`
- `apps/editor/src/app/editor-component-library.tsx`
- `apps/editor/src/entries/notebook.tsx`
- `apps/editor/src/notebook/gate.ts`
- `apps/editor/src/notebook/gate.test.ts`
- `apps/editor/src/notebook/entry.integration.test.tsx`
- `apps/editor/src/notebook/group-libraries-client.ts` (new)
- `apps/editor/src/notebook/group-projects-panel.tsx` (new)
- `apps/editor/src/notebook/group-components-panel.tsx` (new)
- `apps/editor/src/notebook/group-libraries.css` (new)
- `apps/editor/src/notebook/group-libraries-client.test.ts` (new)
- `apps/editor/src/features/editor-shell/cloud-projects-dialog.tsx`
- `apps/editor/src/features/user-components/user-components-library.tsx`
- `docs/specs/server.md`
- `integrations/silicon-notebook/README.md`

Out of scope:

- Changing standalone `accounts` or legacy `local` authentication, project, or public component library semantics.
- Touching daily services on ports `3000`, `8000`, `4310` or their databases.

## Steps

1. Add migration `007-group-shared-libraries.sql`, `notebook-groups.ts`, and `group-libraries.ts`; wire into `registerNotebook` in `app.ts`; add PostgreSQL integration tests in `group-libraries.test.ts` and update migration lists in `server-main.test.ts` and `standalone-mode.test.ts`.
2. Pass authenticated `NotebookUser` from `gate.ts` into `entries/notebook.tsx` and `App.tsx`; support Notebook user display in `HeaderAccountMenu` with My Cloud Projects, Auto-save to Cloud, and back-to-Notebook/Group link; support `?group=<id>&view=projects|components` URL deep-linking.
3. Build `group-libraries-client.ts`, `group-projects-panel.tsx`, `group-components-panel.tsx`, and styles; integrate lazily behind `import.meta.env.ICM_NOTEBOOK` into `CloudProjectsDialog` and `UserComponentsLibrary`.
4. Add unit tests for the new client and header menu; update `docs/specs/server.md` and `integrations/silicon-notebook/README.md`.
5. Run `pnpm format:check`, `pnpm docs:check`, `pnpm typecheck`, `pnpm lint`, `pnpm deadcode`, `pnpm test:local`, `pnpm build`, and `pnpm build:notebook-editor`.
6. Prepare an isolated Silicon Notebook clone (based on `origin/master`) with the group-page Canvas entry button, launch both systems on isolated ports (`13000`/`18000`/`14310`) with an isolated database, and verify end-to-end.

## Acceptance

```bash
pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint
pnpm test:local apps/server/src/group-libraries.test.ts apps/server/src/notebook-auth.test.ts apps/server/src/server-main.test.ts apps/server/src/standalone-mode.test.ts
pnpm test:local apps/editor/src/accounts apps/editor/src/notebook scripts/notebook-editor-build.test.mjs
pnpm build && pnpm build:notebook-editor
```
