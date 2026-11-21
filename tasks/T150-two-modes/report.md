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
  `editor-modes.spec.ts` (43 tests) starts from empty storage and covers
  Auto. `performance.spec.ts` seeds Draw on its own origin.

Commits on `task/T150-two-modes` after the plan (`865426c`): `b1d1947`,
`7285367`, `95e4bd5`, `e11f2f2`, `caa05bf` (implementation), `cd62358`
(review round 1), `6bdf02b`, `aa4fbd1` (round 2), `0b85f5b`, `e38a56e`,
`c594475` (round 3), `0e8260e` (round 4). 41 files, +4791 / −332; product
code under `apps/editor/src` without tests is 22 files, +1620 / −270.

## Acceptance (coordinator's rerun on `0e8260e`)

| Command                                            | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| `pnpm build`, `pnpm test:editor-build`             | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass (lint 0 errors)                |
| `pnpm docs:check`                                  | pass                                |
| `pnpm test:local`                                  | pass: 8608 passed, 117 skipped      |
| `pnpm deadcode`                                    | exit 1 as on `main`; no new finding |
| Browser suite, 53 spec files, one worker           | 417 passed, 2 skipped, 0 failed     |

Earlier full runs: 386 passed, 0 failed at `caa05bf`; 397 passed, 4 failed
at `aa4fbd1`; 414 passed, 0 failed at `c594475`. Those four passed on rerun and none is in code this change
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

The implementer saw the new tests fail before their fixes: 12 in round 2,
9 in round 3 and 3 in round 4.

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
