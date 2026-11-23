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
itself resolves, so a `host`, `socket`, `db`, `dbname` or `database` parameter
is refused — and
`AUTO_CANVAS_API_URL` is an `http://127.0.0.1:<port>` origin, and never uses
ports 3000, 8000 or 4310. `node scripts/notebook-e2e-fixture-check.mjs` checks
the fixture's refusals and cleanup (after `pnpm build`), and
`scripts/notebook-e2e-selection-check.mjs` checks which tests each run
collects from `playwright test --list --reporter=json`.

`scripts/standalone-build-evidence.mjs --port <n> --database <url> [--run "<command>"]`
is the standalone build evidence, for a disposable checkout only (it reads the
build output there, and the builds that precede it overwrite
`apps/editor/dist`): it starts, as its own child, the server the launcher
runs (`node apps/server/dist/cli.js` with `EDITOR_ROOT=apps/editor/dist`) on a
throwaway schema, checks that every script, module preload and stylesheet
reference of the standard output is a `/assets/` path the server answers with
the content type its use needs (a JavaScript MIME type, `text/css`), and with
`--run` runs a command (the Agent browser cases) against that server. It
refuses a checkout with `.env` files, ports 3000, 8000 and 4310, a bound port
and any database but `auto_canvas_test…` (the name `pg` resolves, without a
`host`, `socket`, `db`, `dbname` or `database` parameter), and stops
everything it started on every exit path: the run's processes by its process
group, by their parents, and by a per-run marker in their environment.
`node scripts/standalone-build-evidence-check.mjs` checks its
refusals and cleanup (after `pnpm build` and `pnpm build:notebook-editor`).

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
