# T152 report

## Summary

The desktop acceptance was run for the first time since T150, in its
unpackaged mode. T150 caused one failure, a stale selector in the script;
with it fixed the script passes on `main`. The owner then deferred all
further desktop work; the open items are in
[the roadmap](../../docs/roadmap/README.md#deferred-desktop-preview-work).
No product code changed.

## What ran and what did not

Machine: macOS arm64, Node 26.7.0, Electron 44.4.2.

- **Not run:** `pnpm --filter @icm/desktop test:preview` as the README
  documents it. It needs the package that `package:preview` assembles, and
  `package-preview.mjs` refuses every platform but Windows x64. Not run on
  Windows by anyone either.
- **Run instead:** the same script with its `--development` flag,
  `cd apps/desktop && node scripts/accept-preview.mjs --development`. It
  launches the unpackaged shell (`apps/desktop/dist/main.mjs` with
  `apps/editor/dist-desktop`) on isolated app data and runs the same 41
  checks in 13 launches. Its `result.json` says `"packaged": false`.
- **Not covered by that mode:** the packaged executable and its resource and
  icon paths (`app.isPackaged`), the Windows `.icproj` association, the
  Windows-only branch of the previous-data migration.
- Build steps first, all exit 0, then the Electron runtime, which was
  missing from `node_modules`; the package's own `install.js` downloaded it:

  ```bash
  pnpm --filter "@icm/editor^..." --if-present build
  pnpm --filter @icm/editor exec vite build --config vite.desktop.config.ts
  pnpm --filter @icm/desktop build:preview
  ```

| Commit                              | Result                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `e97b188`, before T150              | PASS                                                                   |
| `e6d9886`, `main`, script as merged | FAIL at the first step: `summary` with text `Edit` not found, line 192 |
| `e6d9886` with the fix below        | PASS                                                                   |

The failure: to insert a component the script clicked the header's `Edit`
menu, which T150c merged into `⋯`. It now opens `more-menu` and picks
`Insert component… (I)` from the Edit group. That item brings up Draw by
itself, so the Auto default mode needs nothing else.

What T150c and T150d changed in the scripts by reading
(`openLibrary()`, `stripShown()`, renaming through File → Project Info,
`project-unsaved-indicator`, `New project tab` through File) works when run.

## Checked in the running shell

Driven through Playwright's Electron driver in the development shell, with
one native tab (a file opened with Open Project…, the blank tab closed). The
window was resized with `BrowserWindow.setContentSize`.

- **Window size.** The shell's minimum width is 900 px
  (`apps/desktop/src/main.ts`) and it has no zoom (the application menu is
  removed). Widths below 900 cannot be reached in the app; on Windows the
  frame leaves about 884 px of content at the minimum. 801 and 761 px were
  measured by lifting the minimum from the driver.
- **Top bar.** At 1100, 1001, 1000, 941, 940, 901 and 900 px, and at 801 and
  761 px forced, in Auto and in Draw: one row of 44 px, nothing off screen,
  nothing overlapping, File and `⋯` on screen.
- **Project name.** Shown from 1001 px (68 px wide in Auto at 1001 px, with
  an ellipsis; 208 px in Draw). Hidden at 1000 px and below; the wordmark is
  hidden at 940 px and below. In the hidden range the bar has empty room:
  about 94 px in Auto and 240 px in Draw at 901 px.
- **Window title.** `BrowserWindow.getTitle()` equals `document.title`,
  `<project name> — Analog Canvas`, at every width, and follows the active
  tab. The shell uses the default OS frame, so the OS title bar draws it. The
  title bar's pixels were not captured (`screencapture` has no screen
  recording permission on this machine).
- **Tab strip.** Hidden with one native tab; shown with two (File → New
  project tab, or a second file through File → Open file in new tab); hidden
  again after File → Close tab.
- **File → Close tab** on a changed tab shows Save and close / Close without
  saving / Keep open under the top bar, with the strip shown or hidden.
- **File on the desktop** lists `Open file in new tab` and `Open Project…`.
- **Names.** Wordmark `Auto Canvas`; window title suffix and About dialog
  `Analog Canvas`; product and executable name `Analog Canvas Preview`.

## Choices put to the owner, all deferred

1. Project name at 1000 px and below, desktop, one tab:
   - A. The window title is enough; no change.
   - B. Up to 1000 px `Import netlist…` becomes its icon and the wordmark is
     hidden, which leaves the name roughly 150–250 px in a real window; below
     about 800 px Auto Layout's label becomes an icon too. CSS only.
     Recommended by the coordinator.
   - C. The host's `Local projects` and `About` become icons. Needs two new
     icons and loses their text.
2. Desktop File menu: drop `Open file in new tab` and keep `Open Project…`
   (recommended), or keep both.
3. `Analog Canvas` in the window title and the About dialog: leave, or change
   those two texts to `Auto Canvas`. The executable and the data directory
   names would need a migration and are a separate matter.
4. Whether the development-mode run is an accepted record or a packaged run
   on Windows is wanted.

## Acceptance results

```text
node scripts/accept-preview.mjs --development  (e97b188)        → 0; PASS
node scripts/accept-preview.mjs --development  (e6d9886)        → 1; locator.click: Timeout 30000ms, summary /^Edit$/
node scripts/accept-preview.mjs --development  (e6d9886 + fix)  → 0; PASS
```

## Deviations and open questions

- The packaged acceptance the task asked for could not run; see above.
- Seen and not investigated: a file opened with Open Project…
  (a copy of `apps/editor/src/examples/simulation-ota.icproj.json`) is marked
  unsaved at once (not compared with `e97b188`); on a first open the mode
  coach bubble overlaps the close decision.
- `apps/desktop/README.md` links two workflow files that do not exist in
  this repository; left as it is, listed in the roadmap.
