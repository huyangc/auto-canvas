# T200 — Move notebook User Analytics entry into HeaderAccountMenu

- Branch: `task/T200-analytics-in-account-menu`
- Base: `main` at `046fafb9`
- Status: approved
- Plan review: self-checked against the code; requested directly by user

## Goal

In notebook mode, stop rendering **User Analytics** as a standalone top-bar button next to the account menu. Instead, place it inside `HeaderAccountMenu` for administrators (`notebookUser.isAdmin === true`), matching standalone `accounts` mode (`account.isAdmin === true`), and style links inside `.command-popover` so the menu item matches adjacent button rows.

## Context

- `apps/editor/src/accounts/header-account-menu.tsx` already renders `<a href={appUrl("analytics")} target="_blank" rel="noopener" data-testid="open-analytics">User Analytics</a>` inside the user dropdown menu when `account?.isAdmin === true` (standalone accounts mode), and already receives `notebookUser?: HeaderNotebookUser` carrying `isAdmin: boolean`.
- `apps/editor/src/entries/notebook.tsx` previously passed `analyticsHref={user.isAdmin ? baseUrl + "analytics" : undefined}` down through `App` -> `EditorMenuBar` -> `EditorAppChrome`, which rendered a separate top-bar `<a className="app-action" data-testid="open-analytics">User Analytics</a>` beside `HeaderAccountMenu`.
- `appUrl("analytics")` resolves to `${import.meta.env.BASE_URL}analytics` (`/canvas/analytics` in the notebook build, `/analytics` in the standalone build).
- `apps/editor/src/styles/editor-chrome.css` styled `.command-popover button` and `.command-popover .file-import` but did not style `.command-popover a`, leaving link items inside `.header-account-popover` with default browser link styling.

## Scope

Owned paths (may be created, edited or deleted):

- `tasks/T200-analytics-in-account-menu/plan.md`
- `apps/editor/src/accounts/header-account-menu.tsx`
- `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/styles/editor-chrome.css`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-app-chrome.test.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/entries/notebook.tsx`
- `docs/specs/server.md`

Out of scope (do not change):

- Analytics dashboard page and backend `/api/admin/analytics` routes
- Notebook sign-in gate screens (owned by T199 / PR #177)

## Steps

1. Update `apps/editor/src/accounts/header-account-menu.tsx` to render the `User Analytics` link (`data-testid="open-analytics"`) whenever `account?.isAdmin === true || notebookUser?.isAdmin === true`.
2. Update `apps/editor/src/styles/editor-chrome.css` so `.command-popover a:not(:where(.cloud-shelf-dialog *))` (and its hover state) matches `.command-popover button` row styling without default underline.
3. Remove the standalone top-bar `User Analytics` button from `apps/editor/src/app/editor-app-chrome.tsx` and remove the now-unused `analyticsHref` prop threading from `editor-app-chrome.tsx`, `editor-menus.tsx`, `App.tsx`, and `entries/notebook.tsx`.
4. Update `apps/editor/src/accounts/header-account-menu.test.tsx`, `apps/editor/src/app/editor-app-chrome.test.tsx`, and `docs/specs/server.md`.
5. Run formatting, typecheck, lint, deadcode, unit tests, and builds.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm test:local apps/editor/src/accounts/header-account-menu.test.tsx apps/editor/src/app/editor-app-chrome.test.tsx apps/editor/src/notebook/entry.integration.test.tsx scripts/notebook-editor-build.test.mjs
pnpm format:check && pnpm docs:check && pnpm typecheck && pnpm lint && pnpm deadcode && pnpm build && pnpm build:notebook-editor
```

Behavioral checks:

- For a signed-in notebook administrator, the top bar shows no standalone `User Analytics` button; opening the account menu (`[data-testid="header-account-menu"]`) shows `User Analytics` styled consistently with adjacent menu rows, opening `/canvas/analytics` in a new tab and closing the menu.
- For a signed-in notebook non-admin user, `User Analytics` is not rendered anywhere.
