# T177 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T177-agent-e2e-new-tab-proof`. The change
is a small fix Opus made directly (run-task "Small fixes"): an 11-line edit to
one test. Opus reran the acceptance.

| #   | Severity | Where                                       | Finding                                                                                                                                                                                            | Expected fix       |
| --- | -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | note     | `apps/editor/e2e/web-agent-session.spec.ts` | The rest of the file needs `AUTO_CANVAS_API_URL` set to the lane's API (documented in `docs/testing/README.md:54`). Without it, the dev-relay handoff test proxies to the developer's 4310 server. | None in this task. |

Acceptance rerun:

```text
playwright … -g "keeps one paired working copy" --repeat-each=5 → 0 (5 passed)
playwright … web-agent-session.spec.ts → 0 (11 passed)
pnpm format:check → 0
pnpm lint → 0 (0 errors)
```

## Round 2 — accepted (codex PR review round 1, P2)

Finding: the `detached` poll could pass before the new tab had decided whether
to recover. A wrong adoption with a slow handshake could then satisfy the final
`attached()`. Fix (small, by Opus): record every `/api/agent/` request and
WebSocket from the reload on. Wait for `networkidle` on the new tab and assert
none. After selecting the paired tab, assert some. Any resume starts with a
relay request, so the new tab's settled network shows its decision. No Agent
status exists outside the panel, and opening the panel would itself connect.

Acceptance rerun (lane 3, `AUTO_CANVAS_API_URL=http://127.0.0.1:4331`):

```text
playwright … -g "keeps one paired working copy" --repeat-each=5 → 0 (5 passed)
playwright … web-agent-session.spec.ts → 0 (11 passed)
pnpm format:check → 0
```
