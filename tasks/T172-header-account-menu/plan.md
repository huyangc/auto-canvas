# T172 — Header user menu and a clearer File menu

- Branch: `task/T172-header-account-menu`
- Base: `main` at `d8c86d1`
- Status: draft
- Plan review: one codex round was run before the owner changed the default to
  "on request only" (2026-11-23). No P0; every P1/P2 finding was checked
  against the code and is folded in below. No further rounds.

## Goal

The top bar's far right ends with the signed-in user: a round avatar (the
name's first letter) plus the username, which opens a small menu showing who is
signed in and a **Sign out** button. Signing out there keeps today's behaviour:
the save check runs first (paused with the same warning when unsaved work
cannot be kept), then the page reloads. `File` no longer carries **Sign out**.

`File`'s awkward **Open Shelf project in tab ›** becomes **Open Cloud
Project… ›**, listing the account's saved drawings under **Cloud Projects**;
the tab strip's `▾` picker gets the same accessible name. The File popover's
rows also get group separators, so project, tab, save and transfer commands
read as distinct groups. Hover styling already exists globally; do not add more.

## Context

Verified at `main` (`d8c86d1`).

### Header

- `apps/editor/src/app/editor-app-chrome.tsx`
  - `.app-chrome-actions` opens at `:276`; it is the top bar's right group.
  - The `⋯` (`more-menu`) `details` runs `:354-521` and is the last control in
    the group; the group closes at `:522`. The user module goes after
    `</details>` and before `</div>`.
  - `identityEnabled` (`:97`, default `:159`, passed at `editor-menus.tsx:317`
    as `identity !== null`) only picks the brand's tooltip.
- `apps/editor/src/entries/web.tsx:32` mounts the editor through
  `mountAccountGate`, which provides `AccountContext`
  (`account-gate.tsx:300-310`) only in `accounts` mode
  (`account-gate.tsx:206-215`: every other mode renders the editor without a
  provider). Notebook (`entries/notebook.tsx:58`) and desktop
  (`entries/desktop.tsx:33`) mount `App` without it. So `AccountContext` is
  exactly "a signed-in standalone account".
- `apps/editor/src/accounts/account-context.tsx`
  - `AccountContext` is `{ username, prepareLogout(check), logout() }`.
  - `SignOutCommand` (`:17-24`) is the File menu's current **Sign out
    (username)**; its only importer is `file-command-menu.tsx:14,466`.
- `account-gate.tsx:258-293`: `logout()` dispatches `ACCOUNT_SESSION_ENDING`,
  runs the last `prepareLogout` check (registered by `useBeforeAccountLogout`,
  imported at `use-project-tab-sessions.ts:19` and called at `:995`), then
  POSTs `auth/logout` (`:290`) and reloads (`:293`). Calling `account.logout`
  from the new module keeps that sequence; calling `auth/logout` directly would
  skip the check.
- Account styles: `components/account.css` is imported by
  `styles/editor-entry.css:6`. `.account-name::before` (`account.css:126-142`)
  paints the round first-letter mark from `data-initial`; reuse it instead of
  drawing a second avatar.

### Header menu behaviour the module must join

- Outside-pointer dismissal collects `.command-menu[open]`
  (`use-editor-shortcuts.ts:195-204`).
- The window keyboard guard that keeps arrows, Home/End and Escape away from
  the canvas matches `.project-menu[open], .more-menu[open]`
  (`use-editor-shortcuts.ts:338`).
- The draw-mode guard treats anything inside `.command-menu[open]` as holding
  focus (`features/editor-shell/editor-mode.ts:162`).

Therefore the module's `details` carries `command-menu` (and
`name="editor-command-menu"` so one header menu is open at a time), and the
keyboard selector is extended with `.header-account-menu[open]`.

### File popover

- `file-command-menu.tsx:222-467` builds the commands as one fragment; the
  `embedded` branch (`:469-480`) wraps it in `.command-section`. `SignOutCommand`
  is at `:466`.
- `styles/editor-chrome.css:720-736` `.command-popover` sets `position:
  absolute; left: 0`, which the account popover must reset to `left: auto`.
- Row metrics `:764-773` (min-height 32px, radius 6px). Hover already comes
  from `button:hover:not(:disabled)` (`styles.css:143-146`) and
  `.file-import:hover` (`styles.css:118-126`); there is nothing to add.
- Import and Export are separate full-width rows, each with its own wrapper
  (`:335`, `:411`); embedded options expand beneath their own row
  (`editor-chrome.css:835-846`).

### Label occurrences

`Open Shelf project in tab` appears in:

- `file-command-menu.tsx:254` (submenu trigger title) and `:256`
  (`label="Shelf projects"`, the group's accessible name), plus the comment at
  `:220-221`.
- `project-tabs.tsx:334-335` (strip picker `title`/`aria-label`).
- `file-command-menu.test.tsx:85-86,96,111,116,146,149,183,198,218,272,274`.
- `e2e/editor-fixtures.ts:194-216` — one `name` string drives both the strip's
  `getByLabel(name)` and File's `getByRole("button", { name })`; the returned
  File group is looked up as `"Shelf projects"` at `:214`.
- Call sites in `e2e/project-tabs.spec.ts`, `base-path.spec.ts`,
  `standalone-accounts.spec.ts`, `cloud-projects-server.spec.ts`,
  `editor-modes.spec.ts:1335`.
- Docs: `docs/specs/editor-interaction.md:391`, `docs/specs/server.md:16`,
  `docs/user/getting-started.md:60,221-222`; both root READMEs still name the
  old command at `README.md:80` and `README_zh.md:70`.

### Tests and gates

- Unit: `file-command-menu.test.tsx`, `project-tabs.test.tsx`,
  `header-account-menu.test.tsx` (new), `App.test.tsx`.
- E2E: `standalone-accounts.spec.ts:36,72` (both inside one test) opens File
  and clicks `/Sign out/`; it must use the new module. `base-path.spec.ts` only
  runs with `AUTO_CANVAS_E2E_BASE_PATH=1` (`playwright.config.ts:36-41`).
- Lanes and their three environment variables are in
  `docs/workflow.md#并行任务`; use lane 1 (`ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`).
- `pnpm deadcode` may already fail on `main`; record the baseline before
  changing anything and compare findings, not just the exit code.

### Coupling with T171

`task/T171-shelf-dialog-polish` is being implemented in another worktree and
already has uncommitted changes to `project-shelf.tsx`, `shelf-wall.*` and
`project-tabs.spec.ts`. This task therefore does **not** touch
`project-shelf.tsx` or `shelf-wall.*`: their copy still says "Shelf" (rename
field, Browse dialog) and stays for T171 or a later copy pass. Only
`e2e/project-tabs.spec.ts` overlaps (label strings here, dialog tests there);
dispatch T172 after T171's branch lands, and rebase before starting. If the two
cannot be sequenced, split the `project-tabs.spec.ts` edits out of this task.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/accounts/header-account-menu.tsx` (new)
- `apps/editor/src/accounts/header-account-menu.test.tsx` (new)
- `apps/editor/src/accounts/account-context.tsx`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/use-editor-shortcuts.ts`
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.test.tsx`
- `apps/editor/src/features/editor-shell/project-tabs.tsx`
- `apps/editor/src/app/App.test.tsx`
- `apps/editor/src/styles/editor-chrome.css`
- `apps/editor/e2e/editor-fixtures.ts`
- `apps/editor/e2e/standalone-accounts.spec.ts`
- `apps/editor/e2e/project-tabs.spec.ts` (label strings only)
- `apps/editor/e2e/base-path.spec.ts`
- `apps/editor/e2e/cloud-projects-server.spec.ts`
- `apps/editor/e2e/editor-modes.spec.ts`
- `apps/editor/e2e/chrome-isolation.spec.ts` (comments/naming only)
- `docs/specs/editor-interaction.md`
- `docs/specs/server.md`
- `docs/user/getting-started.md`
- `README.md`, `README_zh.md` (the one command name each)

Out of scope (do not change):

- Internal "Shelf" identifiers and copy: `ShelfWall`, `shelf-wall.*`,
  `project-shelf.tsx`, `cloud-projects.ts`, the `onOpenShelf`/`onRenameShelf`/
  `onDeleteShelf` props, `ProjectShelf`'s name and behaviour (T171).
- The Gallery/providers account menu (`components/account.tsx`,
  `account-menu-view.tsx`) and its tests; this module is for `accounts` mode
  only. Local mode and the desktop build keep rendering nothing.
- The account gate's sign-in screen, logout request and save-check protocol.
- `AccountStatePreload` wiring and `identityEnabled`'s existing meaning.
- The Shelf dialog's masonry, dragging or close behaviour (T171).

## Steps

1. **New module.** Create
   `apps/editor/src/accounts/header-account-menu.tsx` exporting
   `HeaderAccountMenu`. Read `useContext(AccountContext)`; return `null` when
   there is no account. Hooks (`useRef`) run before that return. Markup:

   ```tsx
   <details
     className="command-menu header-account-menu"
     name="editor-command-menu"
     data-testid="header-account-menu"
     ref={menu}
     onKeyDown={(event) => {
       if (event.key !== "Escape" || !menu.current) return;
       menu.current.open = false;
       menu.current.querySelector("summary")?.focus();
     }}
   >
     <summary
       className="account-name"
       data-testid="account-name"
       data-initial={initial}
       aria-label={`Account: ${account.username}`}
       title={account.username}
     >
       <span className="account-name-label">{account.username}</span>
     </summary>
     <div className="command-popover header-account-popover"
          role="group" aria-label="Account">
       <div className="header-account-identity">
         <span className="header-account-avatar" aria-hidden="true">{initial}</span>
         <span className="header-account-copy">
           <strong>{account.username}</strong>
           <small>Auto Canvas account</small>
         </span>
       </div>
       <div className="command-separator" role="separator" />
       <button type="button" data-testid="sign-out"
               onClick={() => account.logout()}>
         Sign out
       </button>
     </div>
   </details>
   ```

   `initial` is `[...username.trim()][0]?.toUpperCase() ?? "?"`. The summary's
   round mark comes from `.account-name::before`; do not duplicate it in the
   summary. `.command-menu` also gives the trigger the usual caret.

2. **Mount it.** In `editor-app-chrome.tsx`, import `HeaderAccountMenu` and
   render it as the last child of `.app-chrome-actions`, after `</details>`
   (`:521`) and before `</div>` (`:522`). No prop: the context decides.

3. **Extend the guards.** In `use-editor-shortcuts.ts:338`, add
   `.header-account-menu[open]` to the selector that currently matches
   `.project-menu[open], .more-menu[open]`, so Escape and arrow keys inside the
   menu never reach the canvas. Leave the `.command-menu[open]` dismissal at
   `:195-204` as is (the new class joins it).

4. **Remove Sign out from File.** Delete the `SignOutCommand` import
   (`file-command-menu.tsx:14`) and its render (`:466`). Delete the now-unused
   `SignOutCommand` export from `account-context.tsx`; keep
   `useBeforeAccountLogout` and the context. Confirm with
   `grep -rn "SignOutCommand" apps packages` that nothing else imports it.

5. **Rename the Cloud project item.**
   - `file-command-menu.tsx`: `title="Open Shelf project in tab"` →
     `title="Open Cloud Project…"`; the group `label="Shelf projects"` →
     `label="Cloud Projects"`; update the comment at `:220-221`.
   - `project-tabs.tsx:334-335`: `title`/`aria-label` →
     `"Open Cloud Project…"` — the same string as File's trigger, because
     `projectTabAction` uses one name for both surfaces.
   - Leave every internal `Shelf` identifier and the picker's own copy alone.

6. **File menu groups.** Restructure the fragment in `file-command-menu.tsx`
   into ordered groups and interleave `<div className="command-separator"
   role="separator" />` only between groups that are rendered:
   [Project Info, New Project] · [New project tab, Open file in new tab, Open
   Cloud Project…, Close tab] · [Save, NativeFileCommands, Check and Save] ·
   [Import] · [Export] · [Revert to Last Saved, Recover Unsaved Work…]. Import
   and Export stay two full-width rows, each in its own wrapper with its
   options beneath; keep the shelf's click/key propagation boundary
   (`:266-284`), the `dialog[open]` close guard, focus restoration, every
   `data-testid` and every disabled predicate.

7. **Header styles.** In `styles/editor-chrome.css` add a scoped block:
   - `.app-chrome-actions .header-account-menu { position: relative;
     display: inline-flex; align-items: center; }`.
   - `.header-account-menu > summary` as the same pill as other header
     controls: control height, `0 8px` padding, 1px border,
     `--icm-radius-sm`, surface background, `--icm-font-sm`, weight 600,
     `max-width: 10rem`, ellipsis, no marker.
   - `.header-account-popover { left: auto; right: 0; top: calc(100% + 6px);
     min-width: 14rem; z-index: 60; }` (the rest comes from `.command-popover`).
   - `.header-account-identity` row: 24px accent-soft circle for the initial,
     a `strong` + muted `small` copy column.
   - `.command-separator { height: 1px; margin: 4px; border: 0;
     background: var(--icm-border); }`.
   - `<=760px`: hide the name (`font-size: 0`, `padding-inline: 4px`) so the
     avatar alone remains; `.account-name::before` keeps its 11px mark.
   - `<=720px`: hang `.header-account-popover` from the window edge as the
     File and `⋯` popovers do (same fixed/top/right/max-width block,
     `editor-chrome.css:1718-1731`).
   - Do not add hover rules: the global `button:hover:not(:disabled)` already
     covers popover rows.

8. **Unit tests.**
   - New `header-account-menu.test.tsx`: with a provider it renders the initial
     mark, the username and a `Sign out` button; clicking calls `logout` once;
     without a provider it renders nothing; Escape closes an open menu and
     returns focus to the summary.
   - `file-command-menu.test.tsx`: update strings to `Open Cloud Project…` /
     `Cloud Projects`; assert File contains no `Sign out` **inside an
     `AccountContext.Provider`** (so the assertion would fail against today's
     code); assert separators appear only between rendered groups (no tab group
     without `projectTabs`, no recovery group without revert/recovery).
   - `App.test.tsx`: reword the two "no account control" comments to "no
     account module without an account context"; keep the local-mode
     assertions; add one test rendering the chrome inside
     `AccountContext.Provider` that sees `header-account-menu`.

9. **E2E and docs.**
   - `editor-fixtures.ts`: the `projectTabAction` union member becomes
     `"Open Cloud Project…"` (one string for both surfaces) and `:214`'s group
     lookup becomes `"Cloud Projects"`.
   - Replace the old label at every call site in the specs under Scope, and
     `editor-modes.spec.ts:1335`'s submenu union.
   - `standalone-accounts.spec.ts`: in `signOut`, open the header module
     (`page.getByTestId("account-name").click()`) and click
     `getByRole("button", { name: "Sign out" })`; the paused-save case keeps
     waiting for the same dialog. Both clicks at `:36` and `:72` are in the
     same test.
   - `chrome-isolation.spec.ts`: comments/naming only (the default suite is
     local mode, so the module is absent there — that stays asserted).
   - Docs: `editor-interaction.md:391`, `server.md:16`,
     `getting-started.md:60,221-222`, `README.md:80`, `README_zh.md:70`; say
     the top bar's right holds the user menu with Sign out, and that it exists
     in accounts mode.

10. **Format.** Run `pnpm format` (or `format:check` until clean).

## Acceptance

Run from the repository root; all must pass. E2E uses lane 1's ports and test
database.

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:local apps/editor/src/accounts apps/editor/src/features/editor-shell apps/editor/src/app/App.test.tsx
pnpm deadcode   # expected: exit 0, or no new finding against the recorded baseline
```

```bash
pnpm test:e2e project-tabs chrome-isolation editor-modes cloud-projects-server
```

```bash
AUTO_CANVAS_E2E_BASE_PATH=1 pnpm test:e2e base-path
```

```bash
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e standalone-accounts
```

Expected: every command exits 0.

Behavioral checks:

- Signed in (accounts mode): the top bar's last control is the avatar plus the
  username; clicking it shows "Auto Canvas account" and Sign out; signing out
  still runs the save check (the unsaved-work case warns "Sign out paused…")
  and returns to the sign-in screen.
- File no longer contains Sign out; its commands are separated into the groups
  above; a submenu still expands in place and closes the menu when a command
  runs.
- File → Open Cloud Project… lists the account's saved drawings under Cloud
  Projects; the tab strip's ▾ tooltip reads Open Cloud Project…; opening one
  still opens it in a tab, and the picker still works with one and two tabs.
- Clicking the canvas closes the account menu; Escape closes it and returns
  focus to its summary; an arrow key inside it does not pan the canvas.
- Local mode and the desktop build still render no user module.
- No horizontal overflow at 320, 390, 480, 720 and 1440 px; the module stays on
  the header's single row; the popover stays on screen at 320 px and just above
  720 and 760 px; at `<=760px` only the avatar shows.

## Notes for the implementer

- Product decisions taken with the owner (2026-11-23): the name is **Open Cloud
  Project…**, the module shows **avatar + username** with the account line and
  **Sign out**, and the File menu gets **group separators**, not a redesign.
- Reuse `AccountContext` and `account.logout()`; never call `auth/logout`
  directly, or the save check is skipped.
- Keep the module out of `AccountMenu`/`account-menu-fallback`: those belong to
  the Gallery provider path, which this deployment does not use.
- Do not rename internal Shelf symbols, endpoints, CSS classes or test ids, and
  do not touch `project-shelf.tsx`/`shelf-wall.*`.
- Commit only on `task/T172-header-account-menu`, with
  `Test-Impact: tests-updated`; do not push, merge, rebase or switch branches.
