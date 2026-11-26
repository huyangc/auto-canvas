# T185 — Redesign Cloud Projects delete confirmation and inline title rename

- Branch: `redesign_delete_rename_ui`
- Base: `main` at `4fc06e18`
- Status: approved
- Plan review: self-checked against code; product decisions confirmed by owner 2026-11-25 (Confirm/Cancel copy with `Delete?` prompt, single-row footer swap for delete confirm, direct click-to-edit title with I-beam cursor and blur/Enter to save, global `InlineConfirm` default label unification).

## Goal

Fix the layout wrapping and awkward wording on Cloud Projects cards and list rows, and streamline renaming:

1. **Clear, consistent delete confirmation (`Confirm` / `Cancel`)**:
   - Update `InlineConfirm` default labels globally from `"Really delete"` / `"Keep it"` to `"Confirm"` / `"Cancel"`, and add optional `promptLabel` and `dismissOnOutsideClick` props.
   - In `ShelfWall` (both grid cards and list rows), clicking the trash icon swaps the action bar in place into a single non-wrapping confirmation row (`Delete?` on the left, `Confirm` and `Cancel` buttons on the right), hiding `♡` and `•••` while confirming so `•••` never wraps to a new line and card height stays constant (no Masonry reflow).
   - Clicking outside the confirmation bar or pressing `Escape` dismisses it.
   - The `•••` menu's Delete item also displays `Delete?` with `Confirm` / `Cancel` on a single non-wrapping row.
2. **Direct click-to-edit rename on the project name**:
   - Remove the standalone `Rename` button from the card footer and list action bar (keep `Rename` in the `•••` menu as a keyboard/overflow entry that triggers the same inline editor).
   - Card footer groups `♡` on the left and `🗑️` + `•••` on the right to separate favorite from destructive delete.
   - Hovering a project's name shows a text (`I`) cursor and subtle editable highlight (`title="Click to rename"`). Clicking the name turns it into an in-place `<input>` matching the title's typography with zero height jump.
   - Blurring (clicking elsewhere) or pressing `Enter` (IME-safe) saves automatically; empty or unchanged input silently reverts. Pressing `Escape` cancels without closing the Cloud Projects modal.
   - Clicking the preview or rest of the card opens the project; clicking a card open target while a rename input is focused saves the rename without accidentally opening that project.

## Context

Verified at `4fc06e18`:

- `apps/editor/src/components/inline-confirm.tsx`: defaults `confirmLabel = "Really delete"` and `cancelLabel = "Keep it"`. Used by `shelf-wall.tsx`, `component-definition-editor.tsx` (uses defaults), `external-model-source-editor.tsx` (custom labels), and `project-tabs.tsx` (custom labels `"Close without saving"` / `"Keep open"`).
- `apps/editor/src/components/inline-confirm.css`: styles `.inline-confirm`, `.inline-confirm-decision`, `.inline-confirm-actions`.
- `apps/editor/src/components/shelf-wall.tsx` & `shelf-wall.css`:
  - `.shelf-tile-footer` (`flex-wrap: wrap`) renders `♡`, `Rename` button, `InlineConfirm` trash button, and `•••`. Expanding `InlineConfirm` wraps confirmation buttons onto line 2 and pushes `•••` onto line 3.
  - `.shelf-rename-form` renders below the card (or replaces the list row) with Save/Cancel buttons.
- Tests referencing old labels or `.shelf-rename-form`:
  - `apps/editor/src/components/shelf-wall-limit.test.tsx`
  - `apps/editor/e2e/project-tabs.spec.ts` (`"Keep it"`, `"Really delete"`)
  - `apps/editor/e2e/user-components.spec.ts` (`"Really delete"`)
  - `apps/editor/e2e/editor-fixtures.ts` (`renameShelfProject` clicks `button[name="Rename <from>"]`, fills `textbox[name="Project name"]`, presses `Enter` — preserved by keeping `aria-label="Rename <name>"` on the inline title button).

## Scope

Owned paths:

- `tasks/T185-redesign-delete-rename-ui/plan.md`
- `apps/editor/src/components/inline-confirm.tsx`
- `apps/editor/src/components/inline-confirm.css`
- `apps/editor/src/components/shelf-wall.tsx`
- `apps/editor/src/components/shelf-wall.css`
- `apps/editor/src/components/shelf-wall-limit.test.tsx`
- `apps/editor/e2e/project-tabs.spec.ts`
- `apps/editor/e2e/user-components.spec.ts`

Out of scope:

- Server endpoints, `cloud-projects.ts` API, Masonry column math, custom labels in `project-tabs.tsx` / `external-model-source-editor.tsx`.

## Steps

1. Update `inline-confirm.tsx` and `inline-confirm.css`:
   - Change defaults to `confirmLabel = "Confirm"`, `cancelLabel = "Cancel"`.
   - Support optional `promptLabel?: string` (rendered beside `.inline-confirm-actions` inside `.inline-confirm-row`) and `dismissOnOutsideClick?: boolean`.
2. Redesign `shelf-wall.tsx` and `shelf-wall.css`:
   - Track `confirmingDeleteId` so only one card/list delete confirm is open; swap the footer/list action bar in place to a single `nowrap` row (`Delete?  [Confirm] [Cancel]`) hiding `♡` and `•••`.
   - Remove the standalone `Rename` button and `.shelf-rename-form`; separate footer controls (`♡` left, `🗑️` + `•••` right).
   - Use the accessible stretched-link card/list body pattern so preview + metadata open the project while the title text is an independent inline-editable `<button>` (`cursor: text`, subtle hover affordance, `aria-label="Rename <name>"`) that switches in place to `<input aria-label="Project name">` on click, saves on blur/Enter (IME-safe), cancels on Escape, and suppresses accidental card-open on the blur-dismissing click.
   - Keep `Rename` in the `•••` menu activating the same inline input; give menu Delete `promptLabel="Delete?"` and single-row `nowrap` layout.
3. Update `shelf-wall-limit.test.tsx`, `apps/editor/e2e/project-tabs.spec.ts`, and `apps/editor/e2e/user-components.spec.ts` to cover:
   - `Confirm` / `Cancel` labels (and `Delete?` prompt) in shelf card, list, menu, and component editor.
   - Clicking outside or Escape cancels delete confirmation; confirming deletes cleanly without wrapping or pushing `•••`.
   - Clicking project name edits inline, Enter/blur saves, empty/unchanged reverts, Escape cancels, and `•••` → `Rename` opens the same inline editor.
4. Run formatting, typecheck, lint, deadcode, unit tests, build, and targeted Playwright E2E checks (plus visual verification in headless browser if available).

## Acceptance

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm deadcode
pnpm vitest run apps/editor/src/components/shelf-wall-limit.test.tsx apps/editor/src/components/shelf-wall.test.tsx
pnpm test:local
pnpm build
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts
```

Behavioral checks:

- Card footer shows `♡` on the left and `🗑️` + `•••` on the right; no standalone `Rename` button.
- Clicking `🗑️` replaces the footer in place with a single non-wrapping row `Delete?  [Confirm] [Cancel]` with no height jump and no `•••` wrapping; clicking outside, `Cancel`, or `Escape` restores the footer.
- Hovering a project name shows the `I` (`text`) cursor and subtle highlight; clicking edits in place; clicking elsewhere or pressing `Enter` saves; pressing `Escape` cancels.
- Clicking the preview or metadata opens the project as before.
