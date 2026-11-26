# T185 Report — Remove Top Header More (`⋯`) Menu and Relocate Actions Locally

## Summary

Removed the top-bar `⋯` (`more-menu`) overflow dropdown and redistributed every non-redundant capability into the local UI surface it operates on, while retiring the redundant `Edit Device Data…` (`InstanceCodePanel`) view.

## Changes

- **Top header (`EditorAppChrome`, `EditorMenuBar`, `use-editor-shortcuts.ts`)**: Removed `⋯` (`more-menu`) and `AutoLayoutMenuSection` (inlined `AutoLayoutMenuActions` into `auto-layout-button.tsx`). Header now contains only global/document controls (`File`, `Auto Layout`, `Import netlist…` in Auto, `Agent`, and account menu).
- **Retired `Edit Device Data…`**: Removed `"instances"` from `EditorProjectPanelMode`, removed `InstanceCodePanel` wiring from `App.tsx`, and deleted `instance-code*.ts(x)` and `apps/editor/e2e/instance-table.spec.ts` (covered by live Netlist code, Project Code, and Properties JSON).
- **Netlist panel (`NetlistCodePanel`, `NetlistProfileCode`)**: Added `Review Netlist Issues…` (`review-netlist-issues`) and `Netlist Settings…` (`netlist-settings-toggle`) icon actions to the Netlist panel header, plus a `Back to Netlist` (`netlist-settings-back`) button on `NetlistProfileCode`.
- **Hierarchy (`FileCommandMenu`, `CellsRail`)**: Added `Cell Manager…` (`hierarchy-entry`) in `File`'s Project group (covering single-cell and all modes) and `Manage…` (`cells-rail-manage`) in `CellsRail`'s header (Auto multi-cell). Draw multi-cell keeps `HierarchyToolbar`.
- **User Components (`ShapesPanel`, `InsertComponentDialog`)**: Added `User Components…` to the Library panel (`library-user-components`) and the Insert (`I`) dialog header (`insert-user-components`) when `capabilities.userComponents` is enabled.
- **Selection image copy (`EditorCanvasContextMenu`)**: Added `Copy selection as PNG` and `Copy selection as SVG` to the canvas right-click menu when a selection can be copied as an image.
- **Find & Filter (`EditorStatusbar`)**: Added `Find` (`project-search-button`) and always-visible `Filter` (`selection-filter-button`, highlighted with active summary when filtered) pills to the status bar view controls, replacing the conditional `selection-filter-status` chip.
- **Docs & Tests**: Updated `docs/specs/editor-interaction.md`, `docs/user/getting-started.md`, `docs/user/schematic-hierarchy.md`, unit tests, and Playwright E2E fixtures/specs.

## Retired Tests Justification

- `apps/editor/src/features/auto-layout/auto-layout-menu-section.test.tsx`: The `⋯ → Layout` menu section was removed; top-bar `AutoLayoutButton` and `auto-layout.spec.ts` cover Auto Layout start/cancel.
- `apps/editor/src/features/properties/instance-code.test.ts`, `instance-code-panel.test.tsx`, `apps/editor/e2e/instance-table.spec.ts`: `Edit Device Data…` (`InstanceCodePanel`) was intentionally retired by product decision; device editing remains covered by Netlist code, Project Code, and Properties tests.

## Verification

- `pnpm format:check` — passed
- `pnpm docs:check` — passed (74 Markdown files)
- `pnpm agent-docs:generated:check` — passed (6 outputs, 0 stale)
- `pnpm components:check` — passed
- `pnpm typecheck` — passed
- `pnpm lint` — passed (0 errors)
- `pnpm deadcode` — passed (`knip` & `knip --production`, 0 issues)
- `pnpm build` — passed
- `pnpm test:local apps/editor` — 336/336 test files passed (331 sandboxed + 5 Postgres-backed loopback files, 3233 tests total)
- Playwright E2E — passed across `chrome-isolation.spec.ts`, `context-menu.spec.ts`, `editor-modes.spec.ts`, `editor-shell.spec.ts`, `netlist-workflows.spec.ts`, `selection-and-find.spec.ts`, `auto-layout.spec.ts`, `netlist-code-edit.spec.ts`, `selection-visuals.spec.ts`, and `hierarchy.spec.ts` (narrow Cell Manager & Place Cell tests)
