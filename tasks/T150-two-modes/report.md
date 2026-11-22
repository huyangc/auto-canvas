# T150 report — slice a: Auto and Draw modes

Written by the coordinator from the implementer's hand-backs and an independent
rerun (a repository hook stops a subagent from writing report files). Slices b
(Cells rail), c (menus into `⋯`) and d (tab strip hidden with one project) are
later PRs from the same plan.

## What was built

- The editor has two modes with an `Auto | Draw` switch in the top bar. It
  opens in Auto unless the browser remembers Draw.
- **Auto**: no drawing toolbar and no device library. The top bar has
  `Import netlist…` and a primary `Auto Layout` control that shows the run
  and its Cancel. An empty Project shows a card: `Choose netlist file…`,
  `Open project file…`, `Start from an example`, `Draw it yourself →`.
  Netlist and Properties are closed until opened from two buttons in the
  canvas corner. Selecting, moving, rotating, deleting and Undo work as
  before, so a layout can be fine-tuned without leaving Auto.
- **Draw**: the page as it was. Undo and Redo moved from the drawing toolbar
  to the top bar (same test ids) so both modes have them.
- **What is remembered** (owner, 2026-11-21): only an explicit choice — the
  switch, or the card's `Draw it yourself →` — is stored
  (`icm.editor-mode.v1`). A drawing key (B, W, T, I, P, L) or a drawing
  command (Insert component…, Place Cell, the Cell Manager's Place, a wire
  from a Cell symbol layout pin) used in Auto brings up Draw for the session
  and does its job, without storing anything. Such a key does nothing behind
  a modal dialog, from inside a dialog, menu or the canvas text editor's
  toolbar, or from the empty card.
- A one-time coach mark under the switch says where Draw is. Any switch
  dismisses it.
- Switching never edits a Document and adds no Undo step. Switching to Auto
  drops an armed tool, a placement, a Net Label being placed and a control
  pick.
- A successful import in Auto leaves the dock closed. Its Import Review
  waits in Properties, marked by a dot on the Properties button, and is not
  put away until it has been shown. A failed import opens the review in
  either mode.
- Project tabs remember their docks per mode: a tab restored in the other
  mode gets that mode's start (Auto closed, Draw with the Netlist). A tab
  also keeps its unseen Import Review in memory while another tab is shown;
  a reload drops it, as on `main`.
- While a code draft (Project Code or the Netlist code) is unapplied, a mode
  switch or a failed import leaves that dock on screen, so the draft is not
  lost. Document settings, which apply live, close on a switch.
- Switching to Auto cancels an armed tool together with what was typed into
  it (an unplaced Text draft, a Net Label name), as Escape does. An existing
  canvas text being edited is committed first, as by any click outside it.
- The browser suite runs in Draw through Playwright `storageState`;
  `editor-modes.spec.ts` (49 tests) starts from empty storage and covers
  Auto. `performance.spec.ts` seeds Draw on its own origin.

Commits on `task/T150-two-modes` after the plan (`865426c`): `b1d1947`,
`7285367`, `95e4bd5`, `e11f2f2`, `caa05bf` (implementation), `cd62358`
(review round 1), `6bdf02b`, `aa4fbd1` (round 2), `0b85f5b`, `e38a56e`,
`c594475` (round 3), `0e8260e` (round 4), `4ada201` (round 5). 41 files,
+4952 / −332; product code under `apps/editor/src` without tests is
22 files, +1664 / −270.

## Acceptance (coordinator's rerun on `4ada201`)

| Command                                            | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                |
| `pnpm docs:check`                                  | pass                                |
| `pnpm test:local`                                  | pass: 8608 passed, 117 skipped      |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding |
| Browser suite, 53 spec files, one worker           | 423 passed, 2 skipped, 0 failed     |

Earlier full runs: 386 passed, 0 failed at `caa05bf`; 397 passed, 4 failed
at `aa4fbd1`; 414 passed, 0 failed at `c594475`; 417 passed, 0 failed at
`0e8260e`. Those four passed on rerun and none is in code this change
touches:

- `user-components.spec.ts:3564`, `:3606`, `:3915` failed in teardown with
  "Route is already handled". On `main`, `:3564` alone fails 8 of 16 runs
  with the same error, so this is an existing race in that spec's fixture.
- `hierarchy.spec.ts:1179` failed once on a size comparison after a zoom
  (15.50 against 16.02, tolerance 0.5) and passed 7 of 7 on rerun. Not
  compared with `main`.

`project-file.spec.ts` is left out of every run: it fails to load on `main`
as well (`import.meta.env.BASE_URL` is undefined through
`cloud-projects → app-url`).

## Browser check by the coordinator

Against a dev server of this worktree (port 5184), Chrome, 1440×900, starting
from an empty profile (`tmp/t150/check-modes.mjs`, not committed):

- First open: Auto, coach mark, import card; the canvas is 88% of the window
  (49% in Draw).
- Importing a 6-device netlist from the owner's case folder in Auto lays it
  out, keeps the dock closed and shows the dot on Properties.
- Select all, rotate and Undo stay in Auto.
- `W` in Auto: Draw with the wire armed, nothing stored; after a reload the
  page is Auto again, with the Netlist closed.
- Clicking `Draw`, then reloading: Draw.
- Clicking `Auto`, pressing `W`, reloading: Auto (the stored value stays
  `auto`).
- A new project tab in Auto opens with both docks closed.
- The top-bar Auto Layout on the two-stage example shows Cancel while it
  runs and ends with "Auto Layout applied".
- 720 and 390 px wide: one top-bar row, card and corner buttons on screen.

## Review rounds

1. **Coordinator's browser check** — in Auto the Netlist reopened through
   project-tab sessions (new tab; reload after a key brought up Draw; a tab
   last captured in Draw). Fixed in `cd62358`: a tab's saved docks apply only
   in the mode they were captured in. `use-project-tab-sessions.ts` was added
   to the owned paths.
2. **Independent reviewer on `e97b188..caa05bf`** — one P1, four P2, eight
   P3, all fixed in `6bdf02b`:
   - P1: an Auto import's Import Review could be cleared before it was seen.
   - P2: the same netlist file could not be imported twice in a row; a Net
     Label being placed survived the switch to Auto; a drawing key switched
     the page from inside the Agent file approval, the selection filter or
     an open menu; the running Auto Layout label pushed the Agent button off
     screen at 1024 px (measured: it ended at 1085 px).
   - P3: wire from a Cell symbol layout pin and placements started from
     dialogs now bring up Draw; a failed import closes the Netlist so its
     review shows; elapsed seconds show at 760 px and below; opening a
     Project resets the other mode's remembered docks; a no-op pointer
     activation removed; the performance spec seeds Draw; focus moves to the
     Draw switch after `Draw it yourself →` and to Cancel when a run starts.
   - The plan's text that still described the superseded "stored mode
     becomes Draw" behaviour was corrected in `aa4fbd1`.

3. **codex review and the independent re-review on `28a663f`** — the
   re-review found all 13 earlier findings fixed and five new P3; codex
   found five P2 and three P3, largely the same items. Fixed in `0b85f5b`:
   an unapplied code draft was lost by a mode switch or a failed import;
   hidden Document settings kept blocking tab changes and saves after a
   switch to Auto; an unseen Import Review was lost on a project-tab switch;
   a report replacing one on screen was marked as waiting; `W` in Cell
   symbol layout ignored the overlay guard; closing the Netlist reopened
   another mode's Properties; placing from User Components stayed in Auto.
   The top bar at 320 and 390 px during a run was measured and needed no
   change. One item was settled without a code change (`c594475`): typed
   text in an armed tool is cancelled with the tool on a switch to Auto,
   under decision 16; the spec says so and two browser tests pin it.

4. **codex round 2 and the independent pass on round 3, both on `ddcdd5b`** —
   fixed in `0e8260e`: at 390 and 720 px wide the open dock covered Auto's
   two canvas buttons, so a pointer user could not close it (reproduced by
   the coordinator; rechecked after the fix at 390, 720 and 1000 px); a
   project dock other than the Netlist had no control in Auto — the first
   canvas button now carries the open dock's name, reads as pressed and
   closes it; one test could pass before its second import landed; the
   spec's "switching never changes a Document" sentence is qualified.
   Not changed: codex asked for a guard before Auto's Properties or Netlist
   button discards an unapplied code draft. A user's own close of such a
   dock is unguarded on `main` in Draw too (read from the code, not
   exercised on `main`); a confirmation would change both modes and belongs
   in its own task.

5. **codex round 3 on `16b5191`** — fixed in `4ada201`: the card's example
   action replaced a clean Project while a code draft was unapplied (it now
   honours the same Project hold as the other open paths); a dock kept on
   screen only for a draft was saved as that mode's remembered docks; at
   320–480 px the Edit and Circuit popovers ran off the right edge
   (measured by the coordinator: 185…488 in a 390 px window; after the fix
   75…378). Not changed: codex asked for dock memory per tab and per mode;
   it stays per session, as decided in round 1 — it carries a preference
   over, it loses no work. The card's `Choose netlist file…`,
   `Open project file…` and the top bar's `Import netlist…` do not check
   for an unapplied code draft; the File-menu paths they mirror do not
   either on `main` (read from the code).

The implementer saw the new tests fail before their fixes: 12 in round 2,
9 in round 3, 3 in round 4 and 3 in round 5.

## Deviations from the plan

1. Owned paths widened: `use-project-tab-sessions.ts` (round 1),
   `editor-dialogs.tsx`, `editor-dialog-layer.tsx` and `performance.spec.ts`
   (round 2), `user-components.spec.ts` (round 3).
2. The dot on the Properties button for a waiting Import Review is new; the
   wireframe did not have it.
3. In Draw, an import whose dock opens on the Netlist now also keeps its
   review until Properties has shown it.
4. `drawing-toolbar.test.tsx` and `editor-statusbar.test.tsx` changed because
   Undo/Redo and Cancel moved; the hierarchy server-render test in
   `App.test.tsx` passes `initialEditorMode="draw"`.

## Not covered

- Electron and the desktop file chooser were not tried.
- `performance.spec.ts` was not run (it needs `ICM_PERF`).
- The wire from a Cell symbol layout pin bringing up Draw has no browser
  test; its overlay guard has a unit test.
- While a code draft is unapplied, Auto can show the Netlist or Project Code
  dock after a switch. That is the price of not losing the draft.
- The per-mode dock memory in `App.tsx` is per session, not per tab: after
  changing tabs, switching mode shows the docks last used in that mode in
  any tab.

# T150 report — slice b: Cells rail with statuses

Written by the coordinator from the implementer's hand-backs and an
independent rerun. Slice a is merged (`bda24ec`); slices c and d follow.

## What was built

- **Cells rail.** In Auto mode, a Project with two or more Cells shows a
  190 px column on the left listing every Cell, top Cell first, each with a
  status: `not laid out` with the reason (the last finished Auto Layout run
  in this tab refused the Cell and it has not changed since), `laid out`
  (it has routes), `as imported`, or `not laid out`. A row opens its Cell.
  The rail is not shown with one Cell, in Draw, or below 860 px wide, where
  the hierarchy row stays as before.
- The refusal reasons are kept in memory per tab and per Project opened in
  it (`use-cell-layout-outcomes.ts`); nothing is written to the Project.
  Only a verdict the planner returned is recorded, and the run itself names
  the tab it belongs to when its result arrives. A cancelled, failed, stale
  or abandoned run leaves the statuses as they were; Details still says
  what happened. An
  edit to a refused Cell drops its reason; Undo does not bring it back,
  because revisions only go up.
- **Five leftovers from slice a's last codex review:**
  - A dock kept on screen only for an unapplied code draft is no longer
    saved with the tab as that mode's own.
  - A drawing key pressed inside the Shelf picker no longer brings up Draw.
  - Focus moves to Cancel only when the Auto Layout button itself started
    the run, so Space or Enter after an import from the card no longer
    cancels the layout.
  - The Properties button advertises `Q`, and the first canvas button `N`,
    only when the key would do what the button does.

Commits on `task/T150b-cells-rail`: `ed24e03` (leftovers), `cf564cc` (rail),
`1f1a681` (review round 1), `e4c221c` (round 2). 21 files, +1468 / −17;
product code under `apps/editor/src` without tests is 10 files,
+457 / −14.

## Acceptance (coordinator's rerun on `e4c221c`)

| Command                                            | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                |
| `pnpm docs:check`                                  | pass                                |
| `pnpm test:local`                                  | pass: 8626 passed, 117 skipped      |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding |
| Browser suite, 53 spec files, one worker           | 427 passed, 2 skipped, 0 failed     |

Earlier full runs: 426 passed, 0 failed at `cf564cc`; 426 passed, 1 failed
at `1f1a681`. That failure was `hierarchy.spec.ts:1179` (a size comparison
after a zoom: 15.50 against 16.02, tolerance 0.5), which is flaky on the
code from before T150 as well: 5 of 10 runs fail there with the same
numbers, 3 of 10 on this branch.
`project-file.spec.ts` is left out as before (it fails to load on `main`).

## Browser check by the coordinator

Against a dev server of this worktree (port 5184), Chrome, 1440×900:

- Importing the owner's two-subcircuit case shows the rail with `top (top)`
  and `stage`, both `laid out`; the canvas is 76% of the window (88% with
  one Cell).
- Clicking `stage` opens it ("Opened Cell stage") and moves the highlight.
- No rail with a one-Cell import, in Draw, or at 800 px wide.
- A 44-character Cell name is clipped inside the row; the rail does not
  scroll sideways.
- Space pressed right after an import from the card does not cancel the
  layout.

The `not laid out` with a reason state (a Cell over 120 parts) was not
driven by hand; the browser test covers it.

## Review

Independent reviewer on `bda24ec..cf564cc`: approve with fixes, no P1 or
P2. Fixed in `1f1a681`: the draft carry-over flag could survive a tab
switch and make another tab lose a dock's open state. Not reproduced: a
long Cell name widening the rail (rendered and measured; an assertion was
added). Three test gaps closed: the `Q` rule as a tested helper, focus
tests that fail on the old code, and the outcome store driven by the real
controller.

codex on `856abf2`: two P2 in the rail's outcome store, both reproduced by
the implementer with the real session and controller and fixed in
`e4c221c`: a result landing in the same commit as a tab switch was
recorded against the incoming tab; a run left by a tab switch was recorded
as refusals for Cells the planner never judged. Not changed: its P3 about
shortcut hints during a drag (a tooltip cannot be read mid-drag).

## For the owner

By decision 18 a refusal outranks `laid out`: if a manual run times out on
a Cell that is already drawn, the rail shows `not laid out` with the reason
over a routed drawing, until the Cell changes.

## Not covered

- The rail between 860 and 1100 px was not checked by hand.
- Electron was not tried.

# T150 report — slice c: one ⋯ menu and the project name in the top bar

Written by the coordinator from the implementer's hand-backs and an
independent rerun. Slices a and b are merged (`0c07eae`); slice d follows.

## What was built

- The Edit and Circuit header menus are one `⋯` menu
  (`data-testid="more-menu"`) with the groups Edit, Hierarchy, Netlist and
  Layout. Every item keeps its text, test id, enabled condition and
  handler; nothing was dropped.
- The top bar reads: brand, project name, Undo/Redo, `Auto | Draw` on the
  left; `Import netlist…` (Auto only), `Auto Layout`, `File`, `Agent`, `⋯`
  on the right. File moved from the left group to the right with the same
  contents; its popover now hangs from the right.
- The project name is a button that opens Project Info. It shows
  "Untitled" for a blank name, carries a decorative copy of the unsaved
  dot, and is hidden at 720 px and below. When the row is tight the name
  is what shrinks (down to 3rem, with an ellipsis); the controls keep
  their size.
- The shared browser fixture `openMenu` maps every non-File menu name to
  `⋯`. A table-driven browser test walks decision 21's table in both
  modes, so a dropped item fails it.

Commits on `task/T150c-menus`: `150154d` (implementation), `029f77e`
(review round 1), `5c3f4bf` (round 2), `b338ecd` (round 3), `6737342`
(round 4). 19 files, +1377 / −147; product code under `apps/editor/src`
without tests is 6 files, +293 / −95.

## Acceptance (coordinator's rerun on `6737342`)

| Command                                            | Result                                      |
| -------------------------------------------------- | ------------------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                        |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                        |
| `pnpm docs:check`                                  | pass                                        |
| `pnpm test:local`                                  | pass: 8628 passed, 117 skipped              |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding         |
| Browser suite, 53 spec files, one worker           | 439 passed, 2 skipped, 1 failed (see below) |

The one failure is `hierarchy.spec.ts:1179` (a size comparison after a
zoom: 15.50 against 16.03, tolerance 0.5), the test that is flaky on the
code from before T150 as well (5 of 10 runs fail there with the same
numbers; see slice b). Earlier full runs: 431 passed, 0 failed at
`150154d`; 432 passed, 0 failed at `029f77e`; 436 passed, 0 failed at
`5c3f4bf`. `project-file.spec.ts`
is left out as before (it fails to load on `main`).

## Browser check by the coordinator

Against a dev server of this worktree (port 5184), Chrome:

- At 1440 px in both modes and at 390 px in Auto the bar is one 44 px row
  in the order above; the old Edit and Circuit menus are gone.
- `⋯` shows the four groups; `Auto Layout` from it lays the example out;
  `Insert component…` from it in Auto brings up Draw and opens the dialog.
- The `⋯` and File popovers lie inside the window at 1440 and 390 px.
- Long project name (110 characters), Auto mode, before and after the
  review fix:

  | Width | Name before | Auto Layout button before | Name after | Button after |
  | ----- | ----------- | ------------------------- | ---------- | ------------ |
  | 800   | 208 px      | 26 px, label cut          | 99 px      | 122 px       |
  | 900   | 208 px      | 122 px                    | 199 px     | 122 px       |
  | 1024  | 208 px      | 122 px                    | 197 px     | 122 px       |
  | 1280  | 208 px      | 122 px                    | 208 px     | 122 px       |

## Review

Independent reviewer on `0c07eae..150154d`: approve with fixes. It compared
the old menus with `⋯` item by item and decision 21's table row by row and
found no difference. One P2, reasoned from the CSS and confirmed by the
coordinator's measurement above: a long project name did not give way, so
between about 761 and 890 px in Auto the Auto Layout button was squeezed to
its icon. Fixed in `029f77e`: from 721 px up the brand group's items sit in
the bar's own row and the name alone shrinks while idle; during a run the
long label is cut with an ellipsis once the name is at its floor. Two doc
nits fixed (`apps/desktop/README.md`, the header list in the user guide).

codex on the report commit after `029f77e`: one P2 and two P3, fixed in
`5c3f4bf`.

- **`⋯` ran off screen in a narrow desktop window.** The implementer ran
  the desktop entry's dev server and measured it: in Auto, from 761 to
  about 950 px wide, the right edge of `⋯` lay past the window (937 in a
  901 px window with a short name, 948 with a long one). The desktop host
  adds "Local projects" and "About" to the bar. Now a bar with host
  controls hides the project name up to 1000 px and the wordmark up to
  940 px, and only then lets the actions shrink; `⋯`, File, the switch,
  Undo/Redo and the Auto Layout button stay. Measured after the fix at ten
  widths from 721 to 1100 px: `⋯` inside the window, one 44 px row. These
  desktop numbers are the implementer's; the coordinator did not repeat
  them. The committed browser test uses doubles of the host's two buttons
  on the web page, because the Playwright config serves only the web
  entry.
- The slice's `min-width: 721px` rules left a gap for a fractional
  viewport between 720 and 721 px (browser zoom); they are range queries
  now.
- `Cancel Auto Layout` inside `⋯` has a browser test in both modes.

The web bar is unchanged by `5c3f4bf`; the coordinator's measurements in
the table above were repeated on it with the same numbers.

codex on `e064609`: one P1 and one P2, both verified in the code by the
coordinator and fixed in `b338ecd`.

- **P1: the desktop acceptance script still opened `edit-menu`**
  (`apps/desktop/scripts/accept-local-components.mjs`), so the documented
  desktop `test:preview` flow would time out before User Components. The
  script now opens `⋯` and picks User Components… from its Edit group. A
  search of the whole repository found no other consumer of the removed
  menu ids. The coordinator's brief and the independent review had both
  looked only under `apps/editor`.
- **P2: Up and Down panned the canvas instead of scrolling the open `⋯`
  menu.** The router's exemption covered only File; it covers both menus
  now.

codex on `b338ecd`: one P2, fixed in `6737342`: the new exemption also
matched a closed `⋯` button with keyboard focus, so Escape no longer
cancelled an armed tool from there. Both menus are exempt only while open.
File had the same gap on `main`, fixed in the same line.

## Deviations from the plan

1. `chrome-isolation.spec.ts`: its row check named the left group, which
   now holds only the brand; it measures the whole row in order instead.
2. `docs/user/schematic-hierarchy.md` and one line of
   `apps/desktop/README.md` named the old menu paths and were updated.
3. From 721 px up the gap between the brand, the name, Undo/Redo and the
   switch is the bar's gap, not the group's smaller one.

## Not covered

- Electron was not tried; the desktop bar was measured by the implementer
  in a browser against the desktop entry's dev server, not in the app.
- The desktop acceptance (`pnpm --filter @icm/desktop test:preview`) was
  not run by anyone: it needs the packaged app. Only the three changed
  calls of its `openLibrary()` were driven, by the implementer, against the
  desktop entry's dev server in both modes; the rest of that script
  (create, save to library, place, export) was not exercised.
- Rows of the decision table the browser walk skips, because the fixture
  state lacks them: Revert, Recover, RNL…, desktop file commands, Cancel
  Auto Layout. Open Shelf project in tab and the empty card have their own
  tests.

# T150 report — slice d: the tab strip is hidden with one project

Written by the coordinator from the implementer's hand-backs and an
independent rerun. Slices a, b and c are merged (`1515168`); this is the
last slice of T150.

## What was built

- With one project tab the tab strip row is not shown, in both modes; the
  canvas gains its 30 px. With two or more tabs the strip is there as
  before. `ProjectTabs` stays mounted, so its close decisions, tab menu
  and Shelf dialog keep working.
- File holds what the strip offered: `New project tab`,
  `Open file in new tab`, `Open Shelf project in tab ›` (with Cloud) and
  `Close tab`, with any number of tabs. They use the strip's own handlers
  and are disabled when the strip's controls are.
- With one tab a project is renamed through File → Project Info or the
  top-bar name; its unsaved mark is File's dot and the top-bar name's dot.
- File's submenus (Shelf, Import, Export) collapse when File closes, so
  the Shelf reloads its list each time it is opened.
- No arrow key reaches the canvas from an item of an open File or `⋯`
  menu (Left and Right were the leftover from slice c).
- Browser tests reach the strip's actions through `projectTabAction`,
  which uses the strip when it is visible and File otherwise; about 45
  single-tab call sites were switched, listed in the plan notes.

Commits on `task/T150d-tab-strip`: `0b9e29f` (implementation), `fd041cd`
(review round 1). 21 files, +1248 / −136; product code under
`apps/editor/src` without tests is 6 files, +232 / −36.

## Acceptance (coordinator's rerun on `fd041cd`)

| Command                                            | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                |
| `pnpm docs:check`                                  | pass                                |
| `pnpm test:local`                                  | pass: 8638 passed, 117 skipped      |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding |
| Browser suite, 53 spec files, one worker           | 447 passed, 2 skipped, 0 failed     |

The full run at `0b9e29f` was 443 passed, 0 failed. `project-file.spec.ts`
is left out as before (it fails to load on `main`); the implementer ran a
copy with its one failing import inlined, 8 of 8 passed.

## Browser check by the coordinator

Against a dev server of this worktree (port 5184), Chrome, 1440×900:

| Mode | Tabs | Strip  | Canvas top | Canvas height |
| ---- | ---- | ------ | ---------- | ------------- |
| Auto | 1    | hidden | 45         | 819           |
| Auto | 2    | shown  | 75         | 789           |
| Draw | 1    | hidden | 82         | 782           |
| Draw | 2    | shown  | 112        | 752           |

- File → `New project tab` brings the strip back; closing to one tab hides
  it again.
- The top-bar name opens Project Info and shows the new name after a
  rename.
- Left and Right from an item of the open File menu leave the canvas
  `viewBox` unchanged.
- File → `Close tab` with one edited project shows the strip's own
  decision ("Close without saving" / "Keep open") and leaves one blank
  project.
- Import expanded, File closed and reopened: Import is collapsed.

The implementer measured the same numbers on the desktop entry's dev
server; the coordinator did not repeat that.

## Review

Independent reviewer on `1515168..0b9e29f`: approve with fixes, one P2
and several P3, all handled in `fd041cd`.

- **P2: File's Shelf submenu stayed expanded after File closed and showed
  a stale list on reopen.** Fixed by collapsing File's submenus when File
  closes; Import and Export had the same leftover on `main`.
- **Is File → New Project the same as closing the single tab?** The first
  version relied on it. The reviewer traced differences; the implementer
  then ran both on the same steps:

  |                  | Tab × on `1515168`                                                                        | File → New Project                                                 |
  | ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
  | 1 part placed    | asks "Close without saving / Keep open"                                                   | no prompt                                                          |
  | 12 parts         | the same prompt                                                                           | asks "Continue without saving / Stay / Save to Cloud and continue" |
  | after not saving | the work stays as a recovery copy, offered by File → Recover Unsaved Work… after a reload | the recovery copy is deleted                                       |

  They differ, so File got `Close tab`, which runs the active tab's own
  close.

- The spec said a close decision ends when the strip hides; the code
  keeps it answerable. The spec was corrected.
- Two browser tests for the hide transition were added. A rename in a tab
  is always committed by the click or blur that leads to the hide, so
  "the strip hides under a rename in progress" is covered by the jsdom
  test only.
- `accept-preview.mjs`: `stripShown` waits for a settled tab count.

## Open decision for the owner

On the desktop, File lists both `Open file in new tab` and the host's
`Open Project…`; both call `openNativeProject()`. The plan names that
handler for the new item, so both are kept until the owner decides.

## Deviations from the plan

1. The plan counted 19 strip references in 7 spec files; hiding the strip
   also hides its tabs from role queries and the `renameProject` fixture,
   so about 45 single-tab call sites in 11 files changed.
2. `Close tab` in File is not in the plan (see Review).
3. `apps/desktop/scripts/accept-preview.mjs` was edited: its rename, its
   Unsaved check and its `New project tab` click go through File when the
   strip is hidden.
4. A pending close decision disappears when the active tab changes, with
   the strip shown or hidden; that predates this slice and is unchanged.

## Not covered

- The Electron acceptance (`pnpm --filter @icm/desktop test:preview`) has
  not been run by anyone in T150. `accept-local-components.mjs` (slice c)
  and `accept-preview.mjs` (this slice) were edited by reading; only their
  changed calls were driven against the desktop entry's dev server.
- `performance.spec.ts` was not run (it needs `ICM_PERF`).
