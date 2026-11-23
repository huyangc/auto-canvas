# T171 — A replacement belongs to the session it was started in

- Branch: `task/T171-replacement-guard-session`
- Base: `main` at `fb3f0d4`
- Status: approved
- Plan review: codex gpt-6.2-astra, 8 rounds (r1 4 P1/3 P2, r2 6 P1/2 P2/
  1 P3, r3 7 P1/2 P2/1 P3, r4 4 P1/3 P2, r5 4 P1/2 P2, r6 5 P1/1 P2, r7
  4 P1/1 P2, r8 5 P1/1 P2). The rounds kept finding real edge cases and did
  not converge on paper; the owner decided (2026-11-23) to implement this
  plan and let the codex code review close the remaining edge cases on the
  real code. Owner also chose one task, not a split.

## Goal

Every operation that replaces the open Project — a netlist or Project file
import (menu or drop), Open Project File, an example, New Project, Revert,
a Cloud open, an Agent candidate, a recovery restore — belongs to the
session it was started in, and the person answers one replacement at a
time. Today a replacement still reading files, fetching a Cloud project or
writing a recovery copy when the person switches project tabs can replace
the drawing of the tab it came from while the newly active tab's file and
recovery state are changed; **Continue without saving** can delete the
active tab's recovery working copy; a failed import's review can appear in
the wrong tab; two overlapping drops take over each other's confirmation;
and a late completion can cancel the new tab's recovery write.

After this task:

- every replacement command carries an owner captured at its entry, before
  its first await, and every await on the way to replacing (file read,
  fetch, staging, recovery write, save, deletion) is followed by an owner
  check; a stale command discards its late result silently — no
  replacement, report, status, dock change, layout request or recovery
  cancellation;
- one replacement holds a slot from its entry until its dialog is answered
  or it ends; another is refused at once with
  `Another replacement is waiting for your answer`;
- the confirmation stores its command and its staged working-copy id; it
  deletes only that copy; restoring another session's file state releases
  and invalidates the outgoing command at once;
- Save and continue cannot save, export or acknowledge into another
  session;
- T170's drop keeps its statuses; `beginReplacementCommand` is its only
  admission check.

## Context

Facts verified at `fb3f0d4` (numbers after T170's rebase).

**The guard, dialog and save paths** (`use-project-file-lifecycle.ts`).

- `guardDirtyReplacement` (642): bumps `replacementEpochRef`, refuses while
  a native save runs, `await beforeSnapshot()`, fast path
  `perform(false)` when `!hasUnsafeWork()`, else `recovery.stage` +
  `await recovery.flushNow()`, then publishes
  `setReplaceGuard({ intent, perform })` (663) and returns. The state type
  (`ReplaceGuardState`, 78) has no session, no command, no working copy.
- `confirmReplaceGuard` (674): `recovery.cancelPending()`,
  `recovery.deleteSession(recovery.workingCopyId)` (live id), then
  `guard.perform(true)`.
- `saveAndContinueReplaceGuard` (688): three branches — native
  (`saveProjectToNative`, needs the saved token, `liveSessionRef` string
  `savingSession` and no pending edits), no cloud store (export, needs
  `!hasUnsafeWork()`), Cloud (needs the acknowledged baseline and no
  pending edits, plus `replacementEpochRef`). All capture their comparison
  values when the button is pressed; only Cloud compares the epoch. The
  save helpers set persistence state, bindings and status before control
  returns (379-405, 448-453, 500-505, 571-616).
- Live handles: `liveProjectRef` (218), `liveSessionRef` (220),
  `replacementEpochRef` (222), `persistenceStateRef` (T170).
  `restoreFileSession` (1202) restores a tab's file session, bumps the
  epoch and closes the dialog (1212) — but it neither invalidates a pending
  command nor releases the shared busy flag (`replaceGuardSaving`, 250).
- `replaceActiveProject` (318) bumps the epoch: a command that installs
  invalidates **itself**, so an `isCurrent()` check after a successful
  install must not classify it as stale; the install is the commit point.
- The refresh restore (`use-project-file-lifecycle.ts:1083` read, 1106
  direct install) is a second recovery entry point that awaits
  `readSessionProject` and installs without the guard.
- `beforeSnapshot` (deps, line 145 region) can await; App passes a
  snapshotter.

**Recovery.** The coordinator picks the working-copy id when `stage` runs
(`recovery-coordinator.ts:408-418`); `cancelPending` and `flushNow` act on
the **shared** scheduler (435-447), so a late `cancelPending` from an old
command cancels the new tab's queued write. `recovery.workingCopyId` in the
lifecycle is a render-time value (App passes it, `App.tsx:718`), while
`stage` reads the coordinator's mutable id. Restoring a tab (`App.tsx` tab
session activation, `use-project-tab-sessions.ts:339-356`) stages that
tab's recovery immediately.

**Session identity.** One `WorkspaceEditor` renders all tabs;
`activateDocumentSession` (339) swaps the active controller. A
controller's `projectSessionId` (`document-controller.ts:214`) is built
from a project id and a per-controller counter, so two tabs can read equal.
`restoreFileSession` and `replaceActiveProject` (318) are the synchronous
moments an activation or a Project changes.

**Commands and their entry points.** SPICE `importSpiceFiles` (376) and
RNL (342) read files before `installImport` → guard (317). `openProjectFile`
(892) awaits staging (907) and has an exact-current shortcut comparing
against the render's `project` (965-981). Cloud `openProjectById` (~992)
awaits a fetch and has its own not-found handling and direct install
(1051-1079); an already-open Cloud tab is selected
in `App.tsx:1070`; foreground/background tabs are created at
`use-project-tab-sessions.ts:844-855` (line 871 updates an already-open
Cloud project after a management operation, not a tab switch). Recovery restore calls the guard at 809. New (742), Revert
(769), examples (`use-project-entry.ts:58`) and Agent acceptance
(`use-agent-hosts.ts:391`) call the guard synchronously inside their
closures. `file-command-menu.tsx:369`'s pickers and the tab strip's
`inTab: true` openers (`editor-menus.tsx:389`, `native-project-workspace.ts:56`)
share the commands.

**Late reports.** `readSources` (`editor-file-commands.ts:268-289`) sets the
ambiguous-selection status itself, before either caller regains control.
`reportFailedImport` (332) sets report, review, dock and status.
`importSpiceFiles` sets `Importing SPICE sources` (381); its conversion
catch (425) and the RNL one (366) can raise the app-wide chunk-failure
banner (`onChunkLoadFailure`) and a status. The tab switch writes `Switched to …` (`use-project-tab-sessions.ts:354`).

**T170's drop** (`App.tsx:4483-4520`) compares
`editorDocumentController.projectSessionId` (a switch leaves the captured
controller's id unchanged) and passes drop-only `replacementBlocker`s into
`importSpiceFiles` and `openProjectFile`.

**Tests.** `use-project-file-lifecycle.test.tsx` harness (64): one
constant working-copy id, immediate flush, a delete that records no
arguments; the "Open B" case (120-170) is Cloud save-and-retry, not Stay.
`editor-file-commands.test.ts` knows the files-are-read recheck.
`file-drop.spec.ts` fixture (43) creates page-side `File`s; a drop behind
the open modal is ignored before the adapter
(`docs/specs/editor-interaction.md:495`). `project-tabs.spec.ts` switches
tabs. Contracts: `docs/specs/persistence-and-recovery.md:151-158`,
`docs/specs/editor-interaction.md:435-508`.

## Scope

Owned paths:

- `apps/editor/src/document/use-project-file-lifecycle.ts`
- `apps/editor/src/document/use-project-file-lifecycle.test.tsx`
- `apps/editor/src/features/editor-shell/editor-file-commands.ts`
- `apps/editor/src/features/editor-shell/editor-file-commands.test.ts`
- `apps/editor/src/app/App.tsx` — the lifecycle destructuring/options
  (1022-1063, 1096), the file-command factory call (~4450) and the drop
  adapter (4483-4520) only
- `apps/editor/src/app/use-agent-hosts.ts` and
  `apps/editor/src/app/use-agent-hosts.test.tsx` (the automatic-reconnect
  gate only)
- `apps/editor/e2e/file-drop.spec.ts`
- `docs/specs/editor-interaction.md`, `docs/specs/persistence-and-recovery.md`
- `tasks/T171-replacement-guard-session/`

Out of scope:

- The tab model (`use-project-tab-sessions.ts`), `document-controller.ts`,
  the recovery store and coordinator, the save coordinator,
  `replaceActiveProject`'s semantics, `replaceFileSession`'s shape.
- Import Review presentation and code-draft rules.
- Intentional tab opens: a Cloud open into a new tab, selecting an
  already-open tab, background opens and the `inTab` file openers are not
  replacements of the current Project and take no slot.
- T170's drop listeners, frame and statuses (only its admission moves).

## Steps

1. **Synchronous identity.** In `use-project-file-lifecycle.ts` add
   `activationEpochRef` plus `invalidateActivation()` that bumps it; call
   it from `restoreFileSession` (before restoring), from
   `replaceActiveProject` (next to its epoch bump), and in the render body
   when `liveSessionRef.current !== projectSessionId`. Export

   ```ts
   type ReplacementOwner = { activation: number };
   captureReplacementOwner(): ReplacementOwner;   // { activation: activationEpochRef.current }
   ```

   `isCurrent()` of a command (step 2) is true only while the command still
   occupies the slot **and** `activationEpochRef.current === owner.activation`.
   Same-id controllers and A→B→A therefore fail the check.

2. **The replacement slot, and who releases it.** The **file/import
   command is the single acquirer** for both the pickers and the drop:
   `importSpiceFiles`, `importRnlFiles`, `openProjectFile`,
   `openProjectById`, the recovery entry points. `beginReplacementCommand(intent)`
   captures the owner, takes the single slot if free, and otherwise sets
   `Another replacement is waiting for your answer` and returns null. A
   `ReplacementCommand` is `{ owner, intent, isCurrent(), release() }`;
   `release` is idempotent and a no-op once the slot belongs to someone
   else. The acquiring command runs the whole operation in
   `try { … } finally { command.release() }` **until it hands the command
   to the guard**; the guard then owns the release under the same rule until
   it publishes a dialog; the dialog owns it from then (step 3). So a
   malformed file, a refused boundary, a null snapshot, a thrown or
   rejected read, a clean direct install, a stale exit — every path admits
   the next command immediately. Read the working-copy id from the
   coordinator at staging time (step 3), exposed as
   `currentWorkingCopyId` through the App wiring, never a render-time copy.

3. **The guard and its dialog.**
   - `guardDirtyReplacement(intent, perform, command?)`: without a command,
     acquire one for the call (New, Revert, examples, Agent, recovery
     restore); with one, use the caller's. Its dirty decision must see the
     controller's **current** content: `hasUnsafeWork` takes the current
     project and change token from `editorDocumentController.project`
     through the App wiring and compares them with the saved and safe
     baselines, not only with render-derived `liveProjectRef` and
     persistence state — an edit committed synchronously by the controller
     before the next render must still defeat the clean fast path.
     Validate right after
     `await beforeSnapshot()` — before `hasUnsafeWork()` and before
     `recovery.stage`; validate again right after `await
     recovery.flushNow()` and before publishing. A stale exit makes **no**
     `recovery.cancelPending()` (it would cancel the incoming tab's write),
     no dialog, no status, no perform; it releases only its own slot and
     only while it has not published a dialog (step 2's rule).
   - Capture `workingCopyId` synchronously adjacent to `stage`, from the
     coordinator's current session; publish
     `{ intent, perform, owner, command, workingCopyId }`. Ordering across
     the install: validate the command **immediately before**
     installation; let `replaceActiveProject`'s activation bump retire the
     slot; then, synchronously **after** installation returns (the
     replace call clears the import report and closes Import Review
     inside App, and Auto Layout and Revert/Recovery statuses read the
     installed Project and its revision), record the command's `applied`
     result and publish its success effects — status, report, review,
     `onImported` — before yielding to the next await. Those effects are
     not re-checked against `isCurrent()`: the install was the commit.
   - Answering is atomic and owned by the dialog's command: before its
     first side effect the handler flips a synchronous per-command state
     from waiting to answering (a ref, not React state), so two calls in
     one tick cannot both begin; the shared `replaceGuardSaving` boolean is
     replaced by that per-command state. `deleteSession` answers `false` on
     failure: then nothing is performed, the staged copy stays, the dialog
     returns to waiting with `Couldn't save the recovery copy; the Project
     is unchanged` for a retry, and the command keeps its slot; a rejection
     is treated the same. A detached handler (its command no longer current
     or no longer the dialog's) returns silently and writes no status.
   - `confirmReplaceGuard`: validate the dialog's command; then
     `recovery.cancelPending()`, `recovery.deleteSession(guard.workingCopyId)`,
     validate again, then `setReplaceGuard(null)`, run the perform and
     release. A handler invoked after its command was retired starts **no**
     cancel, delete, perform or status; a retirement that lands while the
     deletion is already running lets that one deletion of the staged id
     finish and suppresses every later effect (no dialog close on the new
     tab, no status, no perform). There is no "changed while the
     confirmation was open" status: the tab switch already wrote its own.
     Async completions clear only the dialog/saving state they created.
   - `cancelReplaceGuard` (Stay), a terminal failure and completed actions
     release; a save that fails and leaves the dialog open for retry keeps
     it.
   - **Every independent activation change retires the outgoing command,
     dialog and busy state synchronously** — `restoreFileSession` (before
     it restores), `restoreSavedProjectBaseline`'s install, and the
     render-only session change — even if the outgoing read never settles:
     its slot is released, its dialog closed and its busy state cleared.
     The command that performs the install follows the ordering above
     (validate, install, then record `applied` and publish its effects
     synchronously after the call returns); a retired command's detached
     handlers return silently. `restoreSavedProjectBaseline` therefore
     cannot leave a slot held by a command whose read never resolves.

4. **Save and continue bound to the command.**
   `saveAndContinueReplaceGuard` validates the dialog's command before any
   save starts; the three branches keep their checks, now against the
   command's activation rather than `liveSessionRef` strings: native keeps
   its saved token and no-pending-edit checks, export keeps
   `!hasUnsafeWork()` and validates immediately after its deferred
   snapshot, before delivering bytes, Cloud keeps its acknowledged baseline
   and no-pending-edit checks and its epoch. Save requests that a dialog can
   join capture their activation at **creation** (every save request, not
   only the dialog's), and their `current()` callback answers false once
   that activation is stale, so a joined ordinary Cloud save cannot
   acknowledge into another tab before the dialog checks its result. Each
   acknowledgement (binding, safe token, persistence state) is applied only
   while the request is still current, and the command is validated once
   more before `perform`. A stale acknowledgement is not written.

5. **Every command checks after every await.**
   - `importSpiceFiles`, `importRnlFiles`: acquire at entry; pass the
     command into `readSources`, so the ambiguous-selection status is
     published only for the owner; after the file read, after the
     conversion, before `installImport`, and inside `installImport` before
     the guard, check `isCurrent()` and exit silently when false;
     `reportFailedImport` takes the command. A **rejected** read is caught
     where the command is still in hand (inside the command, not in the
     drop listener): a current drop answers `Couldn't read the dropped
     file`; a stale one says nothing. Each conversion catch (SPICE 425,
     RNL 366) checks ownership before **any** callback — status,
     `onChunkLoadFailure`'s banner, diagnostics — so a stale conversion
     cannot raise the app-wide banner or overwrite the active tab's
     status.
   - `openProjectFile`: acquire at entry; after staging, after the
     exact-current comparison and after each guard await, check. The
     exact-current shortcut compares against the controller's **current**
     project at installation — `editorDocumentController.project` through
     the App wiring, not the render-derived `liveProjectRef` and not the
     render's `project`: the controller commits an edit synchronously and
     schedules the render afterwards, so a read that settles in that
     interval must still see the edit and raise the dirty guard. `inTab` callers acquire only when no tab opener will handle
     the request (step 5's opener rule below).
   - Cloud `openProjectById`/`openCloudProjectById`: acquire only when the
     request will actually replace the current tab — decided at runtime: an
     already-open Cloud tab is selected first (`App.tsx:1070`) and a
     foreground/background tab is created when a tab opener exists
     (`use-project-tab-sessions.ts:844-855`). `inTab: true` alone does not
     exempt: `openProjectInTab` is optional and both the file and Cloud
     paths fall back to replacing the active Project (950 / 1051). The
     current-tab path checks the command after the fetch and after staging,
     before any not-found handling, diagnostics or install, and its
     direct-install shortcut compares the fetched content with the **live**
     project immediately before installing.
   - Manual recovery (`restoreRecoverySession`): the **single acquirer**
     is this function, at entry before its read; it validates on
     settlement before either diagnostic, and passes the same command to
     the guard (which then does not acquire again). Its success status is
     published at the install, before `await discover()`.
   - The refresh restore: capture the owner and the working-copy id when
     the refresh request is established at mount (initialization, 186 —
     a pure capture, no side effect, safe under a render replay). Once
     `recovery.ready` resolves it **reserves the slot** like any other
     command; if the slot is held (an import reading or a dialog waiting
     in the same tab), the automatic restore stands down silently with
     outcome "not restored" — it never retires the user's command and
     never installs over it. It validates the owner and working-copy id
     again after `readSessionProject`. It also captures the controller's
     content change token when the refresh request is established and
     checks it, together with pending edits, before reserving the slot and
     immediately before installing; if the user edited the drawing in the
     meantime the outcome is `unsuccessful` and nothing installs. It
     releases on every read outcome (missing, unsupported, rejected),
     on an edited target, and on success after the install.
     `startupRestoreReady` becomes an explicit outcome
     (`pending | restored | unsuccessful`). A restored workspace counts as
     `restored`: when `restoredWorkspace` exists App already installs it
     and skips refresh recovery (`App.tsx:1080`), so the outcome must
     qualify that path — for the installed working copy and the stored
     proof — rather than leaving it `pending`. Only `restored` for a
     matching working copy enables the Agent's automatic reconnection
     (`use-agent-hosts.ts:357`), gated on the outcome rather than on "the
     startup id differs from the live one", so a superseded or mismatched
     restore never reconnects with the previous tab's proof and never
     blocks the editor's wait. Manual Agent connection stays available
     after an `unsuccessful` restore.
   - The drop adapter in `App.tsx`: `beginReplacementCommand` is the sole
     admission check. Its `replacementBlocker` options keep only the entry
     and replacement-boundary draft/save check from T170 (never the slot, or
     the owner would refuse itself); the admitted command is passed through
     `importSpiceFiles`' options into `installImport` and to the guard. Its
     statuses keep T170's wording.

6. **Docs.** `docs/specs/editor-interaction.md` (~435) and
   `docs/specs/persistence-and-recovery.md` (~151): ownership and
   revalidation as in the Goal; one replacement at a time with an immediate
   refusal; a stale command's late result is discarded silently, including
   statuses, import reviews and Auto Layout; the confirmation stores its
   command and staged copy, deletes only that copy, and is invalidated by a
   session restore; intentional tab opens take no slot.

7. **Tests.**
   - Lifecycle harness (`use-project-file-lifecycle.test.tsx:64`, now
     configurable working-copy ids, a delete spy that records its argument,
     deferred `beforeSnapshot`, `flushNow`, `deleteSession`, a `stage` spy,
     and deferred Cloud fetch / staging so Project-file and Cloud cases
     live here): switch after a deferred snapshot → zero `stage` calls and
     no `cancelPending`; switch during the flush → no dialog; a stale exit
     leaves the incoming tab's staged recovery write alive; **Continue
     without saving** deletes the staged id when the live id changed in the
     same session; a stale confirmation performs no cancel/delete/perform
     and says why; A→B→A with `restoreFileSession` fails an old command;
     two controllers with equal ids still fail the old command; two
     `beginReplacementCommand` calls → one slot, one refusal; a second
     command during a dialog is refused and admitted after Stay; a
     retryable save keeps the slot and the dialog; a malformed Project
     file, a rejected read and a clean successful install each admit the
     next command immediately; B opens **and answers** its own dialog while
     A's deferred deletion is still pending, and A settling later changes
     neither B's status nor B's state; a successful install returns
     `applied` even though it invalidated its own command; a switch during
     the manual restore's `discover()` publishes no status; the refresh
     restore superseded by a switch publishes nothing and settles the
     startup-readiness flag (a superseded restore also enables no Agent
     reconnection); a switch **before** `recovery.ready` still attributes
     the refresh to the tab that requested it; a joined ordinary Cloud save
     whose activation went stale writes no binding, baseline, recovery or
     status; a Cloud direct install over a same-tab edit compares the live
     project and raises the dirty guard instead of installing; the
     exact-current Project-file shortcut (activation change and a
     meaningful same-tab edit during a gated `File.text()`) installs
     nothing; a meaningful same-tab edit committed in the same `act` as a
     gated `File.text()` settlement makes the guard open the dirty dialog
     and the edit survives; `inTab: true` with no tab opener respects an
     occupied slot, while a real opener keeps its behaviour; a deferred
     export snapshot that turns stale delivers no bytes; an independent
     `restoreSavedProjectBaseline` install during a never-settling read and
     during an open dialog retires the outgoing command, closes its dialog
     and admits B's command at once; a gated manual recovery read (valid and
     invalid) settled after a retirement installs nothing and publishes no
     diagnostic; a same-tab replacement holding the slot when the refresh
     restore becomes ready makes it stand down silently, preserves that
     owner and admits the next command when it ends; two invocations of one
     dialog handler in a single `act` start one deletion; a failed deletion
     leaves the dialog open, keeps the slot, performs nothing and allows a
     retry;
   - `editor-file-commands.test.ts`: SPICE and RNL imports whose owner goes
     stale during the read publish no status, report, dock or layout call;
     a stale ambiguous selection publishes nothing; a stale failure opens
     no Import Review; a valid import that goes stale after progress shows
     no **additional** callbacks; a gated read that **rejects** before a
     switch answers `Couldn't read the dropped file`, and one that rejects
     after a switch says nothing; a conversion that rejects after a switch
     raises neither the chunk banner nor a status; a successful import keeps
     its Import Review report after the install cleared the previous one and
     Auto Layout is asked for the **installed** Project; the picker path
     with no command is unchanged.
   - Integration (`use-project-file-lifecycle.test.tsx`, one case): mount
     the real lifecycle harness, wire the real file commands to it, gate a
     read, activate and restore another session, release, await the
     original command promise, and inspect both controllers and the
     recorded callbacks — the settlement barrier the browser cannot give.
   - `file-drop.spec.ts`: gate `File.prototype.arrayBuffer` in the page;
     drop on A, wait until the read is entered, switch to B (distinct
     drawing), **check B's status before switching back**, release, then
     poll for two seconds that both revisions and B's status stay unchanged
     and no dialog appears. Overlap: a second drop while the first read is
     gated → its refusal status; then answer the first dialog and assert its
     file installed exactly once. Gate `File.prototype.text` for a
     Project-file drop over a switch the same way. Keep T170's
     behind-the-modal case.

## Acceptance

Run from the repository root; all must pass. Lane 2 (docs/workflow.md).

```bash
export ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
pnpm typecheck        # exit 0
pnpm lint             # 0 errors
pnpm format:check     # exit 0
pnpm docs:check       # exit 0
pnpm test:local       # all pass, including the new lifecycle, command and integration cases
pnpm build            # exit 0
npx playwright test apps/editor/e2e/file-drop.spec.ts apps/editor/e2e/project-tabs.spec.ts apps/editor/e2e/editor-modes.spec.ts apps/editor/e2e/project-file.spec.ts   # all pass
pnpm deadcode         # exit code and findings as on main; no new finding
```

Behavioral checks:

- Two tabs, an Open Project File or a drop started on the first, switch
  while its read is gated: neither drawing changes; the second tab's
  status, Import Review, recovery list and pending recovery write are
  untouched; no dialog appears anywhere. Recovery-failure notices the
  coordinator raises for an inactive working copy still reach the status
  line (they are not command statuses and are out of this suppression).
- Two quick drops on a dirty Project: the second answers
  `Another replacement is waiting for your answer`; the first dialog is
  answered once and installs its own file once.
- **Stay** keeps the drawing and the staged copy; **Continue without
  saving** applies its own replacement and deletes only its own copy;
  **Save and continue** in an old dialog writes nothing into another
  session.
- Everything in T170's behavioural checks still holds.

## Carried from the last review rounds (bind these in code and tests)

- The guard's dirty decision, the staged copy and every native/Cloud
  save-and-continue comparison read `editorDocumentController.project` (the
  controller commits synchronously, the render later) — never
  `liveProjectRef` alone. After `beforeSnapshot` and the owner check, read
  the controller project once and stage that same object.
- The startup outcome `restored` is produced only by installing the intended
  active workspace tab (or the recovery read); a tab-deserialization failure
  is `unsuccessful` even if a matching working-copy id remains, and only
  `restored` enables automatic Agent reconnection.
- The refresh restore asks the live `describeOpenBlocker()` (code drafts
  change no controller token) before reserving the slot and before
  installing.
- An independent retirement of the startup command settles the startup
  outcome immediately (`unsuccessful`); a late read completion cannot
  overwrite a settled outcome.
- Tests: the detached-handler case asserts B's exact status is preserved;
  Cloud fetch and native/Cloud save settlements commit an edit in the same
  `act` before any render; deletion failure is exercised both as a `false`
  result (retried to success) and as a rejection (then Stay and a fresh
  admission).

## Notes for the implementer

- Identity is the activation counter, invalidated synchronously in
  `restoreFileSession`, `replaceActiveProject` and on a rendered session
  change — never a `projectSessionId` string comparison.
- A stale exit never calls `recovery.cancelPending()`; cancellation belongs
  only to the current owner's confirm and to `replaceActiveProject`.
- Make `release` idempotent and owner-bound; the dialog, not the initiating
  call, releases once a dialog exists.
- Do not change the Cloud new-tab, select-existing and background opens,
  nor the `inTab` file openers: they take no slot.
- Keep T170's drop statuses word-for-word where its tests assert them; the
  slot's own refusal is the only new drop status.
- Do not start, stop or restart anything on port 4310 and do not use port
  5173.
- Commits end with `Test-Impact: tests-updated` and the co-author trailer.
  Never commit anything under `tmp/`.
