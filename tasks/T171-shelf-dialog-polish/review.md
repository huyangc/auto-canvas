# T171 review

## Round 1 — accepted (small review fixes applied by Opus)

Reviewed: `git diff main` on `task/T171-shelf-dialog-polish`; implementer
commit `5babd4a`, plus two small review fixes made by Opus (below).
Acceptance rerun by Opus from the worktree root.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix (fixed by Opus) | `apps/editor/src/components/dialog-drag.ts:100-110` | The drag offset lived in `useDialogDrag`'s ref inside `ProjectShelf`, which stays mounted while the `<dialog>` unmounts on close. Closing after a drag and reopening therefore left a stale offset: the first drag jumped by the previous offset and clamped against a shifted base rect. | Reset the offset when the dialog element changes (`dragged` ref), and cover reopen-then-drag in the e2e case (movement exactly 20/−10 px, reopened x equals the first open's x). |
| 2 | should-fix (fixed by Opus) | `apps/editor/src/components/shelf-wall.css` (`.shelf-tile-actions`) | Opened from the File menu, the tile ••• button inherits `.command-popover button` (`width: 100%`, menu fonts) and reads as a full-width bar across the card — the pre-existing defect the implementer flagged. | A `.cloud-shelf-dialog .shelf-tile-actions` rule (0,2,0) restating the badge's own box and font, as done for the close button. |

Notes accepted without change:

- `.cloud-shelf-dialog`-qualified chrome selectors instead of the plan's bare
  classes (the File menu popover outranked them) — correct, and the reason is
  documented in the stylesheet.
- Menu arrow-key list filtering `[role="menuitem"]:not([hidden])` so the
  hidden Delete trigger is not a focus dead-end.
- `pnpm deadcode` failing is pre-existing: `node
  tasks/T153-deadcode-cleanup/knip-expect.mjs` exits 0 ("default: 23 expected,
  production: 35 expected, no hints"), i.e. the current findings are exactly
  the T153 catalogue and none is in `apps/editor`.
- The implementer left no `report.md`; its hand-back message was written into
  `report.md` verbatim apart from formatting.

Acceptance rerun:

```text
pnpm format:check                     → exit 0 (also rerun after the review fixes)
pnpm typecheck                        → exit 0
pnpm lint                             → exit 0, 0 errors, 3906 pre-existing warnings
pnpm deadcode                         → exit 1; knip-expect.mjs → exit 0 (T153 baseline, no new findings)
pnpm vitest run …shelf-wall-limit.test.tsx …masonry.test.ts …dialog-drag.test.ts → exit 0, 3 files / 12 tests
pnpm vitest run …dialog-drag.test.ts …shelf-wall-limit.test.tsx (after fixes)       → exit 0, 2 files / 7 tests
pnpm test:local                       → exit 0, 857 files passed / 3 skipped, 8893 tests passed / 117 skipped
pnpm build                            → exit 0 (implementer; unchanged by the review fixes)
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts → exit 0, 23 passed (with the reopen assertion)
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts (after the CSS fix) → exit 0, 23 passed
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts (after the reopen-race fix) → exit 0, 23 passed
```

Known limits carried to the PR:

- Escape with a tile's two-step confirm open closes both the confirm and the
  dialog (pre-existing menu behavior).
- Wheel scrolling, ≤700 px one-column layout and many-Project balance are
  reasoned, not automated; the tile-top/no-overflow geometry is asserted.
- Drag is pointer-only and cosmetic by design; the dialog stays modal.

## Round 2 — accepted (codex PR review findings fixed by Opus)

codex PR review round 1 on `12442f1` reported P0/P1; all four findings were
verified against the code and fixed.

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | P1 | `shelf-wall.tsx` menu Delete | A keyboard activation of another tile's ••• fires no outside pointerdown, so React reused the unkeyed `InlineConfirm` and an open "Really delete" retargeted the second Project, skipping its first step. | `key={menu.project.id}` on the menu's Delete confirm; unit test opens Source's confirm, switches the menu with a `.click()` (no pointerdown), and asserts the new Project's confirm is closed. |
| 2 | P2 | `dialog-drag.ts` | The drag wrote `transform`, which made the dialog the containing block of the tile menu's fixed positioning (menu opened at a dialog-relative spot, clipped by `overflow: hidden`) and left the layout box recentering as the lazy wall loaded. | The drag now pins the dialog (`position: fixed`, explicit `left`/`top`, `inset: auto`, `margin: 0`) and moves layout instead of the transform; a resize listener re-clamps the pinned dialog. The e2e asserts the tile menu still opens at its button after a drag. |
| 3 | P2 | `dialog-drag.ts` | Dragging while the wall was still loading could leave the header offscreen once the tiles grew the dialog. | Follows from fix 2 (top-left stays put as content grows); the reopen-then-drag e2e already waits for the settled wall. |
| 4 | P3 | `dialog-drag.ts` | Window-level `pointerup`/`pointercancel` ended the drag for any pointer. | `finish` ignores events whose `pointerId` is not the dragging one. |

Acceptance rerun after round 2: `pnpm format:check` exit 0, `pnpm typecheck`
exit 0, `pnpm lint` exit 0 (0 errors), targeted vitest exit 0 (7 tests),
`pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts` exit 0 (23 passed),
`pnpm test:local` rerun before commit.

## Round 3 — accepted (codex PR round-2 findings fixed by Opus)

codex PR review round 2 on `c45563d` passed with P2/P3 only; all four were
verified against the code and fixed rather than rebutted.

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | P2 | `dialog-drag.ts` | A dialog dragged near the bottom edge while the wall was still loading grew below the viewport once the tiles arrived; only a window resize re-clamped it. | The pinned dialog is observed with a `ResizeObserver` that re-clamps against the current viewport on growth (and on window resize); the e2e shrinks the viewport around the pinned dialog and asserts it comes back inside. |
| 2 | P2 | `shelf-wall.css` menu | On a very short viewport the clamped menu (seven rows plus the two-step confirm) could extend below the screen, putting Delete out of reach. | `max-height: calc(100dvh - 16px)` with `overflow-y: auto` on the menu. |
| 3 | P3 | `shelf-wall.tsx`/`project-shelf.css` | At a 700px viewport the shelf's 92vw dialog left room for two 250px masonry columns, contradicting the plan's "one column at ≤700px". | `useSingleColumn` (matchMedia `(max-width: 700px)`, guarded for jsdom) passes `minColumnWidth` 701, so the wall falls to one column below the breakpoint; the e2e checks the one-column layout at 700px. |
| 4 | P3 | `shelf-wall.tsx` Delete confirm | The unconditional `setMenu(null)` after a delete closed whichever menu was open, not necessarily the one that asked. | The confirm closes the menu only when it still shows the same Project (functional `setMenu`). |

Also fixed in this round: the `reclamp` callback was missing from the
`useDialogDrag` callback's dependency list (one new lint warning).

Acceptance rerun after round 3: `pnpm format:check` exit 0, `pnpm typecheck`
exit 0, `pnpm lint` exit 0 (0 errors, 3906 pre-existing warnings), targeted
vitest exit 0 (7 tests), `pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts`
exit 0 (23 passed), `pnpm test:local` rerun before commit.

## Round 4 — accepted (codex PR round-3 findings fixed by Opus)

codex PR review round 3 on `b345a4b` passed with P2/P3 only; both were real
and fixed.

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | P2 | `dialog-drag.ts` move handler | A pointer move clamped against the box captured at pointerdown; if the wall finished loading mid-drag, the next move could push the grown dialog offscreen again, and releasing left it there. | Each move re-measures the dialog's current layout box (`layoutRect`) and clamps against it. |
| 2 | P3 | `dialog-drag.ts` / `project-shelf.tsx` | Closing a dragged dialog left `dragged.current` and the resize observer holding the detached element (ProjectShelf stays mounted), and an Escape mid-drag left window listeners live. | `useDialogDrag` returns `{ onPointerDown, release }`; the dialog's ref callback calls `release()` when it is unmounted (React passes null), which stops the drag, disconnects the observer and clears the element and offset. |

Acceptance rerun after round 4: `pnpm format:check` exit 0, `pnpm typecheck`
exit 0, `pnpm lint` exit 0 (0 errors, 3906 warnings), targeted vitest exit 0
(7 tests), `pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts` exit 0 (23
passed, run on ports 4398/4399 because a stale e2e server held 4311),
`pnpm test:local` rerun before commit.

## Round 5 — accepted (codex PR round-4 finding fixed by Opus)

codex PR review round 4 on `1b2ba7f` passed with one P2, which was real and
fixed.

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | P2 | `project-shelf.tsx` dialog ref | The inline ref callback is a new function each render, so React detaches it (calls it with null) and reattaches on every `ProjectShelf` render; a shelf refresh mid-drag therefore ran `release()` and ended the drag, leaving a pinned dialog without clamping. | A stable `useCallback` `attachDialog` (depending on the hook's stable `release`) is passed as `ref`, so cleanup runs only when the dialog really detaches. |

Acceptance rerun after round 5: `pnpm format:check` exit 0, `pnpm typecheck`
exit 0, `pnpm lint` exit 0 (0 errors, 3906 warnings), targeted vitest exit 0
(7 tests), `pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts` exit 0 (23
passed, ports 4398/4399).
