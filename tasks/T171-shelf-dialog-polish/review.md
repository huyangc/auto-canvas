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
