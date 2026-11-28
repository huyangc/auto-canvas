# T202 — Notebook Account Menu Libraries & Public Group Support

- **Branch**: `task/T202-account-menu-public-group-libraries`
- **Worktree**: `/Users/huzhifeng/.gemini/antigravity/worktrees/auto-canvas/T202-account-menu-public-group-libraries`
- **Base**: `origin/main` (`8e8a8d77`)

## Goals

1. **Public group support in Auto Canvas server**:
   - Parse `is_public === true` into `NotebookGroup.isPublic` in `apps/server/src/notebook-groups.ts`.
   - Allow any signed-in user to resolve and access a public group (`group.myRole || group.isPublic || systemAdmin`), while keeping `isAdmin` restricted to `myRole === "admin" || systemAdmin` (so system admins administer public groups and regular signed-in users can view/open approved items and submit pending ones).
   - Expose `isPublic` in `GET /api/notebook/groups` responses.
2. **Surface Personal / Group / Public circuit libraries in Notebook Account Menu & Cloud Projects dialog**:
   - In notebook mode, render explicit `我的电路库`, `群组电路库`, and `公共电路库` buttons inside `HeaderAccountMenu`, each opening `CloudProjectsDialog` directly on the matching scope tab (`personal` | `groups` | `public`), while keeping standalone `accounts` mode (`My Cloud Projects`) unchanged.
   - Update `CloudProjectsDialog` in notebook mode with a `电路图库` title and dedicated tabs for `我的电路库` (`personal`), `当前笔记本电路库` (`notebook`, when opened from a notebook), `群组电路库` (`groups`, filtering private groups), and `公共电路库` (`public`, filtering public groups).
   - Update `GroupProjectsPanel` with `groupVisibility` filtering (`"private" | "public" | "all"`), clear empty-state copy, and deep-link tab handoff when a `?group=<id>` deep-link targets a public group.
   - Mark public groups in `GroupComponentsPanel`'s selector (`（公共）`).
3. **Direct circuit deep-links from Silicon Notebook Home**:
   - Support `?project=<id>` (open personal cloud project) and `?group=<groupId>&groupProject=<projectId>` (open group/public circuit as an independent working copy) in `apps/editor/src/app/App.tsx`.

## Editable Paths

- `tasks/T202-account-menu-public-group-libraries/plan.md`
- `apps/server/src/notebook-groups.ts`
- `apps/server/src/notebook-groups.test.ts` (new or existing tests)
- `apps/editor/src/notebook/group-libraries-client.ts`
- `apps/editor/src/notebook/group-projects-panel.tsx`
- `apps/editor/src/notebook/group-components-panel.tsx`
- `apps/editor/src/accounts/header-account-menu.tsx`
- `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/features/editor-shell/cloud-projects-dialog.tsx`
- `apps/editor/src/features/editor-shell/cloud-projects-dialog.test.tsx` (new)
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/editor-dialogs.tsx`
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
