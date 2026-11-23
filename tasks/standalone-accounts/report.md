# Standalone accounts implementation report

## Summary

The standalone web editor now requires a registered account by default. Users can save a drawing to PostgreSQL and reopen it through the Shelf from another browser. Each user retains a separate recovery workspace in each browser. Explicit local mode continues to serve the historical local profile and its original Projects.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| Store identities and sessions | Done | Migration 004 adds accounts and expiring sessions. Registration normalizes the username, hashes the password and issues the first session in the same transaction as account creation. |
| Gate the web editor | Done | The user can register, sign in and sign out. Cross-tab account changes unmount the editor, and the API checks requests against the account bound to the tab. |
| Preserve and isolate work | Done | Server-side Project ownership applies to saves, reads, previews and history. Local workspace data, browser recovery copies, project pointers and publication journals use the account and deployment as their storage namespace. |
| Document and test the flow | Done | The quick starts, server configuration and API specification describe standalone accounts, the legacy local profile and notebook mode. |

## Review findings addressed

Initial implementation. No prior review was supplied.

## Acceptance results

Tests used an isolated PostgreSQL instance, the worktree build and separate browser contexts.

| Command | Result |
| --- | --- |
| `pnpm test:local` | Passed, 8,867 tests with 117 skipped by the suite. The final additional HTTPS and prefix case also passed in the focused rerun below. |
| `pnpm exec vitest run apps/server/src/app.test.ts apps/server/src/standalone-mode.test.ts` | Passed, 23 tests including username validation, session invalidation, old ownership, stale-tab writes and private previews. |
| `AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm exec playwright test --workers=1` | Passed. Saved a resistor schematic in one browser, reopened it from a fresh browser, restored an unsaved edit on the original browser, and checked isolation and sign-out in a sibling tab. |
| `node scripts/server-mode-check.mjs` | Passed. Checked the default account gate, explicit local identity, notebook mode, restart and mount boundaries. |
| `pnpm build`, `pnpm typecheck`, `pnpm lint` | Passed. Lint reports warnings. |
| `pnpm format:check`, `pnpm docs:check`, `pnpm agent-docs:generated:check`, `pnpm components:check` | Passed. |
| `pnpm deadcode` | Exit 1. The original main checkout produces identical output for 20 unused exports and three unused types in the model, netlist and SPICE packages. |

## Investigation results

An explicit Save creates or updates the signed-in user's PostgreSQL Project. Browser recovery preserves unsaved work locally. The same account on another device can open its saved version using File → Open Shelf project in tab on the same deployment.

## Deviations and open questions

Implementation follows the user's direct worktree request. The letter in a username is case-insensitive. Password length is 8–128 characters. Sessions expire after 30 days or on sign-out. Existing local Projects stay with the local profile.
