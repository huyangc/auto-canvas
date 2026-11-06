# T011 report — round 2

## Summary

Completed the round 1 must-fix: the MCP installer now accepts a server base URL,
including `/canvas` or `/canvas/`, fetches the manifest under that base and
preserves the normalized base in `ANALOG_CANVAS_API_URL`. Bare-origin installation
still works. Usage and diagnostic text say “server URL”; the obsolete installer
limitation in the server README has been replaced with supported usage.

All plan and review acceptance commands passed after accommodating local sandbox
restrictions. The existing round 1 prefix implementation was retained and
revalidated, including the reverse proxy, browser workflow and empty-base behavior.

## Steps

| Step | Status | Notes                                                                                                                                                                |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained the shared server/editor/launcher base-path normalization. Installer paths follow the same safe-segment and trailing-slash rules.                           |
| 2    | done   | Revalidated prefixed routes, static assets, manifest/pairing URLs, outside-prefix 404 and WebSocket upgrades. The installer now preserves the full public base URL.  |
| 3    | done   | Revalidated editor API/WebSocket URLs, assets and scoped service worker through unit checks and the prefix browser workflow.                                         |
| 4    | done   | Rebuilt and started with `/canvas`, checked the printed URL and health endpoint, then repeated startup/health/shutdown with an empty base.                           |
| 5    | done   | Expanded installer acceptance/rejection tests and added an opt-in live-server installation test. Reran all acceptance and selected unchanged root browser workflows. |
| 6    | done   | Retained the deployment/spec documentation and replaced the server README's obsolete installer limitation with the supported server-URL usage.                       |

## Review findings addressed

**Round 1 finding 1 (must-fix): fixed.** In `apps/mcp-server/src/install.ts`,
`installationServerUrl()` accepts HTTPS or loopback HTTP with an optional safe
base path. It validates the original path before URL parsing can erase dot
segments or reinterpret backslashes, normalizes a trailing slash and rejects
query strings, fragments, userinfo, unsafe segments and non-loopback HTTP.
The full normalized URL is used for manifest retrieval and host configuration;
the receipt's existing `origin` field is retained for compatibility.

`installation.test.ts` now covers bare origins, `/canvas`, `/canvas/`, loopback
addresses, nested safe paths and rejection boundaries. Successful installation
cases verify the exact manifest request, configured API base, offline readiness,
backups and preservation of settings after failed updates.

`installation-server.test.ts` adds an opt-in check against a running server.
It reads the real prefixed manifest and installs the locally packaged adapter
into a temporary home/config directory, verifies its digest, extracts it and
performs the real stdio initialize/tools/list probe. Only external release
hosting is substituted: the test returns the local archive and pins its digest
in the fetched manifest. It never changes the user's host configuration.

## Acceptance results

Verbose output is in `/tmp/T011-round2-*.log`; final browser JSON reports are
`/tmp/T011-round2-prefix-e2e-report.json` and
`/tmp/T011-round2-root-e2e-report.json`.

```text
pnpm check
  → 0 (rerun with local process/loopback/PostgreSQL access);
    739 test files passed, 3 skipped; 7,340 tests passed, 117 skipped;
    Vitest duration 42.89 s. Formatting, Markdown links, generated outputs,
    component checks, types, lint and build passed.
    Lint: 0 errors, 2,434 existing warnings.
    Log: /tmp/T011-round2-check-local.log

pnpm exec vitest run apps/server scripts
  → 0; 31 files and 259 tests passed (16.58 s).

pnpm exec vitest run apps/mcp-server/src/installation.test.ts
  → 0; 43 tests passed (1.71 s).

npm_config_cache=/tmp/T011-round2-npm-cache pnpm mcp:package
  → 0; built analog-canvas-mcp-server-0.17.88.tgz (4 files, 2.5 MB).
    Log: /tmp/T011-round2-mcp-package-local.log

AUTO_CANVAS_BASE_PATH=/canvas pnpm start
  → 0; auto-canvas is ready at http://127.0.0.1:4310/canvas/

curl -sf http://127.0.0.1:4310/canvas/api/health
  → 0; {"ok":true}

curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4310/api/health
  → 0; 404

curl -sf http://127.0.0.1:4310/canvas/ | grep -q 'src="/canvas/'
  → 0

AUTO_CANVAS_MCP_INSTALL_TEST_URL=http://127.0.0.1:4310/canvas pnpm exec vitest run apps/mcp-server/src/installation-server.test.ts
  → 0; 1 live-server installer test passed (1.33 s).

pnpm stop
  → 0; auto-canvas stopped.

node scripts/base-path-proxy.mjs --check
  → 0; notebook isolation, HTTP, assets, manifest, pairing and WebSocket
    upgrade passed; stopped proxy and removed test schema.

AUTO_CANVAS_E2E_BASE_PATH=1 pnpm exec playwright test apps/editor/e2e/base-path.spec.ts --workers=1
  → 0; 1 passed (7.1 s).
    Place part, save to Cloud, reload, reopen from shelf, User Components,
    Agent pairing, prefixed worker scope and request isolation passed.

pnpm start && curl -sf http://127.0.0.1:4310/api/health && pnpm stop
  → 0; ready at http://127.0.0.1:4310/; {"ok":true}; auto-canvas stopped.

pnpm exec playwright test apps/editor/e2e/cloud-projects-server.spec.ts apps/editor/e2e/user-components-server.spec.ts apps/editor/e2e/agent-connection.spec.ts --workers=1
  → 0; 4 unchanged root browser tests passed (16.1 s).

lsof -nP -iTCP:4310 -iTCP:4173 -iTCP:4311 -sTCP:LISTEN
  → 1 with no output: no listeners remain on the acceptance ports.

psql postgresql:///auto_canvas_test -X -w -Atqc "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'prefix_test_%'"
  → 0; count 0: no prefix test schemas remain.

git diff --check
  → 0
```

Browser timing: the prefix run had one attempt, 3,088 ms cumulative attempt
cost and slowest attempt, 7,071.756 ms total elapsed. The root run had four
attempts, 11,793 ms cumulative attempt cost, 4,920 ms slowest attempt and
16,060.664 ms total elapsed. Neither run retried or had failures.

Initial sandbox failures, retained in logs:

- `pnpm check` exited 1 with 18 failed files, 61 failed tests and 2 unhandled
  errors; local database/process/listener operations were restricted, including
  `listen EPERM 127.0.0.1`. The rerun with the required local access passed.
- Plain `pnpm mcp:package` exited 1 at `npm pack`, which could not write npm's
  cache/log directory under the home directory. Repeating the same command with
  only `npm_config_cache` redirected to `/tmp` passed without dependency changes.

## Investigation results

- The approved review widened scope to `apps/mcp-server/**`; the round 1 scope
  blocker is resolved. No agent-client URL-building change was needed.
- `pnpm mcp:package` did not require a distribution declaration update. It emits
  a development archive and its SHA-256; the published Linux digest is verified
  only for an explicit release operation. `config/agent-mcp-distribution.json`
  was left unchanged, and no generated file was hand-edited.
- The live-server installer test validates the real `/canvas` manifest and a
  real locally built adapter. Downloading the published GitHub archive was not
  exercised; that external boundary is substituted as described above.
- The plan's `074541c/...` examples continue to be treated as base-path
  placeholders, consistent with its `/canvas` goal and acceptance commands.

## Deviations and open questions

- No remaining must-fix findings or implementation blockers.
- Nginx is unavailable; the Node proxy verifies prefix-preserving HTTP and
  WebSocket forwarding and simulated TLS-termination origin forwarding.
- The live-server installer check is opt-in because it requires a packaged
  archive and a running server; it was explicitly enabled and passed here.
- No dependencies, lockfile, release declaration, plan or review were changed.
  No commit, push, merge, rebase or branch switch was performed.
- All launched acceptance services were stopped; temporary installer files and
  prefix test schemas were removed. Work remains on `task/T011-base-path`.
