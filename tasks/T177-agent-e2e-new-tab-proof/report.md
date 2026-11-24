# T177 report — round 1

Opus made this few-line test change itself, under run-task's small-fix rule.

## Changes

- `apps/editor/e2e/web-agent-session.spec.ts` › "keeps one paired working copy
  through Cell switches, a render crash, refresh without resuming a pause":
  after `page.goto("/editor?new=1")` the test expects the relay to report
  `editor: "detached"`, because the new tab does not adopt the paired copy's
  proof. It then selects the paired tab, sees its one instance and expects
  `attached` with `sessionCreates` still 1.

## Investigation

- Bisect over 5c8b43f..7a21def: 40a1adf passes; T171 commits 85d3a52, f14a66c
  and 001fed7 fail. Those commits made the reconnect proof belong to one
  working copy (`apps/editor/src/agent/session-recovery.ts`). This matches
  `docs/specs/web-agent-session.md:105-111`. T171's acceptance ran only Vitest.
- T175's test-speed change does not cause this failure.

## Deviations

None from the plan's steps. The other tests in the file need
`AUTO_CANVAS_API_URL` set to the lane's API (as `docs/testing/README.md:54`
says). Without it, "copies a working handoff through the normal local dev
relay" starts its in-process Vite sibling against the developer server on
4310, which is in accounts mode, and times out on Sign in. With it exported,
the whole file passes.

## Acceptance (lane 3: ICM_E2E_PORT=4373, AUTO_CANVAS_E2E_API_PORT=4331, auto_canvas_test_3, AUTO_CANVAS_API_URL=http://127.0.0.1:4331)

| Command                                                                                                                  | Exit | Result                 |
| ------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------- |
| `pnpm exec playwright test apps/editor/e2e/web-agent-session.spec.ts -g "keeps one paired working copy" --repeat-each=5` | 0    | 5 passed               |
| `pnpm exec playwright test apps/editor/e2e/web-agent-session.spec.ts`                                                    | 0    | 11 passed              |
| `pnpm format:check`                                                                                                      | 0    | All matched files pass |
| `pnpm lint`                                                                                                              | 0    | 0 errors               |
