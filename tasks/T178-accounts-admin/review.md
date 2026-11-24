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

## Round 2 — accepted

Implementer: Opus subagent, commit `c40d5ee`. All six findings fixed; each
new race test held deterministically and, per the implementer, fails without
its fix (finding 6 was a coverage gap; the code was already correct).

Reviewer rerun on lane 2: vitest 409/409; typecheck 0; lint 0 errors;
format, docs, deadcode 0; build 0; server-mode-check 0; accounts Playwright
3/3. Lock order read: account row before session everywhere; admin mutations
additionally under advisory lock (4310, 3).

Note: the unreleased migration 006 was edited (added `credentials_version`).
Only `auto_canvas_test_2` had applied the earlier 006; the implementer added
the column there by hand. `auto_canvas`, `auto_canvas_test` and
`auto_canvas_test_3` never applied 006.

## Round 3 — changes requested (codex PR review round 2 on `13cab1a`)

No P0/P1. Verified against the code; all three hold. This is the task's last
round under the three-round limit.

1. **P2 — admin mutation vs sign-in deadlock.** `mutate()` locks the acting
   session before the target account; a sign-in in the same browser as the
   target holds the target account and waits for the admin's old session.
   Fix: lock the acting account, then the target `users` and
   `standalone_accounts` rows, and only then the sessions.
2. **P3 — session locks out of hash order.** The password change pins the
   presented session, then `removeSessions` locks the others; admin mutations
   pin the acting session, then retire target sessions. A concurrent sign-in
   sweep of expired rows can lock in a different order. Fix: in each
   transaction, lock every session row it touches (presented/acting plus the
   ones it retires) in one `ORDER BY token_hash FOR UPDATE` statement, then
   check that the presented/acting row is among them and live, then delete
   the retired ones. Generalise `removeSessions` (or add one helper) rather
   than duplicating the locking.
3. **P3 — missing expired header.** `POST /api/auth/password` answers 401
   without `X-Canvas-Session: expired` when the account row is gone
   (`standalone-accounts.ts` ~339). Return the same response as the later
   session check.

Tests: a deterministic test for 1 (held transactions; expect no 500 and a
consistent outcome), for 3, and for 2 where it can be made deterministic;
otherwise state the ordering argument in the report. Update the lock-order
notes in `docs/specs/server.md` if they change.

## Round 3 — accepted

Implementer: Opus subagent, commit `17e3a2b`. One lock order for every
account transaction: advisory lock (admin only) → `users` → accounts → all
touched sessions in one statement ordered by hash → pairings.
`removeSessions(conn, retire, keep?)` locks retired and kept sessions
together. Four new deterministic tests; per the implementer, three fail with
`deadlock detected` (500) and one without the expired header on the previous
code. Accepted deviation: the admin mutation locks the target `users` row
before the acting account row (users → accounts strictly).

Reviewer rerun on lane 2: vitest 413/413; typecheck 0; lint 0 errors;
format, docs, deadcode 0; build 0; server-mode-check 0; accounts Playwright
3/3.

## Reviewer fix after codex PR review round 3 (owner's decision)

Codex round 3 on `ccc0a29`: no P0/P1, two P3. The rounds are used up; the
owner chose to have the reviewer fix both.

1. Session liveness in `removeSessions` uses `clock_timestamp()` instead of
   the transaction's `now()`, so a request that waited for a lock past its
   session's expiry is refused. Test: "session expiry while waiting for
   locks".
2. `POST /api/auth/password` locks the account row by id, checks the kept
   session, and only then compares the verified hash: a deleted account or a
   session ended by a disable, reset, deletion or another session's change
   answers 401 `unauthorized` with `X-Canvas-Session: expired`; a change from
   the same session meanwhile still answers `incorrect-password`. Tests: the
   reset test now expects the expired header; "own password after its
   credential read" (deletion, same-session change).

The three tests that cover a fix fail on `ccc0a29` (checked by swapping the
two source files back). Rerun on lane 2: vitest 416/416; typecheck 0; lint 0
errors; format, docs, deadcode 0; build 0; server-mode-check 0; accounts
Playwright 3/3.
