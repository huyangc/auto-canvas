# T032 — Auto-layout: faster routing with identical results

- Branch: `task/T032-auto-layout-routing-speed`
- Base: `main` at `65bd206` (T028 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. T030 (lane 2) and
  T031 (lane 3) run in other worktrees; T031 owns `auto-layout.ts`, `place.ts`,
  `stages.ts`, `refine.ts`, `search*.ts` and `partition*.ts`, T030 owns `units.ts`,
  `fingerprint.ts` and `partition-reconcile.ts`. This task touches none of them. No
  browser test is expected.
- Status: approved

## Goal

Three quarters of auto-layout's planning time is routing, and the largest single part
of that is a brute-force clearance check. Make routing faster **without changing one
edit or diagnostic**: the same plans, sooner. The time saved is what the next task
(rip-up inside every candidate plan) will spend.

Opus profiled quick planning of the 18 dev human drawings on `65bd206` in one process
(`node --cpu-prof`, 80.5 s; `tmp/t032/prof/`, summaries by `tmp/t032/analyze-prof.mjs`
and `tmp/t032/callees.mjs`):

| Inclusive time                                         | Share |
| ------------------------------------------------------ | ----: |
| `routeDocument` (`packages/auto-layout/src/route.ts`)  | 74.5% |
| `planRouteNet` → `planNetTree` → clearance `path`      | 34.9% |
| clearance `conflict` (`route-clearance.ts:438`)        | 28.8% |
| `preview` → `executeTransaction` inside `routeGroup`   | 22.8% |
| `preview` in `buildPlan` (whole-list replays)          | 10.7% |
| `deriveNetConnectivityContext` per `planRouteNet` call |  4.4% |
| `placeDocument`                                        |  3.8% |
| `auditRouting` + `routedScore`                         |  2.9% |

Opus then prototyped two exact changes behind an environment toggle on a scratch copy of
`65bd206` (`tmp/t032/prototype-speed.diff`) and compared, document by document, the
SHA-256 of `[edits, diagnostics]`:

| Prototype on the 33 human drawings            | Result                          |
| --------------------------------------------- | ------------------------------- |
| Documents with identical output               | 33 of 33                        |
| Planning time, one process, both runs at once | 181.9 s → 110.2 s, **0.606×**   |
| Largest document (103 instances)              | 22.8 s → 9.6 s                  |
| `pnpm auto-layout:eval --jobs 10`, sequential | 0.75× under rising machine load |

After this task the product code does the same, with tests that prove the equivalence,
and without any toggle.

## Context

Opus verified everything below on `65bd206`. Paths are relative to the repository root.

### 1. The clearance check

`packages/edit-engine/src/route-clearance.ts:266` `createRouteClearance(document,
resolver, context, own)` builds, once per routed target:

- `pins` (`:318`, filled at `:384`–`:408`): every visible pin's contact point and grid landing;
- `bodies` (`:328`, filled at `:337`–`:383`): per placed instance its ink interior rectangle (`interior`,
  shrunk by `TOLERANCE = 1e-3`) and its drawn straight `strokes`, already transformed
  to document coordinates;
- `routes` (`:410`–`:421`): every Route of another Net (not `sameSignal`) with its
  centerline `points`.

It returns `path(from, to)` and `conflict(points, ends)`.

`conflict` (`:438`–`:610`) decides whether a fixed path would read as a false
connection. Per call it loops, in this order, and returns the first message:

1. `:489` every foreign pin × every path segment: `pointOnSegment`;
2. `:529` every body × every path segment: `clip` against the interior, then every
   stroke through `runsAlong`, then every stroke through `contactPoints`;
3. `:568` every foreign Route: rebuilds `routeSegments` from `route.points` (`:575`),
   then every path point against every Route segment, then every Route point against
   every path segment;
4. `:605` `own.blockedPoints`.

`path` (`:614`) enumerates up to a few hundred L- and Z-shaped candidates (`:707`–`:733`),
compiles and costs all of them (`:734`), sorts by cost and calls `conflict` on each until
one is clear (`:802`). So `conflict` runs many times per wire, each time over every body
stroke and every foreign Route of the Document, although a candidate path is near only a
few of them. In the profile the stroke loops alone are 21% of all planning time.

Every check in loops 1–3 can fire only when the two shapes come within `TOLERANCE`
(`1e-3`) of each other: `pointOnSegment` (`packages/derived/src/segment-geometry.ts:131`,
epsilon far below `1e-3`), `clip` (the segment enters the interior rectangle),
`runsAlong` (`:60`, collinear within `TOLERANCE` and overlapping), `contactPoints`
(`:79`, an end within `TOLERANCE` of the other segment, or a proper crossing). A
bounding-box test with a pad larger than `TOLERANCE` therefore never rejects a pair
that could conflict.

Callers: `route-net-planner.ts` (`planRouteNet`, used by auto-layout, the editor and the
Agent), `wire-batch-planner.ts` (`keepClear`), `stretched-route-clearance.ts`. There is
no `route-clearance.test.ts`; the messages are asserted through
`wire-batch-planner.test.ts`, `route-net-planner.test.ts`, `route-options.test.ts`,
`group-mirror.test.ts` and `cell-selection-deletion.test.ts`.

### 2. The repeated preview

`packages/auto-layout/src/route.ts` `routeGroup` (`:424`): a signal Net with at least
three pins tries the tree and two median trunks (R39). Each candidate is planned
(`planRouteNet`, `:529`), previewed (`preview(working, resolver, candidate.edits)`,
`:550`) and audited; the best is kept (`:567`). After the loop the winner's edits are
previewed **again** (`:609`) to advance `working`. `preview`
(`packages/auto-layout/src/transaction.ts:8`) is a full dry-run transaction on the whole
Document. The second preview of the winner repeats the first exactly: same Document,
same edits.

### 3. Baselines Opus prepared (git-ignored `tmp/t032/`)

- `tmp/t032/paired-base/`: a `git archive` of `65bd206`, installed and built, with
  `tmp/human-cases` linked. Use it for every baseline run.
- `tmp/t032/ab-run.mjs <out.json>`: run from the repository root; plans the 33 human
  drawings, the 9 corpus documents and the 7 held-out documents one after another with
  the build under `AB_ROOT` (default: the current checkout) and writes per-document
  hashes of `[edits, diagnostics]` and planning times. No case id is written.
- `tmp/t032/ab-compare.mjs <base.json> <result.json>`: prints how many documents are
  identical and the time ratio; exits 1 when any differs.
- `tmp/t032/base-hashes.json`: the 49 baseline hashes from `tmp/t032/paired-base/`.
- `tmp/t032/prototype-speed.diff`: the prototype. It shows which filters are exact; its
  environment toggle and its type cast in `route.ts` must not be reproduced.

### 4. Binding constraints

- **Identical results.** For every Document, `planAutoLayout` returns the same edits and
  diagnostics as on `65bd206`, byte for byte. For the editor and the Agent, `conflict`
  and `path` return the same value for every input, including which conflict is reported
  first and its exact wording.
- **No switches.** No environment variable, global flag or module-level cache changes
  behaviour. The one new option is an internal `exhaustive` flag used only by tests.
- **Human cases.** They stay in git-ignored `tmp/human-cases/`. Never commit any case,
  excerpt, case id or id-keyed data; nothing in CI or `pnpm test:local` depends on them.
- **Frozen code.** Everything under `packages/edit-engine/src` except
  `route-clearance.ts` and its new test; `packages/model`, `packages/derived`, `apps/`;
  in `packages/auto-layout/src` everything except `route.ts`. In particular the
  transaction (`transaction*.ts`), `route-net-planner.ts` and `wire-batch-planner.ts` do
  not change.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/edit-engine/src/route-clearance.ts`
- new `packages/edit-engine/src/route-clearance.test.ts`
- `packages/auto-layout/src/route.ts` (the preview reuse of step 2 only)
- `packages/auto-layout/test/routing.test.ts` (one added test)
- `docs/specs/auto-layout.md` (one sentence in R87)

Out of scope (do not change):

- everything under "Frozen code" above, `scripts/**`, every other test file;
- `pnpm-lock.yaml` and every package's dependencies.

## Steps

1. **Bounding-box prefilter in `conflict`.** In `route-clearance.ts`:
   - give each `bodies` entry a padded axis-aligned box over its interior corners and all
     its stroke endpoints; give each `routes` entry its segment list (built once) and a
     padded box over its points; the pad is one named constant, at least ten times
     `TOLERANCE`;
   - in `conflict`, compute the padded box of the whole path and of each path segment
     once per call. Skip a pin whose points all lie outside the path box. Skip a body
     when the path box misses its box; inside a body, skip a segment whose box misses the
     body's box. Skip a Route when the path box misses its box; use the prebuilt segment
     list instead of rebuilding it. Loop order and every message stay exactly as they
     are, so the first conflict reported is the same.
   - add `exhaustive?: boolean` to the `own` options: when true, no prefilter is applied
     (the loops run as on `65bd206`). Document it as a test aid. Nothing in product code
     sets it.
   - Tests (new `route-clearance.test.ts`, hand-built Documents with built-in symbols):
     - **differential sweep.** A fixture with at least six placed instances covering
       rotations 0/90/180/270 and both mirrors, a symbol with diagonal strokes (an op-amp
       or a source), two foreign Routes with bends, and pins on and off the grid lines.
       For every horizontal and vertical segment between lattice points (step = the
       Document grid) inside the fixture's bounds plus a margin, for a few hundred
       two-bend paths, and for at least twenty diagonal segments: `conflict` from a
       default clearance equals `conflict` from an `exhaustive` one, as exact strings.
       Repeat with `ends` set to a terminal for segments that start on that terminal's
       landing (the own-pin exemptions). Assert that the sweep saw each message family at
       least once (`passes over pin`, `passes through`, `runs along`, `touches … drawing`,
       `sits on` or `touches Route`), so it is not vacuous.
     - **`path` equality.** For at least thirty endpoint pairs of the fixture (pin to
       pin, pin to point), `path` from both clearances is deeply equal, with and without
       `crossingCost`.
     - **boundaries.** A segment lying exactly on a body's outline; a segment ending
       exactly on a stroke endpoint; a path point exactly on a foreign Route's end; a
       segment `TOLERANCE / 2` away from a stroke and one `2 × TOLERANCE` away: each gives
       the same result with and without the prefilter, and the expected message or null
       is asserted literally.
2. **Reuse the winner's preview.** In `routeGroup`, keep the previewed Document of the
   best trunk candidate and use it instead of previewing the winner's edits a second
   time. When the winner was taken without a preview (the single-candidate and
   complete-rail-trunk shortcuts at `:543`–`:549`), preview as today. Type it without a
   cast.
   - Test (`routing.test.ts`): on the R39 fixture of "R39 chooses a vertical signal trunk
     …" (`:939`), spy on `preview` in `../src/transaction.js` and assert the Net with
     three candidates is previewed once per candidate and not once more; the existing
     assertions of that test still hold in the new one.
3. **Spec.** In `docs/specs/auto-layout.md` R87, after "Collect foreign segments once per
   clearance…", add: "Clearance checks skip parts and foreign Routes whose padded bounds
   miss the path; the result of every check is unchanged."
4. **Investigate and report.**
   - Identity: `node tmp/t032/ab-run.mjs tmp/t032/result-hashes.json` then
     `node tmp/t032/ab-compare.mjs tmp/t032/base-hashes.json tmp/t032/result-hashes.json`
     must print `different 0` for 49 documents. If any document differs, stop and find
     the cause; do not adjust the comparison.
   - Time, one process: run the baseline and the result at the same moment
     (`AB_ROOT=tmp/t032/paired-base node tmp/t032/ab-run.mjs tmp/t032/base-rerun.json` in
     one shell, the result run in another) and report both totals, the ratio and the five
     largest documents.
   - Time, evaluation: `pnpm auto-layout:eval tmp/human-cases --jobs 10` in
     `tmp/t032/paired-base/` and here, one after the other, with
     `pgrep -fl 'auto-layout-eval|vitest'` empty before each and the load recorded;
     report summed and slowest planning time. Copy the reports to
     `tmp/t032/paired-base-quick.json` and `tmp/t032/result-quick.json`.
   - Investigate: profile the result (`node --cpu-prof --cpu-prof-dir=tmp/t032/prof-after
tmp/t032/profile-run.mjs dev`, summarized with `tmp/t032/analyze-prof.mjs`) and list
     the five largest remaining costs with their share. Do not fix them in this task.

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/edit-engine packages/auto-layout   # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'route-clearance|auto-layout'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
node tmp/t032/ab-run.mjs tmp/t032/result-hashes.json                                   # expected: 49 documents
node tmp/t032/ab-compare.mjs tmp/t032/base-hashes.json tmp/t032/result-hashes.json     # expected: exit 0, "different 0"
pnpm auto-layout:eval tmp/human-cases --jobs 10      # expected: exit 0, 33 completed
git status --short packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent scripts pnpm-lock.yaml package.json   # expected: empty
git diff --stat 65bd206 -- packages/edit-engine/src ':!packages/edit-engine/src/route-clearance.ts' ':!packages/edit-engine/src/route-clearance.test.ts'   # expected: empty
git diff --stat 65bd206 -- packages/auto-layout/src ':!packages/auto-layout/src/route.ts'   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/'   # expected: no output
```

On `65bd206`, `pnpm deadcode` exits 1 for findings outside these paths; only the filtered
output counts. Every other command above passes on `65bd206`.

**Targets.**

| Measure                                                       | Required                    |
| ------------------------------------------------------------- | --------------------------- |
| Documents with identical `[edits, diagnostics]`               | 49 of 49                    |
| Planning time, one process, baseline and result run together  | ≤ 0.70 × baseline           |
| Planning time, `--jobs 10` evaluation, paired sequential runs | ≤ 0.85 × baseline           |
| Existing edit-engine and auto-layout tests                    | pass unchanged, none edited |

## Notes for the implementer

- **Exactness first.** If a filter cannot be shown exact, leave it out and say so. A
  faster planner that changes one message is a failure of this task.
- **Order is part of the contract.** The first conflict found decides the refusal text
  the Agent reads. Filters only skip pairs; they never reorder loops.
- **The pad.** Derive it from `TOLERANCE` in one place and say in a comment why a box
  test with that pad cannot hide a conflict.
- **`exhaustive` is for tests only.** Do not thread it through `planRouteNet` or
  `planWireBatch`; tests call `createRouteClearance` directly.
- **No other optimisation.** Sharing a connectivity context between candidates, changing
  how many previews run elsewhere, or touching the transaction are out of scope; report
  what the profile shows instead.
