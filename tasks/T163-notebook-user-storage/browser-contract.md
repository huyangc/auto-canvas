# T163b contract — browser cases for per-user storage in the notebook build (revision 3)

The follow-up task to T163. Its plan is written from this contract once T162b (the notebook
Playwright spec `apps/editor/e2e/notebook-auth.spec.ts`, its proxy fixture and helpers
`apps/editor/e2e/notebook-fixtures.ts`) is in its base. **Its results are T163's merge
condition**: T163 and T163b merge together, and every case below must run and pass; a skip
or an "outstanding" result blocks W4.

## Owned by T163b

`apps/editor/e2e/notebook-auth.spec.ts` (new cases), a new helper
`apps/editor/e2e/notebook-storage-fixtures.ts`, the adaptation of T162b's helpers named
below, `docs/testing/README.md` if it lists the notebook cases, its task directory. Not
owned: all product code (`apps/editor/src/**`, `apps/server/**`, `packages/**`). A product
defect found by a case is reported, not fixed.

## What the product provides (from T163)

- `performance.mark("auto-canvas:notebook-commit")` right after the namespace is fixed, and
  `performance.mark("auto-canvas:notebook-reload")` right before `location.reload()`.
- `console.error("auto-canvas: browser storage used before sign-in: <name>")` on any
  locked access.
- Concealment for the back/forward cache: `<body>` inline `display: none !important` from a
  persisted `pagehide` until the session is re-checked.
- `namespacePrefix(id)` in `apps/editor/src/notebook/browser-storage.ts` (pure; importable
  from the spec) — expected names are derived from the fixture's **actual** authenticated
  ids (`newUser()` makes `label-<8 hex>` ids), never hard-coded.

## Instrumentation (one init script, one raw-inspection handle)

T163b owns merging T162b's `instrumentStorage` probe into a single
`context.addInitScript` that runs before any page script and does, in this order:

1. **Saved originals** (the raw-inspection handle, test-only): the native `localStorage`,
   `sessionStorage`, `indexedDB` objects of this tab, and the original
   `Storage.prototype.{getItem,setItem,removeItem,key,clear}`, the `length` getter,
   `IDBFactory.prototype.{open,deleteDatabase,databases}`,
   `IDBDatabase.prototype.transaction`, `IDBObjectStore.prototype.{get,getAll,getAllKeys,put,delete}`,
   `LockManager.prototype.{request,query}`. All seeding and raw inspection call these with
   `Reflect.apply`, so fixture traffic never appears in the product trace and cannot satisfy
   an assertion. sessionStorage is per tab: it is inspected only through the handle of the
   **target tab**.
2. **Recorder**: patch those prototypes (and the six global descriptors with delegating
   recording getters, so the product captures them as native) to append entries
   `{ seq, doc, op, name, txId?, revision?, phase }`, where `doc` is a random per-document id,
   `phase` is before/after the commit mark, and:
   - each `transaction()` call gets a `txId`; its `complete`/`abort` (via `addEventListener`)
     is recorded with that `txId`;
   - each `put` records its `txId`, database, store, and a `revision` read from the value by
     the shapes in the source: recovery records `documentRevisions[topDocumentId]`
     (`document/browser-recovery-contract.ts`); workspace records the top document revision
     parsed from each tab's `projectText` (`app/use-project-tab-sessions.ts:560`);
   - `storage` events received, `visibilitychange`, `pagehide`/`pageshow` with `persisted`,
     `performance.mark` calls.
3. The trace is appended synchronously through the saved native `setItem` to a test-only
   sessionStorage key, so it survives the reload in that tab; a held reload cannot be
   inspected (T162b planning record).

**T162b's existing pre-sign-in cases** (N1, N2: direct `indexedDB.databases()` on the
signed-out editor page, recovery inspection around identification failures) are adapted to
the handle: with T163 a direct call to the page's `indexedDB` before sign-in throws by
design. Their assertion that the **product** made no early access is preserved and
strengthened: no native IDB open, no native `sessionStorage`/`indexedDB`/`locks` getter call
before the commit mark, and no locked-access console error.

**Checker rules** (an empty trace is never proof):

- `getItem/setItem/removeItem` names start with the document user's prefix, except
  `silicon_notebook_token` (gate) and the `theme` read (seen as a `localStorage` getter call
  before any module);
- `open/deleteDatabase` names and transaction databases are prefixed; lock `request` names
  are prefixed;
- nameless operations (`key`, `clear`, `length`, `databases`, `query`) are checked by their
  functional result (case L1), not by a name;
- **positive observations**: every surface a case exercises has at least one prefixed entry;
- **control**: one test performs an unprefixed `setItem("icm.control", …)` through the
  recorded path and asserts the checker fails.

Token changes are written from T162b's non-editor page `/` in the same context (a real
`storage` event in the editor tab), never through the editor's `localStorage`.

## Cases (each in a fresh context with its own setup)

- **S1 Preferences and seeds.** (i) Bob's prefixed `icm.editor-mode.v1 = draw` seeded,
  unprefixed absent → Bob's editor shows Draw mode (a nondefault value really read).
  (ii) New context: unprefixed `draw` and Alice's prefixed `draw` seeded, Bob's absent → Bob
  shows the default mode. (iii) Seeds: a valid unprefixed `icm.recovery.v1` and an
  unprefixed recovery DB record (shapes from `document/browser-recovery-store.ts` and its
  contract); Alice's copy made **through the product** (Alice draws three resistors, record
  present by raw read); Bob's own copy made through the product. Bob discards his copy in
  File → Recover Unsaved Work: raw reads show Bob's gone, Alice's and both legacy items
  unchanged. Checker rules and positive observations over Bob's document; the control.
- **L1 Locks.** Alice's workspace DB holds a closed window's record for window `w-test`
  (made through the product in a tab that is then closed). In a fresh Alice tab: (a) the
  test holds the native lock `<alice prefix>analog-canvas-window:w-test` → no reopen offer;
  (b) holds `<bob prefix>analog-canvas-window:w-test` instead → offer shown; (c) holds the
  unprefixed `analog-canvas-window:w-test` → offer shown. The trace shows the product's
  `query` (positive observation). Fails if `query` is not stripped (a) or not filtered (b, c).
- **R1 Manual recovery after tab loss.** Alice draws three resistors, her record is
  present (raw read), `page.close({ runBeforeUnload: false })`; a new Alice tab: Recover
  Unsaved Work lists it; Restore gives revision 3. **R1-Bob**: same Alice setup through the
  product; Bob, with his own copy made first (positive control), opens the dialog, waits for
  his card, and sees no Alice card.
- **R2 Startup prompt, tab identity kept.** One tab: Alice at `/canvas/editor` draws three
  resistors; raw read shows `unsavedAtSnapshot: true`. Token → Bob; the page reloads as Bob;
  Bob goes to `/canvas/editor?recovery=meaningful` (no workspace saved under that route, as
  `recovery-dialog.spec.ts:73`). Positive setup: Bob has a copy of his own, made earlier
  through the product in another tab (so it is not banner-eligible here); wait until his
  Recover dialog lists it (discovery published), close the dialog, then assert
  `startup-recovery-banner` has count 0. Token → Alice; reload at the same URL; the banner
  shows her project (the positive leg of the same mechanism); Restore gives revision 3.
- **R3 Account change with unsaved work (the drain).** Calibration first, in the same page:
  a `location.reload()` attempt raises the `beforeunload` dialog (dismissed), proving the
  dirty-work prompt is armed (T162b N5a). Then Alice makes edit 1 and waits until its
  workspace and recovery puts are complete (trace). Through the handle the test holds a
  readwrite transaction on Alice's workspace store (re-issuing `get` in `onsuccess`). Alice
  makes edit 2 (revision R2) and, within 400 ms, the token changes. The trace must show no
  `visibilitychange`→hidden and no recovery `put` with R2 before the `storage` event (if the
  helper page's focus hides the editor tab, the case is invalid and the setup changes, e.g.
  writing the token from a page in another window). Assert at once: account-changed screen,
  no editor DOM, no navigation request at the route, no `beforeunload` dialog during the
  actual reload attempt. Release the hold. After the reload, from the trace: the workspace
  `put` with R2 and the recovery `put` with R2 have their `txId`'s `complete` before the
  reload mark. Bob's page: empty canvas, no reopen offer, and his Recover dialog (after his
  own positive-control card) has no Alice card. New Alice tab: accept the reopen offer and
  read the restored `revision` = R2. Variant: hold for 5 s → the reload mark comes after the
  deadline (~3 s) and the R2 workspace `complete` is absent before it (the documented limit).
  Fails if `flushPage` is removed (no recovery `put` with R2) or the drain is removed.
- **R4 Pending publication.** Alice creates and publishes a user component (as in
  `user-components-server.spec.ts:5-45`) with the `PUT` aborted: raw read of her journal
  shows one operation `pending: true` for component C. She downloads the project file.
  Token → Bob; Bob opens it and publishes C: the `PUT` for C is sent with Bob's token and
  "Resolve the original publication with its original account…" does not appear; Alice's
  operation is still `pending: true`.
- **R5 Recent cloud project.** Alice opens a cloud project from a clean `/canvas/editor`;
  the target tab's raw sessionStorage holds Alice's prefixed recent id. Token → Bob, URL
  clean. After startup settles (Bob's `GET api/projects` answered and his Recover dialog
  showing his state): the trace has Bob's prefixed `getItem` of the recent-project key and
  none of the unprefixed or Alice's; no request for Alice's project id; Alice's binding is
  still in the raw sessionStorage.
- **R6 Back/forward cache (required).** Launch with
  `ignoreDefaultArgs: ["--disable-back-forward-cache"]`; `goBack({ waitUntil: "commit" })`.
  Alice's editor (dirty, and with a top-layer element open if reachable in a few steps, e.g.
  the component definition editor's `showModal`), navigate to `/`, token → Bob there, Back.
  Require a persisted restore of the **editor** document (same `doc` id, `pageshow.persisted`).
  Recorded synchronously at event handling: in the persisted `pagehide`, body concealed; in
  an early `pageshow` listener (registered by the init script, before the gate's), body still
  concealed; in a late `pageshow` listener (registered at `load`, after the gate's), the
  token was re-read in this task, the account-changed screen is in `#root`, no
  `schematic-canvas`, no element outside `#root` but scripts; all before the reload mark.
  Unchanged-session variant: Back with the same token → the late listener sees body revealed
  and the editor present; no reload. Claimed: the DOM state at those moments; not claimed:
  pixels a browser may show from its own snapshot.
- **Standard build unchanged**: the full standard suite (`pnpm test:e2e:local`) once
  T162b's `project-file.spec.ts` fix is in the base.

## Commands

```bash
AUTO_CANVAS_E2E_NOTEBOOK=1 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 pnpm exec playwright test apps/editor/e2e/notebook-auth.spec.ts --workers=1
```

The report shows, from Playwright's JSON reporter, that every case named here ran (count

> 0 for each title, no skipped, no `test.fixme`).

## Refinements from the last plan review (binding)

1. **R3 ends in Alice's recovery UI.** In the same account-switch scenario, Alice opens
   File → Recover Unsaved Work and inspects or restores the copy written at the switch,
   before consuming the workspace reopen offer (or in a separate observation tab). Close or
   navigate away from Bob's editor before switching back to Alice for the fresh-window
   assertion; otherwise the original tab can reclaim Alice's window id and lock and
   correctly suppress the offer.
2. **R6, unchanged session.** Keep a focused editor control or an open modal across the
   round trip and verify its value, keyboard interaction and non-zero bounds after the
   reveal. Register the late observers after the editor has mounted. Record the first
   successful token recheck as well (focus or visibility may revalidate before `pageshow`).
3. **Recorder.** Keep `BroadcastChannel` a data property with a delegating constructor (do
   not turn it into an accessor: that would change the installer branch under test). For
   fixture ids of the form `label-<hex>` the expected prefix is the literal
   `nb1:${actualId}:`, computed without importing the implementation.
4. **No locked access on a successful sign-in.** Apply the "no storage use before sign-in"
   console assertion to a successful cold sign-in up to its commit mark, not only to the
   signed-out and failing cases, which never import the editor.
5. **L1.** Assert the logical names in the returned lock snapshot directly, including the
   absence of foreign entries.
