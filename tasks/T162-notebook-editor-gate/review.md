# T162 review

## Round 1 — accepted

Reviewed: the working tree on `task/T162-notebook-editor-gate` (stacked on
`task/T161-notebook-identity`) on 2026-11-22; acceptance rerun by the reviewer
in the implementer's worktree. Implementation by a Claude Opus subagent (the
owner's standing instruction since 2026-11-16); the plan had four rounds of
codex `gpt-6.2-astra` review before implementation.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | should-fix | `apps/editor/src/notebook/gate.ts` (commit step) | If `mountApp` throws after `installFetch`, the page keeps a token-carrying fetch that no state records: an account change would not revoke it, and Retry would call `installFetch` a second time, which throws. | Fixed by the reviewer: a throwing mount revokes the fetch at once, ends the gate and shows the error screen without Retry. New test "revokes the fetch and stops for good when mounting throws". |
| 2 | note | plan, Acceptance | The two `git diff --stat main -- …` commands compare against the local `main` ref, which on this machine is behind `origin/main`. Against `HEAD` (the plan commit on top of T161) both are empty. | Later plans compare against `origin/main` or the task's base. |
| 3 | note | `apps/editor/e2e/project-file.spec.ts` | `pnpm test:e2e:local` stops while collecting tests: that spec imports `cloud-projects.ts`, whose chain reaches `components/site-resource-links.ts:10`, which calls `appUrl()` at module evaluation, where Playwright's Node transform has no `import.meta.env`. None of those files is changed by this task (the out-of-scope diff is empty), so the failure is on `main` as well. | Not this task. The reviewer confirmed the collection error on this branch with `playwright test --list project-file`; the implementer ran the other 53 spec files: 449 passed, 2 skipped. A separate fix is needed before T162b can rely on the full suite. |
| 4 | note | `tile-preview.tsx`, `version-history-dialog.tsx` | The plan's first form (a static import folded away) left `api-image.tsx`'s interop requires in the standard output; the implementer used the plan's fallback, `lazy(() => import(…))` behind the constant, and showed the standard output is file-for-file identical to the base. In the notebook build a preview whose chunk fails to load shows nothing. | Accepted. |
| 5 | note | step 10 | The implementer could not run the mutation check for the re-read before commit. | Done by the reviewer: with the re-read removed, "re-reads before the commit even when no event is delivered" fails; restored. |

Read in full: `notebook/scoped-fetch.ts`, `notebook/gate.ts`,
`entries/notebook.tsx`, and the diffs of `main.tsx`, `vite.config.ts`,
`vite-env.d.ts`, `tile-preview.tsx`, `version-history-dialog.tsx`.

Acceptance rerun (finding 1 fixed before the last three lines):

```text
pnpm build → 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; 6 files, 52 tests
pnpm test:local → 0; 849 files passed, 3 skipped; 8810 tests passed, 117 skipped
pnpm build:notebook-editor → 0; index.html has 8 /canvas/assets/ references
silicon_notebook_token: 0 files in apps/editor/dist, 1 in apps/editor/dist-notebook
no path containing @notebook in either output
git diff --stat HEAD -- apps/editor/src (outside the owned files) → empty
git diff --stat HEAD -- apps/editor/e2e playwright.config.ts apps/server packages → empty
pnpm typecheck → 0; pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0
```

Not rerun by the reviewer: the 53-file Playwright run (17.5 minutes).

Open for the work package (W3), not for this task: the browser-level proof is
T162b; the display name and a way back to silicon-notebook await the owner's
decision.

## Round 2 — changes-requested

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 114 at `b494f79`
(three P2, two P3; no blocking finding), each checked against the code by the
reviewer and found valid. All five are worth fixing before the browser tests
(T162b) are written against this code.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 6 | should-fix | `apps/editor/src/main.tsx` | If the notebook entry chunk fails to load (network interruption, stale deployment), the dynamic import rejects before any gate screen can be rendered and the page stays blank. | Catch the rejection in `main.tsx` and show a minimal message with a Reload button, built with plain DOM in the root container; it must not import any editor or notebook module (the import that would provide one has just failed) and must not appear in the standard build's output — keep it inside the `ICM_NOTEBOOK` branch and confirm the standard output is still file-for-file identical to the base (the build test's "no notebook module" assertions must keep passing; say how you checked identity). |
| 7 | should-fix | `apps/editor/src/notebook/api-image.tsx` | The component fetches on mount. The shelf mounts every tile, so opening a full shelf starts up to 200 authenticated, uncached preview requests at once; with `<img loading="lazy">` in the standard build the browser defers them. `loading="lazy"` on the blob-backed image defers nothing. | When `loading="lazy"` is passed, defer the fetch until the element is near the viewport: render a placeholder element in the image's place and start the fetch from an `IntersectionObserver` (a root margin of the order of one viewport height); fetch at once when `loading` is not `lazy` or `IntersectionObserver` is unavailable. Disconnect the observer on unmount and when the fetch starts. Unit tests with a fake observer: no fetch before intersection, one fetch after, none after unmount, immediate fetch for eager images. |
| 8 | should-fix | `scripts/notebook-editor-build.test.mjs` (worker check) | A worker constructor's argument is accepted when it merely starts with `new URL(`, while the URL check only examines constructors whose base is `import.meta.url`. A worker whose URL is resolved against something else (`document.baseURI`, a string) could point outside `/canvas/` and pass both. | For every `new Worker(…)` / `new SharedWorker(…)` in the output, inspect the first argument itself: accept only a `new URL(<literal>, import.meta.url)` whose literal resolves inside the deployment, or one of the recorded computed exceptions matched occurrence by occurrence; anything else fails. Add a negative self-check in the test file: run the same checker over a small synthetic chunk containing `new Worker(new URL("https://evil.example/w.js", document.baseURI))` and `new Worker("https://evil.example/w.js")` and assert it reports both. |
| 9 | should-fix | `apps/editor/src/components/version-history-dialog.tsx`, `notebook/api-image.tsx` | While a notebook preview is loading, or when it failed, nothing is rendered in the row's first grid cell, so the name and metadata slide into the preview column. | The notebook branch always renders one element in that cell: the placeholder from finding 7 while loading or after a failure, the image after success, with the same class hooks the `<img>` gets today so the existing CSS sizes it. The standard branch stays today's `<img>`. Do not add or change CSS files. If the layout cannot be kept stable without CSS, stop and report. |
| 10 | should-fix | `apps/editor/src/notebook/screens.ts` | The error screen renders an enabled Retry button even when no retry callback is supplied (the case added in round 1: mounting threw after the fetch was installed); clicking it does nothing. | Without a callback, render no Retry button and a sentence asking the user to reload the page (a Reload button calling `location.reload()` is fine). Test both variants. |

Keep everything else as it is; the plan's scope and "Out of scope" list are
unchanged. Rerun the plan's Acceptance section, with the two diff commands
taken against `HEAD~1` (the round-1 commit's parent is the plan commit; use
`git diff --stat $(git merge-base HEAD origin/task/T161-notebook-identity)`),
and without `pnpm test:e2e:local` (finding 3); instead run the Playwright spec
files that exercise the shelf and the version history and say which.

## Round 3 — accepted

Reviewed: the working tree after the round-2 fixes (findings 6–10), on
2026-11-22. Implementation by a Claude Opus subagent; acceptance rerun and
every changed file read by the reviewer.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 6 | fixed | `apps/editor/src/main.tsx` | Entry chunk load failure left a blank page. | A rejection handler inside the `ICM_NOTEBOOK` branch draws a plain-DOM `notebook-error` screen with Reload; it imports nothing. Test `notebook/main-entry.test.ts`. |
| 7 | fixed | `notebook/api-image.tsx` | Every tile fetched its preview on mount. | With `loading="lazy"` the fetch waits for an `IntersectionObserver` (root margin `100% 0px`) on the placeholder; disconnected when the fetch starts, on unmount and on a `src` change. Six fake-observer tests. |
| 8 | fixed | `scripts/notebook-editor-build.test.mjs` | A Worker argument was accepted on its prefix. | `codeTargetProblems()`: the first argument must be exactly one accepted `new URL(…, import.meta.url)` (followed by `,` or `)`); a self-check over a synthetic chunk reports both bad Workers. |
| 9 | fixed | `version-history-dialog.tsx`, `notebook/api-image.tsx` | An empty preview cell shifted the row. | A source-less `<img alt="" aria-hidden="true">` holds the cell while loading, after a failure, in the `Suspense` fallback and when the chunk fails. No CSS changed. Test `notebook/version-history-preview.test.tsx`. |
| 10 | fixed | `notebook/screens.ts` | A dead Retry button. | Without a retry callback: a reload sentence and a Reload button. Both variants tested. |
| 11 | note | `notebook/api-image.tsx` | The placeholder is not shown by a browser test; the implementer checked the CSS size of a source-less `<img>` in headless Chrome by hand. | T162b covers the shelf and the version list in the notebook build. |

Acceptance rerun by the reviewer:

```text
pnpm build → 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; 8 files, 62 tests
pnpm test:local → 0; 851 files passed, 3 skipped; 8821 tests passed, 117 skipped
pnpm build:notebook-editor → 0; index.html has 8 /canvas/assets/ references
silicon_notebook_token: 0 files in apps/editor/dist, 1 in apps/editor/dist-notebook
no path containing @notebook in either output
working-tree changes outside the owned files (apps/editor/src, e2e, playwright.config.ts, apps/server, packages) → none
pnpm typecheck → 0; pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0
```

Not rerun by the reviewer: the implementer's identity proof of the standard
output (`diff -rq` of a base build and this build, 194 files each, no
difference) and its three Playwright spec files (23 passed). The build test's
"no notebook module in the standard output" assertions, which the reviewer
did rerun, cover the same property from the other side.

## Round 4 — accepted (fixes by the reviewer)

Reviewed: codex `gpt-6.2-sol` PR review round 2 of PR 114 at `a2751d4`
(one P2, two P3; no blocking finding), each checked against the code and
found valid. Each fix is a few lines, so the reviewer made them instead of
opening a third implementation round.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 12 | fixed | `apps/editor/src/notebook/gate.ts` | When the editor modules fail to load, Retry imports the same URLs in the same document, which may keep the failed load; Retry can then fail for good after the network is back. | A failed module load shows the error screen without Retry (the reload variant from finding 10). Retry stays for identification failures. Test "asks for a reload, without Retry, when the editor modules fail to load". |
| 13 | fixed | `apps/editor/src/notebook/api-image.tsx` | A 200 answer the browser cannot decode left a broken image and never called `onError`, so a Shelf tile kept no fallback. | The shown image's `error` event returns to the placeholder and calls `onError`. Test with an empty 200 body and a dispatched `error`. |
| 14 | fixed | `scripts/notebook-editor-build.test.mjs` | The HTML check read only double-quoted attributes. | `htmlReferences()` reads the page with an HTML parser (jsdom, already a dev dependency): every script source and every `stylesheet` / `modulepreload` / `preload` link, any quoting and case; a `<base>` fails. A self-check covers single-quoted, unquoted and upper-case references. |
| 15 | note | codex finding 1, second half | Recovery after a failed module load is not shown against the built entry. | T162b (browser tests). |

Acceptance rerun by the reviewer:

```text
pnpm build → 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; 8 files, 64 tests
pnpm test:local → 0; 851 files passed, 3 skipped; 8823 tests passed, 117 skipped
pnpm build:notebook-editor → 0; index.html has 8 /canvas/assets/ references
silicon_notebook_token: 0 files in apps/editor/dist, 1 in apps/editor/dist-notebook
no path containing @notebook in either output
working-tree changes outside the owned files → none
pnpm typecheck → 0; pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0
```

The branch then takes the two new commits of its base
(`task/T161-notebook-identity`, server only) by a merge.
