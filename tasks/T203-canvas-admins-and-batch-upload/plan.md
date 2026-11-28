# T203 — Canvas-Independent Administrators (Notebook Mode) & Batch Circuit Upload

- **Branch**: `task/T203-canvas-admins-and-batch-upload`
- **Worktree**: `/Users/huzhifeng/.gemini/antigravity/worktrees/auto-canvas/T203-canvas-admins-and-batch-upload`
- **Base**: `origin/main` (`13c8ceee`)

## Goals

1. **Separate Canvas admins from Silicon Notebook admins (`009-canvas-admins.sql`, `apps/server/src/app.ts`, `apps/server/src/identity.ts`, `apps/server/src/notebook-groups.ts`, `apps/server/src/group-libraries.ts`, `apps/server/src/user-analytics.ts`)**:
   - Add `canvas_admin boolean NOT NULL DEFAULT false` to `users` (migration `009-canvas-admins.sql`).
   - In notebook mode, compute effective `isAdmin = notebookAdmin || canvasAdmin` on every request (reading `canvas_admin` live from `users` so grant/revoke takes effect immediately without waiting for the 60s token cache).
   - Expose `notebookAdmin: boolean` and `canvasAdmin: boolean` on `SessionUser` in notebook mode (`GET /api/auth/me`).
   - Silicon Notebook admins (`notebookAdmin === true`) are always Canvas admins and **cannot be modified/revoked in Canvas** (`409 notebook-admin-immutable`).
   - **Only Notebook admins** (`sessionUser.notebookAdmin === true`) may grant or revoke Canvas admin roles (keeping standalone `/api/admin/users/*` routes strictly absent in notebook mode):
     - `PATCH /api/admin/canvas-admins/:id` (`{ canvasAdmin: boolean }`): updates `users.canvas_admin` for an existing notebook user; rejects non-notebook-admins with `403`, rejects self (`own-account`) or Notebook admins (`last_role === 'admin'`, `notebook-admin-immutable`) with `409`.
     - `POST /api/admin/canvas-admins` (`{ username: string }`): resolves a Silicon Notebook user via Silicon Notebook's `GET /api/users/resolve?username=...` (using the caller's bearer token), upserts into `users`, and grants `canvas_admin = true` even if the user has never opened Canvas before! (Rejects non-notebook-admins with `403`, missing user with `404`, and Notebook admins with `409 notebook-admin-immutable`.)
   - Update `notebook-groups.ts` / `group-libraries.ts`:
     - Only request Silicon Notebook's `/api/groups?scope=all` when `notebookAdmin === true`; Canvas-only admins request `/api/groups?scope=mine` (which returns their joined groups + all public groups), while still receiving `isAdmin: true` in Canvas for managing public/group circuit & component libraries.
   - Update `user-analytics.ts`:
     - In notebook mode, compute effective `role = CASE WHEN coalesce(u.last_role,'user')='admin' OR u.canvas_admin THEN 'admin' ELSE 'user' END`, and return `notebookAdmin` and `canvasAdmin` booleans on each user row so `admins` KPI, `filter=admin`, and Users table all reflect both Notebook admins and Canvas-only admins accurately.

2. **Canvas Admin Management UI in `/canvas/analytics` (`analytics-dashboard.tsx`, `analytics-users.tsx`, `analytics-client.ts`, `entries/notebook.tsx`, `notebook/session.ts`)**:
   - Thread `notebookAdmin?: boolean` through `NotebookUser` and `AnalyticsDashboard` (`canManageCanvasAdmins`).
   - In notebook mode's `Users` tab:
     - Display clear role badges (`Notebook Admin` / `Canvas Admin` / `User`).
     - When the current viewer is a **Notebook admin** (`canManageCanvasAdmins`):
       - Show a top inline form to **grant Canvas admin by Silicon Notebook username** (calls `POST /api/admin/canvas-admins`), even for users who haven't opened Canvas yet.
       - Show a **Manage** column with `Grant Canvas admin` / `Revoke Canvas admin` buttons for non-Notebook-admin rows, and a locked `Notebook Admin (locked)` label for Notebook admins.
     - When the current viewer is a **Canvas-only admin**:
       - Show read-only role badges with a note explaining that Canvas admin assignments are managed by Silicon Notebook administrators.

3. **Batch Circuit Upload UI in Canvas (`apps/editor/src/notebook/group-projects-panel.tsx`, `group-libraries.css`)**:
   - In `GroupProjectsPanel` (both group/public libraries and notebook libraries), add a **「批量上传文件…」** button (`<input type="file" multiple accept=".json,.icproj.json">`).
   - Reads each selected `.icproj.json` / `.json` file, extracts its project name (falling back to filename stem), uploads sequentially via `submitGroupProject` / `submitNotebookProject` (admins publish directly as `approved`; regular users submit as `pending`), displays live progress (`正在上传 3 / 10…`) and a clear summary of succeeded / failed files, and refreshes the project list!

## Editable Paths

- `tasks/T203-canvas-admins-and-batch-upload/plan.md`
- `apps/server/src/migrations/009-canvas-admins.sql`
- `apps/server/src/identity.ts`
- `apps/server/src/app.ts`
- `apps/server/src/notebook-admins.ts` (new)
- `apps/server/src/notebook-auth.test.ts`
- `apps/server/src/notebook-groups.ts`
- `apps/server/src/notebook-groups.test.ts`
- `apps/server/src/group-libraries.ts`
- `apps/server/src/user-analytics.ts`
- `apps/server/src/server-main.test.ts`
- `apps/server/src/standalone-mode.test.ts`
- `apps/server/src/notebook-canvas-admins.test.ts` (new)
- `apps/editor/src/notebook/session.ts`
- `apps/editor/src/entries/notebook.tsx`
- `apps/editor/src/features/analytics/analytics-client.ts`
- `apps/editor/src/features/analytics/analytics-dashboard.tsx`
- `apps/editor/src/features/analytics/analytics-users.tsx`
- `apps/editor/src/features/analytics/analytics-dashboard.test.tsx`
- `apps/editor/src/notebook/group-projects-panel.tsx`
- `apps/editor/src/notebook/group-projects-panel.test.tsx`
- `apps/editor/src/notebook/group-libraries.css`
- `docs/specs/server.md`

## Acceptance Commands

```bash
pnpm format:check
pnpm docs:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm typecheck
pnpm lint
pnpm deadcode
pnpm build
pnpm build:notebook-editor
AUTO_CANVAS_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/auto_canvas_test pnpm test:local
```
