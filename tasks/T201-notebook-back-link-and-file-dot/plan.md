# T201 — Top-left Silicon Notebook back icon & remove duplicate File unsaved dot

- Branch: `task/T201-notebook-back-link-and-file-dot`
- Base: `main` at `38ddf12d`
- Status: approved
- Plan review: self-checked against the code; confirmed with user (Option A breadcrumb icon + remove File dot)

## Goal

1. In notebook mode, provide a direct one-click return link to Silicon Notebook at the top-left of the editor chrome (`[SN icon] / Auto Canvas`) using Silicon Notebook's brand mark, instead of requiring the user to open the account menu and click the bottom item.
2. Remove the duplicate blue unsaved indicator dot beside the `File` menu button so the unsaved dot appears only beside the project name, avoiding confusion when opening `File`.

## Scope

Owned paths:

- `tasks/T201-notebook-back-link-and-file-dot/plan.md`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-app-chrome.test.tsx`
- `apps/editor/src/app/project-menu.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.test.tsx`
- `apps/editor/src/styles/editor-chrome.css`
- `docs/specs/server.md`

## Acceptance

```bash
pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint && pnpm deadcode && pnpm build && pnpm build:notebook-editor
pnpm test:local apps/editor/src/app/editor-app-chrome.test.tsx apps/editor/src/features/editor-shell/file-command-menu.test.tsx scripts/notebook-editor-build.test.mjs
```
