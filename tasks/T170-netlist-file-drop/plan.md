# T170 — Drop a netlist to import and lay it out, or a Project file to open it, in Auto or Draw

- Branch: `task/T170-netlist-file-drop`
- Base: `main` at `2542db6`
- Status: approved
- Plan review: codex gpt-6.2-astra, 4 rounds. Round 1: changes required
  (4 P1, 5 P2, 1 P3, all taken); round 2: PASS, no P0/P1 (3 P2, 2 P3, all
  taken); round 3 after the owner changed the scope (both modes import;
  Project `.json` by drop): changes required (1 P1, 3 P2, 1 P3, all taken);
  round 4: PASS, no P0/P1 (3 P2, 3 P3, all taken). Scope decisions
  confirmed by the owner 2026-11-22.

## Goal

A person can drag a netlist file (or a netlist with its local include files),
or a Project file (`.json`), from the desktop onto the editor window and
release it — in Auto mode and in Draw. The drop does exactly what the
matching command does with that file:

- **SPICE / SCS** (`.cir/.sp/.spi/.scs`, with any `.inc/.lib`): the import
  of **Import netlist…** (native naming profile), behind the unsaved-work
  guard; Auto Layout then starts on every imported Cell that has a part by
  itself (T147).
- **Project file** (`.json`): the open of **File → Import → Project File…**,
  behind the same guard. A Project file has its own drawing, so no Auto
  Layout is started.

While a file is dragged over the window the page shows where it will land.
Today a dropped file does nothing on the canvas, is inserted as text by a
code editor, and anywhere else makes the browser leave the editor to display
the file.

## Context

Facts verified at `2542db6`.

**Netlist import already lays itself out.**

- `apps/editor/src/features/editor-shell/editor-file-commands.ts:367`
  `importSpiceFiles(files: FileList | null, namingProfile = "native")` reads
  the files (`readSources`, line 266), picks the entry (lines 274-283: among
  the `.cir/.sp/.spi/.scs` files, a single one whose base name is
  `circuit.spi` or `circuit.scs` wins; otherwise there must be exactly one;
  anything else sets the status
  `Select one unambiguous .cir, .sp, .spi, or .scs entry and its local include files; found N`),
  imports, and at line 408 calls `installImport(..., layout = true)`
  (defined at line 299), which runs `guardDirtyReplacement`,
  `replaceActiveProject`, sets the status
  `Imported N Documents and M structural instances` and calls `onImported`.
- `apps/editor/src/app/App.tsx:4480` passes
  `onImported: autoLayout.requestAfterImport`
  (`apps/editor/src/features/auto-layout/use-auto-layout.ts:241`), which
  queues the Auto Layout run for every imported Document with an Instance
  (line 249). Nothing in this task touches that chain.
- A `DataTransfer.files` is a `FileList`, so a drop can call
  `importSpiceFiles(event.dataTransfer.files)` unchanged. `readSources`
  spreads the list and starts every `file.arrayBuffer()` before its first
  suspension (line 268), so the files are captured inside the drop event;
  the call must therefore be made synchronously in the drop listener.
- `readSources` runs **outside** the `try` of `importSpiceFiles` (line 371).
  `file.arrayBuffer()` rejects for a dropped folder or an unreadable file,
  and today's callers discard the promise (`void importSpiceFiles(...)`), so
  the drop adapter must catch that rejection itself (step 1).

**Project file open.** `apps/editor/src/document/use-project-file-lifecycle.ts:887`
`openProjectFile(file: File | null, options = {})` stages the file
(`stageProjectFile`, `apps/editor/src/document/project-file-service.ts:130`)
and answers a staged rejection itself with
`Project not opened — ${formatProjectOpenDiagnostics(...)}` (line 899, e.g.
`INVALID_JSON`, `packages/project-protocol/src/load.ts:215`) before any
guard; a readable file is then opened behind `guardDirtyReplacement` (`Open ${file.name}`) or, with
`inTab`, into a new tab. `App.tsx:1060` already destructures it. File →
Import → Project File… calls `openProjectFile(file)` without options
(`editor-menus.tsx:438`); the tab strip calls it with `{ inTab: true }`
(`editor-menus.tsx:389`). The drop uses the plain call: the drop replaces
the open tab's Project, as the File menu item does.

**Where the imports live in the UI.**

- Auto's top bar button and its hidden input:
  `apps/editor/src/app/editor-app-chrome.tsx:283-306`
  (`data-testid="import-netlist-file"`, `accept=".spi,.cir,.sp,.scs,.inc,.lib"`).
  `App.tsx` passes `importNetlist={{ inputRef, onFiles: (files) => void importSpiceFiles(files) }}`
  through `apps/editor/src/app/editor-menus.tsx:586-589`.
- The empty card: `apps/editor/src/features/editor-shell/empty-state-card.tsx`
  (`data-testid="auto-empty-state"`), rendered at `App.tsx:7230-7236` inside
  `<div className="auto-canvas-overlay">` only when `editorMode === "auto"`
  and `projectInstanceCount === 0`. Its CSS is
  `apps/editor/src/styles/editor-workspace.css:726-800`.
- The top bar (`<header className="app-chrome">`) is a sibling above
  `<div className="app-workspace">` (`App.tsx:5192`), which holds the canvas
  and the docks; dialogs render in the header's File menu (the Shelf's
  native Browse `<dialog>`, `project-shelf.tsx:60`) or portaled to the
  document body, so the listeners must cover both.
- The mode: `editorMode` / `editorModeRef` at `App.tsx:685-693`. Both modes
  import now, so the hook does not read the mode.

**Existing drag and drop.**

- The canvas `<svg>` has React `onDragOver` (always `preventDefault`,
  `apps/editor/src/canvas/editor-canvas-event-handlers.ts:590`) and
  `onDrop: handleDrop` (`App.tsx:4713`), the placement tray's drop
  (`apps/editor/src/features/component-insert/placement-tray-commands.ts:35`):
  it reads `application/x-icm-instance` and returns when that is empty. A
  file dropped on the canvas today is swallowed silently.
- The Cell Manager reorders rows by drag
  (`apps/editor/src/features/hierarchy/cell-manager-dialog.tsx:402-494`,
  `text/plain`). Neither drag carries the `Files` type.
- The code docks mount CodeMirror
  (`apps/editor/src/features/project-code/project-text-editor.tsx`,
  `apps/editor/src/features/properties/component-property-json-editor.tsx`).
  CodeMirror's own `drop` handler inserts a dropped file's text into the
  draft (`@codemirror/view` `handlers.drop`, reading through a
  `FileReader`). A listener that ran after it would import **and** change
  the draft; this is why step 1 listens in the capture phase and stops
  propagation for file drags. The repository pins React and React DOM
  19.2.8 (`apps/editor/package.json`); capture on `window` runs before the
  React root's handlers and CodeMirror's.

**Modal state.** `drawingSwitchBlocked` in
`apps/editor/src/features/editor-shell/editor-mode.ts:138-157` detects a
modal with `root?.querySelector('dialog[open], [aria-modal="true"]')`, where
`root` is injectable and undefined without a DOM. The unsaved-work guard
itself is such a dialog (`apps/editor/src/components/replace-guard-dialog.tsx:50`,
buttons `Stay` at line 125 and `Continue without saving` at line 116).
While one is open no button starts an import, so a drop must not either.

**Unsaved-work guard and tests.**
`apps/editor/src/document/use-project-file-lifecycle.ts:291` `hasUnsafeWork`
is false once the current snapshot was exported as a Project file. The e2e
helper `exportedProject` (`apps/editor/e2e/editor-fixtures.ts:612`) performs
that export, so a test that calls it before a replacement **disarms the
guard**.

**Both other entries mount the same `App`.**
`apps/editor/src/entries/notebook.tsx:63` (mounts and unmounts it) and
`apps/editor/src/entries/desktop.tsx:33`. Builds: `pnpm build:notebook-editor`
and `pnpm test:desktop-build` (`package.json:89,100`).

**Tests and docs that describe this surface.**

- `apps/editor/e2e/editor-modes.spec.ts` opens the editor in Auto with
  `test.use({ storageState: AUTO_MODE_STORAGE })` (line 23; exported from
  `editor-fixtures.ts:46`); the rest of the suite opens in Draw.
- `apps/editor/e2e/netlist-auto-layout.spec.ts` (T147's cases; its `FINAL`
  regex at line 11 matches the last status of an import's layout run).
- `apps/editor/e2e/editor-modes.spec.ts:165` opens a Project file through
  the empty card's chooser with `exampleProject("two-stage-op-amp.icproj.json")`;
  `editor-modes.spec.ts:770-782` shows the Netlist code editor located by
  `getByLabel("Netlist code", { exact: true })`, and line 1302 reads the
  revision as
  `getByTestId("editor-test-telemetry").getByTestId("revision")` (Import
  Review has a `revision` id too).
- `apps/editor/src/features/editor-shell/empty-state-card.test.tsx` and
  `editor-mode.test.tsx` (jsdom, `createRoot` + `act`; no testing-library).
- Include syntax the importer accepts: `packages/spice/src/import-reference.test.ts:61`
  (`.include child.spi` then `X1 A B child`).
- `docs/specs/editor-interaction.md:451-468` (Auto and its card),
  `docs/user/getting-started.md:18-47`.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/features/editor-shell/use-file-drop.ts` (new)
- `apps/editor/src/features/editor-shell/use-file-drop.test.tsx` (new)
- `apps/editor/src/features/editor-shell/editor-mode.ts` (export the modal
  test only) and `editor-mode.test.tsx`
- `apps/editor/src/features/editor-shell/empty-state-card.tsx`
- `apps/editor/src/features/editor-shell/empty-state-card.test.tsx`
- `apps/editor/src/app/App.tsx` (the hook call and the overlay element only)
- `apps/editor/src/styles/editor-workspace.css`
- `apps/editor/e2e/file-drop.spec.ts` (new)
- `docs/specs/editor-interaction.md` (the Modes section)
- `docs/user/getting-started.md`
- `tasks/T170-netlist-file-drop/`

Out of scope (do not change):

- `editor-file-commands.ts`, `use-auto-layout.ts`, `use-project-file-lifecycle.ts`
  and everything after the calls into them: the imports, the guard, the
  report and the layout run stay as they are.
- RNL import by drop; the Cadence (`!` globals) naming profile by drop;
  opening a dropped Project file in a new tab.
- Dropping a folder (refused with a status line). A set of files that
  contains a `.json` must be that one file (several are refused); any other
  set follows the existing netlist entry and include rules, which the
  importer already applies.
- The placement tray's and the Cell Manager's drags; text and link drags
  into inputs and code editors.
- `apps/desktop/` and `apps/editor/src/notebook/` (no change; the two builds
  are run in acceptance, a native drop in Electron stays unverified).

## Steps

1. **The hook.** Add `useFileDrop` in
   `apps/editor/src/features/editor-shell/use-file-drop.ts`:

   ```ts
   export function useFileDrop(options: {
     /** Must start reading the files before it first suspends. */
     importNetlist: (files: FileList) => Promise<void>;
     openProjectFile: (file: File) => Promise<unknown>;
     setStatus: (status: string) => void;
   }): { dragActive: boolean };
   ```

   It registers `dragenter`, `dragover`, `dragleave` and `drop` listeners on
   `window` in the **capture** phase, in one effect (removed on unmount, with
   the same capture flag), and keeps the latest options in a ref so the
   effect runs once.

   - A drag **carries files** when
     `[...(event.dataTransfer?.types ?? [])].includes("Files")`. Every
     listener returns at once for any other drag, before `preventDefault` or
     `stopPropagation`, so the tray drag, the Cell Manager drag and text or
     link drags into inputs and code editors behave as today.
   - For a drag that carries files every listener calls `preventDefault()`
     and `stopPropagation()`. That stops the browser from opening the file
     and keeps CodeMirror and the canvas from also handling it, with a modal
     open as well.
   - **Modal first.** First export from `editor-mode.ts` the modal test that
     `drawingSwitchBlocked` ends with, as
     `modalDialogOpen(root = <the same default>)`, and call it from
     `drawingSwitchBlocked`; keep its injectable `root` and the
     no-`document` case. With a modal open: `dropEffect = "none"`, the frame
     never shows, and a drop does nothing and sets no status.
   - Otherwise `dragover` sets `dataTransfer.dropEffect = "copy"`.
   - **Frame.** Keep a depth counter in a ref: `dragenter` adds one,
     `dragleave` subtracts one (never below zero), `drop` resets it to zero.
     `dragActive` is `depth > 0 && no modal`, evaluated in each of the four
     listeners; it is false after the depth reaches zero or a drop. No
     `dragend` listener (that event goes to the drag's source, which is
     outside the page) and no reliance on `relatedTarget`.
   - `drop` with files, after the calls above, in this order:
     1. a modal is open → nothing;
     2. any `dataTransfer.items` entry of kind `"file"` whose
        `webkitGetAsEntry?.()?.isDirectory` is true →
        `setStatus("Drop the file itself, not a folder")`;
     3. let `files = [...dataTransfer.files]`; if none → nothing; if any
        name matches `/\.json$/iu`:
        - exactly one file → `openProjectFile(files[0]!)` and stop;
        - several → `setStatus("Drop one Project file at a time")` and stop;
     4. otherwise, synchronously,
        `importNetlist(dataTransfer.files).catch(() => setStatus("Couldn't read the dropped file"))`.

   No netlist extension check: `readSources` already answers a drop with no
   or several entries with its `Select one unambiguous …` status, the same
   words the chooser path gives.

2. **Wire it in `App.tsx`.** Call the hook after `createEditorFileCommands`
   (line 4443) with `importNetlist: (files) => importSpiceFiles(files)`,
   `openProjectFile: (file) => openProjectFile(file)` and `setStatus`.
   Render, as the last child of the element that wraps the top bar and
   `.app-workspace`, when `dragActive`:

   ```tsx
   <div className="file-drop-overlay" data-testid="file-drop-overlay" aria-hidden="true">
     <p>Release to open the file</p>
   </div>
   ```

   It covers the whole window (`position: fixed; inset: 0`), sits above the
   docks and the top bar, has `pointer-events: none` (so it never becomes the
   drag's target), a translucent backdrop and a dashed frame using the
   existing `--icm-*` tokens. Add the CSS next to `.auto-canvas-overlay` in
   `editor-workspace.css`. No transition.

3. **Say it where people start.** In `empty-state-card.tsx` change the note
   from `.sp / .spi / .cir / .scs` to
   `Drop a netlist (.sp / .spi / .cir / .scs) or a Project file (`.json`)
   anywhere on this page, or choose one`. Update `empty-state-card.test.tsx`
   if it asserts the note.

4. **Unit tests** in `use-file-drop.test.tsx` (jsdom, the `createRoot` +
   `act` pattern of `empty-state-card.test.tsx`; build events with
   `new Event(type, { bubbles: true, cancelable: true })` and
   `Object.defineProperty(event, "dataTransfer", { value: fake })`, dispatched
   on a child element so capture at `window` is what is tested; a bubble
   listener on that child records whether the event reached it):

   - a netlist drop calls `importNetlist` once with the FileList, is
     `defaultPrevented` and does not reach the child's listener;
   - a single `.json` drop calls `openProjectFile` with that File and not
     `importNetlist`; two `.json` files set
     `Drop one Project file at a time` and call neither; a `.json` together
     with a `.sp` sets the same line and calls neither;
   - `dragenter` + `dragover`: `defaultPrevented`, `dropEffect` `"copy"`,
     `dragActive` on; a second `dragenter` (another element) then one
     `dragleave` keeps it on; the second `dragleave` turns it off; a `drop`
     turns it off whatever the depth;
   - with an `[aria-modal="true"]` element in the document: `dragover` gives
     `dropEffect` `"none"`, `dragActive` stays false, a drop is
     `defaultPrevented` and calls neither callback;
   - a drop whose item reports `isDirectory` sets the folder status and
     calls neither callback; an item whose `webkitGetAsEntry` returns `null`
     is treated as a file;
   - a rejecting `importNetlist` sets `Couldn't read the dropped file`;
   - drags without the `Files` type (types `["application/x-icm-instance"]`,
     `["text/plain"]`, `["text/uri-list"]`): none of the four events is
     `defaultPrevented`, each reaches the child's listener, nothing changes;
   - the listeners are gone after unmount.

   In `editor-mode.test.tsx` add a case for `modalDialogOpen`: true with a
   matching element, false without, and false with no DOM (stub the global
   `document` to `undefined` with `vi.stubGlobal` and restore it; passing
   `undefined` as the argument would only pick the default and query the
   live document).

5. **Browser tests** in `apps/editor/e2e/file-drop.spec.ts`. A helper
   dispatches a synthetic drag with a real `DataTransfer`:

   ```ts
   const data = await page.evaluateHandle((files) => {
     const transfer = new DataTransfer();
     for (const { name, text } of files)
       transfer.items.add(new File([text], name, { type: "text/plain" }));
     return transfer;
   }, files);
   for (const type of ["dragenter", "dragover", "drop"])
     await page.dispatchEvent(selector, type, { dataTransfer: data });
   ```

   Netlists come from
   `apps/editor/src/features/auto-layout/auto-layout-fixture.test-support.ts`,
   as `netlist-auto-layout.spec.ts` imports them. Wait for an import's layout
   with that file's `FINAL` pattern (copy the regex; do not edit that spec).
   The cases that need Auto start with
   `test.use({ storageState: AUTO_MODE_STORAGE })` in a `describe` block;
   the Draw case uses the suite default.

   - **Empty page.** After `dragenter` + `dragover` on the card the frame
     (`file-drop-overlay`) is visible; after `drop` it is gone, the status
     reaches `Imported 1 Document … Auto Layout applied`, the card is gone,
     and the exported top Document has routes (`exportedProject`, as
     `netlist-auto-layout.spec.ts:49-54`).
   - **Frame across elements.** `dragenter` on the card, `dragenter` on
     `header.app-chrome`, `dragleave` on the card: the frame stays;
     `dragleave` on the header: it is gone and nothing was imported.
   - **On the top bar.** The drop dispatched on `header.app-chrome` imports.
   - **Entry with an include file.** Drop `top.sp` (`.include child.inc` and
     an `X` instance of `child`) together with `child.inc` (the `.subckt`):
     the status reads `Imported 2 Documents`, so the include reached the
     importer.
   - **A Project file.** Drop `two-stage.icproj.json` written with
     `serializeProject(exampleProject("two-stage-op-amp.icproj.json"))`
     (`serializeProject` from `@icm/project-protocol`; the plain
     `JSON.stringify(exampleProject(...))` that
     `editor-modes.spec.ts:165` uses carries an older schema and reports the
     upgrade status instead). Expect the card gone, the status starting
     `Opened two-stage.icproj.json`, and the instance count from
     `page.getByTestId("editor-test-telemetry").getByTestId("instance-count")`
     (the inspector has an `instance-count` id too) not `0`.
     Then, in a **fresh page**, open the same bytes with the File-menu
     helper `openProjectFile(page, bytes)` (`editor-fixtures.ts:595`); after
     both settle (export only after the guard assertions, below), compare
     `exportedProject` Document revisions, instance positions and route
     counts: the drop queued no Auto Layout, so they are equal.
   - **A Project file over unsaved work.** With a Project imported and
     edited (revision changed), drop the same `.json`: the guard appears;
     **Stay** keeps the revision; drop it again, **Continue without saving**:
     the status starts `Opened two-stage.icproj.json`, and the project-tab
     count did not grow:
     `page.getByTestId("project-tabs").getByRole("tab", { includeHidden: true })`
     (the strip hides with one project, `project-tabs.tsx:108`) is 1 before
     and after — the drop replaces the open tab, as the File menu item does,
     and no new tab skips the guard.
   - **A malformed Project file.** Drop `broken.json` (`"{ nope"`) over that
     Project: the status starts `Project not opened — INVALID_JSON:`, the
     revision is unchanged and no guard appears.
   - **Two Project files.** Dropping both `.json` files sets
     `Drop one Project file at a time` and changes nothing.
   - **Unsaved work.** Read the revision as
     `page.getByTestId("editor-test-telemetry").getByTestId("revision")`
     (`editor-modes.spec.ts:1302`). Drop `NETLIST_A`, wait for its layout,
     rotate a part and wait for the revision to change (do **not** call
     `exportedProject` before the guard: it stamps the snapshot safe). Drop
     `NETLIST_B` on the canvas: the replace guard dialog appears; **Stay**:
     the revision is the one after the rotation. Drop `NETLIST_B` again;
     while the guard is open drop `resistorChainNetlist(3)` (nothing
     changes); click **Continue without saving** on that same dialog. After
     the layout, `exportedProject` has a Document named `stage` and none
     named `chain`: the drop behind the dialog did not replace the pending
     import.
   - **On an open code dock.** With a Project imported and the Netlist dock
     open, take the editor as
     `page.getByLabel("Netlist code", { exact: true })`
     (`editor-modes.spec.ts:775`) and attach a `drop` listener on that
     element that counts deliveries (`page.evaluate`). Drop `notes.txt` on
     it: the counter is 0, the editor text is unchanged and the status reads
     `Select one unambiguous … found 0`. (CodeMirror inserts from a
     `FileReader` callback, so unchanged text alone could pass too early.)
   - **Draw mode.** In Draw (suite default), drop `NETLIST_A`: the status
     reaches `Imported 1 Document … Auto Layout applied`, and the drawing
     toolbar is still Draw's.
   - **The other drags still work.** The Cell Manager's reorder
     (`hierarchy.spec.ts:952`, an HTML drag) must pass unchanged; acceptance
     runs that file. The placement tray's drop has no browser case today
     (`grep -rn "x-icm-instance" apps/editor/e2e` is empty): the unit test in
     step 4 is its guard. Do not add a tray case here.

6. **Investigate: a native drag.** A synthetic `drop` runs the handler but
   proves neither that the browser fires `drop` on release nor that it stays
   on the page. In the same spec try one case with Chromium's own drag
   pipeline: write `NETLIST_A` to `testInfo.outputPath("circuit.sp")`, then
   through `page.context().newCDPSession(page)` send `Input.dispatchDragEvent`
   `dragEnter`, `dragOver` and `drop` at a point on `header.app-chrome` with
   `data: { items: [], files: [<that path>], dragOperationsMask: 1 }`. Expect
   the import's final status and `page.url()` unchanged. Second, send
   `dragEnter` and `dragOver`, see the frame, send `dragCancel`, and expect
   the frame gone with the revision and the status unchanged. The CDP
   `drop` only shows the renderer's response to that command, not that
   Chromium itself chooses `drop` when a file is released over a target; the
   report therefore lists a real desktop release over the header and a real
   Escape cancellation as **manual checks for the reviewer**, and says which
   of them were actually performed. If the suite's Chromium does not deliver
   files this way, remove those cases and record in the report what happened
   (the error or the observed behavior). Do not spend more than a short
   attempt on it.

7. **Documents.** In `docs/specs/editor-interaction.md`, Modes, add after the
   **Auto** bullet (and a sentence in the **Draw** bullet): a netlist file
   or a Project file (`.json`) dragged from outside onto the window is
   imported as by **Import netlist…** / **File → Import → Project File…**
   — same entry rule, same guard, same Auto Layout for a netlist — in both
   modes; the window shows a drop frame while the file is over it; behind a
   modal dialog a dropped file does nothing; a folder is refused with a
   status, a set of files containing a `.json` must be that one file, and
   every other set follows the chooser's existing entry and include rules; a
   dropped file is never opened by the browser nor inserted into a code
   editor. In `docs/user/getting-started.md` add the drop to the "To
   start from a netlist" paragraph (line 31) and, in the Project-file
   paragraph (line 229), say that a `.json` dropped on the window opens in
   the current tab with its drawing kept, replacing the open Project behind
   the same unsaved-work prompt.

## Acceptance

Run from the repository root; all must pass. Lane 2 (docs/workflow.md); its
database `auto_canvas_test_2` already exists on this machine.

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm typecheck        # exit 0
pnpm lint             # 0 errors
pnpm format:check     # exit 0
pnpm docs:check       # exit 0
pnpm test:local       # all pass, including use-file-drop.test.tsx
pnpm build            # exit 0
pnpm build:notebook-editor   # exit 0
pnpm test:desktop-build      # exit 0
npx playwright test apps/editor/e2e/file-drop.spec.ts apps/editor/e2e/editor-modes.spec.ts apps/editor/e2e/netlist-auto-layout.spec.ts apps/editor/e2e/project-file.spec.ts apps/editor/e2e/hierarchy.spec.ts   # all pass
pnpm deadcode         # exit code and findings as on main; no new finding
```

Behavioral checks:

- In Auto and in Draw, `NETLIST_A` dropped anywhere on the window (card,
  canvas, top bar, an open dock) ends with the schematic laid out and the
  status `… Auto Layout applied`; the page never navigates away and no code
  draft changes. Any other netlist dropped gives the same result as choosing
  those bytes through **Import netlist…** (which may honestly read
  `Already laid out` or leave a Cell as it was).
- A `.icproj.json` dropped the same way opens that Project.
- The frame shows only while a file is over the window with no modal open,
  and never stays after the drag ends, leaves or is cancelled.
- **Import netlist…**, **Choose netlist file…**, File → Import, the
  placement tray's drag and text dragged into a code editor behave as before.

## Notes for the implementer

- Decisions already made (owner, 2026-11-22): both modes import; Project
  `.json` files are supported by drop; a file dropped on a code editor is
  imported rather than inserted as text, in both modes; no new auto-layout
  for a Project file; a netlist drop uses the native naming profile, as the
  top bar's button does.
- Do not pass a filtered array to `importSpiceFiles`; it takes the
  `FileList`. Include files (`.inc`, `.lib`) dropped together with the entry
  must reach it.
- The listeners go on `window`, not on a React element: that covers the
  whole editor, including dialogs portaled to `document.body`, and capture
  there runs before the React root's handlers and CodeMirror's own, which
  `stopPropagation()` then keeps from receiving a file event.
- Do not start, stop or restart anything on port 4310 (the owner's running
  server) and do not use port 5173.
- Commits end with `Test-Impact: tests-updated` and the co-author trailer.
  Never commit anything under `tmp/`.
