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
  mode gets that mode's start (Auto closed, Draw with the Netlist).
- The browser suite runs in Draw through Playwright `storageState`;
  `editor-modes.spec.ts` (28 tests) starts from empty storage and covers
  Auto. `performance.spec.ts` seeds Draw on its own origin.

Commits on `task/T150-two-modes` after the plan (`865426c`): `b1d1947`,
`7285367`, `95e4bd5`, `e11f2f2`, `caa05bf` (implementation), `cd62358`
(review round 1), `6bdf02b`, `aa4fbd1` (review round 2). 39 files,
+4042 / −318; product code under `apps/editor/src` without tests is
22 files, +1459 / −256.

## Acceptance (coordinator's rerun on `aa4fbd1`)

| Command                                            | Result                                      |
| -------------------------------------------------- | ------------------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                        |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                        |
| `pnpm docs:check`                                  | pass                                        |
| `pnpm test:local`                                  | pass: 8606 passed, 117 skipped              |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding         |
| Browser suite, 53 spec files, one worker           | 397 passed, 2 skipped, 4 failed (see below) |

The four failures all pass when rerun, and none is in code this change
touches:

- `user-components.spec.ts:3564`, `:3606`, `:3915` fail in teardown with
  "Route is already handled". On `main`, `:3564` alone fails 8 of 16 runs
  with the same error, so this is an existing race in that spec's fixture.
  On this branch `:3564` failed 2 of 8 in isolation; `:3606` and `:3915`
  passed on rerun.
- `hierarchy.spec.ts:1179` failed once on a size comparison after a zoom
  (15.50 against 16.02, tolerance 0.5). It passed 7 of 7 on rerun and in the
  full run at `caa05bf`. Not compared with `main`.

The full run at `caa05bf`, before the review rounds, was 386 passed,
2 skipped, 0 failed.

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

The implementer saw 12 of the new tests fail on `cd62358` before the round-2
fixes.

## Deviations from the plan

1. Owned paths widened: `use-project-tab-sessions.ts` (round 1),
   `editor-dialogs.tsx` and `editor-dialog-layer.tsx` (round 2),
   `performance.spec.ts`.
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
- The wire from a Cell symbol layout pin bringing up Draw (review item 6) and
  a failed import replacing an open Netlist (item 8) are covered by code and
  a unit test respectively, not by a browser test.
- The per-mode dock memory in `App.tsx` is per session, not per tab: after
  changing tabs, switching mode shows the docks last used in that mode in
  any tab.
