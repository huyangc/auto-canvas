# T178 report — round 1 (Opus implementer subagent)

Commit `f008200` on `task/T178-accounts-admin`.

## Changes by step

1. Migration `006-account-administration.sql`: `role`, `disabled`,
   `must_change_password`, `created_at` (default set in a second statement, so
   existing rows stay NULL). Digest pinned in `standalone-mode.test.ts`.
2. `session()` joins `standalone_accounts`, excludes disabled accounts and
   reads `role`/`isAdmin`/`mustChangePassword` from the row. `/api/admin` is
   account-bound.
3. Login rechecks, inside the session transaction, that the account exists,
   is enabled and still has the verified hash (`FOR SHARE`); otherwise the same
   401 as a wrong password. A disabled account answers that 401 too.
4. While `must_change_password` is set, authenticated routes other than
   `POST /api/auth/password` and `POST /api/auth/logout` answer 403
   `password-change-required` (`GET /api/session` and `GET /api/auth/me` are
   registered before authentication).
5. `POST /api/auth/password` with sign-in's limits (shared counters); 401
   `incorrect-password` without `X-Canvas-Session: expired`; ends the user's
   other sessions and pairings.
6. `account-administration.ts`: `removeSessions` generalised (token or user
   selector, same locking); `/api/admin/users` list, PATCH, reset-password,
   DELETE; every mutation under advisory lock (4310, 3), acting administrator
   re-read after the lock.
7. Self-mutation is 409 `own-account`.
8. `--grant-admin <username>` in `server-main.ts`, all refusals before a pool.
9. A Project create for a deleted user answers 401.
10. `docs/specs/server.md` "Administrators and passwords"; README
    "Administrators".

## Lock order (implementer's analysis, checked in review)

Advisory lock → `users` row → `standalone_accounts` row → sessions (by hash)
→ pairings. Login never locks `users`; Project create locks only its own
`users` row; admin mutations are serialised by the advisory lock. The mutual
demotion test passes five rounds without deadlock.

## Deviations

- Any self PATCH (even a no-op) is 409 `own-account`.
- Delete confirmation compares usernames case-insensitively.
- `q`/`cursor` over 100 characters are 400 `invalid-fields`.
- The acting re-read also requires a live presented session and no forced
  change.

## Not done by the implementer

`migration-guard.test.ts:619` pins the migration count at 5; outside the
owned paths, so left failing (2 tests). Fixed in review.

## Known limits

- Vite dev proxy does not forward `/api/admin` (editor scope, T179).
- Under a forced change, unknown authenticated `/api/*` paths answer 403
  instead of 404.
- Attempt throttling is per process, as for sign-in.
