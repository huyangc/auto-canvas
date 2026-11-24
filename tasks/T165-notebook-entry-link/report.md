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

# T165 report, round 4

Implementer: an Opus subagent, working in place on
`task/T165-notebook-entry-link` (head `eaeaae1`). Nothing is committed. All
five findings of review round 4 are fixed. Each has a stage S control, and
each control was shown to FAIL with its fix reverted (`tmp/r4/revert.py`,
`tmp/r4/prove.sh`; logs `tmp/r4/s-<n>.log`).

## Per finding

1. **P1, gate at the proxy boundary** (`stage-l.mjs`). `gateVerdict(held, ms)`
   asks the gate and never throws. An error, or no answer within `ms` (5 s;
   the control uses 300 ms), counts as "not held", with the reason kept as
   `detail`. The proxy's request and CONNECT handlers are async and call
   `verdict` through it. Each handler is wrapped in `.catch` (closing that
   one connection), and a request whose gate check outlived `close()` is
   refused. A gate refusal is recorded as `{ why: "gate", detail }`, and
   `networkChecks` prints the detail. The page route (`guardNetwork`) asks the
   gate the same way. `webGate.held(ms)` gives each `lsof` what is left of
   `ms` (`listenerState(…, { timeoutMs })`) and throws once that time is used
   up, so a stalled `lsof` is an error within the bound.
   `forwardingProxy` is exported for the control.
   _Control:_ new, "S T165 round 4: a listener gate that throws or never
   answers …". It uses a stand-in web origin and two proxies: one whose
   `held` throws (an lsof failure) and one whose `held` never settles. For
   each, an absolute-form GET and a CONNECT to the web origin must get 403,
   be recorded as `gate` with the reason, forward nothing and reach nothing.
   The next request must still be answered, no `uncaughtException` or
   `unhandledRejection` may fire (listeners are installed only while the
   control runs), and stage L's verdict must fail them.
   _Reverted_ (HEAD's `stage-l.mjs`, only exported): it FAILs. The throwing
   gate raised two uncaught exceptions (the process lived only because the
   control's listener caught them) and both requests got no answer. The
   gate that never answers was taken as held (a promise is truthy), so both
   requests were forwarded (200, and 200 Connection Established).
2. **P2, close and closeOpen** (`stage-l.mjs` `browserSessions`). A session
   stays in `registered` until its disposal has ended. `close()` keeps one
   promise per session (`session.closing`), which every caller gets. `closed`
   is still set at once, so a start in flight launches nothing.
   `closeOpen(ms)` closes every registered session and resolves only when
   all their disposals have ended.
   _Control:_ the shutdown control is extended. A stand-in context's `close`
   takes 1.5 s. The control opens it, starts a normal `close`, and calls
   `closeOpen` 200 ms later. It expects that `closeOpen` resolved only after
   the context closed, with the "browser is closed" check already reported
   once, and the context closed only once.
   _Reverted_ (the old close: deregistered at once, and a second close
   returns at once): it FAILs, because `waitedForTheClose` was false and the
   check had not been reported when `closeOpen` returned.
3. **P2, poll bound** (`managed-clone.mjs`).
   `adminSession.query(sql, params, { timeoutMs })` caps that one use,
   connecting included, without changing
   any later use. A connection attempt cut short only by that cap does not
   mark the session unreachable, and a timed-out query discards the
   connection as before, so the next use opens a new one with the full step.
   `lostCreatesRunning` passes the time left until `lostBy` to each poll. If
   the time runs out before the next poll, the previous poll's verdict
   stands.
   _Control:_ new, "S T165 round 4: a poll for a lost create is bounded …".
   It runs the real `adminSession` over a stand-in client that honours
   `query_timeout` the way pg does ("Query read timeout") and never answers
   the poll, with `lostBy` 400 ms away and a 3 s step. It expects every poll
   to get ≤ 400 ms, the database part to end in under 2 s, the created
   database's DROP to be sent on connection 2 with more than 2.5 s, the lost
   create never to be dropped, and one failure line saying it could not be
   read.
   _Reverted_ (no `timeoutMs` passed): it FAILs, because the poll got 3000 ms
   and the part took 3003 ms.
4. **P2, by backend pid** (`managed-clone.mjs`). The poll now reads
   `pid, state, query` for the recorded pids, or for every client backend
   when a pid is unknown. `stillRunning` judges each create on the row of
   its recorded backend, whatever the query text:
   - no row (the backend is gone) or `idle`: ended;
   - a row that cannot be read (state null or `disabled`, empty query,
     `<insufficient privilege>`): still running;
   - a readable row still showing the create: running;
   - a readable row showing another statement: ended (see Deviations).

   The failure line now gives each unresolved name with its reason.
   _Control:_ follow-up 5 is extended. Backend 4105 has `track_activities`
   off (`disabled`, no text) and 4106 shows `<insufficient privilege>`: both
   must be reported unresolved and never looked up. 4107 is idle: that
   create has ended and is looked up. The existing lost, hung, duplicate,
   cancelled and other-pid cases are unchanged. The stand-in answers a poll
   by pid, or a poll by text with its non-idle rows.
   _Reverted_ (the text-based query and judgement): it FAILs, because
   `…_quiet` and `…_hidden` were taken as ended and looked up, and only
   `…_hung` was reported unresolved.

5. **P3, README removal snippet**. The filter is now
   `{ grep -vxF "$CANVAS_UI" || [ $? -eq 1 ]; }`: "nothing left" (status 1)
   succeeds, and a real grep error (status 2) still fails. The README says
   the snippet works under `set -euo pipefail`. I ran it by hand in bash and
   zsh with five lists: only the path, among three entries, three entries
   without it, the path twice, and the variable unset. The old snippet
   stopped (exit 1, before `unset`) for only the path and for unset; the new
   one ends 0 in every case.
   _Control:_ new, "S T165 round 4: the README's removal snippet runs …". It
   extracts the bash block from the README and runs it with `bash -c` under
   `set -euo pipefail` for those five lists, checking the exit status and
   the resulting variable.
   _Reverted_ (the old grep): it FAILs, with status 1 and no output for the
   only-entry and unset cases.

`docs/testing/README.md` now describes the bounded listener check that
never ends the run, the cleanup waiting for a close already under way, and
the lost-create wait by backend pid with its bounded polls.

## Acceptance (environment as the brief, `REF=b5850d6f0ef4003211ebfd8abc52e6063b62d52a`)

```text
pnpm typecheck / lint / format:check / docs:check / deadcode   → 0 (lint: 0 errors, no warning in notebook-integration)
pnpm exec vitest run scripts/notebook-launcher.test.mjs        → 0 (47 passed)
--stage S                                                      → 0 (94 passed; was 91: three new controls)
--stage M                                                      → 0 (114 passed)
--stage L                                                      → 0 (89 passed)
leftover auto_canvas_it_* databases                            → 0
notebook checkout git status --porcelain=v2 --branch           → identical before and after
```

## Deviations

- Finding 4: a readable row of the recorded pid that shows _another_
  statement counts as ended, not as running. CREATE DATABASE cannot run
  inside a transaction block, and the backend of a broken connection runs no
  further statement, so such a row means the pid was reused or the backend
  has moved on. Rows that cannot be read still count as running, as the
  review asks.
- Finding 3: the bound is `query_timeout` on the client side, through
  `adminSession`'s new per-use `timeoutMs`, rather than a server
  `statement_timeout`. The discarded connection then frees the session for
  the drops.
- Finding 1's revert used HEAD's `stage-l.mjs`, which also undoes finding 2,
  so the shutdown control failed in that run too. Finding 2 was also proved
  on its own (run 2).
- `forwardingProxy` is now exported, for the control.

## Could not verify

- A real PostgreSQL with `track_activities` off, or a real lost reply; the
  controls use stand-ins. The new `pg_stat_activity` query was run once
  against the local PostgreSQL 16 test server.
- A real stalled `lsof` (the control uses a `held` that never settles; the
  `spawnSync` timeout path is the existing one, R11-3).
- `pnpm test:local`, `pnpm build`, and the package checks were not rerun
  (not in this round's acceptance).
