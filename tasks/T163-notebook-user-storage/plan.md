# T163 — Per-user browser storage in the notebook build

- Branch: `task/T163-notebook-user-storage`
- Base: the head of `task/T162-notebook-editor-gate` (at `4e7acc7` when this was written;
  stacked; rebase onto `main` once T161 and T162 are merged). In commands below
  `BASE=$(git merge-base HEAD origin/task/T162-notebook-editor-gate)`.
- Lane 2: `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`,
  `ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`. T163 starts no server.
- Split and merge condition: **T163** (this task) is the product code, unit and jsdom tests,
  build-test guards and spec. **T163b** writes the browser cases from a separate contract
  ([browser-contract.md](browser-contract.md)), after T162b. **T163 and T163b merge together**: T163's
  pull request is not merged into `main`, nor into anything merged into `main` ahead of it,
  before T163b's browser cases have run and passed against T163's code. A skipped case, or a
  result recorded as outstanding, blocks W4. W4's acceptance includes the stated `theme`
  exception (D2), a deliberate deviation from the literal wording of parent §4.3.
- Status: approved (revision 4: codex gpt-6.2-astra plan review, three rounds, verdict approve; the round-3 refinements are in "Refinements from the last plan review")
- Parent plan: silicon-notebook integration plan v7, §4.3, work package W4.

## Goal

In the notebook build the editor keeps each notebook user's local data apart. Users who
share a browser profile, one after the other or in several tabs, never see, restore,
overwrite or delete each other's local editor data (recovery records, window workspaces,
recent and deleted cloud bindings, the component publication journal, the refresh-restore
flag, preferences).

**Boundary.** The namespace governs what _the editor's own code in this document_ reads and
writes through the ordinary globals `localStorage`, `sessionStorage`, `indexedDB`,
`navigator.locks`, `BroadcastChannel`, `navigator.storage` (as `window.X`, `globalThis.X`,
`self.X` or a bare identifier). Outside it by design: other same-origin scripts
(silicon-notebook's pages), frames and child windows, anything holding a native object or
method from before the replacement, native `storage` event payloads, Workers and the service
worker, cookies, Cache Storage; quota and eviction stay origin-wide. It separates the
editor's data per user; it is not a defence against hostile same-origin code. A new storage
consumer is reviewed against this section; the guards of step 7 flag the forms they
recognise.

Also:

- Before the gate has established the user the editor cannot use those globals; afterwards,
  for the life of the document, only that user's namespace.
- Legacy _user content and bindings_ (from a single-user editor on this origin) are never
  read, migrated or deleted. Nothing is deleted at an account change or sign-out. Deletions
  inside one user's namespace (recovery retention, discard, displaced tabs) and the service
  worker's shell-cache cleanup continue as in the standard build.
- At an account change with unsaved work, the editor stores it in the outgoing user's
  namespace and the page waits, bounded, before reloading (a best-effort drain).
- A page entering the back/forward cache with the editor mounted is concealed first; on
  restore it is shown again only if the session is unchanged.
- The standard build does not change: no shared source file changes, and a full build of
  the reviewed base and of this task are identical file for file.

Not in this task: deleting another user's data, encryption at rest, the display name or a
way back to silicon-notebook (deferred owner decision), the `?project=` query string kept
by the reload (not storage).

## Context (verified at `4e7acc7`; paths under `apps/editor/src/` unless stated)

### Gate and entry

- `notebook/session.ts:47-86` `identify()` → `{ kind: "user", user }`, `user.id` a non-empty
  string. The server issues ids of 1–200 UTF-16 code units other than `local`
  (`apps/server/src/notebook-identity.ts:30,185`).
- `notebook/gate.ts:77-129` `run()` drops the user id; commit `:112-128` = `installFetch`,
  then `mountApp`. `end()` `:43-55` sets `ended` and bumps `attempt` first, then revoke,
  unmount, account-changed screen, reload, synchronously. `onChange` `:61-71` and `retry`
  `:73-75` return when `ended`. `observeSessionEvents` `:140-156` listens to `storage`
  (token key or `null`), `focus`, `visibilitychange`→visible, `pageshow` with `persisted`.
- `entries/notebook.tsx:23-79`: `mountNotebookEditor()` takes no arguments and builds its
  effects inline; the token read `:31-33` looks `window.localStorage` up inside
  `readToken`'s `try` (`session.ts:30-36`), so a throwing getter → `unreadable` → error
  screen **with Retry** (`docs/specs/server.md:213-215`). `loadApp` imports `../app/App` and
  `../services/web-editor-services`; `reload` is `window.location.reload()`. `main.tsx`
  calls `mountNotebookEditor()` with no arguments.
- `app/App.tsx:278-281` imports `agent/workspace-agent`, which imports the Agent loader
  (`workspace-agent.tsx:15-18`); its storage probe runs during render only when enabled
  (`:133-136`); the notebook build mounts App with the Agent off (`entries/notebook.tsx:58-67`).
- `apps/editor/index.html:12-18` reads `localStorage.theme` (named property) before any
  module; the body holds only `#root` and the module script (`:21-24`).

### Storage inventory (source sweep and the existing notebook output)

Sweep `localStorage|sessionStorage|indexedDB|IDBFactory|caches\.|navigator\.locks|
BroadcastChannel|navigator\.storage|document\.cookie` over `apps/editor/{src,public,index.html}`
and `packages/*/src`, tests excluded; plus a grep of `apps/editor/dist-notebook/assets`
(built from this branch 2026-11-22 12:02). Nothing new since S1 apart from the gate's read.

| #     | Store                                                                                         | Main sites                                                                                                                                                                                                    | Note                                    |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1     | IDB `analog-canvas-recovery`                                                                  | `document/browser-recovery-store.ts:213-244` (open, cached), `:252-280`, `:296-326`, `:328-409` (retention `:355-366` deletes other working copies' records in the DB), `:411`, `:437`                        | per user                                |
| 1a    | local `icm.recovery.v1` (legacy)                                                              | `browser-recovery-store.ts:508-593` (`globalThis.localStorage` `:516`, read `:524`, remove `:575`), run on mount `recovery-coordinator.ts:628-630`                                                            | per user: only the prefixed key is seen |
| 2     | session `icm.working-copy.v1`                                                                 | `recovery-coordinator.ts:192-199` (guarded), `:281,285,456,469`; `workspace-reopen.ts:323`                                                                                                                    | per user                                |
| 3     | IDB `analog-canvas-workspaces`                                                                | `project-workspace.ts:133-148` (bare `indexedDB`, cached), `:150-234`; writes queued `app/use-project-tab-sessions.ts:589-623`                                                                                | per user                                |
| 3a/3b | session `icm.workspace-journal.v1`, `icm.workspace-window.v1`                                 | `project-workspace.ts:17-29,164,251`                                                                                                                                                                          | per user                                |
| 3c    | locks `analog-canvas-window:<id>`                                                             | `project-workspace.ts:33-35` (`navigator.locks ?? null`), `:48-52`, `:62`                                                                                                                                     | per user                                |
| 4     | session `icm.restore-after-refresh.v1`                                                        | `use-project-file-lifecycle.ts:186-192` (unguarded render read), `:197`, `:882`; `components/chunk-load-fallback.tsx:14`                                                                                      | per user                                |
| 5/6   | session recent / deleted cloud projects                                                       | `document/cloud-project-session.ts:10-17` (guarded), `:27,40,51,66,89,103`; read at render `use-project-file-lifecycle.ts:200-202`                                                                            | per user                                |
| 7     | IDB `analog-canvas-component-publication`                                                     | `features/user-components/component-publication-journal.ts:43-62` (new connection per call; records carry `accountId`, key `[accountId, idempotencyKey]`, `:7,27-28`)                                         | per user                                |
| 8     | session `icm.agent-session-recovery.v1`                                                       | `agent/*`, `app/use-agent-hosts.ts:88`; not reached (Agent off)                                                                                                                                               | per user                                |
| 9     | session `icm-chunk-reload`                                                                    | `components/route-chunk-loader.ts:29,36,44`; not in the notebook output today                                                                                                                                 | per user                                |
| 10–15 | local preferences: editor mode, panels, grid, angle, wheel, recent components, netlist export | `features/editor-shell/editor-mode.ts:15-22` (guarded), `use-editor-panels.ts:30-87`, `app/App.tsx:630-870` (`:834` unguarded), `use-component-placement.ts:161,848`, `netlist-export-preferences.ts:178,190` | per user (OD1)                          |
| 16    | local `theme`                                                                                 | `index.html:12-18`                                                                                                                                                                                            | device-wide, stated exception           |
| 17    | Cache `icm-static-shell-…`                                                                    | `public/sw.js:36-59,150-161`; `components/stale-build-recovery.ts:148-154`                                                                                                                                    | outside the boundary                    |
| 18    | local `icm.desktop.creation:…`                                                                | `hosts/native-project-request.ts`                                                                                                                                                                             | desktop only                            |
| G     | local `silicon_notebook_token`                                                                | `session.ts:9,30-40`                                                                                                                                                                                          | always native                           |

Notebook output, by name: `localStorage` in `App-*`, `notebook-*`; `sessionStorage` in
`App-*`, `cloud-project-session-*`, `chunk-load-fallback-*`, `workspace-agent-*`,
`agent-runtime-*`; `indexedDB` in `App-*`, `component-publication-*`; `.locks` in `App-*`;
`caches.` in `styles-*` (stale-build recovery); a `storage` event registration only in
`notebook-*`. Absent from every chunk: `BroadcastChannel`, `getDirectory`,
`Storage.prototype`, `IDBFactory`, `IDBDatabase.prototype`, `LockManager`, `storageArea`,
`SharedWorker`, `document.cookie`, `new Function`, `eval(`. Worker assets
(`auto-layout.worker-*.js`, `worker-*.js`) hold no storage name as a bounded token (the
auto-layout worker contains `blocks`/`.blocks`). Frames: `browser-bounds-*`
(`packages/exporters`), `html2canvas-*`, `jspdf.es.min-*` create iframes; `window.open` in
MathLive and the RNL viewer — all outside the boundary. First-party named access to a
Storage (`localStorage.x`, `localStorage[x]`) exists only in `index.html`. Editor content
outside `#root`: portals and body-appended menus (`features/properties/component-property-json-editor.tsx:1331`,
`features/properties/property-option-preview-menu.ts:168`), top-layer dialogs and popovers
(`showModal`/`showPopover`, e.g. `features/user-components/component-definition-editor.tsx:456`,
`component-popover.tsx:20`).

### Page lifecycle facts

- Page-hide handlers: `document/use-project-tabs.ts:96-114` (`final()` on `pagehide`,
  `beforeunload`, hidden, and at unmount: queues the workspace IDB write on
  `workspaceSaveQueue`, a promise continuation, `use-project-tab-sessions.ts:601-607`, then
  writes the journal synchronously `:622-623`); `recovery-coordinator.ts:641-650` (flushes the
  400 ms debounced record on `pagehide` and hidden; unmount `dispose()` `:658` cancels it);
  `App.tsx:4335-4351` (clears canvas state). The dirty-work prompt goes at unmount
  (`use-unsaved-work-guard.ts:39-56`). No first-party `pageshow` listener exists besides the
  gate's.
- `fake-indexeddb` 6.2.7 is a dev dependency (`apps/editor/package.json:48`); its event
  target runs `addEventListener` listeners before `on…` handlers.
- Build test: `scripts/notebook-editor-build.test.mjs` exposes rendered modules
  (`:85-92`, rolldown 1.2.3 `RenderedModule.code`) and `workerAssets` (`:80-83`, every `.js`
  asset), and already checks executable references; those checks keep running.

### Experiment evidence (Chrome 157.0.8103.79 via Playwright 1.62.1, headless; pages served

by `page.route`, no build, no server; `tmp/t163-exp/`)

- `out.json`, `out2.json`: `localStorage`, `sessionStorage`, `indexedDB`, `caches` are own
  configurable accessors of `window`; `navigator.locks`/`storage` are configurable accessors
  on `Navigator.prototype`; `BroadcastChannel` is an own configurable **data** property.
  Redefinition on `window`/the `navigator` instance works and `window.X`, `globalThis.X` and
  bare identifiers see it. Prefixed names reach the real stores; a 1005-character prefix
  works. A put chained behind an in-flight transaction is lost 3/3 on immediate reload (the
  drain was not exercised).
- `out3.txt` (the first `out3.json` run hung and is empty): a captured
  `Object.getOwnPropertyDescriptor(window, "sessionStorage").get.call(window)` returns the
  same working native object after `window.sessionStorage` is redefined.
- `out4.txt`/`out4b.txt` (`exp4.mjs`): `display: none !important` on `<body>` makes
  `checkVisibility()` false for body content, a modal `<dialog>`, a manual popover and a
  body-appended menu. With `ignoreDefaultArgs: ["--disable-back-forward-cache"]`, a
  navigation away and `goBack({ waitUntil: "commit" })` restore the same document
  (`pageshow.persisted`, same random document id); a concealment set in the persisted
  `pagehide` is still in place when `pageshow` handlers run, and the trace written to
  `sessionStorage` synchronously at each event survives.
- Held navigation: per the T162b planning record (`T163-plan-r2.md`, "Known from the T162b
  planning experiments"), a reload held at the network leaves the old document
  uninspectable; my `exp3.mjs` agrees (evaluate and CDP gave no answer in 5 s).
- Not proved: Firefox, Safari.

## Decisions

### D1 Mechanism

The notebook entry replaces the storage globals with per-user facades (rather than a
namespace module called from ~15 shared files, which would change the standard source and
output and leak at any site it misses). Only `src/notebook/**` and `entries/notebook.tsx`
change; the standard output stays identical. Protecting users from hostile same-origin
code would need a browser-enforced boundary (another origin) and is not this task.

### D2 What is per user

Everything the editor reaches through the replaced globals: rows 1–15 and 18. Retention,
`latestElsewhere`, the lock query and the publication lookup thereby work per user; the
legacy migration only ever sees the prefixed key (always `not-needed`). Preferences per
user (OD1 default). `theme`: device-wide, a stated exception kept as it is (no HTML
transform; no writer in `src`; a future writer would write the prefixed key, which the
early read never sees). Cache Storage: outside the boundary.

### D3 Namespace value

`namespacePrefix(id) = "nb1:" + encode(id) + ":"`; `encode` keeps `A–Z a–z 0–9 _ -` and
writes every other UTF-16 code unit as `.` + four lowercase hex digits. Total, synchronous,
deterministic in every browser, injective, `:`-free (so prefix-free, and disjoint from
every unprefixed name). ≤ 1005 characters for ids of ≤ 200 code units; longer ids give
longer prefixes. Expected values (by hand): `alice`→`nb1:alice:`, `Alice`→`nb1:Alice:`,
`a_b-c`→`nb1:a_b-c:`, `a:b`→`nb1:a.003ab:`, `.003a`→`nb1:.002e003a:`, `a.b`→`nb1:a.002eb:`,
`a b`→`nb1:a.0020b:`, `é`→`nb1:.00e9:`, `😀`→`nb1:.d83d.de00:`, lone `\ud800`→`nb1:.d800:`.
No hash (`crypto.subtle` needs a secure context and is async; little gain).

**Supersedes T162's note** ("do not persist … a user id or anything derived from them"),
without editing T162's plan: the namespace adds an encoded user id to the names of the
user's stores and stores no additional copy of the token. (The publication journal already
persists `accountId`.) The spec says so.

### D4 Install and native access

`installNotebookStorage(page, { onLockedAccess })` runs first in `mountNotebookEditor()`,
before the gate starts and before any `loadApp`. It calls no getter.

- For each surface (`localStorage`, `sessionStorage`, `indexedDB`, `BroadcastChannel` on
  `page`; `locks`, `storage` on `page.navigator`) it finds the descriptor along the
  prototype chain:
  - none → the API is **absent** and stays absent (e.g. `[SecureContext]` `locks`/`storage`
    on plain http);
  - **accessor** descriptor → native access is `descriptor.get.call(receiver)`, made lazily
    at each use; the facade is an own accessor on `page`/`page.navigator`;
  - **data** descriptor (`BroadcastChannel`) → native value is `descriptor.value`; the facade
    class is an own data property.
- If `defineProperty` throws for a **present** surface, or the read-back
  (`Object.getOwnPropertyDescriptor` on `page`/`page.navigator` returns the installed getter
  or class, and `globalThis === page`) fails, install reports a **terminal failure**: the
  entry shows the error screen in its Reload variant, does not start the gate, subscribes to
  nothing, and never calls `loadApp`. This holds whether the native getter currently works,
  throws or returns nothing.
- **Locked until commit**: a facade getter (or the channel constructor) used before
  `setNamespace` throws `DOMException(…, "SecurityError")` and calls `onLockedAccess(name)`;
  the entry logs `console.error("auto-canvas: browser storage used before sign-in: <name>")`.
- **After commit**: the facade getter calls the native getter each time; a throw is
  rethrown unchanged (guarded callers — `recovery-coordinator.ts:192-199`,
  `cloud-project-session.ts:10-17`, `editor-mode.ts:15-22`, `project-workspace.ts:24-27` —
  behave as natively; unguarded render reads fail as in the standard build); `null` stays
  `null`; otherwise it returns the facade bound to that native object (memoised).
- **Token read**: `readToken({ getItem: (key) => storage.native("localStorage").getItem(key) })`,
  the native lookup inside `readToken`'s `try`: denial → `unreadable` → error with Retry, and
  Retry works once the browser allows storage again (T162 behaviour).
- **`setNamespace(prefix)`** (gate commit, once; a second call throws): repeats the read-back;
  a mismatch throws `NotebookStorageError` and the gate ends permanently (below); otherwise
  sets the prefix and unlocks. No dynamic evaluation anywhere.
- Facades:
  - Storage: a frozen object — `getItem`, `setItem` (`String(value)`; native errors such as
    `QuotaExceededError` propagate), `removeItem`, `key(i)`, `length`, `clear()` over native
    keys with the prefix, stripped; `clear()` removes only those. Named properties are
    unsupported (no `Proxy`: no first-party consumer; frozen, so a named write throws in
    module code); a source check (step 8) guards first-party code.
  - IndexedDB: `open`, `deleteDatabase` prefixed; `databases()` filtered and stripped; `cmp`
    passed through; drain tracking (D5).
  - Locks: `request(name, cb)` and `request(name, options, cb)` prefixed; `query()` filtered
    and stripped.
  - `BroadcastChannel`: a class prefixing the name. `navigator.storage`: `getDirectory()`
    rejects `SecurityError`; `estimate`/`persist`/`persisted` call the native ones.
- Gate: `run()` keeps the user id; the commit is re-read token → `installStorage(userId)` →
  `installFetch` → `mountApp`, without yielding. If `installStorage` throws, the gate **ends
  permanently** (`ended = true`, `attempt += 1`: no `onChange` run, no Retry, no
  continuation), installs no fetch, mounts nothing, shows the Reload error.

### D5 Account change: bounded best-effort drain

`end()`:

1. `ended = true; attempt += 1;` take and clear `mounted`. A second change, a late 401, a
   Retry or a stale continuation now does nothing; the editor is never remounted and reload
   happens once.
2. `revoke()`: further API requests are refused; non-API requests are unaffected; requests
   already under way are not cancelled.
3. `flushPage()` (in `try`): dispatch `new PageTransitionEvent("pagehide", { persisted: false })`
   on `window`, running the editor's own page-hide handlers while mounted (recovery flush,
   final workspace and journal, canvas cleanup). Deliberate coupling (RD2).
4. `unmount()` (in `try`); then `purgeOutsideRoot()` (in `try`): remove every element child
   of `<body>` other than the root container and `<script>` elements (body-appended editor
   menus that unmount may leave); then `reveal()` (D6).
5. `showScreen("account-changed")` (in `try`; fallback: the root's children replaced by the
   sentence as plain text).
6. `await settleStorage()` (never rejects), `reload()` in `finally`.

Drain (in the IndexedDB facade): an open or delete request counts from creation to its
first `success` or `error` (`blocked` is not terminal; the upgrade runs inside); a
transaction from creation to its first `complete` or `abort` (`error` is not terminal).
Counting uses `addEventListener` with a once-per-object guard, never replaces application
handlers, never decrements twice. `open()` adds `upgradeneeded` and `success` listeners
before returning, and the first wraps the connection's `transaction` method on the
instance, before the application sees the connection; cached connections were opened
through the facade. `settle(deadlineMs)` uses an injectable checkpoint scheduler (default
`setTimeout(0)`): it resolves after two consecutive checkpoints at which the count is zero
**and no activity (any begin or end) happened since the previous checkpoint**; any activity
resets the streak; or when the deadline passes. Deadline: 3 s, best effort, subject to
browser scheduling.

Promise, and only this: writes the editor starts by the end of step 4 get up to about 3 s
to finish in the outgoing user's namespace before the reload. A blocked open, the cap, or a
killed tab can still lose them; the sessionStorage journal comes back only in that tab and
cannot become a durable record elsewhere.

### D6 Back/forward cache concealment

- `observeSessionEvents` also listens to `pagehide`; with `persisted === true` it calls the
  gate's `onConceal`, which, when mounted and not ended, calls `effects.conceal()` and sets
  `concealed`. The synthetic `pagehide` of D5 has `persisted: false` and is ignored.
- `conceal()` (entry): `document.body.style.setProperty("display", "none", "important")`,
  remembering the previous inline value and priority; `reveal()` restores them (idempotent).
  Body-level concealment covers `#root`, portals, body-appended menus and top-layer dialogs
  and popovers (Chrome, `exp4`). The gate's listener is registered before the editor mounts,
  so it runs before the editor's own `pagehide` handlers.
- On any observed event (in particular `pageshow` with `persisted`): `onChange` re-reads the
  token; unchanged → `reveal()` if `concealed`; changed, missing or unreadable → `end()`
  (unmount and purge happen before `reveal()`, so the editor is never shown again).
- Testable claim: when the restored document's `pageshow` handlers run, the editor is
  concealed, and with a changed session the handler has replaced it by the account-changed
  screen before returning. Not claimed: what a browser paints from its own snapshot before
  script runs.

## Scope

Owned: new `apps/editor/src/notebook/browser-storage.ts`, `browser-storage.test.ts`,
`storage-consumers.test.ts`, `entry.integration.test.tsx`; `apps/editor/src/notebook/gate.ts`,
`gate.test.ts`; `apps/editor/src/entries/notebook.tsx`;
`scripts/notebook-editor-build.test.mjs`; `docs/specs/server.md` (subsection "The editor in
notebook mode"); `tasks/T163-notebook-user-storage/report.md`.

Not owned: `tasks/T162-notebook-editor-gate/**`, `apps/editor/src/main.tsx` and every other
file under `apps/editor/src`, `apps/editor/index.html`, `apps/editor/public/**`,
`apps/editor/vite.config.ts`, `apps/editor/e2e/**`, `playwright.config.ts`,
`apps/server/**`, `packages/**`, dependencies, `pnpm-lock.yaml`. If a step needs one of
them, stop and report.

## Steps

1. Prefix (D3).
2. Facades and install (D4); `installNotebookStorage` never throws; it returns
   `{ failure, native(name), setNamespace(prefix), settle(deadlineMs), schedulerForTests? }`.
3. Drain (D5) with the injectable scheduler.
4. Gate (`gate.ts`): `GateEffects` gains `installStorage(userId)`, `flushPage()`,
   `purgeOutsideRoot()`, `conceal()`, `reveal()`, `settleStorage()`; commit, permanent end on
   `installStorage` failure, `end()` (D5), concealment (D6); `observeSessionEvents` gains the
   `pagehide` callback.
5. Entry (`entries/notebook.tsx`):
   - `mountNotebookEditor(overrides?)`: an optional argument, default today's behaviour, that
     `main.tsx` does not pass: `{ page?: Window, identify?, loadModules?, reload? }`, used only
     by the jsdom test.
   - install first; on `failure` show the Reload error and return.
   - wire the D4–D6 effects; marks for T163b: `performance.mark("auto-canvas:notebook-commit")`
     right after `installStorage` succeeds, `performance.mark("auto-canvas:notebook-reload")`
     right before `reload()`.
6. Spec (below).
7. Build-test guards (`scripts/notebook-editor-build.test.mjs`, notebook build), written as
   pure functions over `{ id, code }` inputs (as `codeTargetProblems` is), so controls can
   run them:
   - **Consumers**: a rendered module whose code contains a bounded token
     `\b(localStorage|sessionStorage|indexedDB|BroadcastChannel)\b`, a member access
     `\.\s*(locks|getDirectory)\b`, or the identifier `\bcaches\s*\.` must have a
     repository-relative id (e.g. `apps/editor/src/app/App.tsx`) in a pinned list. The
     implementer derives the list from the output, checks it against the inventory, records
     it in the report. A second access inside a pinned module is not detected (review rule).
   - **Event registration**: `addEventListener\(\s*["'`]storage["'`]` or `\bonstorage\b` only
     in `apps/editor/src/notebook/gate.ts` (the installer's descriptor lookup of
     `"storage"` on `navigator` is not a registration).
   - **Absent from every emitted chunk and asset**: `Storage.prototype`, `IDBFactory`,
     `IDBDatabase.prototype`, `LockManager`, `storageArea`, `SharedWorker`, `document.cookie`.
   - **Worker assets** (`workerAssets` minus any `sw.js`): no bounded token of
     `localStorage`, `sessionStorage`, `indexedDB`, `BroadcastChannel`, `caches`, and no
     `\.\s*locks\b`. **`sw.js`** (from the output if present, otherwise
     `apps/editor/public/sw.js`): may use `caches`; none of the others.
   - **Controls** (synthetic inputs): the installer-like
     `Object.getOwnPropertyDescriptor(Navigator.prototype, "storage")` → no event finding;
     worker code with `blocks` / `.blocks` → no finding; a second module registering
     `addEventListener("storage", …)` → finding; a worker asset with `indexedDB.open(` →
     finding; an unpinned module using `sessionStorage` → finding.
   - These guards cover the forms they recognise; the existing executable-reference checks
     and standard-build assertions keep running.
8. Tests (Vitest):
   - Prefix: the D3 table (fixed values), plus pairwise injectivity and prefix-freedom over
     generated ids.
   - Install, over fake pages with recording getters: no getter called at install; absent
     surfaces stay absent; accessor and data branches; locked access throws `SecurityError`
     and calls `onLockedAccess`; after commit a denied getter rethrows the same error each
     time (separately from a method failure); `null` stays `null`.
   - Terminal install failure, decided before `loadApp`: a frozen fake page (its
     `defineProperty` throws at install) with a usable getter → `failure`; **denied-then-usable**:
     the same with a getter that throws at install and works afterwards → still `failure`;
     through the entry seam: error screen, `loadModules` never called, the native getter never
     called; a `Proxy` page whose `defineProperty` trap returns `true` without defining →
     read-back `failure`. `setNamespace`: second call throws; descriptor replaced between
     install and commit → `NotebookStorageError`, gate ends, no fetch, no mount.
   - Token read: throwing native getter → error with Retry; Retry after recovery mounts.
   - Storage facade: Alice/Bob/unprefixed native keys; scoping of `length`/`key`/`clear`;
     `QuotaExceededError` propagates; frozen.
   - IDB facade over `fake-indexeddb`: prefixed `open`/`deleteDatabase`; `databases()`
     (stub native if unsupported); `cmp`.
   - Real stores through facades: `createBrowserRecoveryStore({ idbFactory })` — Bob writes
     enough records to trigger retention: a Bob record is evicted and an Alice record that
     would be eligible in a shared DB survives; `createProjectWorkspaceStore(factory)` —
     Bob's `latestElsewhere` never returns Alice's window; `migrateLegacyProjectRecovery` with
     a valid unprefixed `icm.recovery.v1` natively → `not-needed`, native key untouched.
   - Drain with the controlled scheduler: idle → resolves after two idle checkpoints; a
     transaction opened between checkpoint 1 and 2 → waited for (**a one-checkpoint mutant
     resolves early and fails this case**); activity that begins and ends between two
     checkpoints resets the streak; deadline with a never-completing transaction (fake
     timers); blocked-then-released open; upgrade abort (counted to `error`); a handled
     request error (counted to `complete`); `error` then `abort` counted once; reused and new
     connections; application `on…` handlers still run. Separately, with the real
     `setTimeout`: a write chained in a promise continuation after a previous write's
     completion (the `workspaceSaveQueue` shape) is waited for.
   - Locks, channel, `navigator.storage`: prefixing, filtering, absence preserved, locked
     throws, `getDirectory` rejects.
   - Gate: user id to `installStorage` before `installFetch`/`mountApp`; Alice-held/Bob-mounts
     installs once, for Bob; `end()` order revoke → flushPage → unmount → purge → reveal →
     screen → (settle pending, no reload) → reload; each cleanup throwing still ends in one
     reload; trigger, late `onUnauthorized` and Retry during settle do nothing; concealment:
     persisted `pagehide` mounted → `conceal`; then unchanged token on `pageshow` → `reveal`,
     no `end`; changed token → `end`, and `reveal` is called only after `unmount`; synthetic
     (`persisted: false`) → no conceal; not mounted → no conceal.
   - Entry `conceal`/`reveal`: body inline `display` set to `none !important` and restored to
     its previous value and priority.
   - Source check (`storage-consumers.test.ts`): no non-test file under `apps/editor/src`
     uses `localStorage`/`sessionStorage` with a named property other than the six methods,
     or with `[`.
   - jsdom (`entry.integration.test.tsx`): calls the **production** `mountNotebookEditor`
     through the seam with a page whose native `indexedDB` is `fake-indexeddb`, a native
     token for Alice, a fake `identify`, `loadModules` returning a fixture App that writes on
     `pagehide` and at unmount through the globals (one write chained on the previous
     promise), and a spy `reload`. Shows: the token is read natively (a facade read would see
     nothing and give the signed-out screen); after a token change and a `storage` event, the
     account-changed screen, both writes in Alice's prefixed DB before `reload`, nothing in
     Bob's, one `reload`. Does not show the real editor's handlers, navigation, renderer
     teardown, the back/forward cache or native IDB timing (T163b).
9. Report: acceptance output, pinned consumer list, identity result, deviations.

## Spec (`docs/specs/server.md`)

Replace the lifecycle paragraph at `:240-246` with:

> The page watches for another session: a `storage` event for the token key or a cleared
> storage, focus, the page becoming visible, and a page restored from the back/forward
> cache. When the stored token is then missing, unreadable or a different one, or after a
> 401, the page ends its editor once: it refuses every further API request at once (other
> requests are not affected, and requests already under way are not cancelled), lets the
> editor store its unsaved work as when the page is hidden, removes the editor, shows that
> the notebook session changed, waits up to about 3 seconds for the editor's storage writes,
> and reloads. From the first step another change or 401 does nothing: the editor is not
> mounted again and the page reloads once, even if removing the editor fails. When the page
> is put into the back/forward cache it is hidden first, and on return it is shown again
> only if the session is unchanged. The page never renews a token.

Replace the sentence at `:250-253` with:

> **Browser storage per user.** Until the gate has identified the user the editor cannot
> use `localStorage`, `sessionStorage`, `indexedDB`, `navigator.locks`, `BroadcastChannel` or
> `navigator.storage`; then, for the rest of the page's life, they are bound to that user:
> every key, database, lock and channel name gets the prefix `nb1:<encoded id>:` (letters,
> digits, `_`, `-` kept, every other UTF-16 code unit as `.` and four hex digits) and the
> editor sees only those names. Preferences are per user too. The namespace adds the encoded
> user id to store names and stores no additional copy of the token. A store the browser
> denies stays denied; if a store the browser offers cannot be bound to the user, the page
> shows the error page and does not start.
>
> Boundary: this separates the editor's own data per user. It does not cover other scripts
> of the origin (silicon-notebook's pages), frames and windows, `storage` event contents,
> Workers and the service worker, cookies or Cache Storage; quota and eviction stay shared.
> It is not a defence against hostile same-origin code. New storage use in the editor is
> reviewed against this section; the notebook build test flags the forms it recognises.
>
> Exceptions: the gate reads silicon-notebook's token from the browser's own storage; the
> `theme` display preference is read before any script and is shared on the device; the
> service worker's shell cache holds no user data. Content and bindings stored by a
> single-user editor on this origin are never read, migrated or deleted; nothing is deleted
> when the session changes or ends, while within one user's stores the editor deletes as it
> always does and the service worker replaces old shells. At a session change the wait is a
> best effort: unfinished writes, or a tab that closes or crashes, lose what the standard
> editor would lose, and a copy kept only for the tab returns only in that tab. Other users'
> data stays in the browser profile, unshown and unencrypted; signing out does not remove
> it. Not yet in this build: the user's display name or a way back to silicon-notebook in
> the editor's own chrome.

## Acceptance

```bash
pnpm install --frozen-lockfile --offline
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
unset VITE_AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH
BASE=$(git merge-base HEAD origin/task/T162-notebook-editor-gate)
pnpm build                                                                              # exit 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs    # all pass
pnpm test:local                                                                         # all pass
pnpm build:notebook-editor                                                              # exit 0
{ git diff --name-only "$BASE"; git ls-files -o --exclude-standard; } | sort -u \
  | grep -vE '^(apps/editor/src/notebook/|apps/editor/src/entries/notebook\.tsx$|scripts/notebook-editor-build\.test\.mjs$|docs/specs/server\.md$|tasks/T163-notebook-user-storage/)' \
  | grep -vE '^(tmp/|apps/editor/dist|node_modules)' ; test $? -eq 1                     # no path outside the owned list
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check                      # exit 0
ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 pnpm exec playwright test apps/editor/e2e/recovery-dialog.spec.ts apps/editor/e2e/recovery-hardening.spec.ts apps/editor/e2e/project-tabs.spec.ts   # standard, unchanged, pass
```

Standard output identity (full builds of both sides from exports, same environment; the
index and working tree of the task checkout are not touched):

```bash
rm -rf tmp/t163-id && mkdir -p tmp/t163-id/base tmp/t163-id/head
git archive "$BASE" | tar -x -C tmp/t163-id/base
git ls-files -co --exclude-standard -z | grep -zv '^tmp/' | xargs -0 tar -c | tar -x -C tmp/t163-id/head
for side in base head; do (cd tmp/t163-id/$side && pnpm install --frozen-lockfile --offline && pnpm build); done
diff -rq tmp/t163-id/base/apps/editor/dist tmp/t163-id/head/apps/editor/dist           # exit 0, index.html and sw.js included
```

(Both sides sit at paths of equal length, so a path embedded in output could not hide a
difference; if `diff` reports one, the implementer shows its cause before going on.) Not
`pnpm deadcode` (fails on `main`).

## What T163b relies on (summary; the cases are in the contract)

The product exposes: the two marks (`auto-canvas:notebook-commit`, `-reload`); the
`console.error` on locked access; body concealment observable as body inline style; the
prefix function, importable from `apps/editor/src/notebook/browser-storage.ts` (pure) to
derive expected names from the fixture's actual user ids. T163b runs R1–R6 and S1 against
the notebook production build, owns adapting T162b's pre-sign-in probes to one init script
and one raw-inspection handle (a direct `indexedDB.databases()` on the signed-out editor
page now throws by design), and its results are T163's merge condition.

## Notes for the implementer

- Do not add shared-key allowlists (OD1) or delete data (D6/Goal); keep `theme` as is.
- The synthetic `pagehide` is deliberate (RD2); do not change `document/**`.
- A failing consumer guard is reported for review, not silenced by extending the list.
- If a step cannot be done as written, stop it and record why.

## Size

`browser-storage.ts` ~450 lines; ~90 changed lines in `gate.ts`, ~70 in the entry; build-test
guards with controls; ~70 test cases. At the upper end of one round. If it does not fit, two
rounds on this branch, in order: **A** steps 1–2, the commit/permanent-end part of 4, the
entry without drain and concealment, 7, and their tests; **B** step 3, `end()`, concealment,
their wiring, the spec lifecycle paragraph, drain/gate/jsdom tests. Neither merges alone.

## Reviewer decisions

- RD1 encoded id, no hash, T162's plan untouched. RD2 synthetic `pagehide`. RD3 3 s
  best-effort deadline. RD4 T163/T163b merge together.
- Round 1: boundary = editor's own code; lazy native access; `theme` exception.
- Round 2: an unreplaceable present surface is terminal at install; syntax-bounded guards;
  concealment for the back/forward cache in this task; export-based identity check; entry
  seam for the jsdom test.

## Owner defaults

- OD1 preferences per user. OD2 no "remove my data" control in this round; nothing deleted.

## Refinements from the last plan review (binding, they override the text above where they differ)

1. **Connection tracking on a reopen without an upgrade.** The same idempotent connection
   wrapper is called from both the `upgradeneeded` and the `success` listener, before
   application handlers. Unit test: seed a database, close it, reopen at the same version
   through the facade, hold a transaction from that connection, and `settle` waits for it.
2. **Ownership check.** Match the enumerated owned files, not every path under
   `apps/editor/src/notebook/`; ignore generated outputs by directory boundary
   (`apps/editor/dist/`, `apps/editor/dist-notebook/`, `node_modules/`). For the head export,
   feed the NUL-delimited manifest to one `tar --null -T -` invocation.
3. **Wording.** Prefix-freedom separates encoded users from each other; separation from
   legacy names follows from the audited legacy names, none of which starts with `nb1:`
   (another same-origin writer could choose such a name; that is outside the boundary). The
   `theme` read is an inline read before the entry module. Concealment covers editor content
   in the body; the document title, which carries the project name, stays until unmount.
4. **Late lifecycle observers** (for the browser cases) are registered once the editor is
   mounted, not at `load`: `main.tsx` starts a dynamic import. The entry sets its commit mark
   after mount so a test can wait for it.

   (Planner's correction after the code review of PR 116: `createRoot().render()` only
   schedules the render, so the mark means "namespace fixed, render scheduled", not
   "mounted". A case that needs the mounted editor waits for the editor itself, e.g. the
   `schematic-canvas` test id, before it registers late observers.)
