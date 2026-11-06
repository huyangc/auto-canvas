# T002 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T002-remove-upstream-infra` after Codex
round 1; acceptance rerun by Opus.

All changes are inside the owned paths. Every retained file in the report has a
named consumer. The one blocker was the plan's own scope list: it kept
`scripts/format.mjs` read-only while deleting `references/`, so its
`references/**/*.json` pattern stopped `pnpm check`. Opus fixed that directly
(two lines) instead of a second round.

| #   | Severity | Where                                                                            | Finding                                                                           | Resolution                                                                            |
| --- | -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | must-fix | `scripts/format.mjs:10`, `scripts/format.test.mjs:28`                            | Glob for the deleted `references/` fails `format:check`.                          | Fixed by Opus: pattern removed, test fixture no longer creates `references/one.json`. |
| 2   | note     | `apps/editor/src/gallery-*.ts`, `usage-policy-note.ts`, `apps/editor/analytics/` | Still imported by `worker/`, `dev/local-replica.ts`, request-failure code.        | T003 (Worker replacement).                                                            |
| 3   | note     | `fixtures/gallery-redline/`                                                      | Kept: edit-engine, project-protocol and MCP tests read it as a regression corpus. | Keep; it is test data, not Gallery tooling.                                           |
| 4   | note     | editor chrome, desktop docs                                                      | TokenZhang attribution, GitHub links, stale desktop workflow links.               | Rebrand task.                                                                         |

Acceptance rerun:

```text
pnpm check            → 1, only at test:local: 8764 passed, 3 failed
                        (simulation-artifact-files.test.ts, baseline, T004);
                        format, docs (86 files), agent docs (0 stale),
                        components, typecheck, lint (0 errors) pass
pnpm mcp:package      → 0 (includes pnpm build)
pnpm headless:package → 0
pnpm test:desktop-build → 0
playwright editor-shell "every web path" (dev server) → 1 passed
```
