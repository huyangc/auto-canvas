# T004 review

## Round 1 — accepted

Reviewed: working tree on `task/T004-component-library-server` after Codex
round 1; acceptance rerun by Opus; migration checked on the dev database.

All changes are inside the owned paths. Editor, desktop and Worker diffs are
import-path changes plus the removal of code that moved into
`packages/component-library`; the root `package.json` gains only the
`@icm/component-library` workspace link. Omitted Worker assertions all need a
second account or anonymous caller, which the single-user server cannot
express; the report lists each.

Code read: `apps/server/src/components.ts`, `component-library.ts`,
`component-catalog.ts`, `component-management.ts`, `component-sql.ts`,
`migrations/002-component-library.sql`. Writes run in one transaction under
a library advisory lock; values are bound parameters; the interpolated SQL
fragments are internal constants (`>`/`<`, fixed ORDER BY).

| #   | Severity | Where                              | Finding                                                                                                                                                  | Expected fix                                                                    |
| --- | -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | note     | `apps/server/src/component-sql.ts` | Rewrites every `?` to `$n`, so a future statement with a literal `?` (string or the JSON `?` operator) would be corrupted. No current statement has one. | Port remaining statements to `$n` placeholders when the module is next touched. |
| 2   | note     | multi-user                         | Ownership, anonymous-read and moderator rules are ported but only exercised as the admin local user.                                                     | Revisit with real accounts.                                                     |

Acceptance rerun:

```text
pnpm check → 1, only the 3 known simulation-artifact-files failures (8806 passed)
pnpm exec vitest run apps/server packages/component-library → 0, 43 passed
pnpm build → 0;  pnpm test:desktop-build → 0
playwright user-components-server + user-components + cloud-projects-server → 66 passed
git grep old contract paths (outside tasks/) → no matches
```

Dev database `auto_canvas` (already at 001 with T003 data): server start
applied `002-component-library.sql`; `GET /api/components?catalog=1` →
`{"entries":[],"catalogRevision":0,...}`; `GET /api/projects` → 200.
