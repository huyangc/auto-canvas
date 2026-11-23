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
launch. `--stage S` runs these refusals, and the early-exit ownership wait,
against throwaway repositories only; it reads nothing from `--notebook`. An
interrupted run still prints the stage summary and exits 130.

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
