# Test System

Tests protect current behavior, rejection boundaries and safety invariants.
The [contract matrix](contract-matrix.md) names each behavior's primary test.

## Layers

| Layer                 | Purpose                                                          | Typical location                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Static and generated  | types, formatting, documentation links, generated-output drift   | root scripts and `pnpm check`               |
| Unit                  | pure algorithms, value boundaries, deterministic transformations | adjacent `*.test.ts`                        |
| Module contract       | one package's public input/output, including rejection cases     | package test beside the public boundary     |
| Cross-module contract | one fact interpreted consistently across package boundaries      | owning boundary package, named for the fact |
| Browser workflow      | a user-visible flow that cannot be proved below the browser      | `apps/editor/e2e/`                          |
| Packaging and golden  | built product, artifacts, visual reference, packaging            | root scripts and local packaging checks     |

Use the cheapest layer that proves the behavior, one primary contract test per
behavior; add a higher-layer test only for wiring or a real user path the lower
layer cannot prove.

Agent client and MCP tests talk to the real editor via `liveAgentEditor()`
(`apps/editor/src/agent/live-agent-editor.test-support.ts`); script only relay
faults and the network services the editor calls, never the editor's answers.

## Local validation

`pnpm check` runs formatting, documentation links, generated Agent docs,
component generation checks, types, lint, local tests and the build in order.
Run focused unit/browser checks while editing, then every acceptance command
in the task plan before review. Record results and missing resources in the
task report, following the [repository workflow](../workflow.md).

`pnpm test:local` runs ordinary unit/module tests, including standalone tests
that build their own dependencies. Its worker count comes from
`vitest.config.ts`: half the cores locally, which leaves room for the other
task lanes on the machine, and every core on CI; a `--maxWorkers` flag on the
command line overrides it. Files named `*.slow.test.ts` (also `.tsx`
or `.mjs`) hold expensive full-search quality benchmarks and are excluded
from the default Vitest projects, `pnpm check` and CI. `pnpm test:slow` opts
into the `slow` project and runs only those files. For auto-layout changes,
Opus must rerun `pnpm test:slow` locally and post its results as required PR
review evidence. Held-out drawings retain quick-mode validity, routing safety
and Net/terminal preservation checks in the default suite; their unchanged
full-search checks, including the T013 crossing limits, run in the slow suite.
In the same way, the full-search geometry of the current-source-tail pairs and
of the source-degenerated differential branches, the 120-device stage chain
and the 85-device layered chain run only in the slow suite; the default suite
keeps quick-planning or smaller-input checks of the same invariants.

`pnpm test:e2e:local` runs browser workflows;
run `pnpm setup:e2e` once per machine or Playwright version when needed.
`apps/editor/e2e/web-agent-session.spec.ts` starts a Vite server inside the
Playwright worker, whose development proxies default `AUTO_CANVAS_API_URL` to
`http://127.0.0.1:4310`: a full-suite run must export `AUTO_CANVAS_API_URL`
itself (the lane's API origin, for example `http://127.0.0.1:4321`); the unit
suite runs without it.
`pnpm test:desktop-build`, `pnpm mcp:package` and `pnpm headless:package` check
local packaging. Golden and performance scripts remain available for changes
that affect their contracts.

The notebook build's browser tests (`apps/editor/e2e/notebook-*.spec.ts`) are
their own run, excluded from the standard one: after `pnpm build` and
`pnpm build:notebook-editor`, `AUTO_CANVAS_E2E_NOTEBOOK=1 pnpm exec playwright test`
starts `scripts/notebook-e2e-fixture.mjs` (a stub silicon-notebook, the built
server in notebook mode on a throwaway schema, a proxy that rewrites
`/canvas` as silicon-notebook does, and beside them a standalone sibling: the
built server in single-user mode serving the standard build `apps/editor/dist`
on its own schema at `AUTO_CANVAS_E2E_API_PORT`) and runs the cases with one
worker in Chrome. The run refuses to start unless `AUTO_CANVAS_TEST_DATABASE_URL` names
an `auto_canvas_test` or `auto_canvas_test_<digits>` database — the name `pg`
itself resolves, so a `host`, `port`, `socket`, `db`, `dbname` or `database` parameter
is refused — and
`AUTO_CANVAS_API_URL` is an `http://127.0.0.1:<port>` origin, and never uses
ports 3000, 8000 or 4310. `node scripts/notebook-e2e-fixture-check.mjs` checks
the fixture's refusals and cleanup (after `pnpm build`), and
`scripts/notebook-e2e-selection-check.mjs` checks which tests each run
collects from `playwright test --list --reporter=json`.

`node scripts/package-notebook-canvas-check.mjs [--tarball <path>]` is the
on-demand check of the offline silicon-notebook package
([Offline package](../../integrations/silicon-notebook/README.md#offline-package)),
run after `pnpm notebook:package` (by default on the newest tarball in
`output/notebook-canvas/`). It needs `AUTO_CANVAS_TEST_DATABASE_URL` (an
`auto_canvas_test` or `auto_canvas_test_<digits>` database, on a role that may
create databases and reach `127.0.0.1` over TCP) and
`AUTO_CANVAS_PACKAGE_PYTHON` (a Python with pip). It unpacks the tarball into
a fresh temporary directory and, with a `PATH` of system directories only
and `AUTO_CANVAS_NODE` set to the Node running it, checks the layout (regular
files and directories only, executable launchers, nothing else), runs
`init-db.sh` and `serve.sh` on a database `auto_canvas_it_pkg_<12 hex>` and a
stub notebook `/api/me` on a free port, then readiness, the editor, a
project with a formula and its preview, a 401 without the token, that the
server loaded no module outside the unpacked tree but `node:` builtins (a
`module.registerHooks` trace), the plugin wheel's offline install and import,
and that SIGTERM stops the server within 15 s. The database and the temporary
directories are removed at the end, also after a failure or an interrupt.
`scripts/package-notebook-canvas.test.mjs` (in `pnpm test:local`) covers the
packaging's pure helpers without a build.

`scripts/standalone-build-evidence.mjs --port <n> --database <url> [--run "<command>"]`
is the standalone build evidence, for a disposable checkout only (it reads the
build output there, and the builds that precede it overwrite
`apps/editor/dist`): it starts, as its own child, the server the launcher
runs (`node apps/server/dist/cli.js` with `EDITOR_ROOT=apps/editor/dist`) on a
throwaway schema, checks that every script, module preload and stylesheet
reference of the standard output is a root-relative `/assets/` attribute that
also resolves (against the document's base URL) to a `/assets/` path on that
server and is answered with the content type its use needs (a JavaScript MIME
type, `text/css`), and with
`--run` runs a command (the Agent browser cases) against that server. It
refuses a checkout with `.env` files, ports 3000, 8000 and 4310, a bound port
and any database but `auto_canvas_test…` (the name `pg` resolves, without a
`host`, `port`, `socket`, `db`, `dbname` or `database` parameter), and stops
everything it started on every exit path: the run's processes by its process
group, by their parents, and by a per-run marker in their environment; a
readout it cannot make is reported as unverified rather than assumed clean.
`node scripts/standalone-build-evidence-check.mjs` checks its
refusals and cleanup (after `pnpm build` and `pnpm build:notebook-editor`).

The silicon-notebook companion service
([spec](../specs/server.md#running-as-a-silicon-notebook-companion-service))
has three test files in the default suite:

- `apps/server/src/guarded-database.test.ts`: unit tests of the guarded URL
  form and of the grammar silicon-notebook's `.env` must fit.
- `apps/server/src/migration-guard.test.ts`: the flagged starts on real
  PostgreSQL. The `empty` guard looks at the whole database, so the file
  creates databases named `auto_canvas_it_<12 hex>_<n>` on the server
  `AUTO_CANVAS_TEST_DATABASE_URL` names (default
  `postgresql:///auto_canvas_test`), drops them with `WITH (FORCE)` in
  `afterAll`, also after a failed case, and asserts that they are gone. Its
  role needs `CREATEDB`; the file fails at once when it lacks it. A hostless
  test URL (the local lane form) is turned into one on `127.0.0.1` with the
  connection's role, which must be able to log in over loopback. Settings a
  case needs (`search_path`, default isolation) are set per database with
  `ALTER DATABASE`, never per role.
- `scripts/notebook-launcher.test.mjs`: `serve.sh` and `init-db.sh` in
  temporary roots (one with a space in its path) with a recording stand-in
  for Node, and the plugin package and TOML examples under Python. It uses
  `AUTO_CANVAS_TEST_PYTHON` when set, otherwise the first of `python3.13`,
  `python3.12` and `python3` on `PATH` that is 3.12 or newer, and fails
  (it does not skip) with a message naming that variable when there is none.

## Environment-dependent execution

The editor does not run simulations. Tests for inherited packages remain until
their separate removal; they do not qualify an editor simulation workflow.

## Timing evidence

Browser reports distinguish cumulative attempt cost (including retries), the
slowest single attempt and elapsed time per run. Parallel runs can overlap;
neither summed test cost nor queue time is test execution wall time. A run
killed before producing its report has missing timing evidence, not zero cost.

## Test-Impact

Every commit that changes product code, tests or tooling ends its message with
one trailer; Opus checks it in review (no CI check):

```text
Test-Impact: tests-updated
Test-Impact: no-test-change — <evidence that behavior did not change>
```

## Removing or simplifying a test

Keep rejection, migration, authorization and input-hardening tests while their
boundary is reachable. Remove or merge a test only when all hold:

1. Its production surface is unreachable or covered by a named primary
   contract at the same or stronger boundary.
2. It is not the only rejection, compatibility, history or safety assertion for
   the behavior.
3. The task report names the replacement protection or why none is needed.

A browser test meets condition 1 when a named lower-layer test covers it,
unless the browser is the point (pointer or focus, layout, font metrics,
clipboard, download, cross-tab, or the flow's only GUI wiring test); push any
uncovered assertion down first.

## Unused code and file size

An export only tests use is dead (`pnpm deadcode`):
delete it with its tests under the rules above, or tag it `@internal` with the
reason. For a changed product file past 1,000 lines , the
reviewer decides whether to split it along its seams. Coverage is diagnostic,
never a threshold.

## Circuit/model and fixture validation

Each circuit fixture lives in `netlists/<circuit-name>/` with its local models.
Preserve `.subckt` interfaces, pin order (changes check every caller) and
foundry data; label simplified models and topology-only fixtures.

Electrical behavior changes report simulator, models, analyses, corners and
acceptance criteria, or why simulation is blocked; syntax inspection alone
proves nothing electrical.

Symbol geometry/pin changes state their known drawing impacts; repair old
layouts only with a bounded one-off when a few deterministic rules suffice.

For unclear, intermittent, cross-layer or real-data defects follow the
[repository workflow](../workflow.md) and record the diagnosis. Raise
intermittent reproduction rates, measure performance before bisecting, report
attempted methods and missing input when no feedback loop exists, redact
private artifacts and obtain authorization for environment access or
production instrumentation.

## silicon-notebook integration check

`scripts/notebook-integration-check.mjs` checks, on demand, the two rewrite
rules that serve auto-canvas under silicon-notebook's Next.js server at
`/canvas`. It is not part of CI or `pnpm check`.

- Stage T builds a throwaway Next.js app with the two rules against a stub
  upstream and checks the transport: requests reach only the private mount
  `/@notebook/canvas`, the bare entry does not redirect in a loop, and
  malformed paths never reach the upstream.
- Stage A clones a silicon-notebook revision, checks that it adds no
  dependency, that its default build keeps exactly today's rewrite rules, that
  a build with `CANVAS_PROXY_TARGET` adds exactly two frozen rules that pass
  the stage T table, that invalid values fail the build, and that the notebook
  starts without auto-canvas.
- Stage M starts this checkout's canvas as a managed companion service of a
  silicon-notebook clone, with two notebook users, and observes the external
  mode and the rollbacks ([below](#stage-m-a-managed-start-in-a-silicon-notebook-clone)).

```bash
node scripts/notebook-integration-check.mjs --stage T --notebook <notebook checkout>
node scripts/notebook-integration-check.mjs --stage A --notebook <notebook checkout> \
  --ref <branch or commit> --base <commit without the change> --python <interpreter with the backend dependencies>
node scripts/notebook-integration-check.mjs --stage M --notebook <notebook checkout> \
  --ref <full commit SHA> --python <interpreter with the backend dependencies>
```

Everything is built and started in a temporary directory the script creates
(`--keep` leaves it). The notebook checkout is only read: the script clones its
git repository and copies, never uses in place, its installed
`frontend/node_modules`; Node children run offline behind a guard. Stage A
refuses, before any copy, build or launch, a revision whose paths the check
writes to are symlinks or which holds a dotenv file the launcher or Next would
read (`.env`, `frontend/.env*`). Rerun the
check after any Next.js upgrade in the notebook repository.

Stage A refuses (exit status 2 for the run, before any process starts) a
revision whose clone holds a symlink that leaves the clone or dangles, a
symlink on any path the build or launcher writes (`frontend/next-env.d.ts`,
`frontend/tsconfig.json`, `frontend/.next`, `release-manifest.json`,
`.local`), a dotenv file, or runtime state that must start fresh (`.local`,
`release-manifest.json`, `frontend/.next`, `frontend/node_modules`). It
re-checks the clone, and that the private `frontend/node_modules` is still a
real directory whose links stay inside it, after every build and before the
launch.

The same rule covers the script's **own** file operations. Every removal,
directory creation, file write, log-file open, tree copy and read it performs
under the sandbox root is validated and performed in one call: the path must
lie inside the sandbox root, every directory above it must be a real directory
(no symlink), and the target itself must not be a symlink; writes and reads
open it with `O_NOFOLLOW`. A directory that a build or a server of the
revision replaced with a symlink is refused with the path named and exit
status 2, never followed. This is not a sandbox against a hostile revision: a
check and the operation that follows are not atomic against a process that is
still running. The operations that can overlap with a live process are the
log-file opens and reads (a server's own log is read while it runs); the open
is bounded by `O_NOFOLLOW`, so a link planted between the check and the open
fails the open instead of being followed. Every removal and write the script
performs — the `.next` removals, the app files, `.local`, the modules copy —
runs only while no process of the revision that the run started is alive, and
a build's products are checked again before the launch. A process the run did
not start, or one that left its group (A6 reports it and never signals it),
is outside that bound.

Every HTTP request the check sends to a port it claims to own is gated on
that ownership immediately before it is sent — the transport table, stage T's
single-rule control and its upstream-down request, A2's probes, and A6's
probes after readiness. The first mismatch stops the probes, is reported, and
sends nothing to the replacement listener. A6's requests through the frontend
that Next forwards to the backend (`/api/ready` and `/api/health` through the
frontend) require both listeners immediately before they are sent, so a
backend that lost its port is caught before a replacement receives the
request. The readiness probes of `next start` and of A6's `/api/ready` loop
cap each probe at the time they have left and test their deadline again after
the probe: a stalled server can neither extend the limit nor have a late
success accepted. The listener enumeration of that readiness probe is bounded
by the same deadline as the request it precedes, and the remaining time is
recomputed after it, so a slow `lsof` cannot make the request outlive the
limit. The same holds for the two startup waits — `next start`'s listener poll
and A6's ownership wait: each enumeration takes the time its wait has left,
with the time recomputed between the two ports, and a check that used up the
wait is reported as that wait's failure with nothing further sent. Stage T's
upstream-down control also requires the freed upstream port to have no
listener immediately before its request: if another process took the port,
Next would forward the request to it and a 500 would be read as the check's
own, so that check fails and nothing is sent.

Before a built app is started or probed, the check reads that build's own
`.next/routes-manifest.json` and requires every rewrite destination to be one
of the temporary origins it watches: A2's build, A4's (the build A3 made) and
A6's. `next start` forwards to the destination frozen at build time, not to
the port the ownership gate watches, so a revision that ignores
`BACKEND_PROXY_TARGET` or `CANVAS_PROXY_TARGET` would keep its own default —
the developer's backend on port 8000 — and requests would reach it while the
check watched a temporary port. A build whose destinations are not the run's
is reported and never started; the A4 negative control still runs, because the
base revision's two rules do point at the temporary backend (only its canvas
rules are missing, which is the failure the control is for). While A4 starts
and probes its build, both destinations it must not use — the temporary
backend and the runtime canvas target it hands to `next start` — are bound by
tripwire listeners of the run, so no other local process can take either and
receive a forwarded request; a request that still reaches a tripwire fails
`A4 no request reached …` and its answer is never read as the stub's. The
native SWC preflight runs as a supervised child with a finite timeout, with
the sandbox root as its working directory, so a binding that stalls is a
failure of the check within the bound, an interrupt still reaches the cleanup
instead of blocking it, and a binding that writes a relative file writes
inside the throwaway root rather than beside the directory the check was
started from.

A shutdown that leaves a process group present is reported and ends the stage
there: nothing after it runs, so no later step reads build output, removes
`.next` or starts a build beside a process that is still alive. Stage T
validates its private `node_modules` copy before every use — before each
build and before each `next start` — and ends the stage when the copy fails,
so no build or server ever runs from a copy that an earlier one replaced or
linked out of the sandbox. After the transport table stops at a listener
mismatch, no further request goes to that port: the configuration ends and
cleans up instead of attempting the upstream-down probe.

`--stage S` runs these refusals, the early-exit ownership wait, the per-request
ownership gate (including the two-listener gate for a proxied request and the
readiness loop's deadline), the deadline of `next start`'s listener checks with
a stand-in `lsof` that sleeps past it, the upstream-down probe's vacancy check,
the SWC preflight's working directory, the abort of a stage after a failed
shutdown, the pieces stage M adds (the child environment without
`SILICON_NOTEBOOK_ENV_FILE`, the stage's own `.env` accepted only with the hash
it was written with, requests with headers and a body, and the three-listener
gate) and the script's own refused file operations (each after a
simulated swap, with a sentinel outside the sandbox) against throwaway
repositories only; it reads nothing from `--notebook`. It also runs the real
entry script on a throwaway repository whose `frontend` is a regular file and
checks that it ends with the documented refusal (exit 2, naming the ancestor,
no stack trace). An interrupted run still prints the stage summary and exits 130.
The signal handlers stay installed: a further signal while the cleanup runs is
a no-op, so a second Ctrl-C cannot terminate the run without its summary, and
a hard stop ends a shutdown that has not finished 60 seconds after the first.

The offline guard is a Node preload. It also survives npm: it is passed as
npm's `node-options` and the script shell is pinned through the environment,
which outranks any `.npmrc` of the revision. Every stage first proves this
with throwaway npm packages (a project or nested `.npmrc` with `node-options`,
a `.npmrc` `script-shell`, `npm exec`). The preload records each process that
loads it, and stages T and A fail when the process that did the work (each
`next build`, each `next start`, the A6 frontend) is not in that record, so a
script that removes the guard by other means is a failure, not a silent pass.
Long-running children are started under a small supervisor that leads their
process group until shutdown, so a group is only ever signalled while it is
provably this run's. A shutdown first has the supervisor acknowledge that it
has spawned the command or cancelled the launch, so nothing can start after a
stop (an interrupt during a start included); the protocol is described at the
top of `scripts/lib/notebook-integration/sandbox.mjs`. Stage S exercises it
(a stop right after a start, during a held-back launch, after the start, an
unanswered stop, a refused release), along with the transport table's
ownership check before every probe, the A6 check that both service PIDs are
gone, A1's exact manifest list and the handling of a failing `lsof`.

### Stage M: a managed start in a silicon-notebook clone

Stage M proves on real processes that a silicon-notebook built with the
`/canvas` rewrite and configured with the auto-canvas plugin starts this
checkout's canvas as a managed companion service, and that two notebook users
get separate, authenticated canvases through the notebook's origin.

```bash
NB=<notebook checkout>
node scripts/notebook-integration-check.mjs --stage M --notebook "$NB" \
  --ref "$(git -C "$NB" rev-parse origin/master)" --python <interpreter>
```

It needs: `pnpm build` and `pnpm build:notebook-editor` in this checkout (it
refuses with exit status 2, before allocating anything, when
`apps/server/dist/cli.js`, `apps/editor/dist/index.html` or
`apps/editor/dist-notebook/index.html` is missing); a Python 3.13 or newer
with silicon-notebook's backend dependencies (`--python`); a revision of
silicon-notebook with the `/canvas` rewrite (`--ref`, a full commit SHA works
even when only a remote-tracking branch of the checkout holds it); and a
PostgreSQL role that may create databases on the server
`AUTO_CANVAS_TEST_DATABASE_URL` names (default `postgresql:///auto_canvas_test`)
and log in over loopback without a password. A run takes about three
minutes (five launches of the clone and two `next build`s; the sign-out check
alone waits up to the canvas's 60-second token window).

What it does, in a sandbox like stage A's (the clone, the modules copy, the
refusals and the builds are stage A's steps): it creates the databases
`auto_canvas_it_m_<12 hex>` (the canvas) and `…_s`, writes the clone's `.env`
(literal lines: SQLite for the notebook, the canvas URL, the plugin on
`PYTHONPATH`, `EXTENSIONS_CONFIG`, a random administrator password; the clone
refusals accept exactly this file, by its hash) and an extensions TOML derived
from the shipped examples, runs `init-db.sh`, and builds the clone with
`BACKEND_PROXY_TARGET` and `CANVAS_PROXY_TARGET` on ports of the run. Every
notebook and canvas process gets the sandbox's environment without
`SILICON_NOTEBOOK_ENV_FILE`. Then, each with a fresh `.local`:

- **managed** (M2–M9): `npm run start` exits 0 with the service ready; the
  canvas port is held by `node apps/server/dist/cli.js --require-canvas-database`
  with the offline guard loaded, outside the launcher's group; through the
  frontend the canvas is ready, refuses an anonymous API request and serves
  the notebook editor; two registered users each create, save and reopen
  projects the other cannot see; a signed-out user is refused within the
  canvas's 60-second token window while the other is not; the stop (the
  launcher's group, then the clone's `extension_services.py stop`) leaves no
  companion process and no listener;
- **external** (M-ext): the stage starts `serve.sh` itself and the notebook
  only checks it; then a standalone canvas with a seeded project takes the
  canvas port, and no request through the notebook, with or without a token,
  answers JSON or shows that project or its user;
- **partial and full rollback**: without the plugin entry but with the build
  target (M-a), `/canvas` answers 500 and the notebook works; with the entry
  but a build without the target (M-b), the canvas runs and answers on its own
  port while `/canvas` is 404; with both removed (M-full), `/canvas` is 404
  and `/` is 200.

Requests through `/canvas` are sent only while the frontend, the notebook
backend and the canvas are the recorded listeners (`canvasPid: null` in the
rollbacks: the canvas port must have no listener). The companion processes
leave the launcher's process group by design, so the stage never relies on
the group for them: it stops them with the clone's `extension_services.py
stop` and, in its cleanup, signals by pid only the supervisor, worker and
canvas processes it recorded that still have the start time and command line
it recorded — never by port or name, and never with silicon-notebook's `npm run
stop`, which kills by port. The cleanup (that stop, the stage's process groups,
the recorded pids, then `DROP DATABASE … WITH (FORCE)` and a check that both
databases are gone) runs at the end of the stage and, after an interrupt,
before the sandbox is removed; the run then exits 130. No token, password or
database URL appears in the output.
