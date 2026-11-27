# T197 — New Project Flow, Top-Bar Inline Rename, and Incremental Save on Close

- Branch: `new_project_sheet_tabs`
- Base: `main` at `7e033b80`
- Status: approved
- Plan review: self-checked against code and confirmed with user (4 product decisions locked)

## Goal

Streamline the New Project user flow so creating a new project is immediately accessible from the top bar (`+ New`), unified with `File → New Project` (always opening a new tab while keeping open projects in the top tab strip when 2+ tabs exist), make the top-bar project name directly editable in place on hover + single-click, and close the gap on tab close buttons (`×`, `File → Close tab`, `Close Others`, `Close All`) with automatic incremental Cloud save for bound dirty projects and a 3-way confirmation (`Save & close` / `Export & close`, `Close without saving`, `Keep open`) for unbound dirty projects or failed saves.

## Context

Verified in codebase:

- `apps/editor/src/app/editor-app-chrome.tsx`: `EditorAppChrome` renders `.app-brand` (brand, `ProjectNameLabel`, history undo/redo, `ModeSwitch`) and `.app-chrome-actions`. `ProjectNameLabel` currently renders a read-only button opening `Project Info`.
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`: Currently renders both `New Project` (`onNewProject`, replacing the current tab) and `New project tab` (`projectTabs.onNew`, opening a new tab).
- `apps/editor/src/features/editor-shell/project-tabs.tsx`: Renders the top tab strip below `.app-chrome-main` when `tabs.length > 1`, hidden when `tabs.length === 1`. Currently dirty close only offers 2 options (`Close without saving` / `Keep open`) with no Cloud incremental save or `Save & close`.
- `apps/editor/src/app/use-project-tab-sessions.ts`: `projectTabs.tabs` already exposes `cloudId: session.file.cloudBinding?.id ?? null` and `dirty` per tab. `reserveBackgroundCloudSave` and `agent-workspace-requests.ts` establish the safe background Cloud save pattern (`cloudWriteSequence`, binding check, `onCloudProjectSaved`, `holdAfterFailure`).
- `apps/editor/src/app/use-editor-shortcuts.ts`: Line 325 ignores keyboard shortcuts inside `.project-tab-name-input`; must also ignore `.app-project-name-input`.
- `apps/editor/e2e/cloud-auto-save.spec.ts`: Enforces that only the active tab auto-saves after 3s idle (tab switching does not force background PUTs); incremental save is triggered specifically on Close (`×`).
- `apps/editor/e2e/editor-modes.spec.ts`: Enforces single-row top bar (`<= 48px`) across widths `320..1440` and no clipping of `auto-layout-button` / `import-netlist-button`.

## Scope

Owned paths (may be created, edited or deleted):

- `tasks/T197-new-project-flow/plan.md`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-app-chrome.test.tsx` (new)
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/use-project-tab-sessions.ts`
- `apps/editor/src/app/use-project-tab-sessions.test.ts`
- `apps/editor/src/app/use-editor-shortcuts.ts`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/App.test.tsx`
- `apps/editor/src/components/inline-confirm.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.test.tsx`
- `apps/editor/src/features/editor-shell/project-tabs.tsx`
- `apps/editor/src/features/editor-shell/project-tabs.test.tsx`
- `apps/editor/src/features/editor-shell/project-tabs.css`
- `apps/editor/src/styles/editor-chrome.css`
- `apps/editor/e2e/editor-fixtures.ts`
- `apps/editor/e2e/editor-modes.spec.ts`
- `apps/editor/e2e/project-tabs.spec.ts`
- `apps/editor/e2e/project-file.spec.ts`
- `docs/specs/editor-interaction.md`
- `docs/user/getting-started.md`

Out of scope (do not change):

- Moving `ProjectTabs` to the bottom of the screen (confirmed: keep at top, visible with 2+ tabs).
- Auto-saving inactive tabs on tab switch (preserve `cloud-auto-save.spec.ts` contract).
- Backend `/api/projects` schema or server routes.

## Steps

1. Update `docs/specs/editor-interaction.md` and `docs/user/getting-started.md` to match the confirmed UX:
   - Top bar `+ New` button next to `Auto | Draw`.
   - Unified `File → New Project` opens a new project tab (no duplicate `New project tab`).
   - Top-bar project name supports hover editable affordance + single-click inline rename (`Project Info` remains in `File`).
   - Closing dirty Cloud-bound tabs auto-saves incrementally to Cloud before closing (prompting on failure); closing dirty unbound tabs offers 3-way confirmation (`Save & close` / `Export & close`, `Close without saving`, `Keep open`).
2. Implement top-bar `+ New` button and inline editable `ProjectNameLabel` in `editor-app-chrome.tsx`, responsive CSS in `editor-chrome.css`, shortcut guard in `use-editor-shortcuts.ts`, and unified `File → New Project` in `file-command-menu.tsx` + `editor-menus.tsx`.
3. Implement tab save-and-close coordinator (`saveAndCloseTabs` / `saveTabToCloud`) in `use-project-tab-sessions.ts`, wire it through `App.tsx` and `editor-menus.tsx` into `ProjectTabs`, and extend `InlineConfirm` / `ProjectTabs` for automatic incremental save of bound dirty tabs on close and 3-way close decision for unbound dirty tabs or save failures.
4. Update existing unit tests and add targeted unit tests covering:
   - Top-bar `+ New` button and inline project name editing (hover/click/Enter/Escape/blur/maxLength/empty/no-op/editing flag).
   - Unified `FileCommandMenu` (`New Project` delegates to `projectTabs.onNew`, no `New project tab`).
   - `ProjectTabs` incremental save on close for bound dirty tabs (success + failure fallback), 3-way decision for unbound dirty tabs (Cloud & local export), and bulk close (`Close Others` / `Close All`).
   - Update affected e2e specs (`editor-fixtures.ts`, `editor-modes.spec.ts`, `project-tabs.spec.ts`, `project-file.spec.ts`).
5. Run acceptance commands and verify clean diff.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm format:check
pnpm docs:check
pnpm agent-docs:generated:check
pnpm components:check
pnpm typecheck
pnpm lint
pnpm deadcode
pnpm test:local
pnpm build
```

Behavioral checks:

- Clicking top-bar `+ New` (or `File → New Project`) keeps the existing project open, opens a new `Untitled` / `Untitled 2` tab, and shows the top tab strip once 2+ tabs exist.
- Hovering over the top-bar project name shows an editable affordance; clicking enters inline `<input>` rename without opening `Project Info`; Enter/blur commits via `rename_project` (synced with the tab strip); Escape cancels; keys never leak to the canvas.
- Closing a clean tab closes immediately.
- Closing a dirty Cloud-bound tab automatically saves incrementally (`PUT /api/projects/:id`) and closes on success; on failure keeps the tab open with error + retry / close without saving / keep open.
- Closing a dirty unbound tab prompts with `Save & close` (or `Export & close` without Cloud), `Close without saving`, and `Keep open`.

## Notes for the implementer

- Keep `.app-project-name` and `.app-project-name-text` class names and resting button structure so existing selectors remain compatible; render pencil icon with `aria-hidden="true"` and no text content.
- Keep `.project-tabs > [aria-label="New project tab"]` on the tab strip's `＋` button.
- Ensure top-bar `+ New` collapses to icon-only at `<= 900px` and hides at `<= 480px` so the single-row top bar invariant holds from `320px` to `1440px`.
