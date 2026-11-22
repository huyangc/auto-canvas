# T162c — Notebook browser tests: service worker, HTTP cache, offline, standalone evidence

- Branch: `task/T162c-notebook-worker-evidence`, cut from `bfcf72ed902c6ea9f1cfcb5eb59989352b0704f3` = the accepted head of `task/T162b-notebook-browser-tests` (the reviewer fills in the SHA at dispatch).
- Lane: 2 (`ICM_E2E_PORT=4273`, `AUTO_CANVAS_E2E_API_PORT=4321`, `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`)
- Status: approved (codex gpt-6.2-astra plan review: five rounds, verdict approve in round 5)
- Depends on: T162b (fixture `scripts/notebook-e2e-fixture.mjs` and its check, helpers `apps/editor/e2e/notebook-fixtures.ts`, `scripts/notebook-e2e-selection-check.mjs`, the notebook selection in `playwright.config.ts`, the baseline `tasks/T162b-notebook-browser-tests/standard-tests.baseline.txt`). W3 is accepted when T162, T162b and this task are accepted. T163b is gated on accepted T162b **and** T162c.
- Parent plan: silicon-notebook integration plan v7, work package W3 (evidence C-1 editor part, C-4, C-5, and the §4.7 deployment instruction).

## Goal

Prove in a real browser what remains of W3: the notebook build's service worker never stores or serves API data and serves the offline shell only up to the gate; previews are never taken from the HTTP cache, even when a single-user canvas left an immutable entry at the same URL; Bob never sees Alice's previews; the Agent stays off in the notebook build. Produce the standalone evidence: C-1 (the standard production build keeps its recovery prompt with the API unreachable; Agent browser cases pass against an Agent-enabled standard production build; the standard output has no notebook token key), C-4 (a notebook build after a standard build leaves the standard output intact and servable), C-5 (base-path proxy check and browser test, standalone). Run the whole standard browser suite (N12). Document the deployment rule for origins that served a single-user canvas.

## Context

Verified on `4e7acc7`. Labels as in T162b: **[observed: <file>]** (output retained under `tmp/t162b/out/` of the planning worktree), **[observed, not retained]**, **[assertion]** (to be made true here).

### Product facts

- Service worker (`apps/editor/public/sw.js`), registered by the notebook entry for scope `/canvas/` (`entries/web-service-worker.ts`): `install` caches the shell; no `skipWaiting`/`clients.claim`, so a page is controlled from its next load; same-origin `<scope>api` requests are never handled (`isSameOriginApi`), so their responses must report `fromServiceWorker() === false`; navigations are network-first with the cached `/canvas/` as fallback; static assets cache-first. `/canvas` (no slash) is outside the scope.
- Static answers (`apps/server/src/static-editor.ts:52-58`): `index.html`, `sw.js`, `manifest.webmanifest` `no-cache`; other assets `public, max-age=31536000, immutable`.
- Previews (`apps/server/src/projects.ts`): the standalone server answers a current preview whose `?v=` equals the revision with `private, max-age=31536000, immutable` (`:256-260`); history previews are `private, no-store` in both modes (`:250-274`). The editor requests `…/preview.svg?v=<rev>&render=formula-label-v5` [observed: r1-experiments-rerun.txt (E2)]; ids are server-generated (`:141`), so a standalone server cannot produce Alice's URL.
- The scoped fetch sends API requests as `new Request(source, { ...init, redirect: "error", cache: "no-store", credentials: "omit" })` with `Authorization: Bearer <token>` (`notebook/scoped-fetch.ts:52-60`); `entries/notebook.tsx` binds the native fetch before installing it.
- Recovery (`apps/editor/e2e/recovery-dialog.spec.ts:54-79`): one resistor stays below the startup banner's threshold, three objects reach it; the banner is `startup-recovery-banner` (offers "Restore", contains the Project name, e.g. "New Circuit"); a fresh navigation with a new query (`/editor?recovery=meaningful`) has no saved window workspace. Helpers `placeResistors`, `expectRecovered` in `editor-fixtures.ts`. The working-copy pointer `icm.working-copy.v1` is in **sessionStorage** (`document/recovery-coordinator.ts:194,281`).
- Agent: `PUBLIC_AGENT_UI_ENABLED` is on in production only with `VITE_ICM_AGENT_UI=enabled` (`agent/public-agent-ui.ts`). The browser-test editor (`scripts/build-e2e-editor.mjs`, `NODE_ENV=development`) is a development build, so the standard suite is not production evidence. The Agent recovery record `icm.agent-session-recovery.v1` is in **sessionStorage** (`agent/agent-runtime-loader.ts:37-42`) and counts as present only when `hasAgentSessionRecovery` (`agent/session-recovery-presence.ts:14-32`) holds: `version === 1`; non-empty strings `sessionId`, `editorSecret`, `projectId`, `projectSessionId`; an array `scopes`; a finite number `expiresAt`. `?agent=pair` is parsed by `agent/headless-pairing.ts:14`. The notebook build emits `agent-runtime-*.js`, `connect-agent-panel-*.js`, `workspace-agent-*.js` (the last is a static import of `App` and loads; the first two must not).
- `web-agent-session.spec.ts:660` ("…a render crash…") sets `window.__ICM_TEST_RENDER_CRASH__`, honoured only under `import.meta.env.DEV` (`app/crash-test-hooks.ts`); excluded from the production run (reviewer-approved).
- **Port 4310 trap.** `web-agent-session.spec.ts:1227-1245` starts a second Vite server **inside the Playwright worker**; its plugins proxy `/api/auth|projects|components|health` and `/api/agent/` to `AUTO_CANVAS_API_URL ?? "http://127.0.0.1:4310"` (`apps/editor/dev/api-server-proxy.ts:10`, `dev/agent-relay.ts:10`), and the standard config sets the variable only for its managed editor server (`playwright.config.ts:105-126`). Every command here that can run that spec therefore sets `AUTO_CANVAS_API_URL` itself: the lane API origin for N12, the owned server's origin for the C-1 `--run` child. The planning author's own C-1 run (round 2, `c1-agent-production.txt`) did **not** set it, so that case's sibling page proxied its start-up API requests — `GET /api/auth/providers` and `GET /api/auth/me` from `loadAccountState` (`entries/web.tsx:12`, `components/account.tsx` ~108-114), and whatever other `/api/auth|projects|components` reads the standard editor makes while loading — to `127.0.0.1:4310`.
- Launcher (`package.json:37` `"start": "bash scripts/start.sh"`): `start.sh` skips the build with `SKIP_BUILD=1` (`:11-13`), exports `EDITOR_ROOT=apps/editor/dist` (`:14`), and `launcher_start_server` spawns `node apps/server/dist/cli.js` (`scripts/lib/launcher.sh:237`) with `PORT`/`HOST`/`DATABASE_URL` defaulting to `4310`/`127.0.0.1`/`postgresql:///auto_canvas` (`:32-34`) and the checkout's `.env` sourced (`:8-31`). After readiness it clears its PID and leaves the server running detached (`start.sh:15-20`); `stop.sh` stops every listener on the port. `scripts/launcher.test.mjs` exercises start and stop in a temporary copy against a fake server (22 passed) [observed, not retained].
- **C-4 narrowing (deliberate).** The parent plan names `SKIP_BUILD=1 pnpm start`. A wrapper cannot own the server the launcher detaches across an interrupt, so C-4 instead spawns, as its own child, exactly what the launcher runs — `node apps/server/dist/cli.js` with `EDITOR_ROOT=apps/editor/dist` — and the launcher's mapping to that command is shown by the citations above plus `pnpm test:local scripts/launcher.test.mjs`.
- Build order: a test that needs build output must not be a `*.test.mjs` (default Vitest collection, `vitest.config.ts:4-8`; `pnpm check` tests before building, `package.json:101`); build-backed checks are plain Node scripts run after `pnpm build` (`scripts/server-mode-check.mjs`). Vite honours an inherited `NODE_ENV=development` (`scripts/notebook-editor-build.test.mjs:54-59` clears it), so production builds here run with `NODE_ENV` unset. Vite also reads `apps/editor/.env*`, so the disposable checkout has no `.env` anywhere.

### Browser behaviour

1. Control and registration: after the first load and `navigator.serviceWorker.ready`, a reload is controlled; `navigator.serviceWorker.getRegistration("/canvas/")` has scope `http://127.0.0.1:<port>/canvas/`, `navigator.serviceWorker.controller.scriptURL` is `…/canvas/sw.js`, and `getRegistration("/canvas")` returns none [observed: x5-x6.txt (X5)]. Cache Storage holds only shell and `/canvas/assets/…` entries, nothing under `/canvas/api` [observed: r1-experiments-rerun.txt (E7)]. Worker-issued requests are reported (`request.serviceWorker()`), 76 in one load; their `authorization` values were not checked [assertion].
2. Any `page.route`/`context.route` disables the HTTP cache for that context [observed: r1-experiments-rerun.txt (E9)].
3. N7 control: an `<img>` load of the current preview URL answered by the fixture with the standalone header puts it in the HTTP cache. In the controlled editor document, the **native fetch** (a reference saved by an init script before any page script; nothing replaced) called with the product's settings except the cache mode — `Authorization: Bearer <alice>`, `credentials: "omit"`, `redirect: "error"`, default cache — returned the seed bytes with zero wire hits for that URL; the same call with `cache: "no-store"` did not return the seed. After a new boundary, the product's Shelf fetched the URL on the wire with Alice's bearer, the response had `fromServiceWorker() === false`, and the shown blob did not contain the seed marker [observed: x5-x6.txt (X5), current preview only; that the shown bytes equal the measured response, for the current and the history preview, is an acceptance assertion of step 3, not yet observed].
4. Offline: `context.setOffline(true)` also cuts the worker's network. `/canvas/editor` → status 200, `fromServiceWorker() === true`, `notebook-error` with a token and `notebook-signed-out` without; no IndexedDB open; `/canvas` → `net::ERR_INTERNET_DISCONNECTED`, no canvas content [observed: x3-sw.txt, r1-experiments-rerun.txt (E7)]. A `/canvas/sw.js` update request once appeared in the log inside the offline window [observed: r1-experiments-rerun.txt (E7)]: assert "no `/canvas/editor` navigation on the wire", not "nothing on the wire".
5. C-1 Agent cases against an Agent-enabled standard production build served by a standalone `cli.js` with its own schema, in external-base mode: of the 15 cases in `agent-connection`, `agent-bus-reuse`, `agent-bus-productivity`, `web-agent-session`, 14 passed; only `web-agent-session.spec.ts:660` failed, at `editor-crash-screen` [observed: c1-agent-production.txt — run **without** `AUTO_CANVAS_API_URL`, see the port 4310 trap; to be repeated as specified here].

## Scope

Owned paths:

- new: `apps/editor/e2e/notebook-worker.spec.ts` (N7, N9), `apps/editor/e2e/notebook-evidence.spec.ts` (N11b, N11c) — selected by T162b's notebook project pattern `**/notebook-*.spec.ts`
- `apps/editor/e2e/notebook-fixtures.ts` (additions), `scripts/notebook-e2e-fixture.mjs`, `scripts/notebook-e2e-fixture-check.mjs` (the sibling server and seed controls), `scripts/notebook-e2e-selection-check.mjs` (manifest additions for the two new files)
- new: `scripts/standalone-build-evidence.mjs`, `scripts/standalone-build-evidence-check.mjs` (build-backed, not a `*.test.mjs`)
- `docs/specs/server.md` ("The editor in notebook mode": the deployment paragraph and test links), `docs/testing/README.md`
- `tasks/T162c-notebook-worker-evidence/report.md`

Out of scope: all product code (`apps/editor/src/**`, `apps/editor/public/**`, `apps/editor/index.html`, `apps/editor/vite.config.ts`, `apps/editor/dev/**`, `apps/server/**`, `packages/**`); `playwright.config.ts`, `vitest.config.ts`; `scripts/base-path-proxy.mjs`, `scripts/start.sh`, `scripts/stop.sh`, `scripts/lib/**`, `package.json`, `pnpm-lock.yaml`; every existing spec; T162b's spec files.

**Product findings** as in T162b: a correct assertion that fails stays failing (no `test.fail()`, no skip, no weakening), is recorded under "Product findings", and the task is not accepted until the reviewer decides.

## Steps

1. **Fixture additions.** (a) **Standalone sibling**: a second `cli.js`, no `AUTO_CANVAS_AUTH`, no base path, `EDITOR_ROOT=apps/editor/dist` (refuse if `apps/editor/dist/index.html` is missing or contains `/canvas/assets/`; test-only override `NOTEBOOK_E2E_STANDARD_ROOT`), its own `notebook_e2e_<uuid>` schema, `HOST=127.0.0.1`, `PORT=$AUTO_CANVAS_E2E_API_PORT` (already refused for 3000/8000/4310 by T162b's validator; refuse here if bound); tracked by the same cleanup, its own `resource` lines, a new `NOTEBOOK_E2E_FAIL_AT=after-sibling` stage. (b) **Seed**: `POST /__fixture/seed {url, body, contentType, cacheControl}` / `POST unseed {url}`; the proxy answers exactly that path+query itself; seeded answers are logged with `seeded: true`. Extend `scripts/notebook-e2e-fixture-check.mjs` (temp editor roots for **both** children): the new stage, the API-port refusal, a seeded answer's body, headers and log flag.

2. **Helpers.** `expectBearers` gains `exempt: { from, to, url }[]` for the seed window only; `recordRequests(context, { origin })` for the sibling origin with the standalone rule "no request carries `authorization`, none goes to the proxy origin". Selection-check manifest: `(notebook, notebook-worker.spec.ts)` and `(notebook, notebook-evidence.spec.ts)` with the N7, N9, N11b, N11c case titles.

3. **N7 — worker, HTTP cache, previews** (`notebook-worker.spec.ts`, file-level `serviceWorkers: "allow"`, **no route in any context of this file**). Phases bounded by `fixture.seq()`:
   - D (discovery): a fresh Alice gets a Project created and updated through `apiAs` (current preview and version 1 exist); in a throwaway context, open her Shelf and Version history and read the exact current and history preview URLs from the log.
   - S (seed): main context, init script saving `window.__nativeFetch = window.fetch.bind(window)` (a reference only); on `/`: `fixture.seed` the **current** preview URL with a distinct SVG containing `SINGLE-USER-SEED`, `image/svg+xml`, `Cache-Control: private, max-age=31536000, immutable` (the standalone server's header); load it with `new Image()` (wait for `load`); `unseed`. Optional, labelled **synthetic**: the same for the history URL (no real server sends an immutable history preview).
   - C (control): `/canvas/editor`, `navigator.serviceWorker.ready`, reload; registration scope `/canvas/` and controller `…/canvas/sw.js`. In this controlled document: `__nativeFetch(url, { headers: { Authorization: "Bearer <alice>" }, credentials: "omit", redirect: "error" })` returns the seed bytes and the log has no entry for that URL in phase C. If on the acceptance machine Chrome does not reuse the entry, keep the rest of N7 and add separate evidence of the product request's cache mode: an init script (this case only) wrapping `window.fetch` before page scripts to record `input.cache` for `Request` inputs whose URL is a preview — the scoped fetch passes its `Request` to that wrapper as its native fetch — and assert `"no-store"`; record which path ran.
   - A (Alice, measured, new boundary right before the Shelf action): open the Shelf wall and Version history; for each measured URL a fresh log entry in phase A with Alice's bearer and status 200, the browser response with `fromServiceWorker() === false`, and the shown image a decoded `blob:` (`complete && naturalWidth > 0`) whose fetched text is the server's SVG, not the seed. Cache Storage: no entry whose path starts with `/canvas/api`. `expectBearers(alice)` for the page and for `service-worker` records in phase A (seed window exempt), Worker asset requests are checked in the window where they are guaranteed to occur: across installation and the controlled reload (bounded by its own `fixture.seq()` marks) at least one `service-worker` request for a static asset must be recorded, **every** `service-worker` request in that window must carry no `Authorization` header, and the corresponding non-API wire records in the fixture log for that window must carry none either. A warm static cache during the narrower Shelf phase is valid, so phase A requires no worker request; any that does occur there is checked the same way.
   - B (Bob): arm `load` and the response observer, switch from a second page; the reloaded document's `auth/me` answers 200 with Bob's bearer; open the Shelf wall and wait for `shelf-empty`; then no `shelf-actions-<aliceId>`, no `blob:` image, no version dialog; no request (page, worker, log) for either Alice URL; Cache Storage still has no `/canvas/api` entry; `expectBearers(bob)`.
   - _Fails if_ previews came from `<img src>` or a default-cache fetch (seed shown, no wire hit), the worker answered or stored an API request, or Bob's page asked for or kept Alice's previews.

4. **N9 — offline navigation** (`notebook-worker.spec.ts`, route-free). Alice signed in in the test's tab; control the page as in N7; `caches.match("/canvas/")` truthy; `seedSingleUserRecovery` in the same tab (IndexedDB record and `sessionStorage["icm.working-copy.v1"]`); storage instrumented. `context.setOffline(true)`, mark. (a) `const r = await page.goto("/canvas/editor")`: `r.ok()`, `r.fromServiceWorker() === true`, registration scope `/canvas/`, controller `…/canvas/sw.js`, `notebook-error`; snapshot the probe (no IDB open, no session-area working-copy read, only the token `getItem`) **before** any helper reopens IndexedDB; then online, `readSingleUserRecovery` equals the seed. (b) The same without a token (remove it while online on `/`, then offline): `fromServiceWorker() === true`, `notebook-signed-out`, its probe snapshot likewise empty. (c) `page.goto("/canvas")` rejects with `net::ERR_INTERNET_DISCONNECTED`; no element with a `notebook-*` test id and no `schematic-canvas`; back online on `/`, `navigator.serviceWorker.getRegistration("/canvas")` resolves to `undefined`. Across the offline window the log has no `/canvas/editor` navigation. `setOffline(false)` in `finally`.

5. **N11 — C-1, editor part** (`notebook-evidence.spec.ts` unless stated).
   - (a) Standard output has no token key: Acceptance greps `apps/editor/dist`; the build test stays.
   - (b) Recovery in the standard build with the API unreachable, against the sibling (`http://127.0.0.1:$AUTO_CANVAS_E2E_API_PORT`): a new context with `storageState` seeding `icm.editor-mode.v1=draw` and `icm.editor-mode-coach.v1=seen` for the sibling origin, the sibling recorder; `/editor`; `placeResistors(page, [360, 470, 580], 330)`; `revision` `3`; `expectRecovered(page, '"revision": 3')`. In the same tab: `page.route("**/api/**", abort)` with a hit counter; `/editor?recovery=meaningful`; `startup-recovery-banner` visible, containing the Project name and a "Restore" button; the route's count ≥ 1.
   - (c) Notebook side of the Agent: in the test's tab on `/`, seed `sessionStorage["icm.agent-session-recovery.v1"]` with a record satisfying `hasAgentSessionRecovery` (Context); storage instrumented; Alice signed in; same tab to `/canvas/editor?agent=pair`; editor mounted (positive controls: the probe shows the token `getItem` and a session-area `getItem("icm.working-copy.v1")`). Assert: no `getItem` of `icm.agent-session-recovery.v1` in either area; no request for `agent-runtime-*.js` or `connect-agent-panel-*.js`; no request under `/canvas/api/agent`; no `open-agent` control.
   - (d) Agent-enabled production run: Acceptance section B, through step 6's script.

6. **`scripts/standalone-build-evidence.mjs`** (C-4 and C-1(d); run only in a disposable checkout).
   - Arguments: `--port <n>`, `--database <url>`, optional `--run "<command>"`.
   - **Refuse before importing server modules or touching the database** (exit 2, naming the reason): a `.env` at the checkout root or any `apps/editor/.env*`; `--port` not 1024–65535 or one of **3000, 8000, 4310**; the port already bound on `127.0.0.1` (bind attempt); the database URL not using the `postgresql:` or `postgres:` scheme (the same check as the T162b fixture: `pg-connection-string` also accepts `socket:` URLs that take the database from a `db` parameter), its database name not `auto_canvas_test` / `auto_canvas_test_<digits>`, or a `dbname` / `db` parameter present; `apps/editor/dist/index.html` or `apps/editor/dist-notebook/index.html` missing (test-only override `STANDALONE_EVIDENCE_EDITOR_ROOT` for the first).
   - One idempotent cleanup and SIGINT/SIGTERM/SIGHUP handlers registered before the first allocation; create `standalone_evidence_<uuid>` (print `resource schema=`).
   - Spawn, as its own child, `node apps/server/dist/cli.js` with the inherited environment minus `AUTO_CANVAS_*`, `EDITOR_ROOT`, `DATABASE_URL`, `PORT`, `HOST`, plus `HOST=127.0.0.1`, `PORT=<n>`, `DATABASE_URL=<url with search_path=<schema>>`, `EDITOR_ROOT=apps/editor/dist` (print `resource pid=`). Ready when it prints `listening on …:<n>` and `GET /api/health` answers `{"ok":true}` within 30 s. An exit of this child at any time → cleanup, exit 1.
   - C-4 check: `GET /` → 200; parse with `jsdom`; collect **every** `<script src>` and every `<link>` whose `rel` contains `stylesheet`, `modulepreload` or `preload` — before any filtering; each must be a root-relative path starting with `/assets/` (no scheme, no `//`, no `/canvas`), and its `GET` must answer 200 with a JavaScript or CSS content type; at least one script and one stylesheet. Print `C-4 ok: <n> references`.
   - `--run`: spawn `sh -c "<command>"` **detached in its own process group** (print `resource run-pgid=`), with `ICM_E2E_BASE_URL=http://127.0.0.1:<n>`, `AUTO_CANVAS_API_URL=http://127.0.0.1:<n>` and `ICM_E2E_ISOLATED=1` (only there); its exit status becomes the script's.
   - Cleanup (every path): SIGTERM the run process group (`process.kill(-pgid)`), SIGKILL after 10 s; SIGTERM the server child, SIGKILL after 10 s; drop the schema; end the pool; print `cleanup ok`. It never signals any process it did not spawn and never runs `stop.sh`.
   - **`scripts/standalone-build-evidence-check.mjs`** (plain Node, run after `pnpm build`; database `AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test"` passed explicitly; a temporary editor root with an `index.html` referencing `/assets/a.js` and `/assets/a.css`). Copies of the script in a temporary root check each refusal (root `.env`, `apps/editor/.env.local`, ports 3000/8000/4310 and a bound port, database `auto_canvas`, a `dbname` parameter, missing `dist`/`dist-notebook`) → exit 2, no schema. With the real script: (i) SIGINT as soon as `resource pid=` is printed (during startup); (ii) SIGINT during `--run "sleep 60 & sleep 60; wait"`; (iii) SIGKILL of the server child during `--run`; (iv) a normal `--run "true"`. After each: the printed server PID and every process of the printed process group are gone (`process.kill(-pgid, 0)` throws `ESRCH`), the printed schema is absent, and the exit status is the expected one.

7. **Docs.** `docs/specs/server.md`, "The editor in notebook mode", a deployment paragraph (parent §4.7), two separate statements: (1) **permanent**: an origin that has ever served a single-user (standalone) canvas, at the root or at `/canvas/`, must not serve the notebook canvas until its users have exported unsaved work and cleared the origin's site data — an old service worker there can serve the old standalone shell offline, which opens the old recovery data before any gate runs; a fresh origin needs nothing; (2) **temporary, retired by T163**: until browser storage is per user, drafts and preferences in one browser are shared by every notebook user who signs in on it. Add the two spec files to the test links. `docs/testing/README.md`: the sibling server on `AUTO_CANVAS_E2E_API_PORT`, the evidence script and its check, and that full-suite runs must export `AUTO_CANVAS_API_URL`.

## Acceptance

### A. In the implementer's worktree (implementer runs; reviewer reruns)

```bash
set -euo pipefail
pnpm install --frozen-lockfile --offline
unset ICM_E2E_BASE_URL ICM_E2E_SERVER VITE_AUTO_CANVAS_AUTH AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH AUTO_CANVAS_E2E_BASE_PATH AUTO_CANVAS_E2E_NOTEBOOK VITE_ICM_AGENT_UI NODE_ENV
export ICM_E2E_ISOLATED=1 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 AUTO_CANVAS_API_URL=http://127.0.0.1:4321
node -e 'const p=new URL(process.env.AUTO_CANVAS_TEST_DATABASE_URL).pathname;if(!/^\/auto_canvas_test(_\d+)?$/.test(p))process.exit(1)'
T=$(mktemp -d)

pnpm build                                                                # before any collection or server start
pnpm build:notebook-editor

pnpm exec playwright test --list --reporter=json > "$T/std.json"
node scripts/notebook-e2e-selection-check.mjs --standard "$T/std.json" --baseline tasks/T162b-notebook-browser-tests/standard-tests.baseline.txt
AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test --list --reporter=json > "$T/nb.json"
node scripts/notebook-e2e-selection-check.mjs --notebook "$T/nb.json"     # exactly the four (project, file) pairs and every named case

node scripts/notebook-e2e-fixture-check.mjs
node scripts/standalone-build-evidence-check.mjs
pnpm test:local scripts/launcher.test.mjs                                   # stop.sh exercised in isolation

psql "$AUTO_CANVAS_TEST_DATABASE_URL" -Atc "select nspname from pg_namespace where nspname like 'notebook_e2e_%' or nspname like 'standalone_evidence_%' order by 1" > "$T/before"
status=0; AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test > "$T/run.txt" 2>&1 || status=$?
cat "$T/run.txt"; test "$status" -eq 0
node scripts/notebook-e2e-selection-check.mjs --notebook-report test-results/e2e-report.json
grep -o 'resource schema=[a-z0-9_]*' "$T/run.txt" | cut -d= -f2 > "$T/s"; test -s "$T/s"
while read -r s; do test -z "$(psql "$AUTO_CANVAS_TEST_DATABASE_URL" -Atc "select 1 from pg_namespace where nspname='$s'")"; done < "$T/s"
grep -o 'resource pid=[0-9]*' "$T/run.txt" | cut -d= -f2 > "$T/p"; test -s "$T/p"
while read -r p; do if kill -0 "$p" 2>/dev/null; then echo "alive $p"; exit 1; fi; done < "$T/p"
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -Atc "select nspname from pg_namespace where nspname like 'notebook_e2e_%' or nspname like 'standalone_evidence_%' order by 1" | diff "$T/before" -

test "$(grep -rl silicon_notebook_token apps/editor/dist | wc -l | tr -d ' ')" = 0     # C-1(a)
pnpm exec vitest run scripts/notebook-editor-build.test.mjs

unset RNL_VIEWER_TEST_URL    # rnl-interchange.spec.ts would use an inherited value as a real network destination
pnpm test:e2e:local          # N12: whole standard suite; AUTO_CANVAS_API_URL=http://127.0.0.1:4321 (exported above) keeps web-agent-session's in-worker Vite off 4310

# The unit suite expects the proxy default; the export above is for Playwright only.
env -u AUTO_CANVAS_API_URL pnpm test:local
pnpm typecheck
pnpm lint
pnpm format:check
pnpm docs:check
{ git diff --name-only bfcf72ed902c6ea9f1cfcb5eb59989352b0704f3; git ls-files --others --exclude-standard; } | sort -u > "$T/changed"
node -e 'const ok=/^(apps\/editor\/e2e\/notebook-(worker|evidence)\.spec\.ts|apps\/editor\/e2e\/notebook-fixtures\.ts|scripts\/notebook-e2e-(fixture|fixture-check|selection-check)\.mjs|scripts\/standalone-build-evidence(-check)?\.mjs|docs\/specs\/server\.md|docs\/testing\/README\.md|tasks\/T162c-notebook-worker-evidence\/.+)$/;const bad=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(l=>l&&!ok.test(l));if(bad.length){console.log(bad.join("\n"));process.exit(1)}' "$T/changed"
```

### B. In a disposable checkout (C-4, C-1(d), C-5)

Handoff. The reviewer, after reviewing the candidate in the implementer's worktree `W`, provisions `D` from it (the implementer never creates worktrees):

```bash
git worktree add --detach "$D" bfcf72ed902c6ea9f1cfcb5eb59989352b0704f3
git -C "$W" diff --binary bfcf72ed902c6ea9f1cfcb5eb59989352b0704f3 > "$T/candidate.patch"; git -C "$D" apply "$T/candidate.patch"
git -C "$W" ls-files -z --others --exclude-standard | (cd "$W" && tar --null -T - -cf -) | (cd "$D" && tar -xf -)
# verify: the same changed and untracked file list, identical contents
diff <(git -C "$W" status --porcelain --untracked-files=all | sort) <(git -C "$D" status --porcelain --untracked-files=all | sort)
git -C "$W" ls-files -z --modified --others --exclude-standard | while IFS= read -r -d '' f; do cmp "$W/$f" "$D/$f"; done
cd "$D"
test "$(pwd -P)" = "$(cd "$D" && pwd -P)" && test "$(pwd -P)" != "$(cd "$W" && pwd -P)"   # the commands below write build output: never in W
pnpm install --frozen-lockfile --offline
test ! -e .env; for f in apps/editor/.env*; do test ! -e "$f"; done
```

The implementer runs the commands below in `D` if its sandbox allows writing there (a worktree subagent may be refused access to other worktrees; then it records that and stops at A). The reviewer always reruns them. The block is self-contained: it sets its own shell options, directory checks and environment, with `D` and `W` given as absolute paths.

```bash
set -euo pipefail
cd -- "$D"
test "$(pwd -P)" = "$(cd -- "$D" && pwd -P)"       # in the disposable checkout
test "$(pwd -P)" != "$(cd -- "$W" && pwd -P)"      # and not in the working checkout: the builds below write apps/editor/dist
unset ICM_E2E_BASE_URL ICM_E2E_SERVER VITE_AUTO_CANVAS_AUTH AUTO_CANVAS_AUTH AUTO_CANVAS_BASE_PATH AUTO_CANVAS_E2E_BASE_PATH AUTO_CANVAS_E2E_NOTEBOOK NODE_ENV RNL_VIEWER_TEST_URL VITE_ICM_AGENT_UI
export ICM_E2E_ISOLATED=1 ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 AUTO_CANVAS_API_URL=http://127.0.0.1:4321
T=$(mktemp -d)
portfree() { node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(Number(process.argv[1]),"127.0.0.1",()=>s.close())' "$1"; }
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -Atc "select nspname from pg_namespace where nspname like 'standalone_evidence_%' or nspname like 'prefix_test_%' order by 1" > "$T/before"
portfree 4273

# C-4: standard build, then notebook build; the standard output is intact and servable.
pnpm build
pnpm build:notebook-editor
node scripts/standalone-build-evidence.mjs --port 4273 --database "$AUTO_CANVAS_TEST_DATABASE_URL"     # "C-4 ok: <n> references", "cleanup ok", exit 0
portfree 4273

# C-1(d): Agent cases against an Agent-enabled standard production build on the owned server.
VITE_ICM_AGENT_UI=enabled pnpm build
pnpm build:notebook-editor
node scripts/standalone-build-evidence.mjs --port 4273 --database "$AUTO_CANVAS_TEST_DATABASE_URL" \
  --run 'pnpm exec playwright test apps/editor/e2e/agent-connection.spec.ts apps/editor/e2e/agent-bus-reuse.spec.ts apps/editor/e2e/agent-bus-productivity.spec.ts apps/editor/e2e/web-agent-session.spec.ts --workers=1 --grep-invert "a render crash"'
# expected: 14 passed, 0 failed, 0 skipped; "cleanup ok"; the run child had AUTO_CANVAS_API_URL set to the owned origin
portfree 4273

# C-5: last, because both commands overwrite apps/editor/dist with a /canvas build.
test "$(pwd -P)" = "$(cd "$D" && pwd -P)"
AUTO_CANVAS_BASE_PATH=/canvas pnpm build
node scripts/base-path-proxy.mjs --check                                         # "Prefix proxy integration passed: …"
AUTO_CANVAS_E2E_BASE_PATH=1 pnpm exec playwright test apps/editor/e2e/base-path.spec.ts --workers=1   # 1 passed
portfree 4273
psql "$AUTO_CANVAS_TEST_DATABASE_URL" -Atc "select nspname from pg_namespace where nspname like 'standalone_evidence_%' or nspname like 'prefix_test_%' order by 1" | diff "$T/before" -
```

The reviewer then removes `D` (`git worktree remove --force "$D"`).

Behavioural checks by the reviewer: N7's control path (seed served to the native default-cache request, or the recorded `no-store` fallback) and measured wire hits; N9's `fromServiceWorker` values; the C-1(d) pass list with the excluded case named.

## Notes for the implementer

- Never use ports 3000, 8000, 4310; never run `pnpm start`, `pnpm stop` or `stop.sh`; keep `AUTO_CANVAS_API_URL` exported for every Playwright command.
- No route in `notebook-worker.spec.ts` (it would disable the HTTP cache); arm observers before triggers; no fixed sleeps as synchronisation; never call `request.frame()` outside `try`.
- Do not assert anything about Bob's restored tabs, drawing or browser storage (T163).
- No LLM API anywhere.

## Decisions taken by the reviewer (2026-11-22, on revision 2; updated for revision 3)

- C-1 (d): the one excluded Agent case, "a render crash" in `apps/editor/e2e/web-agent-session.spec.ts`, is approved as excluded: it depends on a crash hook that exists only in development builds. The report names it.
- C-4 uses a server the evidence script spawns and owns (decision of round 3, replacing the listener-based identification accepted on revision 2); the launcher's mapping is shown by citation and `scripts/launcher.test.mjs`.
- The reviewer always reruns Acceptance section B in a disposable checkout provisioned from the reviewed candidate.
- (Round 3 of the plan review.) `AUTO_CANVAS_API_URL` is exported for Playwright commands
  only; the unit suite runs without it. Every required command stands on its own line under
  `set -e` (a failing command in an `&&` list would not stop the script).
- (Round 3.) The retained X5 output labels a shown image "server" when its text lacks the
  seed marker and covers the current preview only; the assertions of step 3 are stronger
  (the shown image's bytes equal the measured response, for the current and the history
  preview) and are acceptance assertions, not yet observed.
- (Round 3.) During the disposable acceptance, the reviewer also interrupts one real
  Playwright child of `--run` after its browser has launched and verifies that the browser
  it started (identified by its PID, recorded by the script from the process group and its
  descendants) exits too: Playwright starts Chromium in a separate process group, which the
  `sleep` test of the check script does not cover. The script's cleanup therefore ends the
  run child's descendants, not only its process group.
