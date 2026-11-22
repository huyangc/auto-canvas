# T163 report — round 1

(From the implementer subagent's hand-back; saved by the reviewer, because the
harness refuses a subagent's write of a `.md` file.)

```
$ git status --short
 M apps/editor/src/entries/notebook.tsx
 M apps/editor/src/notebook/gate.test.ts
 M apps/editor/src/notebook/gate.ts
 M docs/specs/server.md
 M scripts/notebook-editor-build.test.mjs
?? apps/editor/src/notebook/browser-storage.test.ts
?? apps/editor/src/notebook/browser-storage.ts
?? apps/editor/src/notebook/entry.integration.test.tsx
?? apps/editor/src/notebook/storage-consumers.test.ts
```

I am on `task/T163-notebook-user-storage` (head 4bfcc19). Nothing is committed, stashed or pushed. Scratch files are in `tmp/` (git-ignored).

## Summary

Rounds A and B are both done. Every acceptance command exits 0, and the standard build is identical file for file to the base.

- **`apps/editor/src/notebook/browser-storage.ts`** (new) provides:
  - `namespacePrefix`, as D3 specifies.
  - `installNotebookStorage`. It replaces the six storage globals with facades that stay locked until the namespace is set. It calls no storage getter. If a store that is present cannot be replaced, it reports a terminal `failure`; it never throws.
  - `native()` (the gate's token read), `setNamespace()` (once only, repeats the read-back) and `settle()` (the bounded drain over IndexedDB requests and transactions, with an injectable checkpoint scheduler).
- **`gate.ts`**:
  - The gate keeps the user id. The commit order is re-read → `installStorage(userId)` → `installFetch` → `mountApp`. If `installStorage` fails, the gate ends for good and shows the Reload error.
  - `end()` runs revoke → flushPage → unmount → purge → reveal → screen, each step in try, then settle, then exactly one reload.
  - Back/forward cache concealment uses a new `pagehide` callback in `observeSessionEvents`.
- **`entries/notebook.tsx`**:
  - `mountNotebookEditor(overrides?)` accepts `{ page, identify, loadModules, reload }`; `main.tsx` is unchanged.
  - Storage is installed first. On failure the entry shows the Reload screen and returns.
  - It wires the D4–D6 effects and sets the two marks, `auto-canvas:notebook-commit` and `auto-canvas:notebook-reload`.
- **Build-test guards**, written as pure functions with controls: storage consumers against a pinned list, storage-event registration, forbidden names, and worker assets plus `sw.js`.
- **Spec text** in `docs/specs/server.md` per the plan, with refinement 3's wording.

## Steps

| Step                       | Status   | Notes                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Prefix (D3)              | done     | `namespacePrefix` in `browser-storage.ts`.                                                                                                                                                                                                                                                                                                                                    |
| 2 Facades and install (D4) | done     | Accessor and data branches; absent stays absent; locked access throws `SecurityError` and calls `onLockedAccess`. After commit a native getter's error is rethrown unchanged and null stays null; facades are memoised. Storage facade is frozen; IDB, locks, channel and `navigator.storage` facades as D4 says. Read-back checks own descriptors and `globalThis === page`. |
| 3 Drain (D5)               | done     | Requests are counted to `success`/`error`, transactions to `complete`/`abort`. A once-per-object guard and `addEventListener` are used. The same connection wrapper runs from both `upgradeneeded` and `success` (refinement 1). Settle needs two consecutive idle checkpoints with no activity between them, or the deadline.                                                |
| 4 Gate                     | done     | As in the Summary.                                                                                                                                                                                                                                                                                                                                                            |
| 5 Entry                    | done     | Commit mark is set after mount (refinement 4); reload mark right before `reload()`. Account-changed fallback is plain text in the entry.                                                                                                                                                                                                                                      |
| 6 Spec                     | done     | Lifecycle paragraph and the storage section replaced. Test links added for `browser-storage.test.ts` and `entry.integration.test.tsx`.                                                                                                                                                                                                                                        |
| 7 Build-test guards        | done     | Pinned list below. The controls the plan lists are in a new test case.                                                                                                                                                                                                                                                                                                        |
| 8 Tests                    | done     | `browser-storage.test.ts` 52 tests, `gate.test.ts` 39 (existing ones adapted to the async reload), `entry.integration.test.tsx` 9 (jsdom, production entry), `storage-consumers.test.ts` 2, build test 7 (1 new).                                                                                                                                                             |
| 9 Report                   | not mine | Content is this message.                                                                                                                                                                                                                                                                                                                                                      |

## Acceptance results

All run with `unset VITE_AUTO_CANVAS_AUTH AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH ICM_E2E_BASE_URL ICM_E2E_SERVER`, `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`, BASE=4e7acc7fa6503394bd9f4b714aa9bb14d53bcd68. Scripts: `tmp/acceptance.sh`, `tmp/identity.sh`; logs: `tmp/acc-*.log`.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm build → 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; Test Files 11 passed (11), Tests 144 passed (144)
pnpm test:local → 0; Test Files 854 passed | 3 skipped (857), Tests 8910 passed | 117 skipped (9027)
pnpm build:notebook-editor → 0
ownership check (refinement 2: the enumerated owned files; dist/, dist-notebook/, node_modules/ ignored by directory) → 0; 0 paths outside
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check → 0; oxlint 0 errors, no warnings in owned files; "All matched files use Prettier code style!"; "Validated local Markdown links in 75 files"
ports 4273/4321 checked free before the run, and again after
ICM_E2E_ISOLATED=1 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 pnpm exec playwright test apps/editor/e2e/recovery-dialog.spec.ts apps/editor/e2e/recovery-hardening.spec.ts apps/editor/e2e/project-tabs.spec.ts → 0; 29 passed (1.6m)
```

## Investigation results

**Standard output identity** (the plan's procedure; head exported with `git ls-files -co --exclude-standard -z | grep -zv '^tmp/' | tar --null -T - -c -f - | tar -x`):

- Head export has 3178 files, base 3172. The 6 extra are `plan.md`, `browser-contract.md` and the 4 new notebook files.
- Base build exit 0, head build exit 0.
- `diff -rq tmp/t163-id/base/apps/editor/dist tmp/t163-id/head/apps/editor/dist` exit 0, over 194 files including `index.html` and `sw.js`.
- `tmp/t163-id/` is left for inspection.

**What I proved about the install in jsdom** (vitest's jsdom environment):

- `window === globalThis` holds.
- `BroadcastChannel` is an own data property.
- `navigator.locks` and `navigator.storage` are absent, and `indexedDB` is absent.
- `localStorage` and `sessionStorage` are own accessors, but Node's own experimental ones shadow jsdom's and return `undefined` without `--localstorage-file`. The test therefore defines its own native stores: Map-backed Storage and fake-indexeddb.

Through the production entry, the install replaced the real global object's properties, and bare identifiers resolved to the facades:

- The fixture's bare `localStorage.setItem` landed natively as `nb1:alice:icm.editor-mode.v1`.
- Its bare `indexedDB.open` landed natively as `nb1:alice:analog-canvas-workspaces`.
- Before commit, `window.sessionStorage` and `indexedDB` threw, and the two `console.error` lines appeared.
- The token was read natively; with a facade read substituted, 7 of 9 entry tests fail.
- After a token change and a `storage` event:
  - The account-changed screen appeared synchronously, with body children reduced to root plus script.
  - The log order was pagehide, unmount, complete pagehide, complete unmount, reload.
  - Both keys were in Alice's prefixed DB, nothing was in Bob's, and reload happened once.
- Terminal failure through the seam (a frozen page, with the store usable, and with it denied at install then usable) gives the Reload screen; `identify` and `loadModules` are never called and the native getter is never called.

**Mutation checks** (`tmp/mutants.sh`, `tmp/mutants-entry.sh`; files restored and verified with `cmp`):

| Mutant                                        | Result                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-checkpoint drain                          | 4 drain tests fail, including "a transaction opened between checkpoint 1 and 2"                                                                                                               |
| `error` counted as terminal for a transaction | the handled-request-error test fails                                                                                                                                                          |
| No activity check                             | 2 tests fail                                                                                                                                                                                  |
| Connection wrapped only on `upgradeneeded`    | the reopen-without-upgrade test fails (refinement 1)                                                                                                                                          |
| No drain in the entry                         | jsdom test fails                                                                                                                                                                              |
| No `flushPage` in the entry                   | 2 jsdom tests fail                                                                                                                                                                            |
| Double-count guard removed                    | survives: `complete` and `abort` are mutually exclusive and `error` is not listened for, so double counting cannot happen; the "error then abort counted once" test still asserts the outcome |

**Import-time storage use:** no module that uses storage reads it at module top level. The only top-level match is the default parameter in `createProjectWorkspaceStore(factory = indexedDB)`, which is evaluated at call time. So loading the editor modules before commit does not hit the locked facades.

**Pinned consumer list**, derived from the notebook output and checked against the inventory. A second assertion keeps the list exact.

- `agent/agent-runtime-loader.ts`, `agent/use-agent-session.ts` (row 8, not reached)
- `app/App.tsx` (rows 10–15), `app/use-agent-hosts.ts` (row 8)
- `components/chunk-load-fallback.tsx` (row 4), `components/stale-build-recovery.ts` (row 17, `caches`)
- `document/browser-recovery-store.ts` (rows 1, 1a), `cloud-project-session.ts` (rows 5–6), `project-workspace.ts` (rows 3, 3a–c), `recovery-coordinator.ts` (row 2), `use-project-file-lifecycle.ts` (rows 4–6), `workspace-reopen.ts` (row 2)
- `entries/notebook.tsx` (row G, token read)
- `features/component-insert/use-component-placement.ts`, `features/editor-shell/editor-mode.ts`, `features/editor-shell/use-editor-panels.ts`, `features/netlist-export/netlist-export-preferences.ts` (rows 10–15)
- `features/user-components/component-publication-journal.ts` (row 7)
- `notebook/browser-storage.ts` (the installer)
- Two false positives of `\bcaches\s*\.`, both module-local arrays named `caches`, not Cache Storage: `node_modules/react-dom/cjs/react-dom-client.production.js` and `packages/derived/dist/document-caches.js`.

The inventory paths for `use-project-file-lifecycle.ts` (it is in `document/`) and `use-component-placement.ts` (in `features/component-insert/`) differ from the plan's table. `workspace-agent.tsx` and `use-project-tab-sessions.ts` are not consumers in the output.

## Deviations and open questions

1. **Install signature.** `installNotebookStorage(page, { onLockedAccess, globalObject?, scheduler? })` returns `{ failure, native, setNamespace, settle }`. The plan's `schedulerForTests?` became the `scheduler` install option. `globalObject` is added so unit tests on fake pages can pass the `globalThis === page` read-back; production uses `globalThis`.
2. **Commit mark** is set after `mountApp` renders, per refinement 4, not right after `installStorage` as step 5 says. Both happen in the same synchronous commit.
3. **Pinned ids from packages** are normalised to `node_modules/<path after the last node_modules/>`, dropping the pnpm version directory. Without this, every dependency bump would break the guard.
4. **Lock objects** passed to `locks.request` callbacks are the native `Lock` (its `name` is prefixed). The plan prescribes only prefixing requests and stripping `query()`; no editor code reads `lock.name`.
5. **Fetch.** The entry now uses `page.fetch` and `page.location` instead of `globalThis.fetch` and `window.location`; in production these are the same objects. On a terminal install failure the entry also skips `configureWebServiceWorker` (it "returns").
6. **Storage-consumers test.** `storage-consumers.test.ts` runs in the shared module registry (node environment).
7. **Not shown here**, as the plan states: the real editor's handlers, navigation, the back/forward cache and native IndexedDB timing. T163b covers these, and T163 must not merge before T163b passes.
