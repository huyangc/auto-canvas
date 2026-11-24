# T165 report, round 1

Written by the reviewer from the implementer's (Opus subagent) final message;
the harness did not let the subagent write this file.

## Summary

T165 is done and every acceptance command passed on the final code: stage S
89 passed, stage M 114 passed, stage L 85 passed, 0 `auto_canvas_it_*`
databases left.

- **The entry:** a new UI package adds the button **打开电路画布** to
  silicon-notebook's side panel; its click calls
  `window.location.assign("/canvas")`.
- **The bundle (0.2.0)** provides `auto_canvas.integration.available`, whose
  decision always answers available with no I/O, and declares the matching UI
  entry.
- **The factoring:** stage M's set-up, launch, managed-service checks, gates,
  stop and cleanup moved into `managed-clone.mjs`, shared by stages M and L.
- **Stage L** builds a silicon-notebook clone with the package, runs
  silicon-notebook's five plugin guards in it, proves the entry, the
  navigation to `/canvas` and the bearer token in headless Chrome, then
  rebuilds without the package and proves the entry is gone.
- **The seven follow-ups** from PR 140 rounds 4 and 5 are fixed in the shared
  module, each with a stage S control that fails with its fix reverted.

## What changed, per file

- `integrations/silicon-notebook/ui/auto-canvas/` (new): `ui-plugin.json`
  (one contribution, as the design); `workspace-plugin.tsx` exporting
  `AutoCanvasEntry`, a `<button type="button" className="button secondary workspace-extension-entry">`
  with lucide `CircuitBoard`, `aria-label`/text 打开电路画布, `title`
  在当前页面打开电路画布; imports `lucide-react` only.
- `plugin/src/silicon_notebook_auto_canvas/bundle.py`, `plugin/pyproject.toml`:
  version 0.2.0, `provides`, `ui_contributions` (`UiContributionDeclaration`
  id `auto_canvas.integration.entry`, slot `workspace.side_panel`),
  `capability_decisions` as a read-only mapping to a probe returning
  `Availability.available()`; still a frozen dataclass, import without side
  effect.
- `scripts/notebook-launcher.test.mjs`: the stub gains `Availability` and
  `app.extension_sdk.ui.UiContributionDeclaration`; asserts manifest id,
  version, `provides` and UI declaration match `ui-plugin.json`, the
  component is exported, the `pyproject` version matches, the decision
  returns available with no audited I/O.
- `scripts/lib/notebook-integration/managed-clone.mjs` (new, 1,639 lines):
  the shared machinery, including `checkManagedService` and `buildWithTarget`.
- `stage-m.mjs`: the M-only phases (854 lines, from 2,114).
- `stage-l.mjs` (new, 967 lines): stage L.
- `scripts/notebook-integration-check.mjs`: `--stage L` (`--ref`, `--python`
  required, `--base` refused); prerequisites stage M's builds, the UI package
  and `@playwright/test`.
- `clone-safety.mjs`: `WRITE_PATHS` gains `frontend/features/ext-auto-canvas`,
  `frontend/features/extension-sdk/registry.local.ts`, `frontend/.local`; the
  regular-file and real-directory checks cover the sync's outputs.
- `self-check.mjs`: a clone-safety scenario (`sync-output-is-a-link`) and
  seven follow-up controls; stage S 81 → 89 checks.
- Docs: `docs/testing/README.md` (stage list and usage, write paths, M6, M8,
  the cleanup deadline, a "Stage L" section); `docs/specs/server.md` (one
  sentence on the entry link); `integrations/silicon-notebook/README.md` (the
  `ui/` entry, "The entry link in a notebook", rollback step 2 names the
  variable).
- `.oxlintrc.json`, `knip.config.js`, `tsconfig.json`: unchanged; no check
  tripped on the UI package.

## Follow-up controls

Checked with a revert harness: per follow-up, a copy of the module directory
with that one fix reverted, the control run against the reverted and an
unchanged copy; both copies removed afterwards.

| #   | Fix                                                                                                                                                                      | As written                   | Fix reverted                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------- |
| 1   | Every pg client has an `error` listener; a broken cleanup connection is replaced                                                                                         | pass                         | FAIL: child crashed on an uncaught `error` event              |
| 2   | One cleanup deadline: 50 s total, 5 s sandbox removal, 20 s reserved for databases, 8 s for groups and pids; the extension stop gets what is left; each cut step says so | pass (1.2 s of a scaled 3 s) | FAIL: still running after 10 s, stop given 40 s, no drop sent |
| 3   | M6 compares the reopened schematic with the saved fixture as canonical JSON (save sends four resistors, create three)                                                    | pass                         | FAIL: the earlier schematic and non-JSON text accepted        |
| 4   | After A's sign-out, B's list holds B's project and not A's                                                                                                               | pass                         | FAIL: an empty list accepted                                  |
| 5   | A `CREATE DATABASE` whose answer was lost is "unknown outcome", looked up and dropped if it exists; a name refused (42P04, 57014) is never dropped                       | pass                         | FAIL: nothing reconciled                                      |
| 6   | `runBounded` settles at its limit when a grandchild holds the pipes                                                                                                      | pass (1.0 s)                 | FAIL: 4.07 s                                                  |
| 7   | A response body is redacted before it is cut for a diagnostic                                                                                                            | pass                         | FAIL: a token prefix printed                                  |
| —   | The sync outputs are write paths (clone-safety scenario)                                                                                                                 | refused                      | FAIL: the link was not refused                                |

## Acceptance results (implementer)

`REF=b5850d6f0ef4003211ebfd8abc52e6063b62d52a`.

```text
pnpm install --frozen-lockfile --offline / pnpm build / pnpm build:notebook-editor   → 0
vitest run scripts/notebook-launcher.test.mjs   → 0   47 passed, none skipped
pnpm test:local                                 → 0   862 files passed, 3 skipped
pnpm typecheck / lint / format:check / docs:check / deadcode   → 0
--stage S                                       → 0   89 passed
--stage M                                       → 0   114 passed
--stage L                                       → 0   85 passed
psql count of auto_canvas_it_ databases         → 0
```

Notebook checkout `git status --porcelain=v2 --branch` identical before and
after. Stage M keeps 114 checks (two renamed: M6 "…and the saved schematic
(canonical JSON)", M8 "…holding B's project and not A's").

Stage L's passing run: L2 guards — `test:node` pass 3279 / fail 0,
vocabulary OK, `typecheck` OK, `cli.sh extensions check` "1 个部署插件：auto_canvas.integration",
parity "OK (2 contributions)"; L4 — the button shows, the
`/api/system/extensions` row is available, the click lands on `/canvas`,
`[data-testid="schematic-canvas"]` mounts, 3 of 3 `/canvas/api/` requests
carried A's token; L6–L7 — copy removed, empty registry, contract row gone,
A's session survives, 添加来源 shows, 打开电路画布 absent for 3 s.

Interrupt (SIGINT after "L4 the browser is open"): exit 130 after 5.0 s; no
browser, companion or canvas process naming the sandbox; 0 databases; sandbox
removed.

## Deviations from the plan

1. `NEXT_PUBLIC_API_BASE_URL=/api` in both stage L builds: silicon-notebook
   bakes it at build time and defaults to `http://127.0.0.1:8000/api`; in the
   first run the page asked port 8000 and the browser guard aborted it, so
   nothing reached the owner's server. `/api` is silicon-notebook's documented
   value for the proxied set-up.
2. Stage L keeps the notebook's data outside `.local` (every launch wipes
   `.local`), so the rollback opens the same notebook: its `.env` sets
   `DATABASE_URL` and `SILICON_NOTEBOOK_STORAGE_DIR` to the sandbox. Stage M's
   `.env` is unchanged.
3. Stage L dismisses the first-visit hint (给阅读多留一点空间, button 知道了)
   that covers the entry for a new user.
4. The browser guard is stricter than the plan: anything but the clone's web
   origin is aborted and fails the stage (other 127.0.0.1 ports included);
   web-origin requests go ahead only while the listeners are the recorded
   processes; WebSockets are refused. Branded Chrome's own background
   connections (`clients2.google.com`, `gstatic`, `www.google.com`,
   `accounts.google.com`, `content-autofill.googleapis.com`) go to a recording
   proxy of the run on 127.0.0.1 that closes each one; they are listed as info,
   not failed.
5. Each browser use gets a fresh persistent profile in the sandbox
   (`launchPersistentContext`), so the browser process is recorded by its
   profile and only it is signalled.
6. Screenshots and the console are written into the sandbox only when a
   browser check fails.
7. `managed-clone.mjs` is 1,639 lines; splitting it further would spread the
   shared context with no reuse.

## Could not verify, or needs follow-up

- The owner's ports were not snapshotted (the rule forbids looking at them).
- `scripts/package-notebook-canvas-check.mjs` imports the plugin under its own
  stub, which lacks `Availability` and `app.extension_sdk.ui`, so it fails
  with bundle 0.2.0 (fixed by the reviewer in this round, see review.md).
- No stage M interrupt test after the refactor (same cleanup as stage L's).
- One orphan from the revert harness (pid 56746, the reverted follow-up 2
  stop script) was ended by its own pid after its command line was checked.

# T165 report, round 2

Implementer: Opus subagent, in place on `task/T165-notebook-entry-link`
(head `a9fca64`), changes uncommitted. Scratch harnesses and logs are in the
worktree's ignored `tmp/r2/`.

## Per finding

1. **P1, every hop through a layer the run controls** (`stage-l.mjs`).
   Chrome is launched with `proxy: { server }` (no `bypass`) and
   `args: ["--proxy-bypass-list=<-loopback>"]`, so loopback goes through the
   run's proxy. The recording proxy is now `forwardingProxy`: it forwards a
   plain HTTP request in absolute form only to `127.0.0.1:<web port>`, opens a
   CONNECT tunnel only to that origin, and does either only while the
   listener gate holds. Everything else is answered 403 or closed and
   recorded as origin, gate or websocket: another host, another 127.0.0.1
   port, an origin-form request, an upgrade. `context.route` stays as the
   second layer. `context.on("request")` also records page requests to other
   origins, a redirect's hops included. The init script writes the token only
   when `location.origin` is the web origin. `networkChecks` fails on a page
   request elsewhere, on any proxy refusal other than Chrome's own background
   hosts (a DNS name, never an IP literal or a loopback name), and on a refusal
   because a listener changed. It requires the proxy to have forwarded the
   page's requests. Background hosts stay info-only.
   _Control:_ stage S "S T165 round 2: a redirect from the web origin to
   another port of 127.0.0.1 …" runs real headless Chrome, launched as
   stage L does, against two listeners of the run. A stand-in web origin's
   `/hop` returns 302 to the other port. The checks: the hop never arrives
   there, the token is set on the web origin and absent on the other, both
   network verdicts fail naming the port, and the proxy forwarded the page.
   _Reverted:_ with round 1's launch options (`bypass: "127.0.0.1"`) the
   control FAILs: the hop arrived (`arrived: ["/landing"]`, forwarded 0). With
   the init script's origin check removed it FAILs: the token was on the other
   origin.
   _Live:_ stage L L4 forwarded 117 requests and L7 forwarded 50 through the
   proxy, so 127.0.0.1 traffic does arrive at the proxy. Playwright's route
   did not see the redirect hop in the control (`blocked: []`); the request
   observer and the proxy did.
2. **P2, interrupt during the start** (`browserSessions`). `open` starts the
   start (the proxy, then the launch, then the record) as `session.starting`.
   It returns no session when the shutdown began during the start, and
   launches nothing once `closeOpen` ran. The start stops before the launch
   when the session was closed while the proxy started. `close` waits for a
   start in flight within its time, then closes the context and the proxy and
   SIGKILLs the recorded process. A context that arrives after a close gave up
   is closed. The process watcher keeps recording after a close, so a launch
   cut short is still ended by pid. A `launching the browser` note marks the
   launch. `browserSessions` takes an injectable `launch` and profile `dir`
   for the control.
   _Control:_ stage S "S T165 round 2: a shutdown during the browser's launch
   …" uses a stand-in launch: a process naming the profile, settling after
   1.5 s. When `closeOpen` comes during the launch, the control expects no
   session, the start awaited, the context closed and the process gone. When
   `closeOpen` comes while the proxy starts, and for a later `open`, it
   expects 0 launches.
   _Reverted_ (no wait, no shutdown checks): it FAILs, because `open` returned
   a session after the shutdown, the close did not wait, and there were 2
   launches.
3. **P2, lost-reply reconcile** (`managed-clone.mjs`). The ledger keeps
   `{ name, backendPid, statement }` for an unknown-outcome create.
   `dropDatabases` polls `pg_stat_activity` with `lostCreatesRunning`: a
   non-idle row with that statement on that backend pid. It polls until no
   such row is left or until `lostBy`, which `cleanUp` sets to the database
   reserve's end minus min(5 s, a quarter of it). Only then does it look the
   name up and drop it. A create still running at `lostBy`, or one whose
   activity could not be read, is reported as "unresolved … (it may be left
   behind)" and is not looked up.
   _Control:_ follow-up 5 is extended. `…_lost` runs on backend 4101 for two
   polls and is in the catalog only after that. `…_hung` never stops. A
   same-text row on another pid is ignored. The lookup must come after the
   wait and name only `…_lost`, which is dropped. `…_hung` is reported
   unresolved and neither looked up nor dropped. Refused names are never
   touched.
   _Reverted_ (round 1's `managed-clone.mjs`): it FAILs, because the lookup
   came at once with both names, 0 activity polls, nothing was dropped and
   nothing was reported unresolved.
4. **P2, list variable** (`integrations/silicon-notebook/README.md`). The
   setup appends the path to an existing `:`-separated list
   (`${VAR:+$VAR:}$CANVAS_UI`). Removal takes out only that path
   (`tr`/`grep -vxF`/`paste`) and unsets the variable only when the list
   becomes empty. Rollback step 2 points to it. The snippets were run in bash
   on a three-entry list, a list holding only the path, and a list without
   it.

`docs/testing/README.md` was updated for the stage S list, the lost-create
reconcile, L3–L5's init script, and the browser-network and shutdown
paragraph.

## Acceptance (final code; environment as the plan, `REF=b5850d6f0ef4003211ebfd8abc52e6063b62d52a`)

```text
pnpm typecheck / lint / format:check / docs:check / deadcode   → 0 (lint: 0 errors, no warning in notebook-integration)
pnpm exec vitest run scripts/notebook-launcher.test.mjs        → 0 (47 passed)
--stage S                                                      → 0 (91 passed; was 89)
--stage M                                                      → 0 (114 passed)
--stage L                                                      → 0 (89 passed; was 85: +2 per browser session)
leftover auto_canvas_it_* databases                            → 0
notebook checkout git status --porcelain=v2 --branch           → identical before and after
interrupt of stage L right after "L4 launching the browser"    → exit 130 after 5 s; "cleanup: the browser is closed" ok; 0 processes naming the sandbox; sandbox removed; 0 databases
```

## Deviations

- `browserSessions(m, { launch, dir })` and `guardNetwork(session, { token })`,
  `networkChecks(report, session, label)` and `TOKEN_KEY` are exported for the
  stage S controls; the gate moved into `open(label, { webPort, held })`.
- Besides the proxy, the stage now also fails on a page request to another
  origin seen by the request observer (redirect hops included).
- A refused proxy target counts as Chrome's background (info) only when it is
  a DNS name with a dot that is not `localhost`/`.localhost`; any IP literal
  fails, not just loopback.
- Stage S now needs the system Chrome (the redirect control runs it).

## Could not verify

- A real PostgreSQL lost-reply race (the control uses a stand-in admin).
- The owner's ports were not snapshotted (the rule forbids looking at them).
- `pnpm test:local`, `pnpm build`, `pnpm build:notebook-editor` and the
  package checks were not rerun (not in this round's acceptance; no file
  they cover changed besides the scripts above).
