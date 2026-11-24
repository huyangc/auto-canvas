# T178 review

## Round 1 — accepted

Reviewer: Opus (main session). Implementer: Opus subagent, commit `f008200`.

Acceptance rerun by the reviewer on lane 2
(`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`):

| Command | Result |
| --- | --- |
| `pnpm exec vitest run apps/server packages/component-library` | 23 files, 405/405 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | 0 errors |
| `pnpm format:check`, `pnpm docs:check` | exit 0 |
| `pnpm deadcode` | no findings |
| `pnpm build && node scripts/server-mode-check.mjs` | build 0; all checks ok |
| `AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm exec playwright test apps/editor/e2e/standalone-accounts.spec.ts --workers=1` | 3/3 passed (implementer's pre-change baseline: 3/3) |

Diff read against the plan: changed paths are the owned paths; plan.md
unchanged; no dependency change. Lock order checked against register, login,
Project create and update; the login and password-change rechecks hold the
verified hash. Deviations accepted (all tighten the plan).

Reviewer fix (plan amendment): `apps/server/src/migration-guard.test.ts:619`
pins the shipped migration count; 5 → 6. The plan wrongly said the file only
reads the list from disk. One line, added to the owned paths here.

## Round 2 — changes requested (codex PR review round 1 on `22f1d57`)

Codex (`gpt-6.2-sol`) reported no P0/P1. The reviewer checked each finding
against the code; all hold and are cheap, so fix them before merge.

1. **P2 — password change keeps a revoked session.**
   `standalone-accounts.ts` `POST /api/auth/password`: inside the
   transaction, after locking the account row, lock the presented session
   (`standalone_sessions WHERE token_hash=$presented AND user_id=$user AND
   expires_at>now() FOR UPDATE`). If it is gone, roll back and answer 401
   `unauthorized` with `X-Canvas-Session: expired`. Test: hold the request
   before its transaction, sign out that session, release → 401, hash
   unchanged, other sessions intact.
2. **P2 — admin mutation proceeds with a revoked session.**
   `account-administration.ts` `mutate()`: after the advisory lock, lock the
   acting account row (`FOR SHARE`) first, then check and lock the presented
   session (`FOR SHARE`) in a separate statement, so the session row is read
   after the account lock (account → session order). Test: hold the admin
   mutation after its first snapshot while the same administrator's password
   change from another session commits → 403, target unchanged.
3. **P3 — pending sign-in survives disable then re-enable.** Add
   `credentials_version integer NOT NULL DEFAULT 0` to migration 006 (not
   released; update its digest). Disable, reset, delete and own password
   change increment it. Login reads it with the hash and requires it unchanged
   in its `FOR SHARE` recheck; the password change does the same. Test:
   verified login held, disable + re-enable committed, release → 401.
4. **P3 — NUL in parameters gives 500.** Reject `\u0000` in `q`, `cursor`
   and every `:id` under `/api/admin` with 400 `invalid-fields` (ids: 404
   `not-found` is also fine; pick one, document it). Test each.
5. **P3 — locale-dependent `lower()`.** Lower the search term in JavaScript
   with the same ASCII rule registration uses; query with `strpos(a.username,
   $1)`. No database `lower()` on usernames remains in the new code.
6. **P3 — restore not exercised in the deletion race test.** Add a restore
   case: pause after the version read, commit the deletion, release → 404 and
   no row.

Update `docs/specs/server.md` where the contract changes (items 1, 3, 4).
