# T185 — Remove Top Header More (`⋯`) Menu and Relocate Actions Locally

- Branch: `remove_top_banner_content`
- Base: `main` at `4fc06e18`
- Status: approved
- Plan review: self-checked against the code; scope and product decisions confirmed by owner

## Goal

Remove the miscellaneous top-bar `⋯` (`more-menu`) dropdown so the header contains only global/document-level controls, and relocate every non-redundant capability into the local UI surface where it belongs while retiring the redundant `Edit Device Data…` (`InstanceCodePanel`) surface.

## Context

- `EditorAppChrome` (`apps/editor/src/app/editor-app-chrome.tsx`) renders a `⋯` (`data-testid="more-menu"`) menu left over from T150c merging legacy `Edit` and `Circuit` menus.
- Many items in `⋯` already exist elsewhere: `Auto Layout` / `Cancel` (header button), `Copy Netlist` (Netlist panel action), `Insert component… (I)` (Library panel + `I`), `Place Cell from this Project…` (`Insert` dialog `Cells` category + `HierarchyToolbar`), and `Delete` / `Rotate` / `Mirror` / `Align` (`CanvasContextMenu` + shortcuts).
- Remaining unique or low-discoverability items move to their local domains:
  - `Netlist Settings…` and `Review Netlist Issues…` → `NetlistCodePanel` header actions, with a `Back to Netlist` button on `NetlistProfileCode`.
  - `Edit Device Data…` (`InstanceCodePanel` / `instance-code`) → retired (covered by Netlist code, Project Code, and Properties).
  - `Cell Manager…` → `CellsRail` header (`Manage…`, Auto multi-cell) + `FileCommandMenu` project group (`Cell Manager…`, covering single-cell and all modes); Draw multi-cell keeps `HierarchyToolbar`'s `Manage Cells…`.
  - `User Components…` → `ShapesPanel` (Library sidebar) and `InsertComponentDialog` header (accessible from both Auto via `I` and Draw).
  - `Copy selection as PNG` / `Copy selection as SVG` → `EditorCanvasContextMenu` right after `Copy (C)`.
  - `Find in Circuit… (Ctrl+F)` and `Choose Selectable Objects… (Ctrl+Shift+F)` → `EditorStatusbar` view controls (`Find` button and always-visible `Filter` button showing active filter summary when filtered).

## Scope

Owned paths (may be created, edited or deleted):

- `tasks/T185-remove-more-menu/plan.md`
- `apps/editor/src/app/editor-app-chrome.tsx`
- `apps/editor/src/app/editor-menus.tsx`
- `apps/editor/src/app/editor-project-dock.tsx`
- `apps/editor/src/app/editor-dialogs.tsx`
- `apps/editor/src/app/App.tsx`
- `apps/editor/src/app/App.test.tsx`
- `apps/editor/src/app/use-editor-shortcuts.ts`
- `apps/editor/src/features/auto-layout/auto-layout-button.tsx`
- `apps/editor/src/features/auto-layout/auto-layout-menu-section.tsx` (delete)
- `apps/editor/src/features/auto-layout/auto-layout-menu-section.test.tsx` (delete)
- `apps/editor/src/features/properties/instance-code-panel.tsx` (delete)
- `apps/editor/src/features/properties/instance-code-panel.test.tsx` (delete)
- `apps/editor/src/features/properties/instance-code.ts` (delete)
- `apps/editor/src/features/properties/instance-code.test.ts` (delete)
- `apps/editor/src/features/netlist-export/netlist-code-panel.tsx`
- `apps/editor/src/features/netlist-export/netlist-code-panel.test.tsx`
- `apps/editor/src/features/netlist-export/netlist-profile-code.tsx`
- `apps/editor/src/features/hierarchy/cells-rail.tsx`
- `apps/editor/src/features/hierarchy/cells-rail.test.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.tsx`
- `apps/editor/src/features/editor-shell/file-command-menu.test.tsx`
- `apps/editor/src/features/editor-shell/shapes-panel.tsx`
- `apps/editor/src/features/editor-shell/shapes-panel.test.ts`
- `apps/editor/src/features/editor-shell/editor-statusbar.tsx`
- `apps/editor/src/features/editor-shell/editor-statusbar.test.tsx`
- `apps/editor/src/features/editor-shell/canvas-panel-buttons.test.tsx`
- `apps/editor/src/features/component-insert/insert-component-dialog.tsx`
- `apps/editor/src/styles/editor-chrome.css`
- `apps/editor/src/styles/editor-workspace.css`
- `apps/editor/src/styles/editor-dialogs.css`
- `apps/editor/e2e/**` (update tests that relied on `more-menu` / `openMenu` / `Edit Device Data`)
- `docs/specs/editor-interaction.md`
- `docs/user/getting-started.md`
- `docs/user/schematic-hierarchy.md`

Out of scope (do not change):

- Core model, netlist, auto-layout, server, or MCP packages.
- Keyboard shortcuts (`I`, `Ctrl+F`, `Ctrl+Shift+F`, `N`, `Q`, `R`, etc.).

## Steps

1. Remove `⋯` (`more-menu`) from `EditorAppChrome`, inline `AutoLayoutMenuActions` into `auto-layout-button.tsx`, delete `auto-layout-menu-section.*`, and remove `.more-menu[open]` from `use-editor-shortcuts.ts`.
2. Retire `Edit Device Data…`: remove `"instances"` from `EditorProjectPanelMode`, remove `InstanceCodePanel` wiring from `App.tsx`, delete `instance-code*` files and `apps/editor/e2e/instance-table.spec.ts`.
3. Add `Review Netlist Issues…` and `Netlist Settings…` icon actions to `NetlistCodePanel` and a `Back to Netlist` action to `NetlistProfileCode`.
4. Add `Cell Manager…` to `FileCommandMenu` (Project group) and `Manage…` to `CellsRail` header.
5. Add `User Components…` to `ShapesPanel` and `InsertComponentDialog` header (respecting `capabilities.userComponents`).
6. Add `Copy selection as PNG` and `Copy selection as SVG` to `EditorCanvasContextMenu`.
7. Add `Find` (`project-search-button`) and always-visible `Filter` (`selection-filter-button`) pills to `EditorStatusbar` view controls, replacing the conditional `selection-filter-status` chip.
8. Update CSS styles, unit tests, E2E tests/fixtures, and user/spec documentation.
9. Run full verification (`format:check`, `docs:check`, `agent-docs:generated:check`, `components:check`, `typecheck`, `lint`, `deadcode`, `build`, `test:local`, and affected E2E specs).

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
pnpm build
pnpm test:local
```

Behavioral checks:

- Top header has no `⋯` (`more-menu`) button; only global/document actions remain.
- `Netlist Settings…` and `Review Netlist Issues…` open from the Netlist panel, and `Netlist Settings` offers a back button to return to `Netlist`.
- `Cell Manager…` is reachable from `File` in all modes (including single-cell), from `Cells` rail in Auto multi-cell, and from `HierarchyToolbar` in Draw multi-cell.
- `User Components…` is reachable from `Library` in Draw mode and from the `Insert` (`I`) dialog in both modes.
- `Copy selection as PNG` and `Copy selection as SVG` appear in the canvas right-click menu when a selection is active.
- `Find` and `Filter` are always accessible in the status bar alongside keyboard shortcuts `Ctrl+F` and `Ctrl+Shift+F`.
