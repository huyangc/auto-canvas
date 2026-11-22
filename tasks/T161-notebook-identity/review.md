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
