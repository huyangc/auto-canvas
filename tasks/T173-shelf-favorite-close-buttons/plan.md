# T173 — Shelf heart favorites, × close on every web dialog, compact rename buttons

- Branch: `task/T173-shelf-favorite-close-buttons`
- Base: `main` at `c5f1678`
- Status: approved
- Plan review: skipped at the owner's standing instruction (T171, 2026-11-23:
  codex plan review only when the owner asks). Scope confirmed by the owner
  2026-11-23: × applies to all web dialogs listed below (desktop-only
  `hosts/native-*` dialogs untouched); favorites filter is an
  `All | ♥ Favorites` segmented toggle.

## Goal

Three pieces of polish the owner asked for on the Shelf (Browse Cloud
Projects) and its dialogs:

1. **Favorite is a heart next to the circuit name** on every shelf tile:
   outline grey ♡ when off, filled red ♥ when on; clicking toggles it. The
   `Favorite` / `Remove favorite` item leaves the ••• menu. The wall gets an
   **`All | ♥ Favorites`** segmented toggle on the count line; Favorites shows
   only hearted circuits.
2. **Every web dialog closes with a small × at its top right**, not a
   full-width / footer `Close` text button. In the screenshot the Version
   history dialog shows both a mangled × (top-left, over the title) and a
   full-width Close bar.
3. **Inline forms use real, compact buttons**: the shelf Rename form shows the
   name input, then `Save` (primary) and `Cancel` side by side on one row,
   styled as buttons (border, padding, auto width), not full-width bars.

## Context

Verified at `c5f1678`.

**Why buttons render as full-width bars (root cause for 2 and 3).**
`apps/editor/src/styles/editor-chrome.css:764-779` styles
`.command-popover button` with `display:inline-flex; width:100%;
min-height:32px; text-align:left; padding:0 10px; border:transparent` etc.
When the shelf is opened from the File menu (`file-command-menu.tsx:285`),
the `<dialog class="cloud-shelf-dialog">` and the VersionHistoryDialog
(rendered inside the wall, a `showModal()` dialog — top layer, but still a
DOM descendant of `.command-popover`) inherit that rule. T171 patched one
button with a dialog-qualified override
(`shelf-wall.css`, `.cloud-shelf-dialog .shelf-tile-actions`). That
whack-a-mole is what made the rename buttons and the version-history ×
(`version-history-dialog.css:286-299`, `position:absolute; right:0`, but
`width:100%` from the popover rule) look wrong. Other overrides of that rule
exist at `editor-chrome.css:813, 848, 924, 929, 1032`.
Preferred fix: stop the popover rule at the shelf dialog boundary, e.g.
`.command-popover button:not(:where(.cloud-shelf-dialog *))` (`:where` keeps
specificity at (0,1,1) so later overrides keep winning) — apply the same
exclusion to every `.command-popover button…` selector that would otherwise
reach into the dialog (incl. `:disabled` at 1032), then delete the T171
`.cloud-shelf-dialog .shelf-tile-actions` override if it becomes redundant.
Verify both hosts: File menu → Browse Cloud Projects, and the tab-strip
Shelf (`project-tabs.tsx:340`).

**Shelf wall** — `apps/editor/src/components/shelf-wall.tsx` (593 lines),
styles `shelf-wall.css`.
- Tile: `.shelf-tile-wrap` > `<a class="shelf-tile">` (preview + `.shelf-tile-copy`
  with `.shelf-tile-name`, `:381-398`) + ••• button `:399-418` + rename form
  `:419-467`. The name currently prefixes `★ ` when favorited (`:383-385`).
- The heart must NOT be nested in the `<a>` (interactive content in a link).
  Make it a sibling `<button>` placed at the right end of the name row
  (absolute within the wrap, or restructure the copy block so the name row is
  a flex row outside the anchor while the card stays one click target);
  reserve space so a long name never runs under the heart.
- Favorite toggling: `act(project, "favorite")` `:213-275` calls
  `setShelfFavorite` and `replaceSummary`. Reuse it. Note `act` early-returns
  while `busyId` is set and calls `setMenu(null)` first — fine.
- Menu item to remove: `:560-567`.
- Sort: favorites first then updatedAt (`:360-366`) — keep.
- Count line `:352-354`.
- Rename form `:419-467`; CSS `shelf-wall.css` `.shelf-rename-form`.
- Tests: `shelf-wall.test.tsx`, `shelf-wall-limit.test.tsx:69`
  (`action("Favorite")` via the menu — must move to the heart).
- API: `setShelfFavorite` in `features/editor-shell/cloud-projects.ts`;
  server `PATCH /api/projects/:id {favorite}` (docs/specs/server.md:76). No
  server change.

**Dialogs with a text Close** (web; all in scope):

| File | Close today | Existing header |
| --- | --- | --- |
| `components/version-history-dialog.tsx:135-141` (×) and `:230-234` (footer Close) | both | `.version-history-header` |
| `features/netlist-export/netlist-preflight-dialog.tsx:216-223` footer, `data-testid="check-report-close"` | footer | `.netlist-preflight-header` `:104` |
| `features/auto-layout/auto-layout-report.tsx:128-134` footer, `data-testid="auto-layout-report-close"` | footer | `.editor-action-dialog-header` `:86` |
| `features/search/project-search-dialog.tsx:46-48` header text "Close" (`aria-label="Close search"`) | header | `<header>` `:41` |
| `features/selection/selection-filter-popover.tsx:87-92` header text "Close" | header | `<header>` `:81` |
| `features/editor-shell/change-log.tsx:54-56` `<form method="dialog">` submit | footer | `.editor-action-dialog-header` `:42` |
| `components/recent-recovery-dialog.tsx:140-146` header text "Close", `ref={closeRef}` (initial focus) | header | `.help-dialog-header` `:134` |
| `components/chunk-load-fallback.tsx:95-99` footer, only when `close` exists | footer | `.editor-action-dialog-header` `:78` |

Already ×: the Cloud Projects dialog (`project-shelf.tsx:86-98`, styles
`project-shelf.css:52-82` `.cloud-shelf-close`), the Agent dialog.
Out of scope: `hosts/native-*` (desktop; owner deferred desktop work), and
footers whose buttons are real choices (Cancel/Apply, Restore, Keep it …) —
only the pure dismiss button changes.

**Tests that name these buttons** (must be updated, not deleted):
`e2e/runtime-crash-safety.spec.ts:114`, `e2e/chrome-isolation.spec.ts:50`,
`e2e/netlist-workflows.spec.ts:715` (testid), `e2e/project-tabs.spec.ts:1325,
1544, 1708, 1726, 1740` (`name:"Close", exact:true` — check which dialog each
is), `e2e/selection-and-find.spec.ts:189,213,254`,
`e2e/label-editing.spec.ts:120`, `e2e/recovery-dialog.spec.ts:218`,
`src/features/auto-layout/auto-layout-report.test.tsx:43` (testid),
`src/notebook/version-history-preview.test.tsx`. `e2e/user-components.spec.ts`
`button(dialog,"Close")` calls — Investigate whether any target an in-scope
dialog; native library dialogs stay.

## Scope

Owned paths:

- `apps/editor/src/components/shelf-wall.tsx`, `shelf-wall.css`,
  `shelf-wall.test.tsx`, `shelf-wall-limit.test.tsx`
- `apps/editor/src/components/version-history-dialog.tsx`, `.css`
- the seven other dialog files in the table and their CSS
- a new shared component, e.g. `apps/editor/src/components/dialog-close-button.tsx`
  (+ CSS imported by it or by `styles/editor-entry.css`)
- `apps/editor/src/styles/editor-chrome.css` (popover button scoping only)
- `apps/editor/src/features/editor-shell/project-shelf.tsx`/`.css` (only to
  reuse the shared × if natural)
- the tests listed above
- `docs/specs/editor-interaction.md` (one line each: shelf heart/filter; web
  dialogs dismiss with a top-right ×)

Out of scope: server, `cloud-projects.ts` API, `hosts/native-*`, desktop,
other menu items or sort order.

## Steps

1. Scope `.command-popover button…` rules so they do not reach inside
   `.cloud-shelf-dialog` (see Context). Remove overrides that become dead.
   Check File-menu items themselves are unchanged (screenshot or computed
   style before/after).
2. Add a shared `DialogCloseButton` (`type="button"`, text `×`,
   `aria-label` passed in, default `"Close"`, optional `data-testid`,
   `disabled`, forwarded ref). Style: 28×28, no border, muted colour, accent
   soft hover, focus-visible outline — same look as `.cloud-shelf-close`.
   Its CSS must load wherever the dialogs load (lazy chunks included).
3. Each dialog in the table: put the × at the top right of its header
   (header becomes a flex row: title block left, × right), delete the text
   Close / footer Close; delete a footer that becomes empty. Keep existing
   `aria-label`s and `data-testid`s on the × (move `check-report-close`,
   `auto-layout-report-close` to it). Keep Escape/backdrop behaviour and
   initial focus (`recent-recovery-dialog` `closeRef`). `change-log` loses its
   `form method="dialog"`; the × calls the dialog's close.
   `chunk-load-fallback`: × only when `close` exists. Version history: × must
   still respect `disabled={busy}`.
4. Shelf heart: sibling button per tile, `aria-pressed={!!favorite}`,
   `aria-label` `Favorite <name>`, `data-testid="shelf-favorite-<id>"`, ♡/♥
   (red: use `--icm-error` or a dedicated red token; filled when on), disabled
   while `busyId`; calls `act(project,"favorite")`. Remove the ★ prefix and
   the menu item.
5. Favorites filter: local state `"all" | "favorites"` (not persisted),
   segmented `All | ♥ Favorites` buttons with `aria-pressed` on the count
   line (right side). Favorites view filters `state.projects` before Masonry;
   if empty show `No favorites yet — click ♡ next to a circuit's name.`
   Count line keeps `N of limit saved…`.
6. Rename form: input full width on its own row; below, `Save` (primary:
   accent background, white text) and `Cancel` (secondary) in one row,
   right-aligned, auto width, ~28px tall. Keep submit/Escape/focus behaviour.
   Update `project-tabs.spec.ts` only if it used "Save name".
7. Update the tests listed in Context; add unit coverage: heart toggles via
   PATCH and `aria-pressed` flips; menu no longer has Favorite; filter shows
   only favorites and the empty message; version history has no text Close
   and its × closes.
8. Docs: the two spec lines.

## Acceptance

No `.baseline/`; run on the task branch and report actual output.

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm deadcode
pnpm vitest run apps/editor/src/components apps/editor/src/features/auto-layout apps/editor/src/notebook/version-history-preview.test.tsx
pnpm test:local            # all pass
pnpm build
pnpm test:e2e apps/editor/e2e/project-tabs.spec.ts apps/editor/e2e/selection-and-find.spec.ts apps/editor/e2e/recovery-dialog.spec.ts apps/editor/e2e/chrome-isolation.spec.ts apps/editor/e2e/runtime-crash-safety.spec.ts apps/editor/e2e/label-editing.spec.ts apps/editor/e2e/netlist-workflows.spec.ts
grep -rnE '>\s*Close\s*<|^\s*Close\s*$' apps/editor/src --include='*.tsx' | grep -v hosts/native   # expected: no in-scope hits
```

Behavioral checks (both shelf hosts: File → Browse Cloud Projects, and the
tab-strip Shelf):

- Each tile shows ♡ right of its name; clicking turns it red ♥ and back;
  the card link still opens the Project; ••• menu has no Favorite.
- `♥ Favorites` shows only hearted tiles; `All` shows all; empty message
  when none.
- Version history from the ••• menu: × at top right, not overlapping the
  title; no bottom Close; × and Escape close it.
- Rename: input, then compact `Save` / `Cancel` side by side.
- File menu items themselves look unchanged.
- Each other dialog in the table opens with a top-right × that closes it.

## Notes for the implementer

- Product code in this repo: follow AGENTS.md and CODING_STANDARDS.md.
- Do not add a new global `button` reset; fix the leak at its source.
- Screenshot before/after of the shelf tile, rename form and version
  history (both hosts) into `tasks/T173-shelf-favorite-close-buttons/` tmp
  evidence or describe in the report.
