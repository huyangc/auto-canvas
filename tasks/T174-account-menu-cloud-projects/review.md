# T174 review

## Round 1 — accepted

Reviewed `git diff origin/main` on `task/T174-account-menu-cloud-projects` at
`5e59b1c`. Opus reran the acceptance commands. Every changed path is in the
owned paths, and plan.md was not edited.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | note | `styles/editor-chrome.css` | The popover min-width is 22rem instead of the planned ~16rem. The root font is 13px, so 16rem cut names short. | Accepted. |

Acceptance rerun (lane 1):

```text
pnpm typecheck && pnpm lint && pnpm format:check → 0
pnpm test:local apps/editor/src/accounts apps/editor/src/features/editor-shell apps/editor/src/app/App.test.tsx → 0 (210 passed)
pnpm deadcode → 0
pnpm test:e2e project-tabs editor-modes cloud-projects-server chrome-isolation → 0 (96 passed)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e standalone-accounts → 0 (3 passed)
```

## Round 2 — accepted (codex PR review round 1 findings, fixed by Opus)

| # | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | P2 | `header-account-menu.tsx`, `file-command-menu.tsx` | The keydown boundary matched `.inline-confirm`, the idle Delete trigger's wrapper. Escape and Left from that button never reached the menu. File had the same gap before this task. | The boundary now matches `.inline-confirm-decision` (an open confirmation only). A new unit test fails on the old selector and passes on the new one. |
| 2 | P3 | `docs/specs/server.md:16` | Still pointed accounts mode to File → Open Cloud Project…. | Now points to the account menu's My Cloud Projects. |

Acceptance rerun after the fix: static → 0; unit → 211 passed; e2e (four specs) → 96 passed; accounts e2e → 3 passed.
