# T161 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T161-notebook-identity` on 2026-11-22;
acceptance rerun by the reviewer in the implementer's worktree. Implementation
by a Claude Opus subagent (the owner's standing instruction since 2026-11-16);
the plan had three rounds of codex `gpt-6.2-astra` review before
implementation.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | should-fix | `apps/server/src/server-main.ts` (listen wait) | `server.once("error", reject)` stayed registered after the server was listening, and its rejection was absorbed by the settled `Promise.race`. A server error after startup would have been swallowed; before this task it was an unhandled `error` event that stopped the process. That is a change in standalone behaviour. | Fixed by the reviewer (four lines): the listener is removed once the server is listening. |
| 2 | note | plan, Acceptance | The plan listed `pnpm deadcode` with expected exit 0. It exits 1 on `main` as well: the same 3 unused files, 51 exports and 6 types, none from this task (compared line by line against a run on the base tree; the only difference is a line number in `apps/editor/e2e/editor-fixtures.ts`). CI does not run it. | None here. Later task plans must not list it as an acceptance command. |
| 3 | note | plan, Context | On `main`, `GET /api/projects` runs the local-user INSERT twice (both `/api/projects` and `/api/projects/*` match). `standalone-mode.test.ts` pins that count, so the test would catch a change in either direction. | None. |
| 4 | note | `scripts/start.sh` and the other launchers | They wait on `/api/health`, which is 404 outside the `/@notebook` mount in notebook mode, so `pnpm start` cannot start that mode. Intended: notebook mode is started by the integration launcher (T164), which probes `/@notebook/<base>/api/integration/ready.json`. | T164 documents it. |
| 5 | note | `apps/server/src/auth-config.ts` | Also rejects `?`, `#` and `@` anywhere in `AUTO_CANVAS_NOTEBOOK_API`, because an empty query, fragment or user part leaves no trace in the parsed URL. Stricter than the plan in the plan's own direction. | Accepted. |

Read in full: `auth-config.ts`, `identity.ts`, `integration-mount.ts`,
`notebook-identity.ts`, `server-main.ts`, and the diffs of `app.ts`, `cli.ts`,
`components.ts`, `projects.ts` and `docs/specs/server.md`. Local mode's
registration is the previous code moved into one function; the notebook
registration order matches the plan (cache header outermost, Agent 404,
cross-site and HEAD rules, the two public GET probes, identity, handlers).

Acceptance rerun (after finding 1 was fixed):

```text
pnpm exec vitest run apps/server (apps/server/dist removed first) → 0; 18 files, 220 tests
pnpm test:local scripts/launcher.test.mjs → 0; 22 tests
pnpm build → 0
node scripts/server-mode-check.mjs → 0; six "ok" groups
git diff --stat origin/main -- app.test.ts base-path.test.ts migrations public-url.ts agent-relay index.ts → empty
pnpm typecheck → 0
pnpm lint → 0
pnpm format:check → 0
pnpm docs:check → 0
pnpm deadcode → 1, identical to main (finding 2)
```

Not run: `pnpm start` against the owner's database and port. The script's
local-mode groups start the built CLI in standalone mode on an isolated schema
instead.

## Round 2 — changes-requested

Reviewed: codex `gpt-6.2-sol` PR review round 3 of PR 112 at `8953134`
(two P1, one P2), each checked against the code by the reviewer and found
valid. Rounds 1 and 2 of that review (P2/P3 only) were answered on the PR and
fixed in `7abbfe6` and `8953134`.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 6 | must-fix | `apps/server/src/notebook-identity.ts` (`fetchProfile`) | The lookup uses the global `fetch`. When Node's environment-proxy support is on (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`) and `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` is set without a `NO_PROXY` entry for the loopback host, that request — carrying the user's bearer token — goes to the proxy, outside the loopback boundary the spec promises. | The **default** transport becomes a direct one: `node:http` / `node:https` `request` with a dedicated `Agent` created for this purpose (no keep-alive, no `proxyEnv`), so no environment setting can route it. Keep the injectable `fetch` option exactly as it is for the existing tests. The direct transport must keep every rule of step 2 of the plan: only the `Authorization` header is sent, one deadline (`timeoutMs`) covers headers and body, a 3xx is not followed and counts as 503, the body is capped at 64 KiB, nothing about the token or body reaches a log or an error message. **Investigate and prove** that a dedicated agent bypasses the environment proxy on this Node version; if it does not, find the construction that does and record it in the report. Proof belongs in `scripts/server-mode-check.mjs` (it runs the built server as a child process): start a trap listener that counts connections; start the notebook-mode server with `NODE_USE_ENV_PROXY=1`, `HTTP_PROXY`, `http_proxy`, `HTTPS_PROXY`, `ALL_PROXY` all pointing at the trap and `NO_PROXY` / `no_proxy` unset; make an authenticated API request; assert it succeeds, the stub notebook received the `/api/me` request, and the trap received zero connections. Add a control in the same group that shows the trap can catch something: a one-line child `node -e` with the same environment that calls the global `fetch` on the stub's URL must reach the trap (if the control cannot be made to reach the trap on this Node version, say exactly why in the report — then the environment-proxy path is not reachable here and the group must say so in its output instead of claiming a proof). Update the spec sentence about the lookup to say it is a direct connection that ignores proxy settings. |
| 7 | must-fix | `apps/server/src/server-main.ts` (notebook-mode `upgrade` listener) | After an upgrade is handed off, Node no longer has an `error` handler on the socket. If the peer resets the connection while the 404 is written, the socket emits an unhandled `error` and the process dies. | Attach an `error` handler to the socket before writing (a failed write only closes that connection). Test in `server-main.test.ts`: open a raw TCP connection, send the upgrade request headers and destroy the socket immediately (repeat a number of times to make the reset likely), then assert the server still answers a normal request. |
| 8 | should-fix | `apps/server/src/server-main.ts` (startup sequence) | Cleanup on failure only wraps the wait for `listening`. A failure earlier — `serveEditor` with a missing `EDITOR_ROOT`, a relay that fails to start, `createApp` throwing — rejects after the pool is open (and, in local mode, after relay alarms are armed) and the caller gets no `close()`. | One cleanup path for everything after `createDb`: on any failure release what was acquired so far (close the relay if it was constructed, end the pool) and rethrow the original error. `--migrate` keeps its own path. Tests: `EDITOR_ROOT` pointing at a missing directory → rejects and the injected pool is ended; a migration failure (a pool whose `connect` rejects) → rejects and the pool is ended. The existing bind-failure test stays. |

Keep everything else as it is; the scope and the owned paths of the plan are
unchanged. Rerun the whole Acceptance section of the plan except `pnpm
deadcode` (finding 2).
