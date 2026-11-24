# T175 — Faster default test suite

- Branch: `task/T175-test-speed`
- Base: `main` at `af05b80`
- Status: approved
- Plan review: self-checked against the code (the owner did not ask for a codex plan review)

## Goal

`pnpm test:local`, which is also the CI step that takes longest, finishes much
sooner without losing any assertion that is not a duplicate. There are four
changes:

1. The Vitest worker count comes from `vitest.config.ts` rather than a
   hard-coded `--maxWorkers=2`: half the cores locally, so up to three task
   lanes can run side by side, and every core on CI.
2. The few test files that become the critical path once more workers run are
   split by case, so their cases run on different workers.
3. CI's `format:check` checks only the files a pull request changes.
4. Four expensive full-search checks move unchanged into `*.slow.test.ts`,
   and the default suite keeps a cheaper check of the same invariants. One
   duplicate determinism replay is dropped.

## Context

Baseline, measured 2026-11-23 on an 18-core Mac after `pnpm build` (timing
JSON is in the main session's `tmp/test-timing/`; it is gitignored and not
copied here):

| Run | Wall | Result |
| --- | --- | --- |
| `vitest run --maxWorkers=2` (today's `test:local`) | 165 s | 1869 files, 9050 tests: 8934 passed, 116 skipped (simulator-dependent), 0 failed |
| `vitest run --maxWorkers=4` | 93 s | same |
| `vitest run` (Vitest default) | 64 s | same |
| `pnpm exec vitest list --mode slow --project slow` | — | 8 slow tests |

CI (`.github/workflows/ci.yml`, `ubuntu-latest`; the repository is public, so
the runner has 4 vCPUs): `pnpm test:local` takes 5.5–9 min,
`format:check` 24–40 s, and `lint` 34–56 s (runs 45343012852 and 45344424108).

The slowest default files at 2 workers (seconds of file time):
`packages/auto-layout/test/current-source-tail.test.ts` 42.6 (5 tests: the
two `keeps the inputs outside both banks…` cases at 12.5 and 12.3 s, the two
`draws the two source resistors…` cases at 8.8 and 6.5 s);
`scripts/launcher.test.mjs` 21.7; `corpus.test.ts` 20.8; `held-out.test.ts`
18.2; `quality.test.ts` 15.3; `differential-branches.test.ts` 15.0;
`stages.test.ts` 10.3 (the 120-device case alone is 8.9 s); `layered.test.ts`
7.4 (the 85-device case is 4.5 s). With every worker running,
`current-source-tail.test.ts` (56 s) sets the whole run's wall time, and
corpus, held-out, quality and differential-branches each take 30–35 s.
`packages/auto-layout` accounts for 197 of the 296 s of file time.

Worker count:

- `package.json:84` `"test:local": "vitest run --maxWorkers=2"` and `:85`
  `"test:slow": "vitest run --mode slow --project slow --maxWorkers=2"`. The
  flag came in with the upstream import (`9f2d88e`), and no commit gives a
  reason for it. `:98` `agent-docs:check` and `scripts/promote-example.mjs:115`
  pass file arguments to `test:local`, which keeps working. `:101` `check`
  calls `test:local`.
- `vitest.config.ts` defines the `modules` (`isolate: false`), `isolated` and
  opt-in `slow` projects. Vitest is 4.1.10. No other file sets `maxWorkers`.
- `.github/workflows/ci.yml:55` carries a comment "vitest.config.ts excludes
  known inherited failures when CI is set". No such code exists in
  `vitest.config.ts`, so the comment is stale.
- `docs/workflow.md#并行任务` allows up to three parallel task lanes on one
  machine, so the local default must leave room for the others.
- Server tests (`apps/server`, 19 files, 249 tests) use PostgreSQL. They passed
  under full parallelism in the baseline run.

Formatting:

- `scripts/format.mjs:19-50` already checks only changed files when
  `FORMAT_BASE_SHA` is a 40-hex SHA that is an ancestor of `HEAD`. It falls
  back to a full check on an invalid or empty value, a missing merge base, or
  any change to the formatting configuration. `scripts/format.test.mjs:40`
  tests this.
- `ci.yml:38` uses `actions/checkout@v4` with the default `fetch-depth: 1`.
  On `pull_request` the checkout is the merge commit `refs/pull/N/merge`. Its
  first parent is normally `github.event.pull_request.base.sha`, so
  `fetch-depth: 2` makes the base an ancestor. With depth 1 the script falls
  back to a full check, which is safe but saves nothing.

Full-search tests (step 4):

- `current-source-tail.test.ts:16` `it.each([false, true])` "draws the two
  source resistors joining above the current source (reverse=%s)" and `:125`
  `it.each(["feedback", "biased-follower"])` "keeps the inputs outside both
  banks and the tail below a %s pair" call `planAutoLayout(…, { presentation:
  "netlist" })` with the default search and assert exact geometry, junction
  tees, `equivalentTerminals` and crossings. The `:266` R170 case (2.4 s) stays
  where it is.
- `stages.test.ts:255` "is deterministic for a synthetic 120-device document
  through the public portfolio": plans twice, expects `candidates` 0.
- `layered.test.ts:155` `it.each([60, 85])` "accepts a synthetic %i-device
  document deterministically within the large search budget": plans twice and
  expects `candidates <= (count > 80 ? 0 : 8)`. The search budget changes at
  more than 40 instances (`packages/auto-layout/src/auto-layout.ts:186`).
- `differential-branches.test.ts:474` `it.each([false, true])` "keeps both
  source-degenerated branches on their own side when all internal names and
  order change (perturb=$0)" goes through `checkSingleStage` with
  `degeneration: true`.
- Duplicate determinism: `quality.test.ts:180-200` (R22, per corpus fixture)
  asserts `expect(planAutoLayout(document, resolver)).toEqual(plan)`, and
  `corpus.test.ts:61-75` asserts the same default re-plan
  (`JSON.stringify(plan.edits)` against a fresh `planAutoLayout`) for the same
  `corpus-cases.json`. One full re-plan per fixture is redundant.
- The precedent is T066 (`802e4fd`). `held-out.slow.test.ts` holds the
  unchanged full-search held-out checks, and `held-out.test.ts` keeps validity
  and Net checks with `search: { seed: 1, evaluations: 0 }` (quick planning).
  `docs/testing/README.md` ("Local validation") describes the slow suite, and
  Opus reruns `pnpm test:slow` for auto-layout changes.

Splitting (step 2):

- `corpus.test.ts` and `quality.test.ts` share plans per file through
  `createCorpusPlans()` (`corpus-plans.ts`). "Each test file owns its cache",
  so splitting a file by case subset still plans each fixture once per file.
  Do not share one cache across files.
- The `modules` project shares one module registry per worker
  (`isolate: false`). A new file that calls `vi.mock` and friends is moved to
  the `isolated` project automatically by the regex in `vitest.config.ts`.
  `vi.spyOn`, which `quality.test.ts` uses, does not move a file.

## Scope

Owned paths:

- `package.json` (`test:local`, `test:slow` scripts only)
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `packages/auto-layout/test/current-source-tail.test.ts`, new
  `current-source-tail.slow.test.ts`
- `packages/auto-layout/test/stages.test.ts`, `layered.test.ts`,
  `differential-branches.test.ts`, and new `*.slow.test.ts` files beside them
- `packages/auto-layout/test/quality.test.ts`, `corpus.test.ts`,
  `held-out.test.ts`, and new split files or shared case helpers beside them
- `docs/testing/README.md` (local validation paragraph)
- `tasks/T175-test-speed/`

Out of scope:

- Product code under `packages/*/src` and `apps/*/src`.
- `scripts/launcher.test.mjs`. Its processes and ports make splitting or
  running it concurrently a separate investigation.
- `lint`, `typecheck`, `deadcode`, and Playwright browser tests.
- Removing or weakening any assertion other than the one duplicate replay
  named in step 5.

## Steps

1. **Worker count.** In `vitest.config.ts`, set `maxWorkers`, at the level
   that Vitest 4.1 applies to every project (check the Vitest 4 docs or
   source and say in the report which level you used and why). Use
   `os.availableParallelism()` when `process.env.CI` is set, otherwise
   `Math.max(2, Math.floor(os.availableParallelism() / 2))`. Add a comment
   saying why, citing the three-lane rule. Remove `--maxWorkers=2` from
   `test:local` and `test:slow` in `package.json`. An explicit
   `--maxWorkers` on the command line must still override the config. Show
   that it does by running `pnpm exec vitest run packages/derived --maxWorkers=1`
   and recording its output. Delete the stale comment at `ci.yml:55`.
2. **CI format check.** In `ci.yml`, set `fetch-depth: 2` on the checkout, and
   give the `pnpm format:check` step
   `env: FORMAT_BASE_SHA: ${{ github.event.pull_request.base.sha }}`. On
   `push` the value is empty, and the script runs a full check. Investigate:
   after the PR's CI run, record from the step log whether it printed
   `Formatting changed files: <n>` or `Full formatting check: <reason>`. If it
   fell back, fix the depth or fetch the base commit, and record the fix.
3. **current-source-tail.** Move both `it.each` blocks at `:16` and `:125`
   unchanged (same titles, assertions and timeouts) into
   `current-source-tail.slow.test.ts`. In the default file, add for those four
   inputs a quick-planning case (`search: { seed: 1, evaluations: 0 }`, still
   with `presentation: "netlist"`) that asserts no error diagnostics, that the
   edits replay through `preview`, `equivalentTerminals`, and
   `auditRouting(...).unsafeProblems` empty. Investigate: which of the
   original geometry assertions (axis, tee, crossings) also hold under quick
   planning. Keep any that do in the default case, and list them in the
   report. Share the document builders between the two files through a
   helper module (`current-source-tail-cases.ts`), not by copying them.
4. **Large documents and perturbation.** Use the same pattern as step 3:
   - Move `stages.test.ts:255` (120 devices) unchanged to
     `stages.slow.test.ts`. In the default file, add the same determinism and
     input-immutability check on a 40-device chain with the default search,
     and name the size in the title.
   - Move the `85` case of `layered.test.ts:155` unchanged to
     `layered.slow.test.ts`, and keep `60` in the default `it.each`. The
     `count > 80` branch (`candidates` 0) is then covered only by the slow
     suite. The owner accepted this.
   - Move `differential-branches.test.ts:474` (`perturb` false/true) unchanged
     to `differential-branches.slow.test.ts`. In the default file, add a
     quick-planning version of the same two inputs that asserts the checks in
     `checkSingleStage` that hold without full search. Investigate which hold,
     and report them. If `checkSingleStage` needs an options argument for
     this, add one inside the test file.
5. **Duplicate replay.** Delete only the line
   `expect(planAutoLayout(document, resolver)).toEqual(plan);` from the R22
   case in `quality.test.ts:185`. Update that case's timeout comment to match
   (it no longer plans twice), and add a comment that points to the
   determinism check in `corpus.test.ts`. Keep every other R22 assertion.
6. **Split the long poles.** Re-measure with
   `pnpm exec vitest run --reporter=json --outputFile=tmp/t175/after.json`,
   using the config's worker count. Split by case subset each default
   `packages/auto-layout/test` file that still takes more than 15 s of file
   time and whose time is spread over independent `it.each` cases (expected:
   `corpus.test.ts`, `quality.test.ts`, `held-out.test.ts`; check the rest).
   Keep the test titles, and keep one `createCorpusPlans()` cache per file.
   Put each file's shared helpers and expectations (for example the
   `targets` table in `corpus.test.ts`) in a non-test module beside it, so
   each split file holds only its subset selection plus the `it.each`.
   Re-measure and repeat until no auto-layout default file takes more than
   15 s, or until a file has no further independent cases to split, and
   explain any file that remains above 15 s.
7. **Docs.** In `docs/testing/README.md` "Local validation", explain that
   the worker count comes from `vitest.config.ts` (half the cores locally,
   all on CI, overridable with `--maxWorkers`). Name the newly slow-only
   checks next to the existing held-out sentence. Run `pnpm docs:check`.

## Acceptance

Run from the repository root, in lane 1 (`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`):

```bash
pnpm build                                   # expected: exit 0
pnpm format:check && pnpm docs:check         # expected: exit 0
pnpm typecheck && pnpm lint                  # expected: exit 0, no new warnings in touched files
pnpm deadcode                                # expected: exit 0 (new helper modules are imported)
/usr/bin/time -p pnpm test:local             # expected: exit 0; 0 failed; wall well under the 165 s baseline (record it)
pnpm test:slow                               # expected: exit 0; 8 + every moved test (8 + 2 + 2 + 1 + 1 + 2 = 16 tests if no case is renamed)
pnpm exec vitest run packages/derived --maxWorkers=1   # expected: exit 0; the CLI flag is honoured
pnpm exec vitest run --maxWorkers=2 --reporter=json --outputFile=tmp/t175/after2.json   # expected: exit 0; record wall and per-file times
```

Behavioral checks:

- Test accounting in the report: the default suite's test count before
  (9050) and after, the slow count before (8) and after. Every moved test
  appears once in the slow suite with its original title, and every added
  default case is named. A split file's tests appear exactly once across its
  parts. Show this with a `vitest list` diff of titles, sorted.
- `git diff` of the moved blocks shows them unchanged except for imports and
  helpers moved to shared modules.
- The report has a timing table: before/after wall at the config default, at
  `--maxWorkers=2`, and the five slowest files after.
- On the PR's CI run: `test:local` and `format:check` step durations compared
  with 5.5–9 min and 24–40 s, plus the format step's log line (step 2).

## Notes for the implementer

- The owner decided the scope: all four changes; local workers at half the
  cores and CI at every core; exactly the four slow moves above plus the one
  duplicate replay. Do not move or delete anything else.
- The T066 rule applies: moved checks are copied verbatim, and the default
  suite keeps validity, Net and routing-safety checks for the same inputs.
- Do not loosen timeouts to make things pass. If a test becomes flaky under
  more workers, report it with the failing output rather than lowering the
  worker count silently.
- Commit message trailer: `Test-Impact: tests-updated`.
