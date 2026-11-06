# T011 review

## Round 1 — changes requested (scope widened)

Prefix support in the server, editor, relay, launchers and docs is done and
its acceptance passed. The MCP installer stopped correctly at the plan's
scope boundary.

| #   | Severity | Where                                          | Finding                                                                                                             | Expected fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | must-fix | `apps/mcp-server/src/install.ts:16-33,187-318` | `installationOrigin` rejects any path, so `--install --origin https://notebook.example.com/canvas` cannot complete. | Scope widened to `apps/mcp-server/**` and, if the packaging checks require it, `config/agent-mcp-distribution.json` (update it only through `pnpm mcp:package` or the script that owns it, and report why). Accept a server **base URL**: HTTPS or loopback HTTP, optional path normalized like `AUTO_CANVAS_BASE_PATH` (no query, fragment or userinfo). Use the full base for the manifest URL and `ANALOG_CANVAS_API_URL`. Keep `--origin` working for a bare origin; rename the usage text to "server URL". Tests: bare origin, `/canvas`, `/canvas/`, rejected query/fragment/userinfo, non-loopback HTTP rejected. |

Acceptance: rerun every command in the plan, plus `pnpm mcp:package`, the
installer tests, and an install dry run or test against
`http://127.0.0.1:4310/canvas` served by `AUTO_CANVAS_BASE_PATH=/canvas pnpm start`.

## Round 2 — accepted

Reviewed: working tree after Codex round 2; acceptance rerun by Opus.

Every changed path is in the widened scope; no root-absolute `/api/` string is
left in `apps/editor/src` outside tests. `normalizeBasePath` accepts only
URL-safe segments and rejects `.`/`..`; the app is mounted under the prefix
with a JSON 404 outside it and a 308 from `/canvas` to `/canvas/`. The
installer accepts a server base URL (HTTPS or loopback HTTP, normalized path,
no query/fragment/userinfo) and uses the full base for the manifest and
`ANALOG_CANVAS_API_URL`.

Acceptance rerun:

```text
pnpm check → 0 (7340 passed)
vitest apps/server scripts apps/mcp-server → 0 (404 passed)
AUTO_CANVAS_BASE_PATH=/canvas pnpm start → ready at http://127.0.0.1:4310/canvas/
  /canvas/api/health {"ok":true}; /api/health 404; /canvas → 308 /canvas/;
  assets src="/canvas/assets/..."
installation-server.test against live /canvas → 1 passed
node scripts/base-path-proxy.mjs --check → notebook isolation, HTTP, assets,
  manifest, pairing and WebSocket upgrade passed
AUTO_CANVAS_E2E_BASE_PATH=1 playwright base-path.spec.ts → 1 passed
pnpm start (root) → ready at http://127.0.0.1:4310/, health ok; stop; no listeners left
```
