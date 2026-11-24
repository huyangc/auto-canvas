# T165 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T165-notebook-entry-link` (uncommitted
work of the Opus implementer on `16d60c7`); acceptance rerun by Opus
(`tmp/t165-review.sh`, logs in `tmp/t165-review/r1/`).

| #   | Severity                         | Where                                       | Finding                                                                                                                                                                                                                                                                                                                                                                                         | Expected fix                                                                                                               |
| --- | -------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix (fixed by the reviewer) | `scripts/package-notebook-canvas-check.mjs` | Its Python stand-in for `app.extension_sdk` lacks `Availability` and `app.extension_sdk.ui`, so the packaged plugin (0.2.0) no longer imports there (reported by the implementer).                                                                                                                                                                                                              | The stand-in gains the same two names as the launcher test's; the check passes 21 of 21. Done in this round (a few lines). |
| 2   | note                             | `stage-l.mjs`                               | Deviations 1–7 of the report (same-origin `NEXT_PUBLIC_API_BASE_URL`, notebook data outside `.local`, the first-visit hint, the stricter browser guard with a recording proxy for branded Chrome's own connections, a profile per browser, screenshots only on failure, one 1,639-line shared module) are accepted: each follows from silicon-notebook's behaviour or makes the stage stricter. | —                                                                                                                          |
| 3   | note                             | T167                                        | `NEXT_PUBLIC_API_BASE_URL` is baked at build time; silicon-notebook's `pack.sh` defaults it to `/api`, so stage P must keep that default.                                                                                                                                                                                                                                                       | Carry into T167's plan.                                                                                                    |

Acceptance rerun:

```text
pnpm build                                        → 0
pnpm build:notebook-editor                        → 0
vitest run notebook-launcher + package-notebook-canvas tests → 0 (56 passed)
pnpm typecheck / lint / format:check / docs:check / deadcode → 0
node scripts/package-notebook-canvas.mjs --python <miniconda> → 0 (the tarball holds integrations/silicon-notebook/ui/auto-canvas/)
node scripts/package-notebook-canvas-check.mjs    → 0 (21 of 21)
--stage S                                         → 0 (89 passed)
--stage M                                         → 0 (114 passed)
--stage L                                         → 0 (85 passed)
leftover auto_canvas_it_* databases               → 0
notebook checkout git status before/after         → identical
pnpm test:local                                   → 0 (862 files passed, 3 skipped; 9135 tests)
```
