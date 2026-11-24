# T174 — Cloud Projects move from File into the user menu

- Branch: `task/T174-account-menu-cloud-projects`
- Base: `main` at `d2e59c3`
- Status: approved
- Plan review: self-checked against the code (owner made codex plan review
  on request only, 2026-11-23; not requested)

## Goal

The circuit library (the account's saved Cloud Projects) belongs to the
signed-in user, so in accounts mode it moves out of `File` and into the
header user menu (`HeaderAccountMenu`, T172). The user menu becomes:
identity row → separator → **My Cloud Projects ›** (an expandable submenu with
the same `ProjectShelf` list: open, rename, delete, Browse Cloud Projects…) →
separator → **Sign out**. In accounts mode `File` no longer shows
**Open Cloud Project… ›**.

Modes without an account (local web, notebook — the owner will retire them)
keep File's submenu unchanged for now, so the default local-mode E2E suite
keeps its route. The tab strip's `▾` picker stays in every mode.

## Context

Verified at `main` (`d2e59c3`).

- `apps/editor/src/accounts/header-account-menu.tsx` — `HeaderAccountMenu`,
  no props; returns `null` without `AccountContext` (only accounts mode
  provides it, `accounts/account-gate.tsx:206-215`). Markup: `details.command-menu.header-account-menu[name=editor-command-menu]`,
  summary `.account-name`, popover `div.command-popover.header-account-popover[role=group][aria-label=Account]`
  with identity row, a `.command-separator`, and the Sign out button
  (`data-testid="sign-out"`). Escape closes and refocuses the summary.
  Tests: `header-account-menu.test.tsx`.
- Mounted at `apps/editor/src/app/editor-app-chrome.tsx:525` as
  `<HeaderAccountMenu />`; props interface `EditorAppChromeProps` at `:97`;
  File is rendered at `:317` as `<FileCommandMenu {...fileCommands} embedded />`
  inside the header `ProjectMenu`.
- `apps/editor/src/app/editor-menus.tsx`
  - `tabActions` `:315-326` (its `busy` is the shelf's `busy`),
    `shelfActions` `:327-332` (`onOpened`, `onOpen`, `onRename`, `onDelete`),
    `cloudProjects` is the list; the strip gets them at `:394-398`; File gets
    `projectTabs.shelf = { projects: cloudProjects, ...shelfActions }` at
    `:482-485`.
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`
  - `CommandSubmenu` `:87-165` is private to this file (trigger with `›`,
    Left/Right keys, options `div.export-submenu-options[role=group]`). Its
    layout effect `:106-113` scrolls the options into view only inside
    `.file-command-popover, .project-menu-popover`.
  - `shelf = cloudEnabled ? projectTabs?.shelf : undefined` `:195`.
  - The embedded-group effect `:199-215` collapses submenus when File closes
    and keeps File open while a `dialog[open]` (the Shelf's Browse dialog) is
    inside it, because hiding the `details` would leave a modal inert.
  - The shelf submenu `:262-309`: `CommandSubmenu id="file-shelf-options"
    title="Open Cloud Project…" label="Cloud Projects"`, wrapping
    `div.file-shelf` with a click-propagation stop and a keydown boundary for
    `input, textarea, select, dialog, .inline-confirm`, then `ProjectShelf`.
  - Comment `:222-223` mentions this route.
- `apps/editor/src/features/editor-shell/project-shelf.tsx` — `ProjectShelf`
  (`:23`) with its Browse dialog `.cloud-shelf-dialog` (`:80`, `showModal`).
  Do not change it.
- Styles `apps/editor/src/styles/editor-chrome.css`: `.file-shelf`
  `:854-866` (280px scroll box, ellipsis on open buttons);
  `.project-menu-popover .export-submenu …` rules around `:840-852`;
  header account block `:1765-1925` (`.header-account-popover` `:1790`, the
  `<=760px` and `<=720px` blocks `:1843-1860`).
- Keyboard and dismissal:
  `apps/editor/src/app/use-editor-shortcuts.ts:195-204` dismisses
  `.command-menu[open]` on outside pointerdown (the Browse dialog is a DOM
  descendant, so clicks in it count as inside); `:330-345` already keeps keys
  inside `.header-account-menu[open]` and `.cloud-shelf-dialog` away from the
  canvas.
- Tests that cover File's shelf: `file-command-menu.test.tsx:42,95-126,
  150-160,190-300` (rendered without an `AccountContext.Provider`, so they
  keep passing; add the accounts-mode case). E2E helper
  `apps/editor/e2e/editor-fixtures.ts:187-215` `projectTabAction`: strip when
  visible, otherwise File, returning `group "Cloud Projects"`. Accounts-mode
  callers: `e2e/standalone-accounts.spec.ts:98,118,125` (run with
  `AUTO_CANVAS_E2E_ACCOUNTS=1`). All other callers run without accounts and
  keep the File route.
- Docs naming the File route: `docs/specs/editor-interaction.md` (grep
  `Open Cloud Project`), `docs/user/getting-started.md`, `README.md`,
  `README_zh.md`.

## Scope

Owned paths:

- `apps/editor/src/features/editor-shell/command-submenu.tsx` (new; moved
  `CommandSubmenu`)
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.test.tsx`
- `apps/editor/src/accounts/header-account-menu.tsx`
- `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/App.test.tsx` (only if a prop change requires it)
- `apps/editor/src/styles/editor-chrome.css`
- `apps/editor/e2e/editor-fixtures.ts`
- `apps/editor/e2e/standalone-accounts.spec.ts`
- `docs/specs/editor-interaction.md`, `docs/user/getting-started.md`,
  `README.md`, `README_zh.md` (the sentences naming where the library is)

Out of scope: `ProjectShelf`/`shelf-wall.*` and their copy; the tab strip's
picker; Save / Check and Save (they stay in File); removing local/notebook
modes; internal `Shelf` identifiers, test ids and endpoints.

## Steps

1. **Share the submenu.** Move `CommandSubmenu` unchanged (props, keys,
   markup) to `features/editor-shell/command-submenu.tsx` and import it in
   `file-command-menu.tsx`. Extend its scroll effect's selector to
   `.file-command-popover, .project-menu-popover, .header-account-popover`.
2. **Account mode leaves File.** In `FileCommandMenu`, read
   `useContext(AccountContext)` (from `../../accounts/account-context`) and
   compute `shelf = cloudEnabled && !account ? projectTabs?.shelf : undefined`.
   Update the comment at `:222-223` (accounts mode: the user menu holds it;
   no-account modes: File and the strip). Keep the `dialog[open]` guard (still
   needed for no-account modes).
3. **User menu gets the library.** Give `HeaderAccountMenu` an optional prop
   `cloudProjects?: { projects: readonly CloudProjectSummary[]; busy: boolean;
   onOpened(): void; onOpen(id: string): void; onRename(id, name):
   Promise<void>; onDelete(id): Promise<void> }`. When present, render between
   the identity row and Sign out: separator, then
   `<div><CommandSubmenu id="account-cloud-projects" title="My Cloud Projects"
   label="Cloud Projects" …>` wrapping a `div.file-shelf` with the same click
   and keydown boundaries as File's (`file-command-menu.tsx:279-297`) and
   `ProjectShelf`; then the existing separator and Sign out. Toggling open
   calls `onOpened()` (reload, as File does). Add the same behaviour File has
   on its `details`: on `toggle` to closed, collapse the submenu, except keep
   the menu open while a `dialog[open]` is inside it. Opening a project closes
   the menu (set `details.open = false`, as File's command run does — check
   how File closes after `onOpen` and mirror it; report what you used).
   Without `cloudProjects` the menu is exactly as today.
4. **Wire it.** Add `accountCloudProjects?` to `EditorAppChromeProps`, pass it
   to `<HeaderAccountMenu cloudProjects={…} />`. In `editor-menus.tsx` pass
   `projectStore ? { projects: cloudProjects, busy: tabActions.busy,
   ...shelfActions } : undefined`.
5. **Styles.** The account popover must hold the submenu like File's does:
   options expand beneath their row inside the popover (no flyout), list
   scrolls in `.file-shelf`'s 280px box, popover `max-height` with
   `overflow-y: auto` so it stays on screen; `min-width` wide enough for
   shelf rows (≈ 16rem). Reuse the `.project-menu-popover .export-submenu`
   rules by scoping selectors to `.header-account-popover` too rather than
   copying. Keep the T172 `<=760px` / `<=720px` behaviour.
6. **Unit tests.**
   - `header-account-menu.test.tsx`: with `cloudProjects`, the order is
     identity, `My Cloud Projects`, `Sign out`; expanding calls `onOpened` once
     and shows the group "Cloud Projects" listing the projects; clicking a
     project calls `onOpen(id)` and closes the menu; without `cloudProjects`
     no submenu; closing the menu with a `dialog[open]` inside keeps it open.
   - `file-command-menu.test.tsx`: inside an `AccountContext.Provider` with a
     `shelf`, File has no `Open Cloud Project…`; existing no-provider tests stay.
7. **E2E fixture.** `projectTabAction(page, "Open Cloud Project…")`: strip
   when visible (unchanged); else, if `getByTestId("header-account-menu")` is
   visible, open it (click `account-name` unless already open), expand
   `My Cloud Projects` unless `aria-expanded="true"`, and return its
   `group "Cloud Projects"`; else File as today. Update the doc comment. In
   `standalone-accounts.spec.ts` add an assertion that File (open it) has no
   `Open Cloud Project…` button in accounts mode.
8. **Docs.** Say that in accounts mode the user menu (top right) holds
   My Cloud Projects; keep File wording only where it describes no-account
   modes, or drop it if those docs describe accounts mode only.
9. `pnpm format`.

## Acceptance

From the repository root, lane 1 (`ICM_E2E_PORT=4173`,
`AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`):

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:local apps/editor/src/accounts apps/editor/src/features/editor-shell apps/editor/src/app/App.test.tsx
pnpm deadcode   # exit 0, or no new finding vs main
pnpm test:e2e project-tabs editor-modes cloud-projects-server chrome-isolation
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e standalone-accounts
```

Expected: every command exits 0.

Behavioral checks (accounts mode):

- User menu: identity, My Cloud Projects ›, Sign out; expanding lists the
  account's projects; open / rename / delete / Browse Cloud Projects… work;
  opening one opens it in a tab and closes the menu; Browse dialog does not
  vanish when clicking inside it.
- File has no Open Cloud Project… (Save and Check and Save remain).
- Escape closes the user menu; arrow keys in it do not pan the canvas.
- Popover stays on screen at 1440 and 780 px (phone widths are out of scope).

## Notes for the implementer

- Owner decisions (2026-11-23): library lives in the user menu between
  identity and Sign out, labelled **My Cloud Projects**; only accounts mode
  matters going forward, but no-account modes keep File's route until they are
  removed.
- Commit only on `task/T174-account-menu-cloud-projects` with
  `Test-Impact: tests-updated`; never push, merge, rebase or switch branches.
