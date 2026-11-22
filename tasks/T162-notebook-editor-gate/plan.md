# T162 — Notebook editor build and startup gate

- Branch: `task/T162-notebook-editor-gate`
- Base: the head of `task/T161-notebook-identity` (stacked on T161, whose `docs/specs/server.md` section this task extends); rebase onto `main` once T161 is merged
- Lane: 2 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`; this task starts no server)
- Status: approved (revision 5; codex gpt-6.2-astra plan review: four rounds, verdict approve)
- Parent plan: the silicon-notebook integration plan (version 7, codex-approved and confirmed by the owner on 2026-11-22; kept outside the repository). Its work package W3 is delivered by two dependent tasks: **this one** (the production code, its unit tests and its build test) and **T162b** (the browser tests, their proxy fixture and the standalone evidence C-4 / C-5). W3 is accepted only when both pass; nothing from this task is deployed before that and before T163.

## Goal

A second build of the web editor, the **notebook build**, for use under silicon-notebook at `/canvas`. It differs from the standard build in four ways and nowhere else:

1. Before any editor module that touches the user's data is loaded, it establishes who the user is from silicon-notebook's session token; without a valid session it shows a sign-in page instead of the editor.
2. Every request it sends to the canvas server API carries that token.
3. When the browser's notebook session changes or ends, the page immediately removes the editor from the screen, stops sending requests, and reloads.
4. The Agent connection is off.

The standard build must not change: not its behaviour, and not its output beyond what an added dead branch compiles away to.

Not in this task: per-user browser storage (T163); the browser tests (T162b); any visible change to the editor's own chrome. The parent plan asked for the notebook display name and a way back to silicon-notebook in an account menu; the header has had no account control since T149, so that is **deferred to an owner decision** and must not be improvised here.

## Context

Server contract (T161, `docs/specs/server.md` "Notebook identity mode"): with `AUTO_CANVAS_AUTH=notebook` the server answers only under `/@notebook/<base>/`; every `/api/*` request except `GET /api/health` and `GET /api/integration/ready.json` needs `Authorization: Bearer <token>` (token: 1–512 characters of `A–Z a–z 0–9 . _ ~ + / = -`); `GET /api/auth/me` returns `{ user: { id, displayName, email: null, provider: "notebook", role, isAdmin } }`; missing or rejected token → 401 `{"error":"unauthorized"}`; notebook unreachable → 503 `{"error":"identity-unavailable"}`; every other API response is `Cache-Control: private, no-store`; `/api/agent/*` → 404. silicon-notebook's Next.js forwards the public path `/canvas…` to `/@notebook/canvas…`, so the browser only ever sees `/canvas…`.

silicon-notebook keeps its session token in `localStorage` under the key `silicon_notebook_token` on the same origin; it removes the key on sign-out and replaces it on sign-in (`silicon-notebook/frontend/app/auth-session.ts`).

Editor facts, verified on `main`:

- `apps/editor/src/main.tsx` is three lines: it imports `mountWebEditor` from `./entries/web` and calls it.
- `entries/web.tsx:12-39`: `mountWebEditor` calls `loadAccountState()` (sends `auth/providers` and `auth/me` at once), creates a `lazy` route that imports `../app/App`, `./web-editor` and `../agent/agent-runtime-loader` in parallel, renders, and registers the service worker (`entries/web-service-worker.ts`).
- `App` is a named export of `app/App.tsx` with props `services` (required) and optional `publicAgentUiEnabled`, `project`, `initialEditorMode` (`App.tsx:467-477`). It creates its own Agent provider, enabled only when `services.capabilities.agent && (publicAgentUiEnabled ?? PUBLIC_AGENT_UI_ENABLED)` (`App.tsx:534-541`). `app/use-agent-hosts.ts:73-89` separately checks `services.capabilities.agent` before reading the Agent recovery record. `App` statically imports `agent/workspace-agent`, which imports `agent/agent-runtime-loader`; the loader's storage read is in a function (`agent-runtime-loader.ts:36-51`), not at import.
- `services/web-editor-services.ts:14` `createWebEditorServices(fetchLike?)` returns the service set with `capabilities: { userComponents: true, agent: true, externalLinks: true }` (`:49-53`). `entries/web-editor.tsx:5` calls it at module evaluation.
- No first-party module in `App`'s import graph reads browser storage at import time; the first reads happen in `App`'s boot effect (`App.tsx:487-529`) and in the render of its children. `apps/editor/index.html:12-18` reads `localStorage.theme` in an inline script before any module.
- Many API call sites use the global `fetch` and cannot take an injected one (`components/shelf-wall.tsx:139,148,163` — the restore at `:163-169` sends `If-Match`; `features/user-components/component-library-client.ts:204,255,437`; `features/user-components/component-catalog-loading.ts:40`; `features/user-components/user-components-library.tsx:200,226`); others take a `fetchLike` that defaults to it. Two module-level `WeakMap` caches are keyed by the fetch function (`features/editor-shell/cloud-projects.ts:170-177`, `components/account.tsx:57`); existing tests rely on a different stubbed global `fetch` being a different key.
- Previews are `<img src>` of API URLs: `components/tile-preview.tsx:60-66` (on `error` the component switches to a placeholder, `:19-37`) and `components/version-history-dialog.tsx:155-159` (inside `versions.map`). An `<img>` cannot carry a header.
- All API URLs are built with `apiUrl()` (`lib/app-url.ts`): `import.meta.env.BASE_URL + "api/…"`. `BASE_URL` is an absolute path ending in `/` (`vite.config.ts:59`).
- The unsaved-work prompt is a `beforeunload` listener that exists only while a component with a dirty document is mounted (`document/use-unsaved-work-guard.ts:39-59`). Unmounting the workspace also makes `document/use-project-tabs.ts:96-115` write a final local journal.
- Build-time switches: `VITE_ICM_AGENT_UI` is only a run-time boolean and keeps no code out of a bundle. The pattern that does is `define` with a literal (`vite.desktop.config.ts:16`) plus an inline conditional at the call site; `scripts/desktop-env-security.test.mjs` builds a real config with `write: false` and inspects the output. Vite here is 8.2.x. `apps/editor/src/vite-env.d.ts` is one line and can augment `ImportMetaEnv`.
- `vite build --outDir <dir>` produces a complete second build without touching `apps/editor/dist`.
- `apps/editor/vite.config.ts` default-exports a config **object**, and `apps/editor/build/rnl-canvas-package.test.ts:11-16` imports it and spreads it into `build({ ...config, … })`. Turning the export into a function would silently drop its plugins in that test. `scripts/build-e2e-editor.mjs` runs a real `build` in development mode through config discovery.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/main.tsx`, `apps/editor/src/vite-env.d.ts`
- new: `apps/editor/src/entries/notebook.tsx`
- new directory `apps/editor/src/notebook/` (session, scoped fetch, gate controller and screens, authorised image component, their unit tests)
- `apps/editor/src/components/tile-preview.tsx`, `apps/editor/src/components/version-history-dialog.tsx` (only to render their image through the new component)
- `apps/editor/vite.config.ts`
- new: `scripts/notebook-editor-build.test.mjs`
- root `package.json` (one script), `.gitignore` (one line)
- `docs/specs/server.md` (a subsection under "Notebook identity mode")
- `tasks/T162-notebook-editor-gate/report.md`

Out of scope (do not change):

- every other file under `apps/editor/src` — in particular `entries/web.tsx`, `entries/web-editor.tsx`, the API clients, `components/shelf-wall.tsx`, everything under `agent/`, `app/`, `document/` and `services/`. If the goal cannot be met without touching one of them, stop and report.
- `apps/server/**`, `packages/**`, `integrations/**`, `playwright.config.ts`, `apps/editor/e2e/**` (T162b), dependencies and `pnpm-lock.yaml`

## Steps

1. **Build switch.** The external switch is the environment variable `VITE_AUTO_CANVAS_AUTH` (the name the parent plan fixed): unset or `local` → standard; `notebook` → notebook build; anything else, including empty → the config throws. `apps/editor/vite.config.ts` keeps exporting a config object (see Context) and gains one small plugin whose `config(_, { command })` hook reads the variable, validates it, and returns `{ define: { "import.meta.env.ICM_NOTEBOOK": notebook ? "true" : "false" } }`. The hook honours the variable **only when `command === "build"`** (the dev server and preview are never notebook builds, whatever the shell exports) and always defines the constant. `scripts/build-e2e-editor.mjs` also issues a build, so the browser-test build becomes a notebook build if the variable is exported there; that is intended to be impossible in practice because nothing but the script of step 8 sets it — say so in the docs. Augment `ImportMetaEnv` in `vite-env.d.ts` with `readonly ICM_NOTEBOOK?: boolean` (it is `undefined` under Vitest and in the dev server's absence of the define — treat `undefined` as `false` everywhere).
   - First-party code reads only `import.meta.env.ICM_NOTEBOOK`, never `VITE_AUTO_CANVAS_AUTH`.
   - **Investigate and prove:** with the constant `false`, the bundler must drop the notebook branch of step 2 and everything only it reaches. Step 9 is the proof. If the form written here does not fold, find the one that does and record it in the report.

2. **Entry.** `main.tsx` becomes:

   ```ts
   import { mountWebEditor } from "./entries/web";
   if (import.meta.env.ICM_NOTEBOOK)
     void import("./entries/notebook").then((entry) => entry.mountNotebookEditor());
   else mountWebEditor();
   ```

3. **Session module** (`notebook/session.ts`), pure, with injected `storage`, `fetch` and base URL:
   - `TOKEN_KEY = "silicon_notebook_token"` — the only place the string appears in the source.
   - `readToken()` returns `{ kind: "token", token }` when the stored value matches `^[A-Za-z0-9._~+/=-]{1,512}$`; `{ kind: "none" }` when the key is absent or the value does not match; `{ kind: "unreadable" }` when reading storage throws.
   - `identify(token)`: `GET <base>api/auth/me` with `Authorization: Bearer <token>`, `cache: "no-store"`, `redirect: "error"`, `credentials: "omit"`. Results: `{ kind: "user", user }` for 200 with `user.provider === "notebook"` and a non-empty string `user.id`; `{ kind: "signed-out" }` for 401; `{ kind: "error" }` for everything else — network failure, a redirect, 5xx, malformed JSON, or a `user` whose provider is not `notebook` (the page is talking to a standalone server: a deployment error, never a reason to fall back to single-user behaviour).

4. **Scoped fetch** (`notebook/scoped-fetch.ts`). `createScopedFetch({ native, token, origin, apiPrefix, onUnauthorized })` returns `{ fetch, revoke() }`. The gate installs `fetch` as `globalThis.fetch` at most once per document, in the synchronous commit of step 6 — after the editor modules are loaded and immediately before the app is mounted — and never restores the native one. (Loading `App` and the services module starts no API request at evaluation, so nothing needs the wrapper earlier.)
   - **This is a deliberate exception** to "pass a transport to each client". Reasons: the shared API clients default to the global `fetch`, a dozen call sites cannot take an injected one, and two caches are keyed by the fetch function with tests that depend on that; editing them would change the standard build's source, and a call site nobody listed would silently lack the header. Replacing the global in the notebook entry leaves every shared file untouched. What keeps the token away from everything else is the scope rule below, and it is tested on the wire in T162b.
   - **Scope rule.** Resolve the request's URL once with `new URL(input instanceof Request ? input.url : String(input), document.baseURI)`. It is an **API request** exactly when its protocol is `http:` or `https:`, its `origin` equals `origin`, and its `pathname` (already normalised by `URL`) starts with `apiPrefix` (`BASE_URL + "api/"`, ending in `/`). `BASE_URL + "apix/…"`, a path that merely contains `/api/` elsewhere, another origin, another scheme are not API requests.
   - **API request:** construct the outgoing request once: `const request = new Request(source, { ...init, redirect: "error", cache: "no-store", credentials: "omit" })`, where `source` is the already-resolved absolute URL when the input was a string or `URL`, and the caller's `Request` object when it was one (keeping its body and signal; a `Request` input plus an overriding `init` keeps the platform's precedence, and method, body, `keepalive`, a streamed body with `duplex: "half"` and caller headers such as `If-Match` survive without the body being read). Then: re-check that `request.url` satisfies the scope rule (reject otherwise); reject when `request.mode` is `no-cors` (a header set on such a request is silently dropped); set `Authorization: Bearer <token>` on `request.headers`, replacing any value; call `native(request)` with no second argument. A redirect is an error because it would carry the header to a path the scope rule never saw. `credentials: "omit"` is right for this API: notebook mode authenticates by the header alone and sets no cookie.
   - **Any other request** is passed to the native fetch with its original arguments, untouched.
   - After `revoke()`, an API request rejects with an `Error` and the native fetch is not called; other requests still pass. Revocation is permanent.
   - A 401 response to an API request calls `onUnauthorized()` (at most once in total) and is still returned to the caller.
   - Known limits, to state in the spec: a Worker has its own global and would not get the header (no first-party worker calls the API); `<img>`, navigation and WebSocket never go through `fetch`; any script running in the page can already read the token from `localStorage`.

5. **Authorised image** (`notebook/api-image.tsx`). A component `ApiImage(props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string })`:
   - it fetches `src` with `fetch` (the scoped one), and has explicit states. Loading → renders nothing. `response.ok` and a blob → an object URL, rendered as `<img {...props} src={objectUrl} />`. A network error or a non-OK response → calls `props.onError` (with a synthetic event object; the existing `TilePreview` only uses it to set its `failed` flag) and renders nothing. Each result is tied to the `src` it was requested for: a completion that arrives after `src` changed or the component unmounted is discarded and its object URL revoked. Every object URL created is revoked when replaced and on unmount.
   - The build-time choice is made **at the two call sites**, not inside the component: each renders `import.meta.env.ICM_NOTEBOOK ? <ApiImage …same props… /> : <img …exactly today's element… />`. In the standard build the conditional folds to today's `<img>` and the import of `ApiImage` becomes unused, so no module under `src/notebook/` is rendered into the standard output (step 9 asserts exactly that; if a static import is not eliminated, use the desktop build's `lazy(() => import(…))` form for the notebook branch and record it). `ApiImage` itself therefore has only the notebook behaviour described above. A component per image also means the list in the history dialog needs no hook in a loop.

6. **Gate controller and entry** (`notebook/gate.ts`, screens in `notebook/`, `entries/notebook.tsx`). Write the controller as a small state machine with injected effects (storage, `identify`, `loadApp`, `mountApp`, `installFetch`, `showScreen`, `reload`, event subscription) so step 10 can test every ordering without a browser. `mountNotebookEditor()` wires the real effects.
   - **Observation starts first.** Before the first token read, subscribe to: `storage` events whose `key` is the token key **or `null`** (`localStorage.clear()`), `focus`, `visibilitychange` to visible, `pageshow` with `persisted === true`. They stay subscribed for the life of the page.
   - **Attempts are numbered.** Each run of the gate (the first, and each Retry) takes the next attempt id; a continuation whose attempt id is no longer current does nothing. An account change, once handled, makes every attempt stale for good.
   - **A run:** show "Loading…"; `readToken()` → `none`: signed-out screen (one sentence that the canvas needs a silicon-notebook session, and a link to `/`). `unreadable`: error screen. Otherwise `identify(token)` → `signed-out`: signed-out screen. `error`: error screen with a Retry button that starts a new run. `user`: continue.
   - **Load, then commit.** The controller has two separate effects: an asynchronous `loadApp()` (the dynamic imports of `../app/App` and `../services/web-editor-services`) and a synchronous `mountApp(modules, token)`. After `identify` returns `user`: `await loadApp()`. If it rejects and the attempt is still current → the error screen with Retry (a stale rejection does nothing). When it resolves: if the attempt is stale, do nothing at all. Otherwise re-read the token; if it is not the one identified, or unreadable, start a new run (nothing has been installed or mounted yet). Otherwise commit **synchronously, without yielding**: create the scoped fetch for this token and install it; build the services as `{ ...createWebEditorServices(), capabilities: { ...capabilities, agent: false } }`; render `<EditorErrorBoundary><App services={services} publicAgentUiEnabled={false} /></EditorErrorBoundary>` (the same boundary the standard entry uses); and record the mounted token, the revoke function and the root together as the mounted state. Do not import `./web-editor` or call `loadAgentRuntimeNeededOnLoad`.
   - Consequence to preserve: a document installs a scoped fetch only for the token whose editor it mounts. A superseded attempt never installs anything, so a later attempt's editor can never send an earlier user's token.
   - A run that ends **before a successful identification** (no token, unreadable storage, `signed-out`, or `error` from `identify`) imports no editor module, creates no services and opens no browser storage other than the token key. Once `loadApp()` has started, its imports cannot be undone; for an attempt that fails or is superseded after that point the guarantee is: it creates no services, installs no fetch and mounts nothing.
   - Register the service worker as the standard entry does (`configureWebServiceWorker`).
   - **Agent inert:** with `capabilities.agent: false` and `publicAgentUiEnabled={false}` both guards named in Context are off. Requirement: the `agent-runtime` chunk is never requested, `icm.agent-session-recovery.v1` is never read, no Agent control is rendered, and `?agent=pair` changes nothing. **Investigate** whether any other read of that key or any request to `api/agent/…` remains reachable with these two settings; if one does and cannot be avoided from the owned paths, stop and report.

7. **Account change.** Whenever an observed event fires, or `onUnauthorized` is called: if the page is in the mounted state, re-read the token; when it is `none`, `unreadable`, or a token different from the mounted one (and always for `onUnauthorized`), do, synchronously and in this order, once:
   1. `revoke()` the scoped fetch;
   2. unmount the React root — this removes the unsaved-work `beforeunload` listener with its component — and then put the **account-changed screen** into the page with plain DOM operations on the root container (a root that has been unmounted cannot render again); it is one sentence with no editor content;
   3. call `location.reload()`.

   The page must be showing the account-changed screen, with no editor DOM and no ability to send an API request, even if the reload is delayed or never completes. Before the mounted state (during a run, including while `loadApp()` is pending), a token change makes the attempt stale and starts a new run; nothing was installed, so nothing needs revoking. There are no timers and no token renewal.

8. **Build script and docs.** Root `package.json`: `"build:notebook-editor": "AUTO_CANVAS_BASE_PATH=/canvas VITE_AUTO_CANVAS_AUTH=notebook pnpm --filter @icm/editor exec vite build --outDir dist-notebook --emptyOutDir"`. `.gitignore`: `apps/editor/dist-notebook/`. `docs/specs/server.md`, subsection "The editor in notebook mode": the build switch; the gate's outcomes; the scoped fetch rule, including that it replaces the page's `fetch` and its known limits; the account-change behaviour; that the Agent is off; that previews are fetched with the header and never from the HTTP cache; that browser storage is not yet per user (T163); that the display name and a way back to silicon-notebook are not shown yet.

9. **Build test** (`scripts/notebook-editor-build.test.mjs`, modelled on `scripts/desktop-env-security.test.mjs`; load the real `apps/editor/vite.config.ts` afresh for each environment value, build with `write: false`, 120 s timeout per build; restore the environment afterwards):
   - standard build, with `VITE_AUTO_CANVAS_AUTH` unset and again with `local`: across **all** emitted chunks and assets, no file contains `silicon_notebook_token`; no rendered module id is under `src/notebook/` or is `src/entries/notebook.tsx`; no emitted file path contains `@notebook`.
   - notebook build, using exactly the environment of the documented script (`AUTO_CANVAS_BASE_PATH=/canvas VITE_AUTO_CANVAS_AUTH=notebook`): some chunk contains `silicon_notebook_token`; no emitted file path contains `@notebook`; and **no executable reference leaves the deployment**: every `<script src>`, `modulepreload` and stylesheet `href` in `index.html`, every static and dynamic import specifier recorded for each emitted chunk (`chunk.imports`, `chunk.dynamicImports`), every import found in emitted **worker JavaScript assets** (Vite returns bundled workers to the main build as assets, so they are not in the chunk lists; the RNL worker's first statement imports a second file), and every `new Worker(…)` / `new URL(…, import.meta.url)` whose target is a **string literal** in chunk code, resolved against the emitting file under `https://deploy.example/canvas/`, has that origin (this also catches protocol-relative URLs) and a path under `/canvas/`. Ordinary hyperlinks and the external RNL viewer's address are data, not executable references, and are outside this assertion.
     - **Computed targets.** The existing editor output already contains `new URL(x, import.meta.url)` with a non-literal operand in exactly two known places: Vite's preload helper (its operands are the dependency lists Vite emits; check those lists — `viteMetadata` / the `__vite__mapDeps` array — the same way as import specifiers), and the `@rich-netlist/runtime` client, which accepts an optional caller-supplied worker location (`apps/editor/node_modules/@rich-netlist/runtime/client.js:109`) while the editor calls it with no argument (`features/netlist-export/rnl-runtime.ts:111`) so the bundled worker is used. Pin both **per occurrence, not per chunk**: record the exact computed expressions each of the two emitters contributes (the RNL client has separate browser and Node worker expressions), match every computed `new Worker(` / `new URL(…, import.meta.url)` occurrence in the output to one of those recorded expressions, and fail on any unmatched occurrence — including a new one inside one of the two recognised chunks; assert that the editor's source still calls the RNL runtime's start function without a worker argument, and assert the bundled RNL worker's own emitted URL is local. **Any other computed executable target fails the test**, so a new one has to be looked at by a person. Investigate the exact shapes in the current output first and record them in the report.
   - with Vite's `resolveConfig` (the validation lives in a plugin hook, which merely importing the config object does not run): `VITE_AUTO_CANVAS_AUTH=""` and `=oidc` reject for command `build`; for command `serve` with `VITE_AUTO_CANVAS_AUTH=notebook`, and for command `build` with the variable unset, the resolved `define["import.meta.env.ICM_NOTEBOOK"]` is the string `"false"`; for command `build` with `notebook` it is `"true"`. The default export of `vite.config.ts` is still a plain object with its `plugins` array.

10. **Unit tests** (Vitest, in `apps/editor/src/notebook/`):
    - `readToken`: absent, valid, 513 characters, containing a space, non-ASCII, storage that throws.
    - `identify`: each outcome in step 3, including `provider: "local"`, a rejected fetch standing in for a refused redirect, and that the request was made with `redirect: "error"` and `credentials: "omit"`.
    - scoped fetch, against a recording fake native fetch: an API URL given as string, as `URL`, as `Request`; a `Request` with a JSON body plus an `init` that overrides the method and adds `If-Match` (both survive, body intact); a `ReadableStream` body with `duplex: "half"`; a body-bearing request with `keepalive: true`; an `AbortSignal` that aborts; an existing `Authorization` replaced on API requests only; `redirect: "error"`, `cache: "no-store"` and `credentials: "omit"` on the request actually passed to the native fetch even when the caller asked otherwise; the native fetch receives exactly one argument, a `Request` whose `url` is in scope; an API request with `mode: "no-cors"` rejects without a native call. Not API, and passed through with the original arguments and no header: same origin outside the prefix, `apix/`, a path containing `/api/` elsewhere, another origin, `blob:` and `data:` URLs. After `revoke()` API requests reject and the native fetch was not called; non-API requests still pass. A 401 calls `onUnauthorized` once across several responses.
    - `ApiImage`: success, non-OK response (calls `onError`, renders nothing, creates no object URL), network error, `src` changing before the first fetch completes (the late result is discarded and its URL revoked), unmount (every created URL revoked).
    - gate controller, with fake effects: no token; unreadable storage; each `identify` outcome; Retry; `loadApp` rejecting → error screen, and Retry works; **Alice's `loadApp` is held, the token becomes Bob's, Bob's run completes and mounts, then Alice's `loadApp` resolves → exactly one mount and exactly one fetch installation, both for Bob; the first API request carries Bob's token; a later change revokes and terminates as in step 7**; the token changes while `loadApp` is pending and the new token is invalid → signed-out screen, nothing installed; **the final re-read on its own:** the stored token changes while Alice's `loadApp` is pending and **no event is delivered**, then her import resolves → she installs nothing and mounts nothing, and the gate identifies the replacement token in a new run before any commit (this fails if the re-read before commit is removed); a run that fails before identification called `loadApp` zero times, and one that fails or is superseded after `loadApp` started created no services, installed no fetch and mounted nothing; after mount, each observed event with an unchanged token does nothing; with a changed, missing or unreadable token it revokes, unmounts, shows the screen and reloads, in that order, exactly once; `storage` with `key === null`; `onUnauthorized`; a second trigger after the first is ignored; a Retry clicked after an account change does nothing.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
unset VITE_AUTO_CANVAS_AUTH
pnpm build                                                                              # expected: exit 0 (the build test below needs the workspace packages built)
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs    # expected: all pass
pnpm test:local                                                                         # expected: all pass; no existing test file changed, including apps/editor/build/rnl-canvas-package.test.ts
pnpm build:notebook-editor                                                              # expected: exit 0
test -f apps/editor/dist-notebook/index.html && grep -c '/canvas/assets/' apps/editor/dist-notebook/index.html   # expected: a number > 0
grep -rl silicon_notebook_token apps/editor/dist | wc -l                                # expected: 0
grep -rl silicon_notebook_token apps/editor/dist-notebook | wc -l                       # expected: at least 1
find apps/editor/dist apps/editor/dist-notebook -path '*@notebook*' | wc -l             # expected: 0
git diff --stat main -- apps/editor/src ':!apps/editor/src/main.tsx' ':!apps/editor/src/vite-env.d.ts' ':!apps/editor/src/entries/notebook.tsx' ':!apps/editor/src/notebook' ':!apps/editor/src/components/tile-preview.tsx' ':!apps/editor/src/components/version-history-dialog.tsx'   # expected: empty
git diff --stat main -- apps/editor/e2e playwright.config.ts apps/server packages         # expected: empty
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check                      # expected: exit 0 (run after the builds, with dist-notebook present)
pnpm test:e2e:local                                                                     # expected: the standard browser suite passes unchanged
```

## Notes for the implementer

- The only visible additions are the three gate screens (signed out, error with Retry, account changed). Use the editor's existing typography and no new assets.
- Do not persist the token, a user id or anything derived from them; the token lives in the scoped fetch's closure and the controller's state.
- Do not show the user's name, a sign-out control or a link back to silicon-notebook in the editor's chrome.
- `pnpm deadcode` already fails on `main` with three unused files and is not part of this task's acceptance; do not add unused exports.
- The browser-level proof of all this (two users, account switch with unsaved work, back/forward cache, offline, HTTP-cache reuse, the wire-level check that only API requests carry the header) is T162b. Write this task's units so that T162b can drive them: in particular keep the three screens identifiable by a stable `data-testid` each (`notebook-signed-out`, `notebook-error`, `notebook-account-changed`).
- If a step cannot be done as written, stop that step and record why in the report.
