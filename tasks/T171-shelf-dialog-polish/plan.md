# T171 — Cloud Projects dialog: × close at top right, aligned masonry, and a draggable window

- Branch: `task/T171-shelf-dialog-polish`
- Base: `main` at `d8c86d1`
- Status: approved
- Plan review: skipped at the owner's instruction (2026-11-23): codex plan
  review is not required by default; the owner asks for one explicitly when
  wanted. Scope decisions confirmed by the owner 2026-11-23: keep the masonry
  wall (fix the misalignment, do not switch to a uniform grid); move Delete
  into the ••• menu; drag by the title bar only.

## Goal

The Browse Cloud Projects dialog (the "shelf wall") reads as a tidy, movable
window:

- The close affordance is a small **× button at the top right** of a real
  header bar that also carries the title, not a text button at the top left.
- Saved circuits **tile without misplacement**: every card sits at the top of
  its masonry column, columns are evenly spaced, and nothing hangs off the
  bottom of the dialog (the screenshot shows card 2 pushed one column right
  *and* one card down, cut by the window edge).
- The dialog window can be **dragged by its header** and stays inside the
  viewport while dragged.
- The stray **Delete text under each card moves into the tile's ••• menu**
  (with the existing two-step confirm), so the wall only shows cards.

## Context

Facts verified at `d8c86d1`.

**Where the dialog lives.**

- `apps/editor/src/features/editor-shell/project-shelf.tsx:59-74` renders the
  `<dialog className="cloud-shelf-dialog" aria-label="Cloud Projects">` with a
  bare `Close` text button (`:68-70`) as the first child and the lazy
  `ShelfWall` (`:71-73`). It is mounted from two entry points:
  `file-command-menu.tsx:285` (File menu submenu) and `project-tabs.tsx:340`
  (tab-strip Shelf details). Desktop builds render `null` (line 4-10).
- `.cloud-shelf-dialog` styling is in `apps/editor/src/components/shelf-wall.css:185-197`
  (`width: min(1100px, 90vw); max-height: 85vh; overflow: auto; padding: 20px`),
  i.e. the dialog chrome is styled by the **lazy** chunk. Any chrome style the
  header and drag need must move to a stylesheet imported by
  `project-shelf.tsx` itself, or the fallback frame is unstyled.

**Why the wall is misaligned (root cause of the screenshot).**

- `apps/editor/src/components/shelf-wall.tsx:333-454` lays tiles out with
  `Masonry` (`apps/editor/src/components/masonry.tsx`), which writes each
  item's `width` and `transform: translate(x, y)` directly
  (`masonry.tsx:88-111`) and sets the container height. It assumes
  `.masonry-item` is absolutely positioned.
- **No CSS anywhere defines `.masonry` or `.masonry-item`.** `grep -rn
  "\.masonry"` over the repo and over `apps/editor/dist/assets/*.css` finds
  nothing. Items therefore stay in normal flow and the translate only shifts
  them: tile 2 begins below tile 1's flow position and is pushed one column
  right — exactly the screenshot (card 2 starts about one tile lower and hangs
  off the bottom edge).
- The fix is the missing two rules: the container `position: relative`, and
  each item `position: absolute; top: 0; left: 0` (the JS already writes
  width, transform and container height). Tile heights stay natural — the
  owner chose to keep the masonry look.
- `Masonry` re-runs its layout whenever `items` changes identity
  (`masonry.tsx:122`; `shelf-wall.tsx:335-341` builds a fresh array each
  render), so add/remove/reorder and image loads are already re-measured
  through its `ResizeObserver`; no other change is needed.

**Tile content today.**

- `shelf-wall.tsx:344-451` per tile: `<a class="shelf-tile">` with
  `TilePreview` (`:351-355`) and name + `time · revision` copy
  (`:356-372`), absolutely positioned `•••` actions button (`:374-393`),
  optional rename form (`:394-441`), and a **standalone `InlineConfirm`
  Delete button below the card** (`:442-450`, `.shelf-tile-delete` in
  `shelf-wall.css:93-104`). This is the bare "Delete" line under the first
  card in the screenshot.
- Sorting is favorite first, then `updatedAt` desc, then id
  (`shelf-wall.tsx:335-341`) — keep it.
- The `•••` context menu (`shelf-wall.tsx:467-552`) holds Open in new tab,
  Version history, Duplicate, Rename, Export, Favorite. It is positioned
  `fixed` from the button's rect (`showMenu`, `:112-118`).
- `InlineConfirm` (`apps/editor/src/components/inline-confirm.tsx:74-131`)
  hides its trigger while open (`hidden`, `:93`), renders a `role="group"`
  decision with danger/cancel buttons, and stops Escape propagation
  (`:80-87`), so it works inside the menu unchanged.

**Tests that pin current behavior.**

- `apps/editor/src/components/shelf-wall-limit.test.tsx:60-75` opens the
  `shelf-actions-<id>` menu for Favorite/Duplicate, and clicks
  `[data-testid="shelf-delete-other"]` **directly** (no menu), then the
  `.inline-confirm-danger` inside `[aria-label="Delete Other from your shelf"]`.
  Moving Delete into the menu changes this test.
- `apps/editor/e2e/project-tabs.spec.ts:1541-1575` expects
  `getByRole("dialog", { name: "Cloud Projects" })`, a button named exactly
  `Close`, keyboard isolation inside the dialog, and the actions menu /
  rename field. `project-tabs.spec.ts:1322-1328` and
  `standalone-accounts.spec.ts:130` open the dialog via
  "Browse Cloud Projects…". The accessible names must stay stable.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/features/editor-shell/project-shelf.tsx`
- `apps/editor/src/features/editor-shell/project-shelf.css` (new: dialog chrome)
- `apps/editor/src/components/masonry.tsx` (import its new stylesheet)
- `apps/editor/src/components/masonry.css` (new: the missing layout rules)
- `apps/editor/src/components/shelf-wall.tsx`
- `apps/editor/src/components/shelf-wall.css`
- `apps/editor/src/components/dialog-drag.ts` (new) and
  `apps/editor/src/components/dialog-drag.test.ts` (new)
- `apps/editor/src/components/shelf-wall-limit.test.tsx`
- `apps/editor/e2e/project-tabs.spec.ts`

Out of scope (do not change):

- `cloud-projects.ts` client, server endpoints, preview SVG generation and
  `TilePreview`'s failure fallback behavior.
- The masonry geometry itself (column width, greedy placement, natural tile
  heights); the menu's existing actions and their semantics; the rename form.
- Desktop builds (`ICM_DESKTOP` renders no shelf).
- Making the dialog non-modal: it stays `showModal()`; dragging is cosmetic.
- Keyboard-driven window movement.

## Steps

1. **Masonry layout rules.** New `apps/editor/src/components/masonry.css`,
   imported by `masonry.tsx` right after its imports:

   ```css
   .masonry { position: relative; }
   .masonry-item { position: absolute; top: 0; left: 0; }
   ```

   Add a comment that the JS writes width/transform/container height and
   these rules are what make that placement take effect. Do not touch the
   component's JS. Verify with the existing `masonry.test.ts` (still green)
   and behaviorally (step 7).

2. **Dialog chrome in `project-shelf.tsx`.** Replace the first-child `Close`
   text button with a header:

   ```tsx
   <dialog className="cloud-shelf-dialog" aria-labelledby="cloud-shelf-title">
     <header className="cloud-shelf-header">
       <h2 id="cloud-shelf-title">Cloud Projects</h2>
       <button type="button" className="cloud-shelf-close"
               aria-label="Close" title="Close">×</button>
     </header>
     <div className="cloud-shelf-body">
       <Suspense fallback={…}><ShelfWall /></Suspense>
     </div>
   </dialog>
   ```

   Keep the accessible name "Cloud Projects" (via `aria-labelledby` on the
   `h2`) and the button name "Close" so the existing e2e selectors keep
   working. Create `features/editor-shell/project-shelf.css` imported by
   `project-shelf.tsx`; move the `.cloud-shelf-dialog` and `::backdrop` rules
   there from `shelf-wall.css` and add: dialog as a column flex box,
   `padding: 0; overflow: hidden`; header `display:flex; justify-content:
   space-between; align-items:center; padding: 12px 20px; border-bottom: 1px
   solid var(--icm-border); cursor: grab; user-select: none; touch-action:
   none`; body `overflow:auto; padding: 16px 20px 20px`; × button a 28px
   square ghost button with hover background and `cursor: pointer`.
   Width `min(1100px, 92vw)`, `max-height: min(85vh, 100dvh - 2rem)`.

3. **Drag the window.** New `apps/editor/src/components/dialog-drag.ts`:
   export a pure `clampDragOffset(candidate, baseRect, viewport, margin)`
   (clamp x so `baseRect.left + x >= margin` and `baseRect.right + x <=
   viewport.width - margin`, same for y; when a range inverts because the
   viewport is smaller than the dialog, that axis stays at 0) and a
   `useDialogDrag(ref)` hook that: on `pointerdown` on the header (button 1
   only; ignore pointerdowns originating in the close button or any
   interactive child), records the pointer and the dialog's untransformed
   rect (`getBoundingClientRect()` minus the current offset), calls
   `setPointerCapture`, tracks `pointermove`/`pointerup`/`pointercancel`,
   and writes `dialog.style.transform = translate(x, y)` clamped through the
   helper (margin 8px), with an `is-dragging` class for `cursor: grabbing`.
   Offset lives in a ref; no React state per move. The offset resets
   naturally because the dialog unmounts when closed.

4. **Delete into the ••• menu.** In `shelf-wall.tsx`: remove the standalone
   `InlineConfirm` under each tile and the `.shelf-tile-delete` rules from
   `shelf-wall.css`; append a danger menu item after Favorite — an
   `InlineConfirm` with `role="menuitem"`, `data-testid={`shelf-delete-${project.id}`}`,
   `aria-label={`Delete ${project.name} from your shelf`}` and
   `onConfirm={async () => { await removeProject(project); setMenu(null); }}`.
   Keep the same confirm/cancel labels so its accessible names are unchanged.
   Make it visually distinct (danger color) and separated by a top border in
   the menu.

5. **Count line unaffected.** Keep `shelf-count` copy and the wall's existing
   sort, padding and visible state (`data-testid`s unchanged).

6. **Tests.**
   - `shelf-wall-limit.test.tsx`: open the actions menu, click the Delete
     item, then `.inline-confirm-danger`; the counts must stay identical.
   - `dialog-drag.test.ts`: clamp keeps the window inside the viewport,
     handles inverted ranges (viewport narrower than dialog) and negative
     candidates.
   - `project-tabs.spec.ts` shelf dialog block: keep existing role names;
     add (a) a layout assertion that both tiles' top edges are equal within
     ~1px and the second tile is inside the dialog's box (regression for the
     missing masonry CSS — wait for the previews to settle), (b) × closes the
     dialog, (c) dragging the header with `mouse.down/move/up` moves the
     dialog's bounding box and it stays inside the viewport, and dragging
     far past an edge clamps it.

7. **Docs**: none expected; confirm no spec describes the old layout
   (`grep -rn "shelf" docs/specs` shows no UI contract for this dialog).

## Acceptance

No `.baseline/` directory exists in this checkout; run these on the task
branch and report actual output.

```bash
pnpm format:check          # expected: clean
pnpm typecheck             # expected: no errors
pnpm lint                  # expected: clean
pnpm deadcode              # expected: no new unused exports
pnpm vitest run apps/editor/src/components/shelf-wall-limit.test.tsx apps/editor/src/components/masonry.test.ts apps/editor/src/components/dialog-drag.test.ts
pnpm test:local            # expected: all pass
pnpm build                 # expected: editor builds
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts   # expected: pass (local; starts its own server)
```

Behavioral checks (run the editor, `pnpm dev` or the `:4310` entry):

- With two Projects, both cards start at the same top edge, the second sits
  in the next column, and nothing extends past the dialog's bottom edge; with
  many Projects the columns stay balanced and the body scrolls.
- The × sits at the top right and closes the dialog; Escape still closes it.
- Dragging the header moves the dialog; it cannot be dragged fully out of the
  viewport; the close button still works after a drag; scrolling the body
  with the wheel still works; cards remain clickable.
- Delete in the ••• menu asks a second time and removes the card; Rename,
  Favorite, Duplicate, Export, Version history, and the limit error behave
  exactly as before.
- Narrow window (≤ 700px): one column, header and × usable, drag still
  clamped.

## Notes for the implementer

- No new dependencies (AGENTS.md). CSS and a small hook only.
- Keep every accessible name and test id the e2e relies on: dialog name
  "Cloud Projects", button "Close", `shelf-actions-<id>`,
  `shelf-delete-<id>`, `shelf-count`, `shelf-tile-<id>`, textbox "Project
  name".
- Do not change the sort order, the menu items' semantics, the masonry
  column math, or the private-shelf copy ("N of LIMIT saved · only you can
  see these").
- Drag is pointer-only by design; do not add keyboard move bindings.
