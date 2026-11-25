# T176 report — Round 7 (Codex implementation round 1)

## Summary

A late background Save As receipt can no longer rebind a working copy after a newer save, including an identical-content save that keeps the original Cloud revision. A pending background write that times out after an Agent edit now records the timeout hold and releases the tab reservation.

## Steps

| Step                          | Status                 | Notes                                                                                                                                                                                      |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Original feature and baseline | Done in earlier rounds | The branch at dd6a90f includes the feature. The original baseline results are preserved below.                                                                                             |
| Reproduce the latest findings | Done                   | Three focused files initially had 5 failing and 93 passing tests. The failures showed rebinding to the duplicate, a missing timeout hold, and retention of the previous window's sequence. |
| Implement and verify Round 7  | Done                   | Updated the Agent save handler, file lifecycle, tab session restore and their tests.                                                                                                       |

## Review findings addressed

1. Foreground and background saves now advance the same per-working-copy write sequence. Tab switches carry the sequence, replacement advances it, and refresh or reopen drops it. The background handler checks both the sequence and the starting binding before applying a receipt or exception. Regression tests cover a newer background write both while pending and after acknowledgment, and a real foreground save following activation.
2. The background deadline checks whether its operation is still pending and owns the write. A real commit routed to the inactive controller while the write is pending now leaves a failed copy with a revision-scoped timeout hold at the deadline.

## Acceptance results

Lane 2 used ports 4273 and 4321 and database auto_canvas_test_2. Original pre-feature baseline from the saved logs in tmp/t175:

```text
pnpm format:check / typecheck / lint / deadcode / build → 0 each
pnpm test:local → 1 (8939 passed, 1 failed, agent-relay)
pnpm test:e2e:local → 1 (487 passed, 2 skipped, 1 failed, web-agent-session)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local → 0 (3 passed)
```

This round:

```text
pnpm exec vitest run <3 files from Round 7> → 0 (98 passed)
pnpm vitest run <11 files from the original plan> → 0 (207 passed)
pnpm typecheck → 0
pnpm lint → 0 (0 errors)
pnpm format:check → 0
pnpm docs:check → 0
pnpm deadcode → 0
pnpm build → 0
pnpm test:desktop-build → 0
pnpm test:local → 1 (9227 passed, 116 skipped, 1 failed)
  agent-relay.test.ts expected port 4310 and received the lane's configured 4321.
  Recheck with AUTO_CANVAS_API_URL unset → 0 (3 passed).
pnpm test:e2e:local → 0 (500 passed, 2 skipped)
AUTO_CANVAS_E2E_ACCOUNTS=1 pnpm test:e2e:local → 0 (4 passed)
git diff --stat origin/main -- apps/server packages apps/desktop apps/editor/src/hosts pnpm-lock.yaml → 0 (55 files)
git diff --stat 292fc2f -- <same paths> → 0 (empty)
```

An additional Chromium check used the real editor and intercepted Cloud requests. A 4.5 s pan and a 4.5 s tab-close decision each produced zero PUTs during the hold and one PUT after release (1 passed).

## Investigation results

The tests reproduced the binding error with identical Cloud revisions and the deadline error with an outstanding reservation. Both now pass with the stricter write ownership checks.

## Deviations and open questions

The plan's two-tip scope comparison includes upstream desktop removal at origin/main (d7b8eb0). The same comparison against the branch's actual merge base (292fc2f) is empty. The original baseline is from the implementation run before the feature existed. Desktop verification covers the requested build.
