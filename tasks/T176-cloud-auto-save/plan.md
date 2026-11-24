# T176 — Cloud auto-save for the active tab, toggle in the account menu

- Branch: `task/T176-cloud-auto-save`
- Base: `main` at `af05b80` (includes T174)
- Status: approved
- Plan review: codex round 1 NEEDS REVISION (5 P1, 7 P2); revised; further codex rounds on request only

## Goal

In every web editor that has Cloud storage (accounts, local and notebook
modes; never the desktop build), a Cloud Project that is already bound saves
itself about 3 s after the person or the Agent stops editing it. It goes
through the same foreground save path as Ctrl+S.

- **Only the active tab auto-saves.** An edit to an inactive tab, including
  an Agent edit, marks that copy unsaved and arms it; it saves once it is
  active and idle.
- **What it never does:** create a Cloud Project, or upload restored or
  recovered state on its own.
- **When it waits:** while a gesture, draft, dialog, replacement decision or
  sign-out is in progress.
- **After a failure:** it stops until that failure is resolved.
- **Preference:** on by default and stored in the browser. Only the
  accounts-mode header account menu shows a toggle; other modes use the
  stored value.
- **Statusbar:** a chip reports the active bound Project's real state:
  saving, saved, unsaved, off, offline or paused. Unbound drawings show no
  chip.
- **No Cloud (desktop):** nothing changes.

## Context

Facts checked at `af05b80`; line numbers refer to it. T174 changed only the
menu, chrome, CSS, docs and e2e files listed below. The save, tab and Agent
files are byte-identical to `d2e59c3`.

**Save path (`apps/editor/src/document/`)**

- **Coordinator.** `project-save-coordinator.ts:52-88`
  `createProjectSaveCoordinator` runs one operation at a time.
  - While one runs, a second non-Save-As request joins it and gets the same
    promise (`:57-60`); it does not save content committed after the first
    snapshot. Save As gets `rejected("busy")`.
  - The candidate is `request.candidate`, else `await beforeSnapshot()`, else
    `current().project` (`:62-66`). With neither of the first two, there is
    no await before `write()`.
  - After an await it rechecks only the session id (`:68`).
- **Lifecycle.** `use-project-file-lifecycle.ts`:
  - `ProjectFileSession` (`:61-69`) is the per-tab file state. It is captured
    on tab switch and persisted with the window workspace
    (`app/use-project-tab-sessions.ts:545-560`).
  - **Render-time binding.** `persistenceStateRef` has a synchronous setter
    (`:317-328`), but `cloudBinding` (`:329-331`) is React state only.
    `performProjectSaveToCloud` (`:587-664`) uses the render-time
    `cloudBinding` for the recovery stage (`:601`) and the PUT (`:603-607`).
    So do `captureFileSession` (`:1672-1680`, which also returns the
    render-time `savedProjectBaseline`), `restoreSavedProjectBaseline`
    (`:1065-1075`) and `noteGalleryPublication` (`:1705-1708`). A save that
    starts after a receipt but before the re-render sends the old revision.
  - **Save outcomes.** `performProjectSaveToCloud` sets `"saving"` and writes
    the status "Saving … to Cloud" (`:598`).
    - Receipt: sets the binding and baseline, then `"clean"` if the live
      Project still equals the candidate, else `"dirty"` (`:622-631`).
    - Failures (`:640-663`): `unreachable` gives `offline`, `conflict` gives
      `conflict`, and every other failure gives `failed`.
    - A receipt from an older activation is dropped (`:609`, `:629`).
  - **`saveProjectToCloud(candidate?, asNew)`** (`:669-709`). Callers:
    - `saveProjectToCloudByHand` (`:712`) and `saveByHand` (`:719`), behind
      Ctrl+S (`app/use-editor-shortcuts.ts:563`) and File → Save.
    - Check and Save (`app/App.tsx:1843`).
    - `saveAndContinueReplaceGuard`.
    - The Agent's foreground `save` (`app/agent-workspace-requests.ts:234`).
  - **Check and Save is gated twice.** `app/use-project-check.ts:48` returns
    at once when `isSaving()` is true, and App passes `isSaveInFlight`
    (`App.tsx:1845`). File disables the command while `saveBusy` is true
    (`app/editor-menus.tsx:464`), where `saveBusy` is
    `persistenceState === "saving"` (`:1741`).
  - **Replacement commands** all start in `beginReplacement` (`:378-402`;
    `beginReplacementCommand` is `:404`). Callers: the guard (`:894`),
    recovery restore (`:1099`), file open (`:1251`), Cloud open (`:1375`), the
    refresh restore (`:1507`, silent), and App's dropped netlist and file
    (`App.tsx:4535`, `:4547`).
    - The exact-content shortcuts install directly, without the guard: file
      open `:1318-1323`, Cloud open `:1444-1448`.
    - `guardDirtyReplacement` (`:889-940`) refuses during a native save
      (`:900-905`) but not during a Cloud save.
    - Revert (`:1077-1084`) reinstalls the cached baseline with the same
      `cloudBinding`.
    - Recovery restore installs the record's binding (`:1138-1147`), so two
      tabs can hold the same binding.
  - **Live-edit observer.** The effect at `:1597-1636` sets `dirty` or `clean`
    when the change token differs inside the same session (`:1621-1631`).
    `restoreFileSession` (`:1681-1699`) and `replaceActiveProject`
    (`:530-585`) set a new baseline without marking anything. This is the one
    place where a live committed edit is told apart from a passive restore.
  - `isSaveInFlight` (`:1739-1740`) covers the Cloud and native coordinators.
    `hasPendingEdits` is not passed by App.
- **App's `beforeSnapshot`** is `async () => editorDocumentController.project`
  (`App.tsx:1030`, `:1093`). It never returns null and resolves in a
  microtask.

**Tabs**

- **`document/use-project-tabs.ts`.**
  - `transition` (`:119-141`) awaits `prepare()`, then synchronously captures
    the outgoing tab and restores the incoming one. `transitioning` (`:59`)
    has no reader.
  - `currentId()` (`:187`) is live, but `activeId` is the render's value.
  - `entries()` (`:192-199`) returns a **fresh capture** for the active tab
    and the stored object for the others.
- **`app/use-project-tab-sessions.ts`.**
  - Tab sessions: `restoreTabSession` (`:330-362`) restores the file session
    at `:343`. `createTabSession` is `:364-425`. `tabSessionFromPortable`
    (`:427-466`) is used after a refresh and for reopen (`:788`); it maps
    `saving` to `dirty` (`:455-461`).
  - Blockers: `projectSwitchBlocker` (`:671-681`, `projectHoldReason` in
    `features/editor-shell/edit-blockers.ts:44`) covers editing in progress
    (`editInProgress`, `:659-667`), `saving` (Cloud and native coordinators,
    native workspace, `cloudMutation`), the replace guard and the recovery
    dialog.
  - Who refuses on that reason: tab `prepare` (`:693-722`), Shelf rename and
    delete (`manageCloud`, `:859-872`), sign-out (`useBeforeAccountLogout`,
    `:1053-1062`, which checks once and then awaits `flushWorkspace`), and
    the Agent's `activate` and `new` (`WORKSPACE_BUSY`).
  - `updateOpenCloud` (`:874-899`) rewrites file sessions with spreads, so new
    fields survive it.
- **Closing tabs.** Closing the active tab goes through `transition`.
  `dropDiscardedWork` (`:734-742`) is returned, but nothing in the repository
  calls it.
- **Inline close decision.** It is local state of `ProjectTabs`
  (`features/editor-shell/project-tabs.tsx:391-462`,
  `data-testid="project-tab-close-decision"`).

**Agent**

- **`app/agent-workspace-requests.ts`.** `createAgentWorkspaceHandler` runs
  `await import("../agent/workspace-copy")` (`:83-85`) before it reads
  `entries()` and the render-captured `projectTabs.activeId` (`:87`,
  `:131`).
  - **Background `save`** of an inactive tab (`:131-233`) calls
    `projectStore.save` directly and applies the receipt to the stored
    session. Its "now active" checks (`:195`, `:222`) use the captured
    `activeId`. If the tab became active during the save, the receipt lands
    on a throwaway capture.
  - Two background requests for one tab can overlap. A late Save receipt can
    then overwrite a Save As binding.
  - A thrown save leaves the tab in `"saving"` (`:159`, outer catch `:342`).
  - **Background edits** mark the stored session at three places: rename
    (`:292-306`), copy into the target (`:332-339`), and the cached host's
    `committed` callback in `createAgentWorkspaceTargets` (`:403-420`). That
    callback also decides "active" from the captured `activeId` (`:411`), and
    calls the `synchronizeExternalCommit` captured when the host was built.
- **`app/use-agent-hosts.ts`.**
  - The foreground host's commit callback (`:152-170`) calls the **latest**
    `synchronizeExternalCommit`. If the person switched tabs while an Agent
    operation was running, a commit to the old tab's controller is handed to
    the new tab's synchronizer. That synchronizer
    (`document/document-controller.ts:855-859`) then does nothing for the
    committing controller, so the old tab keeps a clean mark.
  - `agentFileCandidate` (`:205`) is non-null while an Agent replacement
    waits for approval. `agentPlanning` (`:121-149`) is always truthy.
- **Existing coverage.** The Agent e2e helper sends background edits with
  `client.workspaceId` set to an inactive tab
  (`e2e/web-agent-session.spec.ts:808-836`, `agent.circuit(placeResistor(...))`).
  Background Save As is exercised at `:1097-1105`.

**Interaction state**

- **Interaction kinds** (`interaction/interaction-state.ts:199-240`, read
  through `getCurrentState`, `App.tsx:1257-1311`).
  - In progress: a wire with `source !== null`, `steps.length > 0` or
    `labelEditing`; drawing with `source !== null` or waypoints; a power rail
    with `start !== null`; `copy-placement`; `moving-selection`;
    `cell-symbol-layout` with `gesture !== null`.
  - Not in progress: a merely selected tool (wire with `source === null`,
    placing-component).
- **Pointer gestures.** Pan and marquee state is private to
  `canvas/canvas-gesture-controller.ts:505-546`. A window-level "pointer
  button held" flag covers them.
- **Dialogs.** `modalDialogOpen()` is `features/editor-shell/editor-mode.ts:133-140`.
- **Name trap.** Inside `WorkspaceEditor`, `document` is the
  `SchematicDocument`, so use `globalThis.document`.

**Account menu, statusbar, store, preference**

- **Account menu.** `accounts/header-account-menu.tsx` (with T174) renders
  only with an `AccountContext`, which exists only in accounts mode
  (`accounts/account-gate.tsx:300`).
  - Layout: identity, separator (`:91`), then with `cloudProjects` the My
    Cloud Projects `CommandSubmenu` block (`:92-135`) ending in a separator
    (`:134`), then Sign out (`:136-143`). The popover is a `role="group"`
    (`:79`).
  - Mounted at `app/editor-app-chrome.tsx:535`. Styles are in
    `styles/editor-chrome.css`, next to `.header-account-popover`.
  - The web build always has a `projectStore`
    (`services/web-editor-services.ts:19`).
- **Statusbar.** Chips are rendered in
  `features/editor-shell/editor-statusbar.tsx:166-300`; the recovery chip is
  at `:273-281`. The statusbar is rendered from `App.tsx:7434-7470`. Chip
  styles are in `styles/editor-overlays.css:398`.
- **Store.** `features/editor-shell/cloud-projects.ts`:
  - Outcomes: `saved | signed-out | too-large | limit | conflict | not-found | rejected | unreachable`
    (`:34-42`).
  - Requests: POST to create, PUT with `If-Match: revision-N` to update
    (`:109-117`).
  - Server: an identical-bytes write returns the existing revision
    (`apps/server/src/projects.ts:152`); a changed write with a stale
    revision gets 409.
- **Preference pattern.** `features/editor-shell/editor-mode.ts:10-45`
  (global key `icm.editor-mode.v1`) keeps the in-session choice even when
  storage fails (`:95`).

**Specs and docs**

- `docs/specs/persistence-and-recovery.md`, "Working-copy transitions" (`:146-175`).
- `docs/specs/editor-interaction.md:410`: "Renames mark dirty but never save".
  The account-menu bullet is `:571-581`.
- `docs/user/getting-started.md:220-227`, "Save and recover".

**Tests**

- **E2e specs that save to Cloud** (grep for `ControlOrMeta+s`,
  `save-cloud-project`, `check-and-save` and Agent `action: "save"`):
  - Default run: `project-file`, `project-tabs`, `cloud-projects-server`,
    `web-agent-session`, `editor-shell`, `diagnostics-surfacing`,
    `selection-and-find`, `user-components`, `wiring-semantics`,
    `bus-productivity`, `label-typography`.
  - Other runs: `base-path` (prefix run), `standalone-accounts` (accounts
    run), `notebook-auth` and `notebook-worker` (notebook run).
- **Shared seeding.** All of them take the shared `use.storageState`
  (`playwright.config.ts:238-249`). Playwright copies it into contexts that
  tests create.
  - The specs that override it (`editor-modes.spec.ts:23`,
    `file-drop.spec.ts:138` with `AUTO_MODE_STORAGE` from
    `e2e/editor-fixtures.ts:46`, `notebook-evidence.spec.ts:44`, `:117`) make
    no Cloud saves.
  - `intranet-http.spec.ts:12` seeds by init script and makes no save.
- **CI** runs no Playwright (`.github/workflows/ci.yml`), so e2e evidence is
  local.
- **Unit tests:**
  - `document/use-project-file-lifecycle.test.tsx` (harness with `cloudStore`
    and `deferred()`, `:1-80`).
  - `document/project-save-coordinator.test.ts`, `document/use-project-tabs.test.ts`,
    `app/use-project-tab-sessions.test.ts` (pure helpers),
    `app/use-agent-hosts.test.tsx`, `app/project-check.test.tsx`,
    `accounts/header-account-menu.test.tsx`,
    `features/editor-shell/editor-statusbar.test.tsx`.
  - `app/App.test.tsx:211-240` renders server-side inside `AccountContext`,
    so the new hook must be SSR-safe.
- **Baseline.** The main checkout's `.baseline/` is from 2026-11-05
  (`9f2d88e`, `test:local` failing), so it is unusable. Record a fresh
  baseline on this base.

## Design

1. **Where it runs.** App passes an `autoSave` option to
   `useProjectFileLifecycle` whenever `projectStore && !nativeProjectStore`.
   Without the option the hook behaves as today; that covers desktop and all
   existing unit tests. The toggle renders only in the accounts-mode account
   menu.
2. **Arming.** `autoSaveArmed` is lifecycle state with a ref, captured and
   restored with `ProjectFileSession`.
   - **Set by:** the live-edit branch of the change-token effect, and
     `noteExternalCommit()`. That new lifecycle function sets armed, and if
     the state is `clean` or `unbound` and the content differs from the saved
     baseline, sets `dirty`; it covers Agent commits that land between
     activation and its first render.
   - **Cleared by:** `replaceActiveProject`, and a receipt that matches the
     live content.
   - **Reset on refresh and reopen:** `tabSessionFromPortable` sets it false.
   - **Agent commits are routed to the committing controller**
     (`noteAgentCommit(controller)`, assigned in App through a ref):
     - If that controller is the controller of `projectTabs.currentId()`,
       call the latest `synchronizeExternalCommit`, then
       `noteExternalCommit()`.
     - Otherwise find its stored tab and set `dirty`, `unsafe`,
       `persistenceState = "dirty"` and `autoSaveArmed = true`. Write its
       recovery snapshot as `updateOpenCloud` does (`:887-895`), then call
       `projectTabs.changed()`.
     - Both the foreground host (`use-agent-hosts.ts:155-163`) and the cached
       background host (`agent-workspace-requests.ts:403-420`) call it; so do
       the rename and copy branches, through the same helper.
3. **Holds.** A failed write records a hold in the file session:
   `{ kind, bindingId, revision, onlineEpoch? }`.
   - **Which failures count:** only an actual write attempt. The kind is the
     outcome status, `offline` for `unreachable`, and `rejected` for a thrown
     store call. A Save As failure or a pre-write rejection records nothing.
   - **When it applies:** while it matches the current binding's id and
     revision. An `offline` hold applies only while `onlineEpoch` equals the
     epoch **at the start of the attempt**. A module-level counter in
     `cloud-auto-save.ts` is increased by one window `online` listener.
   - **Merging:** an existing applicable `conflict` is never replaced.
   - **Clearing:** a successful save clears it. Replacement does **not**
     clear it: Revert reinstalls the same binding and stays held, while a new
     binding is released implicitly by the match rule.
   - **Background Agent saves** apply the same merge and clear rules to the
     stored session.
   - **Persistence:** holds persist with the workspace, and
     `tabSessionFromPortable` drops `offline` holds.
4. **Scheduling.** A copy is eligible when all of these hold: enabled,
   bound, armed, `persistenceState` in `dirty | offline | failed | conflict`,
   and no applicable hold.
   - **Timer:** an effect keyed on enabled, armed, `persistenceState`, binding
     id and revision, applicable hold, `currentProjectChangeToken`,
     `projectSessionId`, online epoch and retry tick. It waits 3000 ms from
     the last committed edit.
   - **When it fires:** it re-reads refs. If the copy is no longer eligible,
     it does nothing. If anything blocks, it re-polls every 500 ms. Otherwise
     it saves.
   - **What blocks:**
     - `saveCoordinator.isSaving()`;
     - `replacementInFlight()`;
     - the App `autoSave.blocker()`: `projectSwitchBlockerRef.current()`,
       `projectTabs.isTransitioning()`, `isSigningOut()`,
       `agentFileCandidate !== null`, `interactionHoldsAutoSave(state)`, a
       held pointer button, `modalDialogOpen()`, or a tab close decision on
       screen.
   - **After each settle:** the retry tick increments.
5. **The automatic save** calls the coordinator with **no `beforeSnapshot`
   and no candidate**. The coordinator then reads `current().project` and
   calls `write()` with no await in between, so the content sent is the
   content at admission.
   - This is safe because the blocker already excludes text editing and code
     drafts (`editInProgress`), and App's `beforeSnapshot` only reads the
     controller.
   - It writes no routine "Saving…/Saved…" status line; failure messages are
     still written.
   - Its promise is kept in `autoSaveInFlightRef`, and a state flag
     `autoSaving` mirrors it.
6. **Explicit saves during an auto-save.** The lifecycle exposes
   `isUserSaveInFlight()` (coordinator busy and not automatic) and
   `saveBusy = persistenceState === "saving" && !autoSaving`.
   - **Check and Save:** App passes `isUserSaveInFlight` to `useProjectCheck`
     (`App.tsx:1845`). File's gate at `editor-menus.tsx:464` is unchanged in
     code; it reads the new `saveBusy`.
   - **Manual save** (`saveProjectToCloud` without `asNew`: Ctrl+S, File →
     Save, Check and Save, and the Agent's foreground save) waits for an
     in-flight auto-save first. It then saves its own candidate, or the live
     Project when none is given, unless the content equals the saved baseline
     and nothing is dirty. In that case it returns the auto outcome.
   - **Save As** keeps the coordinator's busy rejection.
   - **`cloudBindingRef`** is written together with the state. It is read by
     `performProjectSaveToCloud`, `captureFileSession` (with
     `savedProjectBaselineRef`), `restoreSavedProjectBaseline` and
     `noteGalleryPublication`, so a follow-up save sends the acknowledged
     revision.
7. **Replacement.** `beginReplacement` refuses while
   `autoSaveInFlightRef.current` is set. With `announce`, it reports "Wait
   for the Cloud auto-save to finish before replacing this Project".
   - Every in-place install acquires its command there, including the
     exact-content shortcuts, Revert, recovery and App's dropped files.
     Opening in a tab is already refused while a save is running.
   - Auto-save does not start while a slot is held.
8. **Agent background saves vs tab switches** (owner, Q2).
   `useProjectTabSessions` keeps a set of tab ids with a background Cloud save
   in flight, and a non-empty set adds to `projectSwitchBlocker`'s `saving`.
   - **Admission:** the handler admits a background save synchronously after
     its import await. It routes by `projectTabs.currentId()` and refuses with
     `WORKSPACE_BUSY` in any of these cases:
     - `projectTabs.isTransitioning()`;
     - the tab already has a background save;
     - the active tab holds the same binding id while a foreground Cloud save
       is in flight.
   - **Reservation:** the entry is held until the receipt is applied, and
     removed in `finally`.
   - **Receipt:** it is applied only if the stored session's `cloudBinding`
     still equals the binding the request used.
   - **Effect:** the target can never become active mid-save, and an
     auto-save, which defers while the set is non-empty, never overlaps a
     background PUT.
   - **Modes:** all of this runs only where Cloud saves exist; the handler
     fails without a `projectStore` (`:129-130`), and desktop has no handler
     (`App.tsx:4991`). Modes without Cloud therefore see no change.
9. **Sign-out.** `useBeforeAccountLogout`'s check sets `signingOut` before
   its blocker check, and clears it when the check throws. A successful
   sign-out reloads the page.
10. **Preference.** `useCloudAutoSavePreference()` is a
    `useSyncExternalStore` over an in-memory value seeded from the global key
    `icm.cloud-auto-save.v1` (`"off"` means off).
    - `setEnabled` updates memory first, then tries storage, then notifies.
      A storage failure therefore still takes effect for the session.
    - It listens to `storage` events. Its server snapshot is `true`.
    - Both `HeaderAccountMenu` and `App` call it.
    - Toggling never clears holds. Turning it on saves a copy that was armed
      while off.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/document/cloud-auto-save.ts` (new), `apps/editor/src/document/cloud-auto-save.test.ts` (new)
- `apps/editor/src/document/use-project-file-lifecycle.ts`, `apps/editor/src/document/use-project-file-lifecycle.test.tsx`
- `apps/editor/src/document/use-project-tabs.ts`, `apps/editor/src/document/use-project-tabs.test.ts`
- `apps/editor/src/app/use-project-tab-sessions.ts`, `apps/editor/src/app/use-project-tab-sessions.test.ts`
- `apps/editor/src/app/agent-workspace-requests.ts`, `apps/editor/src/app/agent-workspace-requests.test.ts` (new)
- `apps/editor/src/app/use-agent-hosts.ts`, `apps/editor/src/app/use-agent-hosts.test.tsx`
- `apps/editor/src/app/App.tsx`, `apps/editor/src/app/project-check.test.tsx` (only if a case is needed for `isSaving`)
- `apps/editor/src/accounts/header-account-menu.tsx`, `apps/editor/src/accounts/header-account-menu.test.tsx`
- `apps/editor/src/features/editor-shell/editor-statusbar.tsx`, `apps/editor/src/features/editor-shell/editor-statusbar.test.tsx`
- `apps/editor/src/styles/editor-chrome.css` (toggle row), `apps/editor/src/styles/editor-overlays.css` (chip)
- `playwright.config.ts` (seed `icm.cloud-auto-save.v1 = "off"` in the shared `storageState`)
- `apps/editor/e2e/cloud-auto-save.spec.ts` (new, default run), `apps/editor/e2e/standalone-accounts.spec.ts` (one new toggle test), `apps/editor/e2e/web-agent-session.spec.ts` (one new case)
- `docs/specs/persistence-and-recovery.md`, `docs/specs/editor-interaction.md`, `docs/user/getting-started.md`

Out of scope (do not change):

- `apps/server/**`, `packages/**`, `apps/desktop/**`, `apps/editor/src/hosts/native-*`, `pnpm-lock.yaml`.
- The coordinator's join and busy semantics for non-automatic callers.
- `editor-menus.tsx`, `editor-app-chrome.tsx` and `file-command-menu.tsx`: no
  toggle in File, and no prop threading.
- Background or inactive-tab auto-save, and any per-copy write queue.
- Auto-creating Cloud Projects, and Save As UI.
- Mechanics of the recovery store and window workspace
  (`browser-recovery-store.ts`, `recovery-coordinator.ts`, `project-workspace.ts`).
- `dropDiscardedWork`, which has no caller.

## Steps

1. **Baseline.** Before editing, run the Acceptance commands marked
   *baseline* and keep their summaries for the report.
2. **`document/cloud-auto-save.ts`.** Pure and SSR-safe, plus one hook. Every
   export needs a runtime importer or a test that imports it, otherwise
   `pnpm deadcode` (both knip passes) fails.
   - `CLOUD_AUTO_SAVE_STORAGE_KEY`, `CLOUD_AUTO_SAVE_DELAY_MS = 3000`,
     `CLOUD_AUTO_SAVE_POLL_MS = 500`.
   - `useCloudAutoSavePreference()` (Design 10), `onlineEpoch()` (installs its
     listener lazily), and `type CloudAutoSaveHold`.
   - `holdAfterFailure(existing, binding, outcome | "threw", epochAtStart)`
     and `applicableHold(hold, binding, epoch)`.
   - `interactionHoldsAutoSave(state)`.
   - `cloudSaveIndicator(input)`. Input:
     `{ visible, enabled, binding, persistenceState, saving, armed, hold, pendingDraft }`.
     The first matching row wins:

     | Condition | label | title (final wording may vary) |
     | --- | --- | --- |
     | `!visible` or no binding | none (`null`) | |
     | `saving` | Saving… | Saving to Cloud |
     | hold `conflict` | Auto-save paused | Changed elsewhere. Your edits stay here: export a backup, close this tab and reopen the Project from Cloud Projects |
     | hold `offline` | Cloud offline | Saves when the browser is back online; Ctrl+S retries now |
     | other hold | Auto-save paused | depends on the kind (sign in again; too large, download a backup; no longer exists, export a backup; otherwise "Ctrl+S retries") |
     | `pendingDraft` | Unsaved | Saves after the current edit is applied |
     | `clean` | Saved | enabled ? "All changes saved to Cloud" : "Saved to Cloud · auto-save is off" |
     | `failed` | Save failed | Press Ctrl+S to retry |
     | `!enabled` | Auto-save off | Press Ctrl+S to save to Cloud |
     | `armed` | Unsaved | Saves to Cloud a few seconds after editing pauses |
     | otherwise | Unsaved | Restored changes: edit or press Ctrl+S to save to Cloud |

     It never claims a local save.
3. **`use-project-file-lifecycle.ts`.**
   - Add the optional fields `autoSaveArmed?` and `autoSaveHold?` to
     `ProjectFileSession`. Spread them conditionally, because
     `exactOptionalPropertyTypes` is on.
   - Add the option `autoSave?: { enabled: boolean; blocker(): string | null }`,
     read through a ref.
   - Add `cloudBindingRef` and a setter wrapper (Design 6).
   - Add armed and hold state (each with a ref). Capture and restore them.
     The live-edit branch of the change-token effect sets armed.
     `replaceActiveProject` clears armed but keeps the hold. Add
     `noteExternalCommit()`.
   - Change `performProjectSaveToCloud(snapshot, asNew, auto)`:
     - In auto mode, skip the routine status lines.
     - Capture `onlineEpoch()` before the PUT.
     - Wrap `projectStore.save` so that a throw records a `rejected` hold,
       then rethrows.
     - On a receipt: clear the hold; clear armed if the receipt still
       matches the live content.
     - On a failure: merge the hold for the binding the PUT used.
     - Record nothing for Save As or for a stale snapshot.
   - Add `saveProjectToCloudAutomatically()` (Design 5) and change the manual
     path to wait for it (Design 6). Expose `isUserSaveInFlight`, the new
     `saveBusy`, and `cloudAutoSave: { armed, hold, saving }` for the chip.
   - Make `beginReplacement` refuse while an auto-save runs (Design 7).
   - Add the scheduling effect and poll loop (Design 4). Clear the timer on
     unmount and whenever a dependency changes.
4. **`use-project-tabs.ts`.** Add `isTransitioning: () => transitioning.current`.
5. **`use-project-tab-sessions.ts`.**
   - Export `resumedFileSession(file)` and use it in `tabSessionFromPortable`:
     it maps `saving` to `dirty`, clears armed and drops an `offline` hold.
   - Add the background-save set and `reserveBackgroundCloudSave(tabId)`,
     which returns a release function or null. The set feeds
     `projectSwitchBlocker`.
   - Add `signingOut` with `isSigningOut()` (Design 9).
   - Add `noteAgentCommit(controller)` (Design 2), returned for App to assign
     into a ref.
6. **`agent-workspace-requests.ts`.**
   - Background save (Design 8): route by `currentId()`, then admit or
     refuse, reserve, check receipt ownership, and apply holds through the
     shared helpers. A thrown save sets `"failed"`. A receipt sets
     `autoSaveArmed = false` only when `stillCurrent`.
   - The rename and copy branches and the cached host's `committed`
     callback call `noteAgentCommit(controller)`; they no longer mark
     sessions themselves. Pass the latest `synchronizeExternalCommit`
     through a ref.
7. **`use-agent-hosts.ts`.** The foreground host captures its controller and
   calls `noteAgentCommitRef.current(controller)` instead of the bare latest
   synchronizer. Keep the immediate `flushRecovery`.
8. **`App.tsx`.**
   - Call the preference hook and keep the pointer-held ref (window listeners
     `pointerdown` in capture phase with `buttons !== 0`, `pointerup`,
     `pointercancel`, `blur`).
   - Assign `autoSaveBlockerRef` after `useProjectTabSessions`
     (`:4849-4930`).
   - Pass `autoSave` (Design 1) at `:1074`.
   - Pass `isSaving: isUserSaveInFlight` at `:1845`.
   - Wire `noteAgentCommitRef`, and pass `reserveBackgroundCloudSave` to the
     handler (`:4992`).
   - Pass `cloudSave={cloudSaveIndicator({...})}` to `EditorStatusbar`
     (`:7434`), with `visible` true when `autoSave` is passed and
     `pendingDraft: codeDraftDirty`.
9. **`header-account-menu.tsx`.**
   - After the My Cloud Projects block and its separator (`:134`), and before
     Sign out, add:
     `<button type="button" data-testid="cloud-auto-save-toggle" aria-pressed={enabled} title="Save bound Cloud Projects a few seconds after you stop editing">Auto-save to Cloud <span>On|Off</span></button>`,
     followed by a separator.
   - Without `cloudProjects` (never the case on web), it sits after the
     identity separator.
   - Clicking it toggles and keeps the menu open.
   - Style it in `editor-chrome.css`.
10. **`editor-statusbar.tsx`.** Add the optional `cloudSave` prop, rendered
    after the recovery chip as
    `<output className="statusbar-cloud-save" data-testid="cloud-save-state" data-tone=… title=… aria-label=…>`.
    Style it in `editor-overlays.css`.
11. **`playwright.config.ts`.** Add `{ name: "icm.cloud-auto-save.v1", value: "off" }`
    to the shared storageState (`:243-246`), with a comment: specs that test
    auto-save turn it on. Existing assertions stay unchanged.
12. **Tests** (below), then the docs:
    - `persistence-and-recovery.md`: an auto-save bullet in Working-copy
      transitions covering web with Cloud, bound copies, the active tab,
      arming by live edits (including Agent edits to inactive tabs), no
      upload on refresh, reopen or recovery, holds, and offline-until-online.
    - `editor-interaction.md`: `:410` becomes "Renames mark dirty; they reach
      the Cloud through Save or auto-save". The account-menu bullet adds
      Auto-save between My Cloud Projects and Sign out. Add a statusbar line
      for the chip.
    - `getting-started.md` "Save and recover": two sentences.

## Tests

Unit tests use Vitest fake timers where timing matters.

- **`cloud-auto-save.test.ts`**
  - Preference: default on; `"off"` reads off. With a storage that throws,
    `setEnabled(false)` still makes subscribers read off for the session.
  - `holdAfterFailure`: map every outcome kind; a conflict stays sticky
    across later failures, including `"threw"`; an offline hold keeps the
    epoch at the start of the attempt.
  - `applicableHold`: changes to the revision, the id or the epoch release it.
  - `interactionHoldsAutoSave`: every rule. A wire with `source === null` is
    not held; a wire with a source and no steps is held.
  - `cloudSaveIndicator`: every row of the table.
- **`use-project-file-lifecycle.test.tsx`** (harness plus `autoSave`)
  1. Timing. A live edit on a bound clean copy saves at 3000 ms and not at
     2999 ms. A rerender with the same content keeps the clock. Each edit
     restarts it.
  2. No save. Without the option, with `enabled: false`, or while unbound,
     there are no `store.save` calls in 10 s.
  3. Restore. With `restoreFileSession`, a dirty copy with armed false does
     not save; a dirty copy with armed true saves once.
  4. Deferral. A blocker reason defers the save, and clearing it saves with
     no new edit. A held replacement slot behaves the same: no save until
     `release()`, then one.
  5. Conflict. A 409 holds; another edit does not save; a manual Save gets 409
     again and the hold stays `conflict`. `captureFileSession().autoSaveHold`
     carries it.
  6. Revert while held. After a 409, Revert followed by an edit gives zero
     saves.
  7. Offline. `unreachable` holds and further edits do not save; an `online`
     event saves once. An `online` event that fires while the failing PUT is
     still deferred leaves the hold released (epoch taken at the start).
  8. Edits during a deferred PUT. An edit during the PUT gives a second save
     at revision N+1. An undo to the saved content during the PUT gives a
     second save of that content.
  9. Manual Save during an auto-save waits, then makes a second
     `store.save` with N+1 and the newer content. With nothing newer, there
     is no second call. `isUserSaveInFlight()` stays false and `saveBusy`
     stays false during the auto-save.
  10. Save As during an auto-save is rejected as busy.
  11. Replacement during an auto-save. `beginReplacementCommand` returns null
      with the status; so does the exact-content Cloud-open shortcut, and
      nothing is installed.
  12. The auto-save passes no `beforeSnapshot`. A `beforeSnapshot` spy is not
      called, and the content sent is the controller's at admission.
  13. A thrown `store.save` records a `rejected` hold and makes no retry.
  14. `noteExternalCommit()` arms the copy and marks it dirty.
- **`use-project-tab-sessions.test.ts`:** `resumedFileSession` maps `saving`,
  clears armed and drops only offline holds.
- **`use-project-tabs.test.ts`:** `isTransitioning()` reads true during a
  pending `prepare` and false after it.
- **`agent-workspace-requests.test.ts`** (new; real
  `EditorDocumentController`, fake `projectTabs` with live `currentId()`, fake
  `projectStore` with deferred responses):
  - A background save is refused while `isTransitioning()`.
  - A second background save of the same tab is refused while the first is
    pending.
  - A late receipt whose binding no longer matches the stored session is not
    applied (Save As to B kept).
  - A 409 sets the stored hold. A later identical-bytes success clears it.
  - A thrown save leaves the tab `failed`.
  - The reservation is held until the receipt is applied.
  - `noteAgentCommit` on an inactive controller marks that stored session
    dirty and armed. On the active controller it calls the synchronizer and
    `noteExternalCommit`.
- **`use-agent-hosts.test.tsx`:** the foreground host's commit calls
  `noteAgentCommitRef` with its own controller.
- **`header-account-menu.test.tsx`:**
  - The toggle comes after My Cloud Projects and before Sign out, with
    `aria-pressed="true"`.
  - A click gives `"false"` and the `details` stays open.
  - With a storage that throws, it still reads Off after the click.
- **`editor-statusbar.test.tsx`:** the chip shows after `recovery-state`,
  and is absent for `null`.
- **`App.test.tsx`:** the existing server render inside `AccountContext`
  still passes.
- **`e2e/cloud-auto-save.spec.ts`** (default run, local server)
  - Setup: `test.use({ storageState })` with the shared keys and
    `icm.cloud-auto-save.v1 = "on"`, at the origin `playwright.config.ts`
    uses. Each test places a resistor, presses Ctrl+S to bind, and counts
    `POST /api/projects` and `PUT /api/projects/<id>` with
    `page.on("request")`. `page.route` holds or replaces responses where
    needed.
  1. **Draw.** After one edit there is no PUT within 1 s, exactly one within
     8 s, and the chip reads "Saved". The unsaved dot clears. 4 s later there
     is still one PUT, and `GET` shows the new revision.
  2. **Auto mode** (`mode-auto`). A rename through Project Info gives one PUT.
  3. **Unbound.** A new tab with edits makes zero POST or PUT requests in 6 s.
  4. **Wire.** Make an edit, then start a wire before 3 s pass and hold it
     for 5 s: zero PUTs. Escape gives one PUT.
  5. **Project Info.** Make another edit, then open Project Info for 5 s:
     zero PUTs. Closing it gives one PUT.
  6. **Conflict.** Bump the revision from a second page (Shelf rename), then
     edit: one 409, and the chip reads "Auto-save paused". Another edit gives
     no PUT in 6 s. After a reload, an edit still gives no PUT.
  7. **Offline.** With `context.setOffline(true)`, an edit makes the chip read
     "Cloud offline", and another edit makes no attempt. After
     `setOffline(false)` there is one PUT, then "Saved".
  8. **Refresh.** Edit, then reload within 1 s. The tab is dirty, and there
     are zero PUTs in 6 s. One edit then gives one PUT.
  9. **Two tabs.** Edit A, then switch to B within 1 s: zero PUTs in 6 s.
     Switching back gives one PUT for A.
  10. **Manual Save during an auto-save.** Hold the first PUT, edit, press
      Ctrl+S, then release. A second PUT sends `If-Match: revision-(N+1)`
      and the chip ends at "Saved".
  11. **Check and Save during an auto-save.** Hold the first PUT, edit, and
      run Check and Save: it is enabled, the Issues result appears, and a
      follow-up PUT carries the edit.
- **`e2e/web-agent-session.spec.ts`** (new case, auto-save on through
  storageState)
  - Bind tab A, open tab B, and pair the Agent.
  - With `client.workspaceId = A`, `agent.circuit(placeResistor(...))`
    applies a background edit: A's tab shows the dirty mark, and there are
    zero PUTs in 6 s.
  - Select A: one PUT that contains the new instance.
  - With A's PUT held, an Agent `activate` of B and a click on tab B are
    both refused ("a save is still running").
- **`e2e/standalone-accounts.spec.ts`** (new test, accounts run, auto-save on)
  - Register, bind, and toggle Off in the account menu: an edit gives zero
    PUTs in 6 s, and the chip reads "Auto-save off".
  - Toggle On, with no new edit: one PUT.
  - Toggle Off, edit, reload, toggle On: zero PUTs in 6 s. The next edit
    gives one PUT.
  - The toggle still reads On after a reload.
  - Test 1 stays unchanged, because the shared storageState now seeds Off.

## Acceptance

Run from the repository root, in lane 2 of `docs/workflow.md` (`createdb
auto_canvas_test_2` once; use lane 3 if lane 2 is taken):

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 \
  AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 \
  AUTO_CANVAS_API_URL=http://127.0.0.1:4321 ICM_E2E_ISOLATED=1
```

Commands marked *baseline* also run before Step 2, and both results are
reported.

```bash
pnpm format:check                    # baseline; expected: pass
pnpm docs:check                      # expected: pass
pnpm typecheck                       # baseline; expected: pass
pnpm lint                            # baseline; expected: pass
pnpm deadcode                        # baseline; expected: pass
pnpm vitest run apps/editor/src/document/cloud-auto-save.test.ts \
  apps/editor/src/document/use-project-file-lifecycle.test.tsx \
  apps/editor/src/document/project-save-coordinator.test.ts \
  apps/editor/src/document/use-project-tabs.test.ts \
  apps/editor/src/app/use-project-tab-sessions.test.ts \
  apps/editor/src/app/agent-workspace-requests.test.ts \
  apps/editor/src/app/use-agent-hosts.test.tsx \
  apps/editor/src/app/project-check.test.tsx \
  apps/editor/src/accounts/header-account-menu.test.tsx \
  apps/editor/src/features/editor-shell/editor-statusbar.test.tsx \
  apps/editor/src/app/App.test.tsx   # expected: all pass
pnpm test:local                      # baseline; expected: pass, or only the baseline's failures
pnpm build                           # baseline; expected: pass
pnpm test:desktop-build              # expected: pass
pnpm test:e2e:local                  # baseline; expected: full default run passes, including cloud-auto-save.spec.ts
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local   # baseline; expected: all pass, including the new toggle test
git diff --stat origin/main -- apps/server packages apps/desktop apps/editor/src/hosts pnpm-lock.yaml   # expected: empty
```

Behavioral checks:

- **Local mode** (e2e build) and **accounts mode:** edit a bound Project and
  stop. Within about 4 s the chip goes Unsaved → Saving… → Saved, and the dot
  clears.
- **Account menu:** reads identity, My Cloud Projects ›, Auto-save On/Off,
  Sign out. Off survives a reload.
- **Deferral:** a held drag, an open wire, a dialog or a tab close decision
  delays the save until it ends.
- **Status line:** auto-save writes no "Saving…/Saved…" lines.
- **Unbound drawings and the desktop build:** no chip, no auto-save.

## Notes for the implementer

- **Owner decisions (2026-11-23):**
  - active tab only, through the existing coordinator, with no background
    queue;
  - every web mode with Cloud; the toggle appears only in the accounts-mode
    account menu, default On, stored in localStorage;
  - bound Projects only, 3 s idle, live edits only;
  - the deferral list, holds, and offline-until-online;
  - Agent background saves briefly refuse tab switches (Q2);
  - replacement is refused during an auto-save (Q3);
  - toggling keeps holds (Q5);
  - no chip for unbound drawings (Q4).
- **Preference key.** It is global, not `accountKey`-scoped, so e2e can seed
  it.
- **Forbidden designs.** Do not add a write queue or a second coordinator. Do
  not use `agentPlanning` as a blocker. Do not query `document` inside
  `WorkspaceEditor`.
- **Keep unchanged:** `captureReplacementTarget`, the replace-guard answers,
  and the coordinator's semantics for non-automatic callers.

## Appendix A — codex round 1 finding → disposition

All twelve were verified against the code and all are accepted.

| # | Finding | Disposition |
| --- | --- | --- |
| 1 P1 | Agent save admitted after a tab switch passed its blocker (`:83` import await, stale `activeId`) | Accepted. Synchronous admission after the await: route by `currentId()`, refuse while `isTransitioning()`, reserve until the receipt is applied (Design 8). Unit test. |
| 2 P1 | Late background Save undoes Save As; two tabs can share a binding through recovery | Accepted. One background save per tab, refusal while the active tab saves the same binding id, and a receipt-ownership check (Design 8). Unit test with reversed receipts. When the two tabs' saves do not overlap, the server's `If-Match` turns the stale one into a 409 hold. |
| 3 P1 | Agent edit crossing activation misses the mark and the auto-save | Accepted, now in scope (owner). Commits route to the committing controller through `noteAgentCommit` and `noteExternalCommit` (Design 2). Unit tests and an Agent e2e. |
| 4 P1 | Check and Save never reaches the wait (`use-project-check.ts:48`, `editor-menus.tsx:464`) | Accepted. `isUserSaveInFlight` and a `saveBusy` that excludes auto (Design 6). e2e 11. |
| 5 P1 | Toggle test needed an upload after a reload | Accepted. The test is split: before a reload, toggling uploads; after a reload, it uploads only after an edit (accounts e2e). |
| 6 P2 | Background receipts ignore holds | Accepted. The same merge and clear rules apply to the stored session (Design 3). Unit test. |
| 7 P2 | Revert releases a conflict; offline epoch taken at receipt | Accepted. Replacement keeps the hold, and the epoch is taken at the start of the attempt (Design 3). Unit 6 and 7. |
| 8 P2 | Exact-content shortcuts bypass the guard; undo during preparation | Accepted. The refusal moves to `beginReplacement` (Design 7). The auto-save passes no `beforeSnapshot`, so there is no preparation await (Design 5). Unit 11 and 12. |
| 9 P2 | Background-save blocker changes local and notebook | Re-read under Q1 and Q2. Auto-save now runs in local and notebook too, and the owner approved the brief refusal wherever Cloud saves exist. Modes without Cloud see no change: the handler fails without a `projectStore`, and desktop installs none (Design 8). Covered by the Agent e2e. |
| 10 P2 | Sign-out races a new auto-save during the workspace flush | Accepted. `signingOut` is set before the check and blocks auto-save (Design 9). |
| 11 P2 | Blocker cases lacked a dirty edit; POSTs were not counted | Accepted. Each blocker case starts with an edit, and the spec counts POST and PUT. |
| 12 P2 | Storage failure makes the toggle ineffective | Accepted. The in-memory value wins for the session (Design 10). Unit and menu tests. |

## Appendix B — old T172 review findings → disposition

The narrowed design (active tab only, no queue, polling deferral, state kept
in `ProjectFileSession`) makes most of the old machinery unnecessary.

| Round · finding | Disposition |
| --- | --- |
| r1 P1 `agentPlanning` is always truthy | Not used; the blocker uses `agentFileCandidate`. |
| r1 P1 "Continue without saving" vs an in-flight PUT | The command slot is refused during an auto-save, and auto-save does not start while a slot is held. |
| r1 P1 wires, modals and close decision are missed | Interaction predicate, pointer-held, modal and close-decision checks; e2e 4–5. |
| r1 P1 failure state vs `persistenceState`; tab switch clears it | A revision-scoped hold in the file session. |
| r1 P1 stable callback and identity at write | Refs throughout, `cloudBindingRef`, and no await before the write. |
| r1 P2 announcement per operation | Auto-save never joins; a manual save waits, then saves. |
| r1 P2 chip inputs; "saved locally" | `pendingDraft` and an `autoSaving` flag; no local claim. |
| r1 P2 manual retry vs a real conflict | Unit 5. |
| r1 P2 timing in existing e2e | Shared storageState seeds Off. |
| r1/r2 P2 restore triggers a write | Armed is cleared on replace and on portable restore; e2e 8. |
| r1 P2 typecheck; `menuitemcheckbox`; App-level tests | The hook needs no prop threading; `aria-pressed` button; e2e through the real App. |
| r1 P3 knip key; doc references | The key has importers; Context cites current files. |
| r2 P1 `document` shadowing | `globalThis.document`. |
| r2 P1 same model id in two tabs; Stay cancels; guard during prep | No keyed maps; polling; no preparation await and a slot refusal. |
| r2 P1 Undo during PUT; first edit after a dirty restore | Armed is cleared only on a matching receipt; armed is state. |
| r2 P2 local rejections create holds | Only attempted writes create holds. |
| r2–r6 background Agent saves (holds, overlap, Save As, queues) | Design 8 and Appendix A 1, 2, 6. |
| r3 P1 write-boundary deferral strands work | No write-boundary deferral; a retry tick after each settle. |
| r3 P2 inactive Agent edit does not arm; conflict downgraded; tooltip | `noteAgentCommit`; sticky merge; indicator table. |
| r4 P1 / r5 P1 commits across activation | Appendix A 3. |
| r4 P2 thrown background save stays "saving" | Set to `failed`. |
| r4/r5 P2 refresh erases holds | Holds persist; offline holds are dropped on purpose. |
| r5 P2 cancelling a draft creates a revision | A draft is a blocker, never an arm. |
| r6 P2 explicit Save after auto leaves edits unsaved | Manual waits, then saves (unit 9, e2e 10). |
