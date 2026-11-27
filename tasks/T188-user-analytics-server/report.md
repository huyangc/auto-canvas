# T188 report — round 1

## Summary

Implemented PostgreSQL activity counters, migration 007, and six read-only administrator analytics endpoints in accounts and notebook modes. All six new PostgreSQL test cases passed. One existing CLI migration assertion prevents full acceptance because its expected ledger ends at 006.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Added automatic layout and four export actions to the protocol allowlist. |
| 2 | done | Added migration 007 and its SHA-256 pin. The upgrade fixture verifies known dates, unknown dates, role backfill and the new default. |
| 3 | done | Recorded authenticated events by UTC day. A single PostgreSQL statement increments the counter and advances last activity atomically. The local-mode query contract and JSONL tests pass. |
| 4 | done | Implemented overview, trends, features, retention, user list and user detail with mode-specific membership, admin authorization and parameter validation. |
| 5 | done | Added real PostgreSQL tests covering both modes, private response fields, access control, concurrency, persistence failure, migration, deleted accounts and UTC boundaries under a non-UTC database timezone. |
| 6 | done | Documented routes, authorization, UTC windows, query parameters and privacy in the server specification. |

## Review findings addressed

Round 1 had no prior review.

## Acceptance results

Database checks used lane 1 with `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm exec vitest run apps/server packages/project-protocol packages/component-library → exit 1
  645 passed, 1 failed across 73 files.
  apps/server/src/server-main.test.ts:183 expects the --migrate ledger to contain 001–006.
  Actual ledger also contains 007-user-analytics.sql.
  user-analytics.test.ts and all five server suites named in the behavioral checks passed.

pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check → exit 0
  oxlint: 2145 files, 0 errors, 4003 warnings
  All matched files use Prettier code style!
  Validated local Markdown links in 73 files

pnpm deadcode → exit 0
  Both Knip passes completed with no findings.

pnpm build && node scripts/server-mode-check.mjs → exit 0
  All seven server-mode checks passed, including restart persistence and notebook isolation.
```

## Investigation results

The CLI's migration ledger contains the required new row. The failing assertion independently enumerates all migrations in a file outside the approved paths. Appending `007-user-analytics.sql` to its expected array would preserve the exact-ledger check.

## Deviations and open questions

- Approval to extend the path scope to the single assertion in `apps/server/src/server-main.test.ts` is pending.
- Save totals count successful project creates and saves. Netlist and export activity totals include both outcomes. Active and dormant user filters use the same UTC daily activity records as DAU.
- Validation reused the existing dependency tree from the base checkout. No package installation or lockfile update was needed.
