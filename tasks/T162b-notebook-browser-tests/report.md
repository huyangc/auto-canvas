# T162b report — round 1

(From the implementer subagent's hand-back; saved by the reviewer, because the
harness refuses a subagent's write of a `.md` file.)

`git status --short` (branch `task/T162b-notebook-browser-tests`, nothing committed):

```
 M docs/specs/server.md
 M docs/testing/README.md
 M playwright.config.ts
?? apps/editor/e2e/notebook-auth.spec.ts
?? apps/editor/e2e/notebook-bfcache.spec.ts
?? apps/editor/e2e/notebook-fixtures.ts
?? scripts/notebook-e2e-fixture-check.mjs
?? scripts/notebook-e2e-fixture.mjs
?? scripts/notebook-e2e-selection-check.mjs
```

## Summary

Everything in the plan's Steps is written. The full Acceptance block passes (exit 0). There are **26 notebook tests and all 26 pass**: 24 in project `notebook`, 2 in project `notebook-bfcache`. There are no product findings. No case is skipped, marked `test.fail()`, or left unwritten.

Two changes depart from the plan's literal text, and both are explained under Deviations:

1. Both spec files also set `trace: "off"`.
2. N5a draws three resistors instead of one.

I made no product code change, added no dependency and did not touch the lockfile. All work stays in the plan's owned paths. Only lane 2 was used: I checked that ports 4273 and 4321 were free before every run. Nothing touched 3000, 8000 or 4310. Every Playwright command had `AUTO_CANVAS_API_URL=http://127.0.0.1:4321`, and the unit suite ran with that variable removed. I did not run `web-agent-session.spec.ts`, the standard browser suite, `pnpm test:e2e:local`, `pnpm deadcode` or the base-path browser test. No LLM API was called.

## Steps

| Step                                             | Status            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Fixture `scripts/notebook-e2e-fixture.mjs`     | done              | **Refusals:** checked before anything is allocated (exit 2, one line, never echoes a value). The proxy-port probe comes last. **Cleanup:** one idempotent `cleanup(reason, code)` plus SIGINT/SIGTERM/SIGHUP/uncaught handlers are registered before the first allocation. **Resource lines:** `resource pid=… role=fixture`, `resource schema=…` and `resource pid=… role=server` are printed as each resource is created. **Test hook:** `NOTEBOOK_E2E_FAIL_AT` works at all four stages. **Stub notebook:** implements `/api/me` with an `error` mode. **Server:** `dist/cli.js` with the `server-mode-check.mjs` stripping. **Proxy:** rewrites `/canvas` to `/@notebook/canvas` and pipes WebSockets. **Request log** is never printed. **Control endpoints:** `/__fixture/{seq,log,reset,hold,held,release,notebook}`; held requests have their body buffered and report `complete: true`. `release` forwards the held requests and clears the hold rules. |
| 2 `scripts/notebook-e2e-fixture-check.mjs`       | done              | Covers (a) all four fail-at stages, (b) SIGINT after ready with exit 0, (c) SIGKILL of the server PID with a non-zero exit, and (d) 27 refusals. Each check confirms the schemas are absent from `pg_namespace` and every PID returns ESRCH.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3 `playwright.config.ts`                         | done              | **Notebook branch:** refusals naming the variable, two projects, `workers: 1`, `fullyParallel: false`, and the fixture as web server (SIGTERM, 30 s, `stdout: "pipe"`). **Standard branch:** gains only `"**/notebook-*.spec.ts"` in `testIgnore`. **Base-path branch:** unchanged. The `launchOptions` expression became a shared `const`, with the same value as before. The notebook `webServer` is a separate spread after the existing block, so the standard and prefix `webServer` text is untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4 Helpers `apps/editor/e2e/notebook-fixtures.ts` | done              | All the named helpers exist. **`notebookSuite()`** registers the `workers === 1` `beforeAll` and a `fixture.reset()` `beforeEach`. **Additions:** `recorder.markAtNavigation(page, label)`, which starts a phase at a reload's own navigation request so the new document's `auth/me` falls in the new phase; `recordPageShows`, `recordDialogs`, `nextLoad` and `nextAuthMe`; and `createProjectAs` / `updateProjectAs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5 `scripts/notebook-e2e-selection-check.mjs`     | done              | Four modes: `--standard`, `--prefix`, `--notebook` and `--notebook-report`, plus a manifest of 26 titles. `--standard` passes against the baseline file unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6 Cases N1–N6, N8, N10                           | done, all passing | Per case, see the list at the end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 7 Docs                                           | done              | `docs/testing/README.md`: one paragraph. `docs/specs/server.md`: two added lines only (the links to the two spec files).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Acceptance results

I built first, then ran the plan's block verbatim as `tmp/acceptance.sh` (git-ignored) with lane-2 variables. Overall exit 0.

```text
pnpm install --frozen-lockfile --offline → 0
pnpm build → 0; pnpm build:notebook-editor → 0
--standard → 0; "standard listing: 459 tests equal the baseline"
--prefix → 0; "prefix listing: exactly the base-path case"
--notebook → 0; "notebook: 26 notebook tests"
refusal loop → all 11 exit 1 naming the variable:
  "AUTO_CANVAS_E2E_BASE_PATH and AUTO_CANVAS_E2E_NOTEBOOK cannot both be set"
  "ICM_E2E_BASE_URL must not be set"
  "ICM_E2E_SERVER must not be set"
  "VITE_AUTO_CANVAS_AUTH must not be set"; same for AUTO_CANVAS_AUTH and AUTO_CANVAS_BASE_PATH
  "ICM_E2E_PORT and AUTO_CANVAS_E2E_API_PORT must differ"
  "AUTO_CANVAS_E2E_API_PORT is reserved for the developer's servers"
  "AUTO_CANVAS_API_URL must be an http://127.0.0.1:<port> origin outside 3000, 8000 and 4310" (empty and :4310)
  "AUTO_CANVAS_TEST_DATABASE_URL must name auto_canvas_test or auto_canvas_test_<digits>"
node scripts/notebook-e2e-fixture-check.mjs → 0
  ok fail-at after-schema / after-stub / after-server / before-listen: exit 1, cleaned
  ok ready then SIGINT: exit 0, cleaned
  ok server SIGKILL: exit 1, cleaned
  ok 27 refusals: exit 2, nothing allocated
AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test → 0; "26 passed (37.3s)"
--notebook-report → 0; "notebook-report: 26 notebook tests, every one passed"
schema and pid checks → 0
  schema notebook_e2e_9ccec2635abd4859b7f023cb0f4ea1e1 gone; pids 64412 64414 gone
  notebook_e2e_% schemas before = after (none)
env -u AUTO_CANVAS_API_URL pnpm test:local → 0; 851 files passed, 3 skipped; 8831 tests passed, 117 skipped
pnpm typecheck → 0
pnpm lint → 0; 0 errors, 3702 warnings (pre-existing)
pnpm format:check → 0
pnpm docs:check → 0; "Validated local Markdown links in 75 files"
owned-paths check → 0
  changed: the 9 owned files above, plus the task's own plan.md and baseline from the base commit
server.md diff check → 0
```

The JSON report is kept at `tmp/nb-report.json` and the full log at `tmp/acceptance.log`.

## Investigation results

**Fixture resource lines for one run:**

```
[WebServer] notebook-e2e-fixture resource pid=64412 role=fixture
[WebServer] notebook-e2e-fixture resource schema=notebook_e2e_9ccec2635abd4859b7f023cb0f4ea1e1
[WebServer] notebook-e2e-fixture resource pid=64414 role=server
[WebServer] notebook-e2e-fixture ready http://127.0.0.1:4273/canvas/
[WebServer] notebook-e2e-fixture stopped (signal SIGTERM)
```

**N10c preview counts:** 60 Projects; **8** previews were requested when the Shelf wall opened and **16** after the last tile was scrolled into view. The last tile's URL had not been requested before scrolling; afterwards it was requested with Alice's bearer and its image became `blob:`.

**N8 hit counts and sources.** None of these carried an `authorization` header; the trap count is **0**.

| Request                                  | Hits | Source                                                                    |
| ---------------------------------------- | ---- | ------------------------------------------------------------------------- |
| Bundled `analog-canvas-extensions-*.rnl` | 5    | page                                                                      |
| Same packages in the fixture log         | ≥1   | no Authorization on the wire                                              |
| `viewer-api.json`                        | 1    | page                                                                      |
| Popup navigation to the Viewer           | 1    | `"frameless"`                                                             |
| RNL Worker `rnl_runtime_wasm-*.wasm`     | 1    | `"page"` (Playwright attributes the dedicated worker's fetch to the page) |

**N6c `sessionStorage` record:**
`[{"/",false,navigate}, {"/canvas/editor",false,navigate}, {"/",false,navigate}, {"/canvas/editor",true,navigate}, {"/canvas/editor",false,reload}]`

The facts saved by the restored document at `pageshow` were `{screen:"notebook-account-changed", canvases:0, aliceName:false}`. The case then ended on `notebook-signed-out`, with no request carrying Alice's bearer after the token was removed. The plain-page control showed `/a` persisted true.

**N10f measurements** (measurement only, matching Context 11). Row tops are 1:353, 2:221, 3:89 and each row is 122 px high, at both sizes.

| Viewport | `.version-list` scroll / client | `.version-history-dialog` scroll / client | Version previews requested before scrolling |
| -------- | ------------------------------- | ----------------------------------------- | ------------------------------------------- |
| 1280×200 | 386 / 386                       | 522 / 166                                 | all three, including version 1 at top 353   |
| 1280×420 | 386 / 386                       | 522 / 386                                 | all three                                   |

The IntersectionObserver roots were `[null, null, "cloud-shelf-dialog", "version-list", "version-list", "version-list"]`, so every version-row observer uses `.version-list`, which never scrolls.

**Diagnostics:**

- **N4a:** `requestfailed` for the abandoned POST: **none recorded**. Ownership was established another way: the held POST was buffered complete (bodyBytes > 0, Alice's bearer), `release()` returned `[201]`, Alice's list contains the name and Bob's does not.
- **N4b:** the save returned **201**, carrying Alice's bearer. The synthetic `focus` then reloaded the page, and the next document's `auth/me` returned 200 with Bob's bearer.
- **N5b:** at both the storage event and the attempted reload, the state was `{screen:"notebook-account-changed", canvases:0, aliceName:false, rootChildren:1}`. Both `fetch` calls on the retained document rejected with "The canvas session has ended". No browser request or log entry appeared after the switch.

## Product findings

None. Every prescribed assertion passes against the product.

## Deviations and open questions

1. **`trace: "off"` in both spec files**, next to `serviceWorkers: "block"`.
   - What I observed: with the config's default `trace: "retain-on-failure"`, tracing is always recording, and the fixture log showed every preview fetched a **second time without Authorization, answered 401** (log #91 and #94 in N3).
   - Why it is the trace recorder: these requests are invisible to Playwright's `request` events and never reach the page; with `--trace off` they disappear.
   - Effect: they broke the log side of `expectBearers`. With tracing on, a test-harness request would be indistinguishable from a page request. Screenshots on failure stay on.
2. **N5a draws three resistors, not one.**
   - What I observed: with one resistor (and with a named drawing, or a saved-then-edited Cloud drawing of two resistors), the calibration got **no** `beforeunload` dialog. A synthetic `beforeunload` showed `defaultPrevented === false`, and the page reloaded without asking.
   - Cause: `document/project-content.ts` sets `MEANINGFUL_CONTENT_MIN_OBJECTS = 3`. The editor arms its leave prompt only for a drawing of three or more objects; smaller drawings count as throwaways. This is the product's intended rule, not a notebook defect.
   - With three resistors the calibration raises exactly one dialog, and the switch then reloads with zero dialogs.
   - N5b also places three resistors, so the editor's own guard is armed before the switch.
   - The plan's Context 4 / N5a wording ("places a resistor") should be corrected.
3. **N4c trigger.** The case opens the Shelf picker (`projectTabAction(…, "Open Shelf project in tab")`) rather than the full Shelf wall. Opening the picker already sends `GET /canvas/api/projects`, so the 401 reloads the page before "Browse Cloud Projects…" can be clicked.
4. **Fixture's non-canvas pages carry no `cache-control: no-store`.** Chrome keeps `no-store` pages out of the back/forward cache, and with it the N6c plain-page control was not restored.
5. **Case layout.**
   - N1a/N1b and N2a–N2g are separate tests; N1's positive control runs in both N1 tests, and N2d covers both bodies (`{` and `{"user":{}}`) in one test.
   - The "B opens the editor as Bob" check runs at the end of both N4a and N4b.
   - The N6c plain-page control is its own test, placed first in `notebook-bfcache.spec.ts`.
6. **Log windows.** In multi-tab windows, `expectBearers` takes `log` as a list of allowed bearers or `false`, because the fixture log cannot tell tabs apart. Each page's own browser records are always checked exactly.

## Case status

All passed (26):

- N1a no token key: signed-out page, no API request, no editor module or storage
- N1b a malformed token: signed-out page, no API request, no editor module or storage
- N2a notebook unreachable: error page with Retry, no single-user storage
- N2b notebook answers 5xx: error page with Retry, no single-user storage
- N2c auth/me answers 500: error page with Retry, no single-user storage
- N2d auth/me answers malformed JSON or no user: error page with Retry
- N2e auth/me answers a standalone user: error page with Retry
- N2f Retry after the fault is gone mounts the editor
- N2g a token notebook rejects shows the signed-out page
- N3 an account switch in another tab reloads into the new account without the old previews
- N4a a save issued before the switch stays the old account's
- N4b a save in the pre-event interval carries the mounted account's bearer
- N4c a 401 on a mounted document reloads the page
- N5a unsaved work: the switch reloads without a beforeunload prompt
- N5b the old document is cleared at the storage event and sends nothing
- N6a sign-out then Back shows the signed-out page
- N6b sign-out in another page reloads into the signed-out page
- N6c control: a plain page is restored from the back/forward cache (notebook-bfcache)
- N6c sign-out then Back: the restored editor is cleared at pageshow (notebook-bfcache)
- N8 bundled packages, the RNL Viewer and the RNL Worker carry no bearer
- N10a the entry chunk fails: reload page, then the editor
- N10b the editor modules fail: reload page without Retry, then the editor
- N10c lazy Shelf previews load as they scroll into view
- N10d version history placeholders hold the layout until previews load
- N10e previews that do not decode fall back to placeholders
- N10f measurement: version list observer root and requests before scrolling

Failing as a product finding: none. Not written: none.
