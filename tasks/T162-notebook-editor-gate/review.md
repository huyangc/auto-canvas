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
