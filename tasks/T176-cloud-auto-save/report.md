# T176 report — Round 8 (Codex implementation round 2)

## Summary

A rolled-back Agent batch preserves the auto-save and recovery state of a restored Cloud working copy. The active editor still shows the controller's current revisions. A successful batch marks the Project as Agent-edited and reports one commit when the outermost step finishes.

## Steps

| Step                         | Status                 | Notes                                                                                                                                                                                                       |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original plan                | Done in earlier rounds | The implementation was already present at e3789ac. The original pre-feature baseline is recorded below.                                                                                                     |
| Reproduce the latest finding | Done                   | Focused tests reproduced callbacks during the batch, an inactive copy becoming armed, an active copy becoming armed through its change-token observer, and the foreground host losing the rollback outcome. |
| Implement and verify Round 8 | Done                   | Updated the browser Agent host, routing, and file lifecycle, with regression tests at each boundary.                                                                                                        |

## Review findings addressed

1. `BrowserAgentHost` defers the Agent mark and commit notification until the outermost batch succeeds. The rollback notification carries the outcome through both browser host paths. An inactive tab keeps its file session and recovery snapshot. An active tab refreshes its React snapshot without staging or flushing recovery, and the file lifecycle records the revised token without arming when Project content is unchanged.

## Acceptance results

Lane 2 used editor port 4273, API port 4321, and database `auto_canvas_test_2`. The original pre-feature baseline on af05b80 is preserved in `tmp/t175`.

```text
pnpm format:check / typecheck / lint / deadcode / build → 0 each
pnpm test:local → 1 (8939 passed, 116 skipped, 1 agent-relay failure)
pnpm test:e2e:local → 1 (487 passed, 2 skipped, 1 web-agent-session failure)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local → 0 (3 passed)
```

The pre-edit rerun used e3789ac with the existing review appendix present.

```text
pnpm format:check / typecheck / lint / deadcode / build → 0 each
pnpm test:local → 1 in the sandbox (61 failed, 8876 passed, 308 skipped)
pnpm test:e2e:local → 1 in the sandbox (PostgreSQL connection EPERM)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local → 1 in the sandbox (same EPERM)
```

### After the fix

```text
pnpm exec vitest run <5 files from Round 8> → 0 (176 passed)
pnpm vitest run <11 files from the plan> → 0 (208 passed)
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm deadcode && pnpm build → 0
pnpm test:desktop-build → 1 (command removed upstream, ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL)
pnpm test:local → 1 (9132 passed, 115 skipped, 1 agent-relay failure)
  agent-relay expected port 4310 and received the lane's configured 4321.
env -u AUTO_CANVAS_API_URL pnpm test:local → 0 (9133 passed, 115 skipped)
pnpm test:e2e:local → 130 (single-worker run interrupted to use four workers)
pnpm test:e2e:local --workers=4 → 0 (499 passed, 2 skipped, 6.6 min)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local → 0 (4 passed)
git diff --stat origin/main -- apps/server packages apps/desktop apps/editor/src/hosts pnpm-lock.yaml → 0 (empty)
git diff --check → 0
```

The browser suites verified the Cloud save chip, the account menu toggle and reload behavior, wire and dialog deferral, silent automatic writes, and the absence of automatic writes for unbound copies. The held pointer and tab-close decision checks were verified in Round 7.

## Investigation results

The rollback changes the controller's revisions while preserving the Project's content. Previously both the Agent commit callback and the active tab's change-token observer could arm a restored copy. The regression tests demonstrated each failure before its fix.

## Deviations and open questions

The latest review assigns task Round 8 to Codex implementation round 2. The pre-edit sandbox restricted local PostgreSQL and loopback access, so the final database and browser runs used approved local access. Upstream removed the desktop build command in d7b8eb0. The current branch contains that removal.
