# T163 review

## Round 1 — accepted

Reviewed: the working tree on `task/T163-notebook-user-storage` (stacked on
`task/T162-notebook-editor-gate` at `4e7acc7`) on 2026-11-22. The plan had
three rounds of codex `gpt-6.2-astra` review (verdict approve). Implementation
by a Claude Opus subagent. Read in full by the reviewer:
`notebook/browser-storage.ts`, the diff of `notebook/gate.ts`,
`entries/notebook.tsx`, and the spec text; acceptance rerun by the reviewer.

| #   | Severity | Where                  | Finding                                                                                                                                                                                                                                                                                    | Expected fix                                                                                                                                            |
| --- | -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | note     | report, Deviations 1–6 | The install takes `globalObject` and `scheduler` options; the commit mark is set after mount (refinement 4); pinned package ids drop the pnpm version directory; a lock handed to a callback is the native `Lock` with its prefixed name; the entry uses `page.fetch` and `page.location`. | Accepted: each stays inside the plan's design. No editor code reads `lock.name`.                                                                        |
| 2   | note     | plan, merge condition  | The real editor's page-hide handlers, navigation, the back/forward cache and native IndexedDB timing are not shown by this task's tests.                                                                                                                                                   | T163b (the browser cases of `browser-contract.md`). **This task is not merged into `main`, nor into anything merged ahead of it, before T163b passes.** |
| 3   | note     | Firefox, Safari        | The replacement of the storage globals and the body concealment are shown in Chrome only.                                                                                                                                                                                                  | Stated in the plan; a browser that refuses the replacement gets the error page (unit-tested with a refusing page).                                      |

Acceptance rerun by the reviewer:

```text
pnpm build → 0
pnpm exec vitest run apps/editor/src/notebook scripts/notebook-editor-build.test.mjs → 0; 11 files, 144 tests
pnpm test:local → 0; 854 files passed, 3 skipped; 8910 tests passed, 117 skipped
pnpm build:notebook-editor → 0
silicon_notebook_token and the `nb1:` prefix: in 0 files of apps/editor/dist; the prefix in 1 file of apps/editor/dist-notebook
changed paths (tracked and untracked) → the nine owned files and the task directory, nothing else
pnpm typecheck → 0; pnpm lint → 0; pnpm format:check → 0; pnpm docs:check → 0
```

Not rerun by the reviewer: the implementer's comparison of two full standard
builds from exports (`diff -rq`, 194 files, no difference), its three standard
Playwright spec files (29 passed) and its mutation checks. No shared file is
changed (the path list above), and the build test's "no notebook module in the
standard output" assertions passed in the rerun.

Smoke check by the reviewer in a real browser (Chrome through Playwright; the
notebook build of this tree behind a stub notebook, the server in notebook
mode and a rewriting proxy on a throwaway port and schema; not a substitute
for T163b):

```text
Alice signs in: native localStorage holds silicon_notebook_token and nb1:alice:icm.netlist-export.v1;
  native sessionStorage nb1:alice:icm.working-copy.v1, nb1:alice:icm.workspace-window.v1;
  native databases nb1:alice:analog-canvas-recovery, nb1:alice:analog-canvas-workspaces;
  through the page's own globals the token is not visible and the databases have their plain names
token changed to Bob from another page: the editor reloads as Bob; Bob's databases and keys appear
  beside Alice's (her workspace journal was written under her prefix at the switch);
  Bob's globals show none of Alice's names
no "browser storage used before sign-in" line, no page error, no console error
12 checks, 0 failed
```

## Round 2 — accepted (corrections by the reviewer)

Reviewed: codex `gpt-6.2-sol` PR review round 1 of PR 116 at `b719e48` (two
P2, one P3; no blocking finding), each checked and found valid.

| #   | Severity | Where                                    | Finding                                                                                                                                                                                                                                        | Expected fix                                                                                                                                                                                                                 |
| --- | -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | fixed    | `browser-contract.md`, R6                | On a foreground restore from the back/forward cache Chromium can dispatch `visibilitychange` before `pageshow`; the gate rechecks at whichever comes first, so "still concealed in an early `pageshow` listener" would fail a correct product. | The contract now asserts concealment at the first read of the token key after the persisted `pagehide`, and the variant's document state after it (planner's correction in the contract).                                    |
| 5   | fixed    | `entries/notebook.tsx`, the commit mark  | `createRoot().render()` schedules the render; the mark does not show a mounted editor.                                                                                                                                                         | The mark keeps its place and its meaning is stated: namespace fixed, render scheduled. The plan's refinement 4 and the contract say that a case needing the mounted editor waits for the editor itself. No behaviour change. |
| 6   | fixed    | `scripts/notebook-editor-build.test.mjs` | A build that does not write returns no copied `sw.js`, and the fallback source reached only the worker-storage check, not the forbidden-names check.                                                                                           | The fallback source is included in `forbiddenNameProblems`.                                                                                                                                                                  |

Rerun by the reviewer: notebook unit and build tests 11 files, 144 tests;
typecheck, lint, format, docs 0.

## Round 3 — rebase on the base holding T162b/T162c; contract corrections (by the reviewer)

Rebased onto `main` `c5f1678` (one conflict, the test-link sentence of
`docs/specs/server.md`: both sides kept). After the rebase the reviewer ran the
31 notebook browser cases of `main` against this build: **13 passed, 18
failed**, none a product defect — each relies on the shared storage this task
replaces (the unprefixed Draw-mode seed of `playwright.config.ts`: N3, N4a,
N4b, N5a, N5b, N6a, N6b, N6c; a case's own `indexedDB.databases()` before
sign-in: N2a–N2f, N9; the probe's area test and the bare working-copy key:
N1a, N1b, N11c). They are T163b's work, and T163 does not merge before they
pass.

Reviewed: codex `gpt-6.2-sol` PR review round 4 of PR 116 at `220a590` (one
P1, two P2, one P3), each checked and found valid.

| #   | Severity | Where                        | Finding                                                                                                                                                                                             | Fix                                                                                                                                                                                                                                      |
| --- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | P1 fixed | `browser-contract.md`, scope | The follow-up covered `notebook-auth.spec.ts` only; `notebook-bfcache.spec.ts` (test records in `sessionStorage` after a signed-out reload) and `notebook-evidence.spec.ts` (bare-key seeds) break. | The contract owns every notebook spec, the helpers and the selection manifest, with the rules of the adaptation (native storage for test-owned records, prefixed user-owned seeds, raw inspection through the handle, nothing weakened). |
| 8   | P2 fixed | `browser-contract.md`, R3    | The calibration reload ran before edit 1, when no `beforeunload` listener is installed.                                                                                                             | Edit 1 and its writes first, then the calibration.                                                                                                                                                                                       |
| 9   | P2 fixed | `browser-contract.md`        | The command lacked `AUTO_CANVAS_API_URL`, which the configuration requires.                                                                                                                         | The whole notebook run with the lane's API origin; the standard-suite line no longer names `pnpm test:e2e:local`.                                                                                                                        |
| 10  | P3 fixed | `docs/specs/server.md`       | The deployment paragraph still said storage is shared until T163.                                                                                                                                   | The temporary rule is removed; the permanent export-and-clear rule stays.                                                                                                                                                                |

Rerun by the reviewer on the rebased tree: `pnpm build`,
`pnpm build:notebook-editor` 0; notebook unit and build tests 144 passed; the
unit suite 8853 passed; typecheck, lint, format, docs, deadcode 0; no changed
path outside the owned list.
