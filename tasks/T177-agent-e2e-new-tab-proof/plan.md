# T177 — Agent e2e: a new tab opened by a reload keeps the pairing on its own copy

- Branch: `task/T177-agent-e2e-new-tab-proof`
- Base: `main` at `9e66529`
- Status: approved (owner confirmed the test-only fix, 2026-11-24)
- Plan review: self-checked against the code (codex plan review not requested)

## Goal

`apps/editor/e2e/web-agent-session.spec.ts` › "keeps one paired working copy
through Cell switches, a render crash, refresh without resuming a pause" fails
3/3 on `main` (7a21def and 9e66529): its last `attached()` poll reads
`editor: "detached"`. The product behaves as the spec requires since T171; the
test's final expectation is out of date. Update the test so it checks the
current contract: a reload to `/editor?new=1` keeps the pairing and creates no
session. The new tab does not adopt the paired tab's proof. Showing the paired
tab again reconnects to the same relay session.

## Context

- Bisect between 5c8b43f (the spec's last change) and 7a21def on lane 3:
  40a1adf (T171 review record) passes. 85d3a52, f14a66c and 001fed7 (T171
  review rounds 1–2 and "the Agent proof belongs to a working copy, not a
  mount nonce") fail. Those commits made `readAgentSessionRecovery` match the
  proof's `projectId`/`projectSessionId` to the target working copy
  (`apps/editor/src/agent/session-recovery.ts:80-87,152-160`). T171 round 7
  (300b2f8) added per-working-copy proofs. T171's acceptance ran only
  Vitest, so this e2e was never rerun.
- `docs/specs/web-agent-session.md:105-111` (written by T171): refresh,
  Project switches and Gallery return keep the pairing. A stored proof names
  its working copy. "Another tab's proof is never adopted."
- `/editor?new=1` now restores the window's workspace and opens a new circuit
  beside it (`apps/editor/src/app/App.tsx:500-508`). After the
  `page.goto("/editor?new=1")` at spec line ~738, the window has the paired tab
  A (one resistor, unsaved) and a new active tab C (0 instances). The single
  stored proof names A's working copy, so C does not reconnect and the relay
  reports `detached` (`apps/server/src/agent-relay/agent-session-do.ts:266-270`
  counts open editor sockets).
- Probe on 7a21def, lane 3: after the reload, sessionStorage
  `icm.agent-session-recovery.v1` holds A's proof and the relay status is
  `detached`. Clicking the first project tab shows A (instance count 1), and
  the status becomes `attached` within 3 s with `sessionCreates` still 1.
- The neighbouring test "keeps pairing across Project tabs…" (spec line 746)
  covers a live session following tab switches. It is unaffected.

## Scope

Owned paths:

- `apps/editor/e2e/web-agent-session.spec.ts` (only the test named above)

Out of scope:

- Product code under `apps/editor/src/` and `apps/server/src/`, and the spec
  document. The per-working-copy proof is T171's reviewed contract.

## Steps

1. Replace the final segment of the test, after
   `await page.goto("/editor?new=1")` and the `active-instance-count` "0"
   check:
   - Assert the relay reports `editor: "detached"` with
     `expect.poll(...).toBe("detached")`. The new copy does not adopt A's
     proof.
   - Select A's project tab. It is the tab before the selected one in the
     "Open projects" tablist, named "New Circuit" with the unsaved marker.
     Select it by role or position, without a timeout.
   - Expect `active-instance-count` "1", then `await attached()`.
   - Keep `expect(sessionCreates).toBe(1)` at the end.
   - Add a one-line comment saying why: the proof belongs to its working copy
     (spec `web-agent-session.md`).
2. Optionally rename the test title's last clause so it describes the new tab.
   Leave it if the rename makes the title unwieldy.

## Acceptance

Run from the repository root in lane 3:

```bash
export ICM_E2E_PORT=4373 AUTO_CANVAS_E2E_API_PORT=4331 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_3 ICM_E2E_ISOLATED=1
pnpm exec playwright test apps/editor/e2e/web-agent-session.spec.ts -g "keeps one paired working copy" --repeat-each=5   # expected: 5 passed
pnpm exec playwright test apps/editor/e2e/web-agent-session.spec.ts   # expected: all passed
pnpm format:check   # expected: pass
pnpm lint           # expected: 0 errors
```

Behavioral checks:

- The test still fails if the reload creates a second session, or if showing
  A does not reattach.

## Notes for the implementer

The change is test-only. Do not touch Agent recovery code. If the tab selector
is fragile, read the tablist markup in the snapshot under `test-results/` and
pick a stable locator.
