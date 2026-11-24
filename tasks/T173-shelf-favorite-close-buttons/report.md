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

## PR #130 review round 2 — shelf favorite focus

### Summary

A focused heart records its project ID before the favorite PATCH starts. After
React updates the tiles and re-enables the controls, the shelf focuses the
project's current heart, or the Favorites filter if the tile disappeared.
Focusing another control cancels restoration for the rest of the request.

### Steps and review findings

| Step | Status | Notes |
| --- | --- | --- |
| Fix P2 keyboard focus loss | Done | The same post-commit focus handling runs on success and failure. |
| Add regression coverage | Done | Deferred PATCH tests cover a reordered tile, a filtered-out tile, a server error, and a user moving focus elsewhere with and without a subsequent blur. |

### Acceptance results

| Command | Result |
| --- | --- |
| `pnpm format:check` | Exit 0, all matched files use Prettier style |
| `pnpm typecheck` | Exit 0 |
| `pnpm test:local apps/editor/src/components/shelf-wall-limit.test.tsx` | Exit 0, 8 tests passed |
| `pnpm lint` | Exit 0, 0 errors and 3852 warnings |
| `pnpm deadcode` | Exit 0 |
| Plan's component, auto-layout and version-history Vitest run | Exit 0, 147 tests passed across 24 files |
| `pnpm build` | Exit 0 |
| Plan's Close-text scan | Exit 1, zero matches as expected |
| `pnpm test:local` on lane 2 | Exit 0, 8785 tests passed and 116 skipped across 848 passing and 3 skipped files |
| Plan's seven Playwright specs on lane 2 | Exit 0, all 63 tests passed |

The initial sandboxed full suite and Playwright runs exited 1 when local
socket access was denied. Both passed with local access on lane 2.
