# T150 — Two editor modes: Auto (default: import, lay out, fine-tune) and Draw (today's page), with a first-open pointer to Draw

- Branch: `task/T150-two-modes`
- Base: `main` at `e97b188`
- Status: approved

## Goal

The page serves two kinds of users. People who import a netlist and want it
drawn automatically are the main group. People who draw by hand are the other.
After this task the editor has two **modes** behind one switch in the top bar,
`Auto | Draw`.

- **Auto mode is the default.** The canvas takes most of the page. A Cells rail
  lists every Cell with its layout status. The top bar has `Import netlist…`
  and a primary `Auto Layout` button, which shows its progress and Cancel in
  place while a run plans. With nothing in the Project, the canvas shows an
  import card.
- **Draw mode is today's page, tidied.** It has the drawing toolbar, the device
  library and the panels, plus the same `Auto Layout` button.
- **First open.** The first time a browser opens the page, a one-time bubble
  points at the switch and says where manual drawing is.

Everything is built from functions that already exist. Features that are not
built yet (the backlog table at the bottom of `design/proposal-v2.html`) are
out of scope.

## Decisions

Each item is marked with where it comes from:

- **owner**: approved by the owner ("按这版做"), or answered by the owner on
  2026-11-21.
- **coordinator's default**: proposed in v2 and not objected to.
- **coordinator accepted**: the plan recommended it because the code forces a
  choice, and the coordinator accepted it as written on 2026-11-21. The
  alternative that was not chosen is recorded.

1. **Two modes; Auto is the default; Draw is chosen by the user. (owner)**
2. **The first-open coach mark. (owner)**
   - It is a one-time bubble anchored under the mode switch. Its text:
     "Prefer to draw the circuit yourself? Switch to **Draw** here for the
     device library and drawing tools." It has one button, `Got it`.
   - It appears once per browser. `Got it` or any mode switch dismisses it
     for good. A switch made by a drawing shortcut or command counts as a
     switch (decision 15).
   - It is not modal and does not block the canvas.
3. **Build from existing functions only. (owner)** Backlog items 1–12 of the
   wireframe are out of scope. That includes drag-and-drop or paste of a
   netlist, persisted refusal reasons, locks, preview, alternatives, partial
   re-layout, idempotence, the netlist-path gaps, i18n and leftover links.
4. **The page layout per v2. (owner)**
   - **Top bar, both modes:** brand, project name, Undo/Redo, `Auto | Draw`,
     `Auto Layout` (primary, with progress and Cancel in place), `File ▾`,
     `Agent`, `⋯`. `Import netlist…` is in the top bar in Auto mode only.
   - **Auto mode:** a Cells rail with statuses; no drawing toolbar and no
     library; Netlist and Properties collapsed, opened from two buttons at
     the canvas's lower right. Select, drag, rotate and delete still work.
     The empty-state card is shown when there is nothing to draw.
   - **Draw mode:** today's toolbar (Library, Wire, NoConn, Text,
     Annotation, Properties, Reset labels | Netlist, Project Code), the
     library and the existing Cell selector.
5. **The mode is remembered per browser; the first time is Auto.
   (coordinator's default)**
   - Owner, 2026-11-21: remembered only when switched explicitly; implicit
     switches are session-only. The switch and the empty card's `Draw it
yourself →` write `icm.editor-mode.v1`; a drawing shortcut or command
     (decision 15) does not.
6. **Switching mode changes only the UI.** It makes no Document change and no
   Undo step. (coordinator's default)
7. **Opening an example or a project keeps the remembered mode.**
   (coordinator's default)
8. **Every existing menu item is kept.** Edit and Circuit items move into
   `File` and `⋯`; nothing is deleted. (coordinator's default)
   Item 21 gives the placement.
9. **The desktop shell uses the same two modes.** (coordinator's default)
10. **UI text stays English.** (coordinator's default)
11. **The status bar stays.** It still shows import and layout results.
    (coordinator's default)
12. **The project tab strip is hidden when exactly one project tab is open,
    in both modes. (owner, 2026-11-21; delivered as its own slice, T150d)**
    - Today several actions exist only on the strip: **New project tab**
      (`project-tabs.tsx:283`), **Open file in new tab** (`:292`), **Open
      Shelf project in tab** (`:307`, cloud only), and renaming by
      double-clicking a tab (`Project name`, `:243`).
    - First these actions move into `File`, keeping their accessible names:
      `New project tab`, `Open file in new tab`, and `Open Shelf project in
tab` (cloud only).
    - The rename moves too. Renaming already exists in File → Project Info,
      which renames the project and the on-screen Cell in one Undo step
      (`docs/specs/editor-interaction.md:389-391`). No new rename UI is
      added.
    - Once the strip is hidden, a single project's name shows as the
      top-bar label from decision 23. Clicking it opens Project Info.
    - With two or more tabs the strip returns unchanged, including its
      double-click rename and close menu.
    - T150a and T150b do not touch the strip.
    - Slice choice (coordinator accepted): T150d is its own slice after
      T150c, not merged into it.
      - T150c already reshapes the menus and the shared `openMenu` fixture.
      - T150d instead moves the Shelf dialog's host (trap 13) and edits 19
        e2e references in 7 spec files.
      - Each diff reads on its own, and a regression is easier to place.
13. **The browser suite opens in Draw mode by default. (coordinator
    accepted)**
    - 38 of the 53 spec files touch something Auto mode hides. Those files
      hold 333 of the 372 tests. Context gives the evidence.
    - The test project in `playwright.config.ts` gets `use.storageState`, an
      object whose `localStorage` for the `baseURL` origin holds
      `icm.editor-mode.v1 = "draw"` and `icm.editor-mode-coach.v1 =
"seen"`.
    - Playwright applies it to every page and to `browser.newContext()` too
      (trap 9).
    - The new Auto-mode spec overrides it with
      `test.use({ storageState: { cookies: [], origins: [] } })`.
    - Not chosen:
      - A `?mode=draw` query parameter. 37 spec files call `page.goto`
        directly, so each would need editing.
      - A build-time default for the test build. The suite would then never
        run the product's real default.
14. **Server rendering and `App.test.tsx`. (coordinator accepted)**
    - `AppProps` (`App.tsx:431-436`) gets `initialEditorMode?: "auto" |
"draw"`. When it is set, it wins over storage. Without `window`, the
      mode is `"auto"`.
    - The existing Draw-layout assertions in `App.test.tsx:77-182` and
      `:319-363` pass `initialEditorMode="draw"`. A new SSR test pins the
      Auto markup.
    - Not chosen: an SSR default of `"draw"`. The tests would then not
      describe the product's default.
15. **In Auto mode a drawing shortcut or drawing command switches to Draw
    and then does its normal job. (owner, 2026-11-21; this replaces the
    earlier "disable" draft)**
    - Rule: anything that needs the drawing tools brings them up. Fine-tuning
      after an automatic layout is part of the product, so the drawing tools
      are not walled off behind the switch, and no key is dead.
    - **The keys.** Each switches to Draw, then acts:
      - `B`: switch, then show the library. It is opened, never toggled shut:
        if the restored Draw panel state already has it open, `B` leaves it
        open.
      - `W`: switch, then arm the wire tool.
      - `T`: switch, then start a text note.
      - `I`: switch, then open insert search.
      - `P`: switch, then arm the Cell pin.
      - `L`: switch, then start net-label editing.
      - `I` and `W` behave the same while an interaction is active
        (`editor-shortcuts.ts:207-215`).
    - **Investigate step 1(d)** confirms the list: any other key that arms an
      `EditorTool` or opens a surface the Auto chrome hides. Today none was
      found besides those six.
    - **Keys that stay in Auto with no switch.** They work on the drawing
      without a Draw-only surface: R, Shift+R, Ctrl+R, M/Shift+M, C, V (the
      paste placement shows in the status bar's tool chip), Delete, E/Shift+E,
      F, Home, N, Q, O, H, U, Ctrl+Z/Y, Ctrl+F, arrows and Escape.
    - **Menu commands that switch first.** These do so in both the `⋯` and the
      Edit menu:
      - `Insert component…`;
      - `Place Cell from this Project…`;
      - the hierarchy row's `Place Cell` (shown at compact width in Auto
        mode).

      Commands that only open a dialog stay in Auto: `User Components…`,
      Find, Choose Selectable Objects, Cell Manager and the Netlist items.

    - **Status line.** After a switch it reads `Draw mode: <Tool>`, for
      example `Draw mode: Wire`. The action's own status may follow it.
    - **Implementation.**
      - The pure resolver is unchanged, with no new context field. The hook
        (`use-editor-shortcuts.ts`) and the menu bindings
        (`editor-menus.tsx`) wrap the resolved intent.
      - When `mode === "auto"` and the intent is in the drawing set, they
        call `setMode("draw")` and then dispatch the same intent through
        the path it uses today.
      - Because the mode change is a React state update, the action must run
        after the Draw chrome has rendered when it targets a Draw-only
        element (the library panel, the toolbar's aria-pressed state). The
        tool or command state itself does not depend on the chrome, so
        dispatching in the same event handler is acceptable. Step 8 tests
        both.
    - **Guards.** The switch happens only where the key would act today:
      - Not in a typing target: `editor-shortcuts.ts:127` returns early, and
        `isTypingTarget` covers inputs, textareas and contenteditable.
      - Not inside any scope the router already skips
        (`use-editor-shortcuts.ts:304-345`): the Auto Layout report, Project
        Info, the tab-name input, the Shelf dialog, the component editor,
        User Components, the workspace interaction, inline confirmation and
        interface confirmation.
      - New guard: not while a modal dialog is open (`dialog[open]` or
        `[aria-modal="true"]` in the document), and not while focus is
        inside the empty-state card or its example list. The router does
        not skip these today, so without the guard `W` pressed on a focused
        button in the Cell Manager would arm a wire behind it, and would now
        also change the page (trap 12).
    - **The coach mark.** Such a switch dismisses it.
      - The coach's job is to tell the user where drawing lives. A user
        who presses `W` already knows how to get drawing tools.
      - The switch they did not see is now shown pressed on `Draw` in the
        top bar, and the status line names it.
      - Showing the bubble afterwards would point at a mode the user is
        already in.
      - Not chosen: keep the coach until `Got it`. It would read "switch to
        Draw" while Draw is already on.
    - **Remembered mode.** Owner, 2026-11-21: remembered only when switched
      explicitly; implicit switches are session-only. Such a switch does not
      write the stored mode, so the next open is the mode last chosen with
      the switch (Auto if never chosen). It does store the coach mark as
      seen. A user who presses `W` once in Auto mode therefore finds the
      page in Auto again on the next open. Going back within the session
      stays one click on `Auto` in the top bar, which also cancels the
      armed tool (decision 16).
      - Not chosen (the earlier draft): a shortcut switch stored like a
        click on the switch. The owner rejected it: only an explicit choice
        is remembered.
16. **Switching to Auto cancels any armed tool or transient interaction.
    (coordinator accepted)**
    - Switching to Auto calls `cancelAllTransientInteraction()`
      (`App.tsx:3649-3660`) and returns the tool to `pointer`, so no hidden
      tool stays armed.
    - Switching to Draw cancels nothing.
    - The status line reads `Auto mode` or `Draw mode`.
17. **Auto Layout progress and Cancel move to the top bar; the status bar
    keeps the finished report. (coordinator accepted)**
    - While a run plans, the top-bar control shows `Auto Layout… n s · Cell
i of N` and a Cancel button. Cancel keeps `data-testid="auto-layout-cancel"`
      and `aria-label="Cancel Auto Layout"`.
    - The status-bar chip (`auto-layout-status`) then appears only for a
      finished report, with `Details` (`auto-layout-details`), as v2's
      footer shows.
    - Not chosen: keeping a second Cancel in the status bar. Two live
      Cancels would duplicate a test id and an accessible name.
18. **Cells rail statuses. (coordinator accepted; v2 gives the labels)**
    For each Document, in this order:
    1. **`not laid out` with a reason.** The last finished run in this tab
       refused the Cell, and the Document's revision is still the one
       recorded when the report arrived.
    2. **`laid out`.** The Document has routes.
    3. **`as imported`.** `netlistOnly(document)` holds
       (`netlist-layout.ts:11-15`).
    4. **`not laid out` with no reason.** None of the above holds.

    The reasons live in memory only. They are keyed by the tab's controller,
    because `useAutoLayout` clears its report on Details close and on a tab
    switch (`use-auto-layout.ts:147-163, 259-262`). The rail must therefore
    keep its own copy (trap 6).

19. **The empty-state card. (coordinator accepted)**
    - It shows in Auto mode when `projectInstanceCount === 0`: no Cell of
      the Project has an instance.
    - Not chosen: "the open Cell is empty". That would show the import card
      inside an empty sub-Cell of an imported Project.
    - The card's actions:
      - `Choose netlist file…` imports exactly like File → Import → SPICE /
        SCS….
      - `Open project file…` behaves like File → Import → Project File… on
        the web, and calls `openNativeProject()` on the desktop.
      - `Start from an example` opens a small list of
        `libraryProjectExamples` (`library-examples.ts:33-75`). It opens the
        chosen example through the same code path as `?example=<id>`, which
        is extracted from `use-project-entry.ts:91-116` into a function.
      - `Draw it yourself →` switches to Draw.
20. **Panel defaults (coordinator accepted), and an import in Auto mode
    (owner, 2026-11-21).**
    - Auto mode starts with Netlist and Properties closed.
    - Draw keeps today's start: Netlist open (`App.tsx:831-832`).
    - Panel open/closed state is kept per mode, in memory only, so a round
      trip Auto → Draw → Auto restores each mode's panels. It is not
      persisted.
    - A successful SPICE import in Auto mode does not open the Import Review
      dock. The status line and the rail carry the result, and Properties
      still shows the review when opened.
    - A failed import still opens it, because the user needs the
      findings.
    - Not chosen: persisting panel state in localStorage. v2's "记住上次的开合"
      for Draw is read as within a session, since nothing persists it today.
21. **Where every menu item lives. (coordinator accepted; satisfies
    decision 8)**
    - `File ▾` is unchanged: `project-menu`, with every item and data-testid
      as today.
    - A new `⋯` menu (`<details data-testid="more-menu">`) replaces the Edit
      and Circuit menus. It holds the same groups with the same `role="group"`
      `aria-label`s: **Edit**, **Hierarchy**, **Netlist** and **Layout**.
    - The test helper `openMenu` (`editor-fixtures.ts:86-98`) therefore maps
      every non-File name to `more-menu` with a one-line change.
    - The id `app-more-menu` stays unused, because `App.test.tsx:252` asserts
      that T149 removed a menu with that id.

| Item                                                                                                                                                                                                   | Today                          | Auto mode                                                                                                                                                          | Draw mode                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Project Info, New Project, Save, Check and Save, Import ›{Project File…, SPICE / SCS…, Cadence SPICE…, RNL…}, Export ›{Project File…, SVG, PNG, PDF, Netlist…}, Revert, Recover, desktop file commands | File                           | File (unchanged)                                                                                                                                                   | File (unchanged)                |
| SPICE / SCS… shortcut                                                                                                                                                                                  | —                              | top bar `Import netlist…` + empty card                                                                                                                             | File only                       |
| Insert component… (I)                                                                                                                                                                                  | Edit                           | ⋯ › Edit (switches to Draw first, decision 15)                                                                                                                     | ⋯ › Edit                        |
| User Components…                                                                                                                                                                                       | Edit                           | ⋯ › Edit                                                                                                                                                           | ⋯ › Edit                        |
| Place Cell from this Project… (when available)                                                                                                                                                         | Edit                           | ⋯ › Edit (switches to Draw first)                                                                                                                                  | ⋯ › Edit                        |
| Find in Circuit… (`project-search-button`)                                                                                                                                                             | Edit                           | ⋯ › Edit                                                                                                                                                           | ⋯ › Edit                        |
| Selection group (Delete, Copy as PNG/SVG, Rotate, Mirror ×2, Align ×n)                                                                                                                                 | Edit                           | ⋯ › Edit                                                                                                                                                           | ⋯ › Edit                        |
| Choose Selectable Objects… (`selection-filter-button`)                                                                                                                                                 | Edit                           | ⋯ › Edit                                                                                                                                                           | ⋯ › Edit                        |
| Cell Manager… (`hierarchy-entry`)                                                                                                                                                                      | Circuit › Hierarchy            | ⋯ › Hierarchy                                                                                                                                                      | ⋯ › Hierarchy                   |
| Copy Netlist (`copy-netlist`), Netlist Settings…, Edit Device Data…, Review Netlist Issues…                                                                                                            | Circuit › Netlist              | ⋯ › Netlist                                                                                                                                                        | ⋯ › Netlist                     |
| Auto Layout (`auto-layout-command`) / Cancel Auto Layout (`auto-layout-cancel-command`)                                                                                                                | Circuit › Layout               | top-bar button + ⋯ › Layout                                                                                                                                        | top-bar button + ⋯ › Layout     |
| Undo / Redo (`draw-tool-undo`, `draw-tool-redo`)                                                                                                                                                       | drawing toolbar                | top bar (same ids)                                                                                                                                                 | top bar (same ids)              |
| Library, Netlist, Project Code toggles                                                                                                                                                                 | drawing toolbar                | Netlist: lower-right button (`netlist-panel-toggle`, reused id). Library: not shown; `B` switches to Draw and opens it. Project Code: not shown; available in Draw | drawing toolbar (unchanged ids) |
| Wire, NoConn, Text, Annotation ▾, Properties (document style), Reset labels                                                                                                                            | drawing toolbar                | not shown; W/T/L switch to Draw and arm the tool                                                                                                                   | drawing toolbar                 |
| Properties dock                                                                                                                                                                                        | right dock                     | lower-right `Properties` button (`properties-panel-toggle`) + dock                                                                                                 | right dock (unchanged)          |
| Top / Cells selector / Enter Cell / Manage Cells… / Place Cell (`cell-navigation`)                                                                                                                     | hierarchy row                  | Cells rail (compact width: the hierarchy row, decision 22)                                                                                                         | hierarchy row (unchanged)       |
| Agent (`open-agent`), host actions, desktop preview label                                                                                                                                              | header                         | top bar                                                                                                                                                            | top bar                         |
| Status bar (status, chips, Grid, Hints, zoom, Fit, Change Log)                                                                                                                                         | footer                         | footer                                                                                                                                                             | footer                          |
| New project tab / Open file in new tab / Open Shelf project in tab (T150d)                                                                                                                             | tab strip                      | strip (with ≥2 tabs) + File                                                                                                                                        | strip (with ≥2 tabs) + File     |
| Rename a project (T150d)                                                                                                                                                                               | tab double-click, Project Info | File → Project Info, top-bar name; plus tab double-click with ≥2 tabs                                                                                              | same                            |

22. **Narrow and compact widths. (plan's recommendation)**
    - The header stays one row, at most 48 px tall, at 320–1440 px. This is
      pinned by `chrome-isolation.spec.ts:116-140`.
    - Below 720 px:
      - The top-bar buttons drop their labels to icons with `aria-label`s.
      - `Import netlist…` is hidden; File keeps it.
      - The project name is hidden.
    - At compact width (`(max-width: 860px)`, `App.tsx:413`), Auto mode shows
      the existing hierarchy row instead of the rail.
23. **The project name in the top bar. (plan's recommendation)** It is a
    read-only label of `project.name` with the File menu's dirty dot. Clicking
    it opens Project Info. Renaming stays in Project Info and, with two or
    more tabs, in the tab. Once T150d hides the strip, this label is where a
    single project's name is seen. Below 720 px the label is hidden, and
    the name is reached through File → Project Info.
24. **The Cells rail's accessible name is `Cell list`, not `Cells`. (plan's
    recommendation)** The hierarchy select is already `aria-label="Cells"`
    (`hierarchy-toolbar.tsx:46`), and specs look it up by that label.
25. **The canvas zoom controls stay in the status bar. (plan's
    recommendation)** That is already the lower right. Only the Netlist and
    Properties buttons float on the canvas. Not chosen: moving zoom into the
    floating cluster as v2 draws it. That is cosmetic, and it moves pinned
    controls.

## Context

All of the following was verified in `.claude/worktrees/t150-two-modes`
(`task/T150-two-modes` = `main` `e97b188`).

### The shell today

- **Composition.** The tree is `App` → `<main className="app-shell">`
  (`apps/editor/src/app/App.tsx:4742`).
  1. Dialog confirmation (`:4743-4770`).
  2. `<EditorMenuBar …/>` (`:4772-4869`).
  3. `<EditorDialogs …/>` (`:4870-4964`).
  4. `<div className="app-workspace">` (`:4965-6991`), which holds, in
     order:
     - the properties resize handle (`:4978-5019`);
     - `<ShapesPanel open={visibleLibraryPanelOpen}>` (`:5020-5026`);
     - the library resize handle (`:5027-5066`);
     - `<EditorRightDock project={…} properties={<EditorPropertiesDock
open={selectionOpen} …>}>` (`:5067-~6416`; project panels
       `:5068-5240`; properties from `:5241`);
     - `<EditorCanvasSurface>` (`:6418`);
     - `<EditorCanvasContextMenu>` (`:6969-6990`).
  5. `<EditorComponentEditor>` (`:6993`).
  6. `<SelectionFilterPopover>` (`:7021`).
  7. `<EditorStatusbar … autoLayout={…}>` (`:7027-7083`, Auto Layout chip
     props `:7046-7053`).
  8. `<AutoLayoutReport>` (`:7084-7089`).
- **`EditorMenuBar`** (`apps/editor/src/app/editor-menus.tsx:69`) renders
  `EditorAppChrome` (`:262`) and binds each part:
  - `hostActions` = the services' `NativeHeaderActions` (`:264`);
  - `projectHome` (desktop, `:267-275`);
  - `projectTabs`: `<ProjectTabs>` plus the hidden `tab-project-file` input
    (`:276-355`, input `:342-353`);
  - `fileCommands` (`:359-417`);
  - `autoLayout` from `editorCommands.state({id:"layout.auto"})` and
    `layout.auto-cancel` (`:512-527`);
  - `agentAction` (`:528-538`);
  - `drawingToolbar` (`:539-589`; undo/redo `:553-560`);
  - `hierarchyToolbar` (`:590-601`);
  - telemetry (`:602-624`).

  `EditorCanvasContextMenu` is at `:630`. The context menu holds only
  selection actions (Align, then per-selection actions,
  `features/selection/canvas-context-menu.tsx:40-80`), so it works unchanged
  in Auto mode.

- **`EditorAppChrome`** (`apps/editor/src/app/editor-app-chrome.tsx:131-363`)
  renders `<header className="app-chrome">` with these parts:
  - `.app-chrome-main` → `.app-brand`: the brand `h1` "Auto Canvas"
    (`:133-145`), `projectHome` (`:146`), File = `<ProjectMenu label="File">`
    wrapping `<FileCommandMenu embedded>` (`:149-156`, `data-testid="project-menu"`
    in `project-menu.tsx:32-36`), Edit `<details data-testid="edit-menu">`
    (`:157-254`) and Circuit `<details data-testid="circuit-menu">`
    (`:255-320`, Auto Layout section at `:318`).
  - `.app-chrome-actions`: Agent `open-agent` (`:323-350`), `hostActions`
    (`:351`) and the desktop preview label (`:352-356`).
  - Then `<DrawingToolbar>` (`:359`), `<HierarchyToolbar>` (`:360`),
    `projectTabs` (`:361`) and telemetry (`:362`).
- **The drawing toolbar** (`features/editor-shell/drawing-toolbar.tsx:149-284`,
  `data-testid="draw-toolbar"`).
  - Panel toggles: `library-toggle` (`:156`, aria-label "Component library",
    shortcut B), `netlist-panel-toggle` (`:173`, N) and `project-code-toggle`
    (`:184`).
  - Commands: `draw-tool-undo` (`:202`), `draw-tool-redo` (`:213`),
    `draw-tool-wire` (`:225`), `draw-tool-no-connect` (`:236`),
    `draw-tool-text` (`:247`), `<AnnotationMenu>` (`:255`),
    `draw-tool-document-style` (`:263`) and `draw-tool-reset-labels`
    (`:274`).
- **The hierarchy row** (`features/hierarchy/hierarchy-toolbar.tsx`).
  - It renders nothing for a flat Project (`:28`).
  - Otherwise it shows `cell-navigation` (`:33-35`): Top, the `<select
aria-label="Cells" data-testid="document-selector">` (`:45-58`), Enter
    Cell, Manage Cells… and Place Cell.
  - Switching Cell programmatically uses `selectDocumentFromHierarchy(id)`
    (`features/hierarchy/editor-navigation-controller.ts:131-139`). It clears
    the stack, then calls `switchDocument` (`:108-123`), which keeps per-Cell
    view boxes, resets the interaction and sets `Opened Cell <name>`.
- **Panels.**
  - `useEditorPanels` (`features/editor-shell/use-editor-panels.ts:25-138`)
    owns the library state (`icm.library-panel-open.v1`, read guarded by
    `typeof window` at `:26-34`) and its width. It also owns compact layout,
    `selectionOpen` (Properties), search and Agent.
  - App defines the storage keys at `App.tsx:390-393` and calls the hook at
    `:629-640`. `visibleLibraryPanelOpen` is at `:638`.
  - The Netlist / Project Code / Instances / Netlist-configuration dock is
    `projectPanel`, starting `"netlist"` (`App.tsx:831-832`).
    `showProjectPanel` / `closeProjectPanel` / `toggleProjectPanel` are at
    `:3535-3558`.
  - Properties collapses to a narrow strip (`selection-dock`,
    `styles/editor-inspection.css:3-19`) whose header button is
    `selection-shelf` (`app/editor-properties-dock.tsx:127-135`). Import
    Review lives inside it (`:235`).
- **Layout CSS.**
  - `.app-workspace` is a grid of `"shapes canvas props"` with columns
    `var(--icm-shapes-width) minmax(0,1fr) auto`; `.library-collapsed` makes
    the shapes column 0 (`styles/editor-workspace.css:3-15`).
  - The right dock is at `:51-62`.
  - Compact rules (≤860 px) are at `:567-600`.
  - Header styles are in `styles/editor-chrome.css`: `.app-chrome-main` at
    `:1201-1260`, many width bands at `:615-1445`, and the status bar at
    `:1059`.
- **Persisted UI preferences.**
  - They are plain localStorage keys named `icm.<name>.v1`, each read in a
    `useState` initializer guarded by `typeof window === "undefined"` and
    try/catch. Examples: `use-editor-panels.ts:26-47`, and
    `icm.properties-panel-width.v1` at `App.tsx:393`, `:600-607`.
  - There is no preferences module.
  - The web and desktop entries use `createRoot` (`entries/web.tsx:32`,
    `entries/desktop.tsx:33`); nothing hydrates. A localStorage read at first
    render is therefore safe in the browser.
  - Vitest runs in Node, where `window` is undefined. `App.test.tsx` renders
    with `renderToStaticMarkup` (`:7`, `:80`).
- **Auto Layout seams (T014/T147).**
  - `useAutoLayout` (`features/auto-layout/use-auto-layout.ts`) returns
    `running`, `progress {evaluations,budget,startedAt,cell,cells}`,
    `report`, `elapsedSeconds`, `detailsOpen`, `start`, `requestAfterImport`,
    `cancel`, `openDetails` and `clearReport` (`:208-263`).
  - The report shape is `{ run: "manual"|"import", cells: [{ documentId,
cellName, outcome: "applied"|"refused"|"edited"|"unchanged", reason?,
diagnostics }] }` (`auto-layout-session.ts:55-71`).
  - The menu section is `auto-layout-menu-section.tsx:9-41`
    (`auto-layout-command`, `auto-layout-cancel-command`).
  - The status chip is `editor-statusbar.tsx:111-139` (label) and
    `:224-254` (`auto-layout-status`, with `auto-layout-cancel` while running
    or `auto-layout-details` after).
  - `netlistOnly` is at `netlist-layout.ts:11-15`.
- **Import.**
  - The File → Import inputs are bare `<input type="file">`s inside labels
    (`features/editor-shell/file-command-menu.tsx:219-280`):
    `project-file` (`:226-227`, bound to `projectInputRef`), `spice-files`
    (`:242`), `cadence-spice-files` (`:256`) and `rnl-files` (`:273`).
  - `installImport` (`editor-file-commands.ts:283-305`) replaces the Project,
    opens Import Review (`setImportReviewOpen(true); setSelectionOpen(true)`
    at `:298-299`) and calls `onImported` (T147's layout) at `:303`.
  - A failed import opens the review too (`:307-312`).
  - `exportDesignNetlist` opens the Netlist panel (`:163-168`).
- **Examples.**
  - The only in-app route is the boot query `?example=<id>`
    (`app/use-project-entry.ts:91-116`): find in `libraryProjectExamples`,
    `prepareNetlistExample`, `guardDirtyReplacement`, `replaceActiveProject`,
    status `Opened example: …`, then drop the query.
  - There is no examples menu today. `App.test.tsx:340-343` asserts that
    `examples-toggle` and the example names are absent from the markup, so
    the new list must render only when opened.
- **Desktop.**
  - `apps/desktop/src/main.ts:271` sets `Menu.setApplicationMenu(null)`, so
    there are no native menus to mirror.
  - Host-specific UI comes through services: `NativeHeaderActions =
NativeAboutButton` (`services/preview-editor-services.ts:19`),
    `NativeFileCommands`, `NativeProjectHome` and `nativeProjectStore`. The
    plan only moves where these render; their props stay.
- **Shortcuts.**
  - `resolveEditorShortcut` (`interaction/editor-shortcuts.ts:82`) maps
    `B`/`N` to `toggle-panel` (`:299-304`), `I` to `insert.open` and `P` to
    `insert.cell-pin` (`:320-325`), `W` to `tool.activate wire` and `T` to
    `drafting.add-text` (`:354-362`), and `L` to `edit-net-label` (`:363`).
  - `I` and `W` also resolve while an interaction is active (`:207-215`).
  - The hook dispatches in `app/use-editor-shortcuts.ts:486-600` (toggle
    panel at `:546-552`). Its pure context is built at `:423-462`.
  - `EditorTool` = pointer, wire, no-connect, construction-line, arrow,
    polyline, rectangle, circle (`interaction/interaction-state.ts:59-67`).

### Tests that pin the shell

- **Counts.**
  - Browser specs: 53 `*.spec.ts` files, 372 `test(` calls.
  - 38 files reach something Auto mode hides. They do so directly or
    through `clickDrawTool`, `placeText`, `closeProjectTools`,
    `revealPropertiesShelf`, `showNetlistPanel`, `drawWire` or
    `placeComponent`.
  - The hidden things are: `draw-tool-*` (17 files), `library-toggle` or
    "Component library" (4), `shapes-chip-*` (5), `netlist-panel-toggle`
    (7), `project-code-toggle` (7), `cell-navigation` / `document-selector`
    (2), and plain drawing keys `W/T/I/P/L/B` pressed on the keyboard (15
    files, 71 presses).
  - The 35 files with direct hits hold 333 tests.
  - The menu helpers reach Edit and Circuit through `openMenu`
    (`editor-fixtures.ts:86-98`; 26 calls in 11 files) and `clickCommand`
    (41 calls in 12 files). `"circuit-menu"` is used directly only at
    `hierarchy.spec.ts:1057`.
- **Harness.**
  - `playwright.config.ts:56-66` has `use` with `baseURL` only, and no
    storage state.
  - `openEditor` (`editor-fixtures.ts:36-39`) is not used everywhere: 37
    spec files call `page.goto` themselves.
  - Precedent for seeding storage: `component-insert.spec.ts:277-279` sets
    `icm.library-panel-open.v1` with `addInitScript`.
- **Unit tests.**
  - `App.test.tsx:77-182` checks the File/Edit/Circuit menus.
  - `App.test.tsx:221-269` checks the header action row; the action row is
    sliced up to `<div class="toolbar-row` (`:126`, `:236`).
  - `App.test.tsx:319-363` checks library, toolbar and Netlist defaults.
  - `editor-statusbar.test.tsx:315-331` pins the running chip with Cancel.
    `auto-layout-menu-section.test.tsx` pins the menu section.

### Traps

1. **Header height.** `chrome-isolation.spec.ts:116-140` asserts that
   `.app-chrome-main` is ≤ 48 px tall at 320, 390, 480, 720 and 1440 px, with
   File/Edit/Circuit on one row. The top bar gains several controls: switch,
   Undo/Redo, Import, Auto Layout, ⋯ and the name. Without responsive
   compaction (decision 22) it wraps and fails.
2. **`App.test.tsx` runs in Node.** A mode read that touches `window`
   without a guard throws. A default of Auto silently breaks the toolbar and
   library assertions at `:319-363`. Decision 14 handles this.
3. **`app-more-menu` is a banned id.** `App.test.tsx:252` asserts it is
   absent because T149 removed that menu. Use `more-menu`.
4. **The hierarchy select is already named `Cells`.**
   `hierarchy-toolbar.tsx:46` uses `aria-label="Cells"`, so a rail with the
   same accessible name makes `getByLabel("Cells")` ambiguous whenever both
   render. Name the rail `Cell list` (decision 24).
5. **Import opens the Properties dock.** `editor-file-commands.ts:298-299`
   opens Import Review in the Properties dock on every import. Unchanged, the
   Auto canvas is not "full width" after an import (decision 20).
6. **The report is cleared often.** `use-auto-layout.ts:147-163` clears the
   report when the controller changes (a tab switch), and `:259-262` clears it
   on Details close. A rail that reads `autoLayout.report` directly loses
   `not laid out — reason` as soon as the user reads Details (decision 18).
7. **File inputs inside a closed `<details>`.** The `spice-files` and
   `project-file` inputs live inside the File menu popover. Do not drive the
   top-bar and card buttons by clicking those inputs. Give them their own
   hidden input (`data-testid="import-netlist-file"`), as the tab strip does
   with `tab-project-file` (`editor-menus.tsx:342-353`), and call the same
   `onImportSpice(files)` handler. For `Open project file…` on the web, use
   `projectInputRef.current?.click()` only if the step 3 investigation
   confirms it works with the menu closed; otherwise use a second hidden
   input that calls `openProjectFile(file)`.
8. **Netlist starts open.** The Netlist panel starts open
   (`App.tsx:831-832`), and many specs depend on that through
   `closeProjectTools` (`editor-fixtures.ts:55-75`). Draw must keep that
   start.
9. **Storage seeding reaches every context.** Playwright 1.62.1 copies
   `use.storageState` into every `browser.newContext()` that does not set it
   (`node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/lib/index.js:127-131`,
   `runBeforeCreateBrowserContext`). The extra contexts at
   `project-file.spec.ts:556` and `user-components.spec.ts:2020` therefore
   also open in Draw. Build the origin from the same `baseURL`
   (`externalBaseUrl ?? e2eBaseUrl`), so live runs (`ICM_E2E_BASE_URL`) are
   covered.
10. **Duplicate test ids.** Undo/Redo keep their ids when they move to the
    top bar. Delete them from `DrawingToolbar` in the same change, or
    `getByTestId("draw-tool-undo")` resolves to two elements in Draw mode.
    The same goes for `netlist-panel-toggle`: render the floating button only
    in Auto mode.
11. **Gates already red on `main`.** `pnpm deadcode` exits 1 on `main`, and
    `scripts/editor-bundle-budget.mjs` is broken there. Both are
    "no new finding" checks against a clean `main` output (as in T147), not
    pass/fail gates.
12. **A mode switch can happen behind a dialog.** The router skips keys only
    for the scopes it lists (`use-editor-shortcuts.ts:304-345`): the Auto
    Layout report, Project Info, the tab-name input, the Shelf dialog, the
    component editor, User Components, the workspace interaction, inline
    confirmation and interface confirmation.
    - Inside Cell Manager, Netlist Review, Search or Import Review, a plain
      `W` pressed on a focused button (not a typing target,
      `editor-shortcuts.ts:127`) still resolves to `tool.activate wire`
      today.
    - Under decision 15 the same key would also switch the page to Draw
      behind the dialog.
    - The new guard (a modal dialog or the empty-state card holds focus →
      no switch, no action) must come before the switch, and it is
      unit-tested.
    - Investigate step 1(d) lists the dialogs that are not `<dialog>` or
      `aria-modal`.
13. **The Shelf picker and the close decisions live inside `ProjectTabs`
    (T150d).**
    - "Open Shelf project in tab" is a `<details className="project-tabs-shelf">`
      that hosts `<ProjectShelf>` (`project-tabs.tsx:298-321`). The
      close-decision dialogs (`project-tab-close-decision`, `:366`, `:398`)
      and the tab context menu (`:323`) render from the same component.
    - Hiding the strip by unmounting `ProjectTabs` would remove all of
      them. Hide only the strip row (a `collapsed` prop or a CSS class) and
      keep the component mounted.
    - In File, host the Shelf list in an `Open Shelf project in tab ›`
      submenu that renders the same `ProjectShelf` with the same handlers
      (`editor-menus.tsx:332-340`).
14. **A drawing key that switches to Draw and touches Draw-only DOM.** `B`
    toggles `libraryPanelOpen` (`use-editor-panels.ts:93-107`), and it can
    flip a library that the restored Draw state already shows. Under
    decision 15, `B` in Auto mode must open the library, never close it:
    call `setLibraryPanelOpen(true)` and persist it, instead of
    `toggleLibraryPanel()`.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/app/App.tsx`, `App.test.tsx`
- `apps/editor/src/app/editor-app-chrome.tsx`, `editor-menus.tsx`,
  `project-menu.tsx`, `editor-properties-dock.tsx` (only the hook for
  collapsed visibility)
- `apps/editor/src/app/use-editor-shortcuts.ts`,
  `use-editor-shortcuts.test.tsx`, `use-project-entry.ts` (extract the
  example opener), `use-project-entry.test.tsx`
- `apps/editor/src/interaction/editor-shortcuts.ts` and its tests
- `apps/editor/src/features/editor-shell/**`: new mode state, mode switch,
  coach mark, empty-state card, examples list and floating panel buttons;
  `drawing-toolbar.tsx`, `editor-statusbar.tsx`, `use-editor-panels.ts` and
  `editor-file-commands.ts` (the Auto-mode import dock rule), with their
  tests
- `apps/editor/src/features/auto-layout/**`: the top-bar control, a
  report-retaining hook for the rail, the menu section, with their tests
- `apps/editor/src/features/hierarchy/**`: the new Cells rail component and
  its test; `hierarchy-toolbar.tsx` only if needed
- `apps/editor/src/styles/editor-chrome.css`, `editor-workspace.css`,
  `editor-inspection.css`
- `apps/editor/e2e/editor-modes.spec.ts` (new), `editor-fixtures.ts`,
  `hierarchy.spec.ts:1057` (slice C only), and
  `chrome-isolation.spec.ts` / `editor-shell.spec.ts` only where an
  assertion names a moved control
- `playwright.config.ts` (`use.storageState` only)
- `docs/specs/editor-interaction.md`, `docs/user/getting-started.md`
- T150d only:
  - `apps/editor/src/features/editor-shell/project-tabs.tsx`,
    `project-tabs.css`, `file-command-menu.tsx` and their tests;
  - the 7 spec files that reference the strip actions
    (`project-tabs.spec.ts`, `cloud-projects-server.spec.ts`,
    `base-path.spec.ts`, `copy-paste.spec.ts`, `project-file.spec.ts`,
    `web-agent-session.spec.ts`, `user-components.spec.ts`), only to reach
    those actions through the new helper.

Out of scope (do not change):

- Every backlog item in v2's last table.
- `packages/**` (the planner, model and edit engine), `apps/server/**`,
  `apps/desktop/**` (no native menu exists) and `scripts/**`.
- Any account or identity work, and renames of commands, data-testids
  (except the additions listed), storage keys or files.
- Document, transaction or undo semantics. A mode switch never calls
  `transact`.
- The tab strip in T150a, T150b and T150c. It changes only in T150d.

## Steps

The work is split into four slices, each one PR, delivered in order:

- **T150a** is the owner-visible core. Deliver it first.
- **T150b** follows on the same branch line.
- **T150c** follows on the same branch line.
- **T150d** comes last. It needs T150c's top-bar project name.

### T150a — modes, switch, coach mark, Auto chrome, empty state, top-bar Auto Layout

1. **Investigate** (report the answers before coding further):
   - (a) Run `pnpm deadcode > tmp/t150/deadcode-main.txt 2>&1` on a clean
     `main` checkout (not via `git stash`).
   - (b) Confirm `projectInputRef.current?.click()` opens the chooser while
     the File menu is closed (Chromium and Electron). Report which path step
     7 uses.
   - (c) List every caller of `setSelectionOpen(true)` and
     `showProjectPanel` that runs without a user click, such as the import,
     export and diagnostics jumps. Report which ones Auto mode must respect.
   - (d) List:
     - every shortcut intent and menu command that arms an `EditorTool`,
       starts a placement, or targets a Draw-only surface (start from the
       six keys in decision 15, `insert.start`, `insert.cell-pin` and Place
       Cell);
     - every dialog or overlay that holds keyboard focus but is neither a
       `<dialog open>` nor `aria-modal="true"` (trap 12).

     Stop and report if a key outside decision 15's lists turns out to arm
     a tool.

   - Stop and report if any data-testid listed in the decisions table turns
     out to have a second, different owner.
2. **Mode state, tests first.** Add `features/editor-shell/editor-mode.ts`:
   - `type EditorMode = "auto" | "draw"`, and constants
     `EDITOR_MODE_STORAGE_KEY = "icm.editor-mode.v1"` and
     `MODE_COACH_STORAGE_KEY = "icm.editor-mode-coach.v1"`.
   - Pure functions `readStoredEditorMode(storage | undefined): EditorMode`
     (anything but `"draw"` → `"auto"`), `readCoachSeen` and the writers,
     all try/catch.
   - A hook `useEditorMode({ initialMode? })` returning `{ mode, setMode,
coachVisible, dismissCoach }`. `setMode` persists the mode and dismisses
     the coach.
   - Unit tests: no storage → Auto and coach visible; `"draw"` stored → Draw;
     a throwing storage → Auto with no throw; a switch persists both keys.
3. **`AppProps.initialEditorMode`** (`App.tsx:431-436`). Thread the mode
   into `EditorMenuBar` → `EditorAppChrome` and into the workspace render.
   Switching to Auto calls `cancelAllTransientInteraction()` and activates
   `pointer` (decision 16). Add a test in `App.test.tsx` that renders with
   `initialEditorMode="auto"`:
   - present: `mode-switch`, `auto-layout-button`, `import-netlist-button`,
     the empty-state card;
   - absent: `draw-toolbar`, `shapes-library-panel`.

   Pass `initialEditorMode="draw"` to the existing Draw assertions.

4. **Top bar** (`editor-app-chrome.tsx`).
   - Add, in v2 order: Undo/Redo, moved from `DrawingToolbar` with the same
     ids (trap 10); the mode switch; `Import netlist…` (Auto only); and the
     `Auto Layout` control.
   - The mode switch is two buttons with `aria-pressed` in a
     `role="group" aria-label="Editor mode"`, with
     `data-testid="mode-switch"`, `mode-auto` and `mode-draw`.
   - In Auto mode do not render `DrawingToolbar`. Render `HierarchyToolbar`
     only at compact width (decision 22).
   - Keep the File, Edit, Circuit and Agent order for now; T150c folds Edit
     and Circuit.
   - Add the CSS bands so that `chrome-isolation.spec.ts:116-140` still
     holds in both modes.
5. **The Auto Layout control.** Add `features/auto-layout/auto-layout-button.tsx`.
   - At rest it is a primary button, `data-testid="auto-layout-button"`. It
     is disabled with the command's reason as its title. It runs
     `editorCommands.execute({id:"layout.auto"})`.
   - While a run plans, it shows the label `Auto Layout… n s · Cell i of N
· evaluation e/b`. Reuse `autoLayoutChipLabel`: move it out of
     `editor-statusbar.tsx` into the auto-layout feature, without changing
     the text. Beside it is Cancel (`auto-layout-cancel`, `aria-label="Cancel
Auto Layout"`) running `layout.auto-cancel`.
   - Remove the running branch from the status-bar chip, which keeps
     report/Details only. Update `editor-statusbar.test.tsx:315-331` to the
     new owner, and add the button's own test.
   - It shows in both modes.
6. **The Auto workspace** (`App.tsx:4965-6991` and `editor-workspace.css`).
   - In Auto mode replace `<ShapesPanel>` and its resize handle with the
     slot for the Cells rail. In T150a this slot is empty, and the canvas
     takes the column, as with `.library-collapsed`.
   - Add the floating lower-right cluster `Netlist` (`netlist-panel-toggle`,
     calls `toggleProjectPanel("netlist")`) and `Properties`
     (`properties-panel-toggle`, same handler as the dock header).
   - Hide the collapsed Properties strip in Auto mode while it is closed.
   - Panel state per mode, and the Auto start closed, per decision 20.
7. **Import and the empty state.**
   - Add the hidden `import-netlist-file` input (trap 7). `Import
netlist…` and the card's `Choose netlist file…` both click it.
   - Add `empty-state-card.tsx` (`data-testid="auto-empty-state"`), shown
     per decision 19, with:
     - `empty-choose-netlist`;
     - `empty-open-project` (web: step 1(b)'s path; desktop:
       `openNativeProject()`);
     - `empty-examples`, opening a list `empty-example-<id>` built from
       `libraryProjectExamples`;
     - `empty-draw`, which sets Draw.
   - Extract `openLibraryExample(id)` from `use-project-entry.ts:91-116`.
     Use it both at boot and from the list, with identical status text and
     guard.
   - In Auto mode skip `setSelectionOpen(true)` in `installImport` on
     success only (decision 20, trap 5); keep `setImportReviewOpen(true)`,
     so Properties shows the review when the user opens it. Pass the mode
     in as a getter, so a run started before a switch reads the current
     mode.
8. **Drawing shortcuts and commands bring up Draw** (decision 15; traps 12
   and 14). Write the tests first.
   - **The pure classifier.** Add
     `isDrawingIntent(intent): { tool: string } | null` in
     `features/editor-shell/editor-mode.ts`. It covers:
     - `toggle-panel` library → `Library`;
     - `run-command` `tool.activate` wire → `Wire`;
     - `drafting.add-text` → `Text`;
     - `insert.open` → `Insert`;
     - `insert.cell-pin` → `Cell pin`;
     - `edit-net-label` → `Net label`.

     `resolveEditorShortcut` is unchanged.

   - **The hook** (`use-editor-shortcuts.ts`, after the existing scope
     guards at `:304-345` and the new modal/card guard). When `mode ===
"auto"` and `isDrawingIntent(shortcut)`:
     - call `switchToDraw(tool)`, which runs `setMode("draw")`, dismisses
       the coach and sets the status `Draw mode: <Tool>`;
     - then dispatch the intent as today, except that `B` calls
       `setLibraryPanelOpen(true)` with persistence instead of the toggle
       (trap 14).
   - **Menu commands.** In `editor-menus.tsx`, `onInsertComponent` and
     `placeProjectCell.execute`, and the hierarchy row's `onPlaceCell`, call
     `switchToDraw` first when the mode is Auto.
   - **Unit tests** (`editor-mode.test.ts`, `use-editor-shortcuts.test.tsx`):
     - for each of B, W, T, I, P and L in Auto mode: the mode becomes Draw,
       the coach is dismissed, the stored mode is unchanged (session-only,
       decision 15), the status reads
       `Draw mode: <Tool>`, and the intent's normal effect happens (wire tool
       armed, insert dialog open, library open);
     - the same keys in Draw mode: unchanged behavior and no status prefix;
     - `B` in Auto mode with the Draw library already open leaves it open;
     - no switch from a typing target, inside Project Info, with a
       `<dialog open>` present, or with focus in `auto-empty-state`;
     - R, Delete, M, V, N, Q and Ctrl+Z in Auto mode leave the mode as
       Auto.
9. **The coach mark.** Add `mode-coach.tsx` (`data-testid="mode-coach"`, a
   `Got it` button `mode-coach-dismiss`, `role="dialog"` not modal or
   `role="note"`), anchored under `mode-switch` with the text of decision 2.
   Render it client-side only. Check `App.test.tsx:250-260`, which asserts
   no `role="dialog"` in the initial markup: with no `window` the coach is
   not rendered, so the markup still has no dialog. Keep it that way.
10. **E2E harness** (decision 13). Add the `storageState` object in
    `playwright.config.ts`. In `editor-fixtures.ts` export
    `AUTO_MODE_STORAGE = { cookies: [], origins: [] }` for new specs.
11. **New spec `apps/editor/e2e/editor-modes.spec.ts`**, with
    `test.use({ storageState: AUTO_MODE_STORAGE })`. It covers:
    - first open: Auto pressed, coach visible, no `draw-toolbar` and no
      shapes panel, and the empty card;
    - `Got it`, then reload: no coach, still Auto;
    - a switch to Draw dismisses the coach, shows `draw-toolbar` and
      `library-toggle`, and after a reload is still Draw;
    - each of the four card actions: netlist via `setInputFiles` on
      `import-netlist-file` with T147's one-Cell fixture; project via a
      file chooser; an example from the list (status `Opened example: …`);
      Draw;
    - Auto import: the Properties dock is not open, and the canvas width is
      at least 85% of the viewport after the run;
    - the Auto Layout button: running state with Cancel (use the long-run
      fixture T147 uses, or cancel immediately), and Cancel works;
    - mode switch during an armed wire (Draw: press W; switch to Auto): the
      tool chip is gone, and the revision and Undo state are unchanged;
    - in Auto with `?example=two-stage-op-amp`:
      - press `W`: the page is in Draw, `draw-tool-wire` has
        `aria-pressed="true"`, the status starts `Draw mode: Wire`, and the
        coach is gone;
      - press Escape, then click `mode-auto`: the tool chip is gone and
        there is no `draw-toolbar`;
      - reload: the page opens in Auto;
    - in Auto, `Insert component…` from the menu switches to Draw and opens
      the Insert dialog;
    - in Auto with the Cell Manager open, `W` on a focused button changes
      neither the mode nor the tool;
    - a canvas edit in Auto: select a part of `?example=two-stage-op-amp`,
      press R, Undo restores it, and Delete works.
12. Docs:
    - `docs/specs/editor-interaction.md`: add a "Modes" section, and in
      "Automatic layout" (`:434-460`) change "status chip shows … Cancel"
      to the top-bar control.
    - `docs/user/getting-started.md:15-30`: describe the two modes and the
      first-open bubble.

### T150b — Cells rail with statuses

13. **A retained per-Cell outcome**, tests first. Add
    `features/auto-layout/use-cell-layout-outcomes.ts`. It is keyed by
    controller, like `abandonedRef` (`use-auto-layout.ts:87`). On each new
    report it stores, for every `refused` cell, `{ reason, revision }`, where
    `revision` is the live Document's revision at that moment. An `applied`
    cell clears its entry. Nothing is written to the Project.
14. **`features/hierarchy/cells-rail.tsx`** (`<nav aria-label="Cell list"
data-testid="cells-rail">`):
    - one row per `project.documents` entry, top first, as a button
      `cells-rail-<documentId>` with `aria-current` on the open Cell;
    - a status (`laid out`, `as imported`, `not laid out`) by decision 18,
      with the reason as visible text under the row and as `title`;
    - a click calls `selectDocumentFromHierarchy`.

    Render it in the Auto slot from step 6, not at compact width. Add a unit
    test with one row per status.

15. Extend `editor-modes.spec.ts`. Import T147's two-Cell fixture with one
    over-limit Cell (`netlist-auto-layout.spec.ts:101-122`). Expect the rail
    to read `laid out` for the small Cell and `not laid out` with `more than
120 parts` for the large one. The reason must still be there after
    Details closes. Clicking a row opens that Cell (the status reads
    `Opened Cell …`).

### T150c — menu consolidation and top-bar name

16. Replace the Edit and Circuit `<details>` (`editor-app-chrome.tsx:157-320`)
    with one `⋯` `<details className="command-menu" name="editor-command-menu"
data-testid="more-menu">` holding groups Edit, Hierarchy, Netlist and
    Layout. Keep every button's text, id and handler. Add the read-only
    project name (decision 23).
17. Change `openMenu` (`editor-fixtures.ts:86-98`) to map every non-File
    name to `more-menu` and update the comment. Change
    `hierarchy.spec.ts:1057` to `more-menu`. Update `App.test.tsx:77-182`
    (Edit and Circuit assertions → the groups inside `more-menu`) and the
    getting-started paragraph `:24-30`.
18. Add a test that every row of the decisions table is reachable in both
    modes. One parameterized e2e test opens each menu path in Auto and in
    Draw and asserts that the button is visible and enabled where expected.

### T150d — hide the tab strip with one project (decision 12)

19. **Investigate:**
    - List the 19 strip references in the 7 spec files (Scope) by
      `file:line`. For each, record whether it runs with one tab, where the
      strip will be hidden, or with several.
    - Confirm where the close-decision dialogs and the tab context menu
      render (`project-tabs.tsx:323-420`).
    - Stop if a strip action has a handler outside `editor-menus.tsx:276-355`.
20. **File gets the strip-only actions**, in `file-command-menu.tsx`, with
    the same accessible names:
    - `New project tab` (`projectTabs.open(() => createTabSession())`);
    - `Open file in new tab` (web: `tabProjectInputRef.current?.click()`;
      desktop: `openNativeProject()`, as at `editor-menus.tsx:327-331`);
    - when cloud is enabled, an `Open Shelf project in tab ›` submenu that
      renders `ProjectShelf` with the strip's handlers (trap 13).

    Pass these through `fileCommands` props. Write unit tests first in
    `file-command-menu.test.tsx`.

21. **The strip hides itself with one tab.** Give `ProjectTabs` a hidden
    state when `tabs.length === 1`: it hides the strip row and keeps the
    component mounted for its dialogs and menu (trap 13). It shows again
    with two or more tabs. This applies in both modes. Update
    `getting-started.md:32-38` and `editor-interaction.md:387-405`.
22. **E2E.**
    - Add `projectTabAction(page, name)` to `editor-fixtures.ts`. It clicks
      the strip button when the strip is visible, and otherwise File → the
      item with that name.
    - Switch the single-tab references from item 19 to the helper, and
      leave multi-tab ones alone.
    - Add these cases to `project-tabs.spec.ts`:
      - one tab: no `project-tabs` strip is visible, and File → `New
project tab` shows the strip with two tabs;
      - closing back to one tab hides the strip;
      - with one tab, File → Project Info renames the project, and the
        top-bar name shows the new name.

## Acceptance

Run from the repository root; all must pass for each slice. The
`tmp/t150/deadcode-main.txt` baseline comes from step 1(a).

```bash
pnpm exec vitest run apps/editor/src/app apps/editor/src/features/editor-shell apps/editor/src/features/auto-layout apps/editor/src/features/hierarchy apps/editor/src/interaction   # expected: all pass, new tests included
pnpm typecheck        # expected: exit 0
pnpm lint             # expected: exit 0
pnpm format:check     # expected: exit 0
pnpm docs:check       # expected: exit 0
pnpm test:local       # expected: all pass
pnpm build            # expected: exit 0
pnpm deadcode > tmp/t150/deadcode-branch.txt 2>&1; diff tmp/t150/deadcode-main.txt tmp/t150/deadcode-branch.txt   # expected: no added line (main already exits 1)
pnpm test:editor-build   # expected: exit 0 (editor-bundle-budget.mjs is broken on main; not a gate)
ICM_E2E_PORT=4199 AUTO_CANVAS_E2E_API_PORT=4339 npx playwright test apps/editor/e2e/editor-modes.spec.ts apps/editor/e2e/chrome-isolation.spec.ts apps/editor/e2e/editor-shell.spec.ts apps/editor/e2e/auto-layout.spec.ts apps/editor/e2e/netlist-auto-layout.spec.ts apps/editor/e2e/hierarchy.spec.ts apps/editor/e2e/project-tabs.spec.ts   # expected: all pass
ICM_E2E_PORT=4199 AUTO_CANVAS_E2E_API_PORT=4339 npx playwright test --workers=4   # expected: all pass, or exactly the failures of the same command on main (record main's list first)
git diff --stat main -- packages apps/server apps/desktop scripts pnpm-lock.yaml   # expected: empty
git diff main -- apps/editor/e2e | grep '^[-+]' | grep -v '^+++\|^---' | grep -v 'editor-modes.spec.ts'   # expected T150a: only editor-fixtures.ts additions; T150c: plus the openMenu mapping and hierarchy.spec.ts:1057; T150d: plus projectTabAction and the single-tab call sites listed in step 19
```

Behavioral checks for the reviewer. Start the `editor` config from
`.claude/launch.json` in a fresh browser profile, or clear `icm.editor-mode*`
in DevTools. Do not touch ports 4310 or 5173 while the owner's trial server
runs; use another port.

- **First open.** Auto is pressed; the coach mark points at the switch with
  the exact text and `Got it`. The canvas shows the import card with its four
  actions. There is no drawing toolbar and no library.
- **The coach mark is one-time.** `Got it`, then reload: no coach, still
  Auto. In a fresh profile, switching to Draw (without `Got it`) hides it for
  good too.
- **The four card actions.**
  - `Choose netlist file…` with a one-Cell netlist: the import runs, T147's
    layout runs, and progress and Cancel show in the top bar.
  - `Open project file…`: a saved `.icproj.json` opens.
  - `Start from an example` → Two-Stage Op Amp: the example opens, and the
    mode is still Auto.
  - `Draw it yourself →`: Draw mode.
- **Auto import of a two-subcircuit netlist.**
  - The Cells rail lists both Cells with statuses. After a refusal, the
    reason stays visible after Details is closed.
  - The canvas is about the full width; Properties and Netlist are closed
    and open from the lower-right buttons.
  - Clicking a rail row opens that Cell.
- **Switch to Draw.** The toolbar and library appear. The Document is
  unchanged (same revision in telemetry), and the Undo button's state is
  unchanged. Reload: still Draw.
- **Fine-tuning in Auto.** Select, drag, `R`, `Delete`, `Ctrl+Z`, `F`, zoom
  and the context menu all work, and the page stays in Auto.
- **A drawing key in Auto.**
  - Press `W`: the page is in Draw with the wire tool armed (the Wire
    button is pressed), the status says `Draw mode: Wire`, and the coach
    mark is gone.
  - Press Escape and click `Auto`: the tool is cancelled and the toolbar is
    gone.
  - Repeat with `B` (the library opens), `I` (Insert search opens) and
    `T`. In Auto, ⋯ → `Insert component…` also switches to Draw.
  - With a dialog open (Cell Manager), `W` does nothing.
- **Reload after a shortcut switch.** The page opens in the mode last chosen
  with the switch. After a `W` switch with no switch back, it opens in Auto
  (or in Draw if Draw was chosen with the switch before).
- **Tab strip (T150d).**
  - With one project, no strip is shown in either mode.
  - File → `New project tab`: the strip appears with two tabs.
  - Close one tab: the strip hides.
  - With one project, File → Project Info renames it, and the top-bar name
    follows.
  - File → `Open file in new tab` and, with cloud, `Open Shelf project in
tab ›` work.
- **Every menu item.** Every row of the decisions table is reachable in both
  modes (T150c).
- **Auto Layout** is in the top bar in both modes. While planning it shows
  the progress text and Cancel; Cancel stops the run and the status says
  cancelled.
- **Narrow widths.** At 390 px and 720 px the header is one row, and every
  control is still reachable.
- **Desktop.** `pnpm test:editor-build` passes. If a desktop build is at
  hand, the same switch and coach mark appear, and `Open project file…` opens
  the native chooser.

## Notes for the implementer

- Implementation is by a Claude subagent. Review is by an independent Opus
  subagent before any PR. Codex is not used. No step spends LLM API tokens.
- Size, honestly:
  - T150a is about 1,400–1,700 changed lines. About 40% is tests, CSS and
    docs. The rest is App.tsx wiring, the new components, the shortcut
    switch with its guards, and the status-bar move.
  - T150b is about 300–400 lines.
  - T150c is about 300–450 lines.
  - T150d is about 300–450 lines: the File items, the hidden state, the
    helper and about 19 call sites.
  - If the T150a diff is too large to read in one sitting, split it at step
    7: T150a1 is steps 1–6 and 8–11 without the card, and T150a2 is the
    card, the examples list and the import-dock rule.
  - Review round 1 (coordinator, 2026-11-21): tab sessions remember docks
    per mode; owned paths widened to `use-project-tab-sessions.ts`.
  - Review round 2 (2026-11-21): one line per fix.
    - Unseen Import Review is kept and marked on the Properties button
      (`data-review-pending`, "Properties, import review waiting"); only a
      seen review is cleared by Properties, the Netlist, inspection or a
      mode switch.
    - The `Import netlist…` input is cleared after each import, so the
      same file imports again.
    - Switching to Auto also drops a Net Label being placed and a control
      pick.
    - Overlays block the drawing-key switch by event target (dialogs,
      menus, open header menus, the canvas text editor's toolbar); the
      Agent file approval is `aria-modal`.
    - The running Auto Layout label is capped with an ellipsis; Cancel and
      Agent stay on screen at 800 and 1024 px.
    - A wire started from a Cell symbol layout pin brings up Draw.
    - Placements from the Cell Manager and the insert dialog bring up Draw.
    - A failed import closes the Netlist so its review shows.
    - At 760 px and below the button shows the elapsed seconds.
    - Opening a Project resets the other mode's remembered docks.
    - The no-op `activateTool("pointer")` on the switch to Auto is removed.
    - `performance.spec.ts` seeds Draw on its preview origin.
    - Focus moves to the Draw switch after `Draw it yourself →`, and to
      Cancel when a run starts from the focused Auto Layout button.
    - Owned paths widened to `editor-dialogs.tsx`, `editor-dialog-layer.tsx`
      and `performance.spec.ts` for these fixes.
  - Review round 3 (2026-11-21): one line per item.
    - A: while a code draft is unapplied, a mode switch keeps the project
      dock open, and a failed import neither closes it nor opens Properties.
    - B: Document settings apply live; a mode switch closes them, so hidden
      settings no longer hold the Project.
    - C: an import's review (report, open, seen) is kept per project tab in
      memory, not in the saved window; a reload drops it.
    - D: a report that replaces one on screen is seen at once (no dot).
    - E: in Auto the overlay guard runs before the Cell symbol layout takes
      `W`.
    - F: what closing a project dock reopens is kept per mode with the
      mode's docks.
    - G: placing from User Components brings up Draw (the component
      editor's command router is wrapped for `insert.start`).
    - H: measured at 320 and 390 px with a run in progress: nothing
      clipped, no CSS change; the measurement stays in the spec.
    - I: not done. The switch loses typed text on two paths (a `T` text
      draft not yet placed, and a Net Label name being typed); only an
      existing text being edited is committed. Left for the coordinator.
    - Owned paths widened to `user-components.spec.ts` (the Auto placement
      case).
- Keep `App.tsx` thin. New UI goes into feature files, and App.tsx only
  passes `mode` and handlers. Its JSX gains conditionals, not markup.
- Never write the Document from mode code: no `transact`, no
  `commitStructure`. The mode is not part of the Project file, the
  workspace snapshot or the Agent API.
- Do not rename existing data-testids. The only new ids are `mode-switch`,
  `mode-auto`, `mode-draw`, `mode-coach`, `mode-coach-dismiss`,
  `auto-layout-button`, `import-netlist-button`, `import-netlist-file`,
  `properties-panel-toggle`, `auto-empty-state`, `empty-choose-netlist`,
  `empty-open-project`, `empty-examples`, `empty-example-<id>`,
  `empty-draw`, `cells-rail`, `cells-rail-<documentId>` and `more-menu`.
- Touch the tab strip only in T150d.
- The example list must not render the example names until it is opened
  (`App.test.tsx:340-343`).
- If any decision above turns out to be wrong in the code, stop and report.
  Do not choose a different design yourself.
