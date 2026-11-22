# T160 — Repeatable integration check for silicon-notebook: stages T and A

- Branch: `task/T160-notebook-integration-check`
- Base: `main` at `387a3de`
- Lane: none (no auto-canvas database is used)
- Status: approved (revision 6; codex gpt-6.2-astra plan review: five rounds, verdict approve; afterwards only the pinned base commit was corrected from the stale local `master` to the candidate's real base on `origin/master`)
- Parent plan: the silicon-notebook integration plan (version 7, codex-approved and confirmed by the owner on 2026-11-22; kept outside the repository). This task is its investigation S4. This file is self-contained.

## Goal

A check script, run on demand and never by CI, that proves two things about serving auto-canvas under silicon-notebook's Next.js server at `/canvas`:

- **Stage T (transport):** with a real Next.js production server and the two rewrite rules the integration uses, requests are forwarded only into the private upstream mount `/@notebook/canvas`, the bare entry does not redirect in a loop, and malformed paths never reach the upstream.
- **Stage A (notebook alone):** a given silicon-notebook revision builds and starts without anything from auto-canvas, its default build contains exactly today's rewrite rules, and a build with the canvas rule enabled contains those plus exactly the two expected rules, frozen at build time and behaving as stage T requires.

Later tasks add stages M, L and P to the same script. This task changes no product code.

## The first rule: the owner's environment

silicon-notebook is a separate repository, checked out on this machine at `/Users/huzhifeng/workspace/silicon-notebook` and in daily use by the owner, who also runs servers on ports 3000, 8000 and 4310. The script must be unable to affect any of that:

- It never writes inside the source checkout, including its ignored directories (`frontend/node_modules`, `.next`, `.local`). It reads from it only to clone the git repository and to **copy** `frontend/node_modules`.
- It never reads the source checkout's `.env`, never uses its databases, and never passes through environment variables from the invoking shell that could point there.
- It never signals a process it did not start, and never looks processes up by port in order to signal them.
- Its Node child processes are stopped from making the accidental TCP downloads this toolchain is known to attempt (see the offline guard). This is a guard against accidents, not a network sandbox: it does not cover UDP or non-Node programs.

Each step below says how these are enforced; they are also acceptance items.

## Context

- silicon-notebook's rewrite rules live in `frontend/next.config.mjs`. Today `rewrites()` returns two rules — `{ source: "/api/:path*", destination: "<backend>/api/:path*" }` and `{ source: "/mcp", destination: "<backend>/mcp/" }` — built from `BACKEND_PROXY_TARGET` (default `http://127.0.0.1:8000`). A change under review in that repository (local branch `claude/canvas-proxy-rewrite-a58b3d`, at `0984e08e8` when this plan was written; its merge base with `origin/master` is `d3388036b`, the last commit without the change; the checkout's local `master` branch may lag behind `origin/master`, so always name the base by commit id) adds two more rules when `CANVAS_PROXY_TARGET` is set to an `http://` or `https://` origin on host `127.0.0.1` or `localhost` (optional port, optional single trailing slash): an exact rule for `/canvas` and a restricted wildcard, both pointing into `<target>/@notebook/canvas`. Any other value makes the config throw at load.
- The restricted wildcard this check uses for its own fixture (the notebook change is expected to behave the same; its exact text may differ):

  ```js
  // one allowed unit: not / \ % . , not a control character or space, and not an
  // escape of dot, slash, backslash, a control character, space or DEL
  const unit = String.raw`(?:[^/\\%.\x00-\x20\x7f]|%(?!2[eEfF]|5[cC]|[01][0-9a-fA-F]|20|7[fF]))`;
  // a segment has at least one such unit, or is three or more dots
  const segment = String.raw`\.*` + unit + "(?:" + unit + String.raw`|\.)*|\.{3,}`;
  const rules = (target) => [
    { source: "/canvas", destination: `${target}/@notebook/canvas/` },
    { source: `/canvas/:path(${segment})*`, destination: `${target}/@notebook/canvas/:path*` },
  ];
  ```
- Next.js 15.5.18 behaviour the stages rely on (read from the installed source):
  - A request target containing a backslash or `//` gets `308` before any rewrite is considered; the `Location` is the target with every backslash replaced by `/` and every run of slashes collapsed to one (`next/dist/server/lib/router-utils/resolve-routes.js:89-100`, `shared/lib/utils.js:124-130`).
  - The default trailing-slash handling redirects `/x/` to `/x` with `308` before rewrites.
  - A wildcard rule matched with an empty tail compiles `<target>/@notebook/canvas/:path*` to `<target>/@notebook/canvas` (no slash).
  - Rewrite destinations are written into `.next/routes-manifest.json` at build time; `rewrites` there is `{ beforeFiles, afterFiles, fallback }` (older versions: a plain array, which means `afterFiles`). The rules returned as a plain array from `rewrites()` land in `afterFiles`. `next start` reads rewrites from that file.
  - The proxy sends the upstream's own host in `Host`, and answers `500` when the upstream connection fails.
  - Next may write into its own package directory (when no native SWC binding loads it downloads a fallback into `node_modules/next/…`, calling `fetch()` directly, which `npm_config_offline` does not stop), may fetch registry metadata to patch a lockfile unless `NEXT_IGNORE_INCORRECT_LOCKFILE` is set, and may call a package manager when `typescript`, `@types/react` or `@types/node` is missing. This is why the check never builds against the owner's `node_modules`, preflights the copy, and blocks non-loopback connections. Native SWC packages are named `@next/swc-<platform>-<arch>` on macOS and `@next/swc-linux-<arch>-gnu` or `-musl` on Linux.
- auto-canvas answers a bare base path with `308` to `base/` (`apps/server/src/app.ts:128-132`). With a single wildcard rule this loops: Next redirects `/canvas/` to `/canvas`; the next request for `/canvas` is forwarded as `…/@notebook/canvas`; the upstream redirects to `/canvas/`; and so on.
- silicon-notebook's production launcher `npm run start` → `scripts/prod.sh`:
  - needs a root `.env` or `ALLOW_NO_ENV_FILE=1`; reads `PYTHON_BIN`, `PORT` (backend, default 8000), `FRONTEND_PORT` (default 3000), `SKIP_INSTALL`, `SKIP_BUILD`; refuses occupied ports;
  - with `SKIP_INSTALL=1` it skips `pip install` and `npm ci`; with `SKIP_BUILD=1` it skips the build and starts `frontend/node_modules/.bin/next start` directly;
  - starts the backend and the frontend with `nohup … &`, prints `backend  : … (PID <n>, …)` and `frontend : … (PID <n>, …)` (`prod.sh:189-190`) and exits; it does not wait for readiness;
  - the Python side loads an env file chosen by `SILICON_NOTEBOOK_ENV_FILE` (`scripts/python_env.py:24-39`): unset → `<root>/.env`; **empty string → no env file at all**;
  - writes logs, the SQLite database (when `DATABASE_URL` is unset) and extension state under `<root>/.local/`, `release-manifest.json` in `<root>`, and a launcher receipt under `${TMPDIR:-/tmp}`;
  - `npm run stop` → `scripts/stop.sh` finds whatever process owns the two ports and signals it. **The check must not use it.**
- Repository tooling: `pnpm lint` scans `apps packages worker scripts`; `pnpm format:check` covers `scripts/**/*.mjs`; knip treats `scripts/*.mjs` as entries. That is why this check lives under `scripts/`.
- `scripts/base-path-proxy.mjs` is the house style for a spawned-process check.

## Scope

Owned paths (may be created, edited or deleted):

- new: `scripts/notebook-integration-check.mjs`
- new, only if the main script would otherwise exceed about 400 lines: helpers under `scripts/lib/notebook-integration/` (`*.mjs`)
- `docs/testing/README.md` (one short section on when and how to run the check)
- `tasks/T160-notebook-integration-check/report.md`

Out of scope (do not change):

- everything under `apps/`, `packages/`, `integrations/`, every other script, `package.json`, `pnpm-lock.yaml`, CI configuration
- anything inside the silicon-notebook checkout

## Steps

1. **Command line.** `node scripts/notebook-integration-check.mjs --stage <T|A> --notebook <dir> [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]`. Unknown stages or missing arguments print usage and exit 2. `--keep` leaves the temporary directory in place and prints its path. Every stage prints one line per assertion (`ok   <name>` / `FAIL <name>: <detail>`), a final `stage <X>: N passed, M failed`, and exits 0 only when M is 0.

2. **Shared helpers.**
   - **Start marker and temporary root.** Before reading anything from `--notebook`: take `parent = os.tmpdir()` and the notebook directory, and compare them **by directory identity, not by text** (the volume may be case-insensitive, and `fs.realpathSync` keeps the spelling it was given): `stat` the notebook root; resolve the temporary parent first with `fs.realpathSync(parent)` (so a symlink that points into the checkout is followed), then walk from that **resolved** path up to the filesystem root and `stat` each directory on the way, the resolved parent itself included; if any of them has the same `dev` and `ino` as the notebook root, exit 2 with a message — `os.tmpdir()` follows the invoking shell's `TMPDIR`, which must not point into the checkout. Then `fs.mkdtemp(path.join(<the resolved parent>, "nb-check-"))`; create `home/`, `t/` and `npm-cache/` in it and a marker file whose mtime is the run's start. The root is removed in a `finally` and on SIGINT/SIGTERM unless `--keep`.
   - **Child environment.** Every child process (git, cp, npm, node, the launcher) gets an environment built from an allow-list, never `process.env` spread: `PATH` and `LANG`/`LC_ALL` copied from the parent; `HOME=<tmp>/home`; `TMPDIR=<tmp>/t`; `NEXT_TELEMETRY_DISABLED=1`; `NEXT_IGNORE_INCORRECT_LOCKFILE=1`; `PYTHONDONTWRITEBYTECODE=1` (the interpreter may have an editable install pointing into the owner's checkout; imports must not write bytecode there); `NODE_OPTIONS=--require <tmp>/offline-guard.cjs` (next item); `npm_config_offline=true`; `npm_config_update_notifier=false`; `npm_config_cache=<tmp>/npm-cache`; `SILICON_NOTEBOOK_ENV_FILE=` (empty); `MODEL_SERVICES_CONFIG=` (empty); plus only the variables a step names. In particular `DATABASE_URL`, `EXTENSIONS_CONFIG`, `SILICON_NOTEBOOK_UI_PLUGINS`, `CANVAS_PROXY_TARGET` and `BACKEND_PROXY_TARGET` exist in a child only when the step sets them.
   - **Offline guard.** Write `<tmp>/offline-guard.cjs`: it wraps `net.Socket.prototype.connect` — which HTTP, HTTPS (through `TLSSocket`) and the built-in `fetch` all reach — handling both call shapes (a single normalised `[options, callback]` array, and direct `(options|port, host, …)` arguments). A TCP connection whose host is `127.0.0.1` or `::1` passes; `localhost` is rewritten to `127.0.0.1` before connecting, so it cannot resolve elsewhere; Unix-socket connections pass; anything else is refused with an error and appended as one line (host, port) to the file named by `NB_CHECK_OFFLINE_LOG`. It is in `NODE_OPTIONS`, so it applies to npm, `next build`, its workers (Next keeps `--require` when it rebuilds `NODE_OPTIONS`) and `next start`. Scope: accidental TCP connections from Node processes of this toolchain; it does not see UDP or other programs.
     - **Control, run first in every stage:** a child `node -e` with the allow-listed environment and its own log file that calls `fetch("http://192.0.2.1:49152/", { signal: AbortSignal.timeout(3000) })` must reject, and that log must contain exactly that host and port. (Do not use a low port such as 9: `fetch` refuses those itself with `bad port` before any socket is created, so the guard would never be reached.) This proves the preload is active; without it an empty log would mean nothing. Print `ok   offline guard active`.
     - Each stage ends with `ok   no outbound connection attempted` when the run's log is absent or empty, FAIL with its content otherwise.
   - **Processes.** Spawn every long-running child with `detached: true` so it leads its own process group, remember that group id, and stop it with `process.kill(-pgid, "SIGTERM")`, then `SIGKILL` after 5 s. Never signal anything else. After stopping, verify the group is gone (`process.kill(-pgid, 0)` throws `ESRCH`) and forget the id at once, so a recycled id can never be signalled later.
   - **Ports and listener ownership.** Obtain a free loopback port by listening on port 0 and closing. Never use 3000, 8000 or 4310 (if port 0 returns one of them, ask again). A port can be taken by something else between the probe and the use, so before trusting any HTTP answer from a server the check started, `listenerIs(port, pid)` must hold: the set of PIDs reported by `lsof -nP -a -iTCP:<port> -sTCP:LISTEN -Fp` is exactly `{pid}`. `next start` listens in the process the check spawned (so `pid` is the child's pid, for the direct `node …/next start` spawns of stages T and A); for A6 the PIDs are the two the launcher prints. Any other PID on the port is an immediate FAIL for that step; that process is never signalled.
   - **Raw HTTP client** on `node:http` `request({ host: "127.0.0.1", port, path, method })` that sends `path` byte for byte (no URL normalisation) and never follows redirects; returns status, headers and body.
   - **Stub upstream** (`node:http` server on a free loopback port) that records `{ method, url }` of every request before answering. A path exactly `/@notebook/canvas` → `308` with `Location: /canvas/` (what auto-canvas does publicly for a bare base); a path that is `/@notebook/canvas/` or starts with it → `200` JSON `{ "path": …, "query": … }`; anything else → `404` with the record flagged `outsideMount`.
   - **Mount predicate**: for a recorded URL, `new URL(url, "http://x").pathname` is exactly `/@notebook/canvas`, exactly `/@notebook/canvas/`, or starts with `/@notebook/canvas/`. `/@notebook/canvas-other` is outside.
   - **Manifest reader**: returns `{ beforeFiles, afterFiles, fallback }`, each an ordered list of the raw rule objects from `.next/routes-manifest.json` (a legacy plain array is `afterFiles`, the other two empty). `expectRewrites(manifest, expected)` asserts: `beforeFiles` and `fallback` are empty; `afterFiles` has exactly `expected.length` entries in order; each entry's `source` and `destination` equal the expected ones (or satisfy the expected predicate, for the wildcard `source`); and no entry has a `has` or `missing` condition.
   - **Private modules.** `copyModules(from, to)`: a copy of a `node_modules` directory with internal symlinks preserved — `cp -cR` on macOS (copy-on-write clone), `cp -a --reflink=auto` on Linux, falling back to `cp -a`. Then, before anything from the copy is executed: (a) walk the copy and require every symlink to resolve (`fs.realpathSync`) to a path inside the copy — an absolute or escaping link is a FAIL naming it; (b) `next/package.json` exists (print the version) and so do the three files Next's TypeScript setup looks for: `typescript/lib/typescript.js`, `@types/react/index.d.ts`, `@types/node/index.d.ts`; (c) in a child process with the allow-listed environment, `require()` the main file of each **native** SWC package in the copy — directories matching `@next/swc-*` whose name does not start with `@next/swc-wasm` — and require that at least one loads; presence alone, or only a WASM package, is not enough. A failed preflight is a FAIL with a message; no build starts.
   - **The transport table** — one function `transportAssertions({ nextPort, stub })` used by stage T and by stage A (step 4, A4), so both check the same properties:
     - `GET /canvas` → 200; exactly one new stub record, `/@notebook/canvas/`.
     - `GET /canvas?new=1` → 200; stub path `/@notebook/canvas/`, query `new=1`.
     - `GET /canvas/editor` → 200; stub path `/@notebook/canvas/editor`.
     - `GET /canvas/api/projects/x/versions/x%3A3/preview.svg` → 200; stub path is `/@notebook` followed by the request path byte for byte, `%3A` intact.
     - `GET /canvas/a.b/c.svg`, `GET /canvas/...` → 200; stub path is `/@notebook` followed by the request path byte for byte.
     - `GET /canvas/` → 308 whose raw `Location` header is exactly `/canvas`; no new stub record.
     - `GET /canvasx` → 404; no new stub record.
     - Not forwarded — for each, no new stub record, and the status is `404`: `/canvas/..`, `/canvas/../api/projects`, `/canvas/x/../y`, `/canvas/x/..`, `/canvas/x/.`, `/canvas/.`, `/canvas/./x`, `/canvas/%2e/api`, `/canvas/%09../api`, `/canvas/%1f/x`, `/canvas/%2e%2e/api/projects`, `/canvas/%2E%2e/api`, `/canvas/.%2e/x`, `/canvas/..%2fapi`, `/canvas/a%2Fb`, `/canvas/a%5cb`, `/canvas/a%5Cb`, `/canvas/.%09./api`, `/canvas/.%0a./api`, `/canvas/.%0D./api`, `/canvas/..%20`, `/canvas/..%00`, `/canvas/a%20b`, `/canvas/a%7fb`, `/canvas/%1F`.
     - Redirected, not forwarded — for each, status exactly `308`, no new stub record, and the **raw `Location` header string** equal to the value given (compare the header text; do not parse it with `new URL`, which would resolve the dot segment and would also accept another origin): `/canvas/a\b` → `/canvas/a/b`; `/canvas/..\api` → `/canvas/../api`; `/canvas\api` → `/canvas/api`; `/canvas\..\api` → `/canvas/../api`; `/canvas//editor` → `/canvas/editor`. Do not follow them.
     - Malformed and ending in a slash — `/canvas/./`, `/canvas/../`, `/canvas/%2e%2e/`, `/canvas/x/../`, `/canvas/a%20b/`: for each, no new stub record (the hard requirement). **Investigate** the status and raw `Location` Next returns for each (the trailing-slash redirect is expected to answer `308` to the same target without the final slash), then pin exactly what you observed as the assertion and list the observations in the report.
     - **Investigate, then extend:** the notebook candidate keeps its own table of malformed paths in `frontend/tests/unit/next-proxy.test.mjs` (read it from the `--notebook` checkout's candidate ref with `git show`, or from the clone in stage A). Add every row of it that can be sent on the wire (`node:http` rejects a request path containing a raw NUL, tab, newline or space — leave those to the candidate's matcher-level tests — but it does accept a raw DEL, so the candidate's `/canvas/a<0x7f>b` row **is** sendable and must be included) and is not already above, keeping its exact casing and backslashes; for each, the hard requirement is no new stub record, and the status and raw `Location` are pinned from what the production fixture returns. List the added rows in the report.
     - Finally: every record the stub holds satisfies the mount predicate and none is flagged `outsideMount`.

3. **Stage T.** Needs only `--notebook`.
   - `copyModules(<notebook>/frontend/node_modules, <tmp>/app/node_modules)`.
   - `<tmp>/app`: `package.json` (`{"name":"nb-check","private":true}`), `pages/index.js` (a component returning a short string), `next.config.mjs` that reads `CHECK_RULES` (`two` or `one`) and `CHECK_TARGET` and returns, for `two`, `rules(target)` from Context; for `one`, only `{ source: "/canvas/:path*", destination: "<target>/@notebook/canvas/:path*" }`. Set `experimental: { proxyTimeout: 300_000 }` as silicon-notebook does; do not set `trailingSlash` or `skipTrailingSlashRedirect`.
   - Three configurations, each: fresh stub, `next build`, `next start -p <free> -H 127.0.0.1`, wait until `listenerIs(port, child.pid)` and `GET /` → 200 with HTML that **contains** a marker string generated at random for this run and rendered by `pages/index.js`.
     - **(i)** `two`, target `http://127.0.0.1:<stub>` → the full transport table. Then, as the last assertion of this configuration, stop the stub and `GET /canvas` → 500.
     - **(ii)** `two`, target `http://localhost:<stub>` → the full transport table.
     - **(iii)** `one`, target `http://127.0.0.1:<stub>`, stub alive — the negative control. Walk by hand, comparing raw `Location` headers: `GET /canvas/` must be `308` with `Location: /canvas` and no stub record; `GET /canvas` must be `308` with `Location: /canvas/` and exactly one stub record, `/@notebook/canvas`; repeat both once more with the same results. Print `ok   control: single rule loops`. Any other status or location at any hop is a FAIL (the premise of the two-rule design would be wrong).

4. **Stage A.** Needs `--notebook`, `--ref`, `--base` and `--python`.
   - **Clone.** `git clone --quiet --no-hardlinks <notebook> <tmp>/nb`. Resolve `--ref` once to a commit: try it as given in the clone, then as `origin/<ref>`; print the commit; `git checkout --quiet --detach <commit>`. Resolve `--base` the same way. Use those two commit ids for every later git command.
   - **Modules.** Compare `frontend/package-lock.json` at the candidate commit with the same file in the source checkout's working tree; if they differ, FAIL ("installed modules do not match the revision under test"). Otherwise `copyModules(<notebook>/frontend/node_modules, <tmp>/nb/frontend/node_modules)`.
   - **A1 no new dependency.** `git diff --name-only <base> <candidate>` contains none of: `package.json`, `package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`, any path matching `backend/requirements*`. Print the changed files. When `<base>` equals `<candidate>` the diff is empty: print `ok   A1 (base equals candidate, nothing to compare)`.
   - **A2 default build equals today's rules.** Allocate port `P_be`. In `<tmp>/nb/frontend` run `npm run build` with `BACKEND_PROXY_TARGET=http://127.0.0.1:<P_be>` and no `CANVAS_PROXY_TARGET`. Exit 0. `expectRewrites` with **exactly** `[("/api/:path*", "http://127.0.0.1:<P_be>/api/:path*"), ("/mcp", "http://127.0.0.1:<P_be>/mcp/")]` — both in `afterFiles`, the other phases empty, no conditions. `next start` on a free port; trust it once `listenerIs(port, child.pid)` and `GET /` → 200; `GET /canvas` → 404 and `GET /canvas/editor` → 404.
   - **A3 enabled build adds exactly two rules.** Fresh stub `S`. Remove `.next`; build with the same backend target and `CANVAS_PROXY_TARGET=http://127.0.0.1:<S>`. `expectRewrites` with exactly four `afterFiles` entries (other phases empty, no conditions): the two from A2 unchanged and first; third `("/canvas", "http://127.0.0.1:<S>/@notebook/canvas/")`; fourth with destination `http://127.0.0.1:<S>/@notebook/canvas/:path*` and a `source` that starts with `/canvas/:path(` and ends with `)*`. Print the fourth `source` verbatim.
   - **A4 the real build passes the transport table and is frozen.** Start that build with `CANVAS_PROXY_TARGET=http://127.0.0.1:<another free port>` in the environment; run `transportAssertions` against it with stub `S`. Passing proves both that the real rules behave like the fixture's and that the run-time variable did not replace the build-time target (every forwarded request arrived at `S`).
   - **A5 invalid values fail the build with the right diagnostic.** `CANVAS_PROXY_TARGET=http://[::1]:4310 npm run build` and `CANVAS_PROXY_TARGET=http://example.com npm run build` each exit non-zero **and** their output mentions `CANVAS_PROXY_TARGET`.
   - **A6 the notebook starts without auto-canvas.** Allocate `P_api` and `P_web` first. Remove `.next`; build with `BACKEND_PROXY_TARGET=http://127.0.0.1:<P_api>` and `CANVAS_PROXY_TARGET=` (set, empty); assert the manifest equals A2's two rules with `<P_api>` (this also covers the "explicitly empty" case). Then, in `<tmp>/nb`, spawn `npm run start` detached with: `ALLOW_NO_ENV_FILE=1`, `SKIP_INSTALL=1`, `SKIP_BUILD=1`, `PYTHON_BIN=<--python>`, `PORT=<P_api>`, `FRONTEND_PORT=<P_web>`, `BACKEND_PROXY_TARGET=http://127.0.0.1:<P_api>`, and the allow-listed base environment (so `SILICON_NOTEBOOK_ENV_FILE` and `MODEL_SERVICES_CONFIG` are empty and no `DATABASE_URL` exists). `P_api` and `P_web` must differ. Parse the two `PID <n>` values from its output. The launcher backgrounds the services with `exec nohup … &` in a non-interactive shell, so they stay in the launcher's process group, which the check owns; assert it (`ps -o pgid= -p <pid>` equals the owned group id for both) before going on.
     - Before trusting any HTTP answer, establish who is listening: poll until `listenerIs(P_api, <backend PID>)` and `listenerIs(P_web, <frontend PID>)` (a different PID on either port is an immediate FAIL: something else took the port; do not signal it). Only then wait, up to 120 s in total, for `GET http://127.0.0.1:<P_web>/api/health` → 200 and `GET http://127.0.0.1:<P_web>/` → 200, while checking on every poll that both PIDs are still alive (a dead PID is an immediate FAIL with the tail of `<tmp>/nb/.local/logs/*.log`). `GET http://127.0.0.1:<P_web>/canvas` → 404.
     - Confirm the database is the clone's: `<tmp>/nb/.local/` contains the SQLite file and the backend log's first lines name paths under `<tmp>/nb`.
     - Stop by signalling the owned process group; verify the group is gone and both PIDs are dead. Do not run `npm run stop`.
     - **Investigate:** this is the only step whose environment is not fully known. Read `scripts/prod.sh`, `scripts/extension_services.sh` and `scripts/python_env.py` in the clone and add whatever further variables a clean, offline, model-free start needs. Do not edit files in the clone. Record in the report which variables were needed and why. If either service is not in the launcher's process group, that is `FAIL A6`: clean up the owned group as usual, **signal nothing else**, print the out-of-group PID and its command line for the owner to inspect, and report it. If a start is impossible without network access or the owner's `.env`, A6 prints `FAIL A6: <reason>` — never a skip.
   - **Source-checkout observation, last** (stage T ends with the same). Prevention is the job of the boundaries above; this is only an observation, and an mtime scan cannot prove absence of writes. Run `find <notebook>/frontend/node_modules -newer <marker>` and treat three outcomes separately: a non-zero exit or stderr output → FAIL (traversal error); any path printed → FAIL listing up to ten (nothing but an install writes there, and the script must not); nothing printed → `ok   no newer entries under the source node_modules`. Then run `find <notebook> -path '<notebook>/.git' -prune -o -path '<notebook>/frontend/node_modules' -prune -o -newer <marker> -print` and print up to ten results as `note newer in source checkout: <path>` without failing — the owner may be editing files or running their own server there; list them in the report.

5. **Docs.** `docs/testing/README.md`: a short section "silicon-notebook integration check" — what stages T and A prove, the command lines, that it is not part of CI or `pnpm check`, that it copies (never uses in place) the notebook's installed frontend modules, and that it must be rerun after any Next.js upgrade in that repository.

## Acceptance

Run from the repository root.

```bash
pnpm install --frozen-lockfile --offline
NB=/Users/huzhifeng/workspace/silicon-notebook
PY=/opt/homebrew/Caskroom/miniconda/base/bin/python
BASE=d3388036b

node scripts/notebook-integration-check.mjs --stage T --notebook "$NB"
# expected: exit 0; every line "ok" or "note"; includes "ok   offline guard active", "ok   control: single rule loops", "ok   no outbound connection attempted" and "ok   no newer entries under the source node_modules"

node scripts/notebook-integration-check.mjs --stage A --notebook "$NB" --ref claude/canvas-proxy-rewrite-a58b3d --base "$BASE" --python "$PY"
# expected: exit 0; A1–A6, the outbound check and the node_modules observation all ok

node scripts/notebook-integration-check.mjs --stage A --notebook "$NB" --ref "$BASE" --base "$BASE" --python "$PY"
# expected: exit non-zero; A1, A2 and A6 ok; A3, A4 and A5 FAIL (the base commit has no canvas rule).
# This run shows the stage detects a missing rule.

node scripts/notebook-integration-check.mjs --stage X --notebook "$NB"; echo $?     # expected: usage, 2
TMPDIR="$NB/frontend" node scripts/notebook-integration-check.mjs --stage T --notebook "$NB"; echo $?   # expected: refuses, 2, and creates nothing under $NB
TMPDIR="$(dirname "$NB")/SILICON-NOTEBOOK/frontend" node scripts/notebook-integration-check.mjs --stage T --notebook "$NB"; echo $?   # same directory in another letter case (this volume is case-insensitive): refuses, 2, creates nothing
D=$(mktemp -d); ln -s "$NB/frontend" "$D/link"; TMPDIR="$D/link" node scripts/notebook-integration-check.mjs --stage T --notebook "$NB"; rc=$?; rm "$D/link"; rmdir "$D"; echo $rc   # a symlink outside the checkout that points into it: refuses, 2, creates nothing
pnpm lint && pnpm format:check && pnpm docs:check && pnpm deadcode && pnpm typecheck   # expected: exit 0
```

Behavioural checks:

- After each run every process group the script created is gone and the temporary directory is removed (unless `--keep`).
- Interrupting a run with Ctrl-C during a build, and again during A6 after the services are up, leaves no process of the script's groups and no temporary directory.
- The owner's servers on 3000, 8000 and 4310 (when running) have the same PIDs before and after every run: record `lsof -ti tcp:<port> -sTCP:LISTEN` for the three ports before and after, and include both in the report.

## Notes for the implementer

- If the branch `claude/canvas-proxy-rewrite-a58b3d` no longer exists when you run the acceptance, find the candidate with `git -C "$NB" log --all --oneline -S CANVAS_PROXY_TARGET -- frontend/next.config.mjs`, use that commit as `--ref`, and say so in the report. The base stays `d3388036b`.
- The candidate's wildcard may be tightened further while this task is in progress (it is under review). Stage A does not compare its text, only its shape (A3) and its behaviour (A4), so the check should keep passing; if A4 fails on the candidate, report the exact failing lines — do not loosen the table.
- Children get `NODE_OPTIONS` with both `--require <guard>` and `--dns-result-order=ipv4first`.
- Copying `node_modules` (about 500 MB) is a copy-on-write clone on APFS and takes seconds; it is done once per stage.
- Do not add dependencies; use only Node built-ins.
- This check never calls an LLM API; `MODEL_SERVICES_CONFIG` stays empty so the notebook backend cannot call one either.
- If a step cannot be done as written, stop that step and record why in the report.
