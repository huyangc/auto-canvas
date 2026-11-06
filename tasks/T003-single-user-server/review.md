# T003 review

## Round 1 — accepted

Reviewed: `git diff HEAD` on `task/T003-single-user-server` after Codex round
1; acceptance rerun by Opus; live check against `auto_canvas`.

All changes are inside the owned paths. `pnpm-lock.yaml` differs from the plan
commit only by the five permitted `workspace:*` links for `apps/server`
(checked by a parsed YAML comparison); the textual churn is Prettier restoring
the repository's quoting after Opus's setup commit wrote pnpm's native style.

Code read: `apps/server/src/projects.ts` (create under a per-user row lock,
update with `SELECT … FOR UPDATE`, idempotent no-op before the revision check,
snapshot + compare-and-swap + prune to 3 in one transaction, parameterized SQL
only), `migrations/001-single-user.sql`, `app.ts` same-origin guard,
`static-editor.ts` traversal guard.

| #   | Severity | Where                                                                                | Finding                                                                                              | Expected fix                                                       |
| --- | -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | note     | `apps/editor/src/features/editor-shell/cloud-projects.ts` `CLOUD_PROJECT_LIMIT = 20` | Shelf counts, replacement dialog and limit messages still say 20; the server allows 200.             | Client task: read the limit from the server or raise the constant. |
| 2   | note     | `apps/server/src/projects.ts`                                                        | Preview rendering runs inside the row-locked transaction. Fine for one user; revisit for multi-user. | None now.                                                          |

Acceptance rerun:

```text
pnpm check                         → 1, only the 3 known simulation-artifact-files failures (8780 passed)
pnpm exec vitest run apps/server   → 0, 16 passed
pnpm --filter @icm/server build    → 0
pnpm build                         → 0
playwright cloud-projects-server + editor-shell "every web path" → 2 passed
```

Live check (`node apps/server/dist/cli.js`, database `auto_canvas`): health
ok; `/api/auth/me` returns the local user; POST a fixture project → rev 1; PUT
with `If-Match: revision-1` → 200; restart; list shows rev 2; preview 200
`image/svg+xml` 11.9 kB; history lists `:1`; cross-origin POST → 403;
cleanup DELETE → 200.
