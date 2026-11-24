# T173 report — round 1 (Opus implementer subagent)

Commit: one implementation commit on `task/T173-shelf-favorite-close-buttons`.

- Leak fix: `.command-popover button…` (editor-chrome.css) and `.project-tabs button…`
  / `.project-tabs-shelf …` (project-tabs.css) get `:not(:where(.cloud-shelf-dialog *))`;
  T171's `.cloud-shelf-dialog .shelf-tile-actions` override and the restated
  `.cloud-shelf-close` rules removed as dead.
- Shared `DialogCloseButton` (+ `.dialog-header-with-close`), CSS loaded last from
  `styles/editor-entry.css`.
- Top-right × replaces the text/footer Close in version history, Check Report,
  Auto Layout report, Find in Circuit, selection filter, Change Log, Recover recent
  work, chunk-load fallback (× only when closable); Cloud Projects dialog reuses it.
  Test ids and aria-labels moved to the ×.
- Shelf tile heart (sibling of the card link, subgrid name row), `aria-pressed`,
  red ♥ when on; Favorite removed from the ••• menu; `All | ♥ Favorites` filter
  (unsaved) with an empty-state line.
- Rename: input row, then compact `Save` (primary) / `Cancel`.
- Tests: shelf-wall-limit (heart, filter, menu, rename buttons), version-history
  preview, auto-layout report; project-tabs e2e `Keep it` → `Cancel`.
- Docs: two bullets in docs/specs/editor-interaction.md.

Investigate: user-components.spec `Close` calls target the User Components library
(already ×, untouched) except :3924 (chunk fallback, still named "Close", passes).

Deviation: `features/editor-shell/project-tabs.css` edited (not an owned path) — the
tab-strip Shelf host had the same leak.

Known limits: un-hearting in the Favorites view removes the tile at once; filter
resets to All per open; heart layout uses CSS subgrid.
