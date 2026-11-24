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
that build their own dependencies. Files named `*.slow.test.ts` (also `.tsx`
or `.mjs`) hold expensive full-search quality benchmarks and are excluded
from the default Vitest projects, `pnpm check` and CI. `pnpm test:slow` opts
into the `slow` project and runs only those files. For auto-layout changes,
Opus must rerun `pnpm test:slow` locally and post its results as required PR
review evidence. Held-out drawings retain quick-mode validity, routing safety
and Net/terminal preservation checks in the default suite; their unchanged
full-search checks, including the T013 crossing limits, run in the slow suite.

`pnpm test:e2e:local` runs browser workflows;
run `pnpm setup:e2e` once per machine or Playwright version when needed.
`pnpm test:desktop-build`, `pnpm mcp:package` and `pnpm headless:package` check
local packaging. Golden and performance scripts remain available for changes
that affect their contracts.

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

```bash
node scripts/notebook-integration-check.mjs --stage T --notebook <notebook checkout>
node scripts/notebook-integration-check.mjs --stage A --notebook <notebook checkout> \
  --ref <branch or commit> --base <commit without the change> --python <interpreter with the backend dependencies>
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
shutdown and the script's own refused file operations (each after a
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
