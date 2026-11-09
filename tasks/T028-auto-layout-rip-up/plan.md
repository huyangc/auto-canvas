# T028 — Auto-layout: rip-up and reroute for fewer crossings

- Branch: `task/T028-auto-layout-rip-up`
- Base: `main` at `078f407` (T025 merged)
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. T026/T027 run on
  lane 2 in another worktree and own `src/partition*.ts`, `src/place.ts`,
  `src/stages.ts`, `src/types.ts`; this task does not touch those. No browser test is
  expected.
- Status: approved

## Goal

Auto-layout routes Nets one after another in a fixed order (R12, R13). A Net sees only
the Nets routed before it: R87's crossing cost steers it around them, but nothing ever
revisits an early Net once later Nets have been drawn around it. On the 33 third-party
human drawings the planner draws 624 crossings in quick mode where the humans draw 122.
Rip-up and reroute is the standard remedy in sequential routers: after the first pass,
take the Nets that carry crossings, remove each one's wires and route it again against
everything else that now exists, keeping the new routing only when the drawing gets
strictly better.

Opus prototyped exactly that in a scratch copy of `078f407` (`tmp/t028/prototype-route.diff`,
not for reuse: it rebuilds the working Document per candidate and runs on every candidate
plan). Two passes over the Nets with crossings, applied to every plan the quick path
evaluates:

| Quick mode, 33 of 33 complete |               dev |               val |
| ----------------------------- | ----------------: | ----------------: |
| Crossings, `078f407` → proto  |         287 → 246 |         337 → 305 |
| Bends                         |         371 → 394 |         400 → 392 |
| Floating pins                 |             0 → 0 |             1 → 1 |
| Missing connections           |             0 → 0 |             1 → 1 |
| Wire length                   | 127,850 → 129,390 | 148,260 → 149,350 |
| Readability                   |   0/32/8 → 0/33/7 |   1/31/6 → 1/31/6 |
| Pairs mirrored (T025)         |     58/58 → 58/58 |     29/29 → 29/29 |
| Planning time                 |              2.8× |              3.6× |

23 of 33 drawings lose crossings, none gains. The time is the cost of running it on
every candidate of R58's refinement; applied once to the final plan the work is a
small fraction of planning. After this task:

- `routeDocument` can rip up and reroute (R95), bounded, deterministic, with strict
  acceptance;
- the quick path and the offline search apply it to their finalists only (R96);
- quick-mode dev crossings fall by at least 10% with no new floating pin or missing
  connection and planning time within 1.25× of a paired baseline.

## Context

Opus verified everything below on `078f407`. Paths are relative to the repository root.

### 1. What exists

- **Routing loop.** `packages/auto-layout/src/route.ts:411` `routeDocument(document,
resolver, frozen, roles, structures, signalTrunks)`. It sorts the frozen pin groups
  (`route.ts:436`: power first, then `signalPriority`, then lowest instance id, R13),
  then for each group builds `targets` (power: `powerTargets`, trunk + marker stubs;
  signal: one pins target), prepends R38 contact stubs, and for each target calls
  `planWireBatch` (stubs) or `planRouteNet` (`route.ts:528`) with `netScope: "base"`,
  `partial: true`, `crossingCost: 20 × grid` (R85–R87). Signal Nets with ≥ 3 pins try
  the tree and two median trunks and keep the best `[unjoined, crossings, bends,
wireLength]` (R39, `route.ts:507–578`). Each target's edits are previewed onto
  `working` (`preview(working, resolver, planned)`, `route.ts:612`) and appended to
  `edits` through `replayEdits` (`route.ts:350`), which maps Net ids back to frozen
  input ids. A failed Net gets an R14 warning and, if named, `fallbackLabels`
  (`route.ts:286`: one stub plus one `net-label` annotation per disconnected
  component). The function returns `{ document: working, edits, diagnostics, problem? }`.
- **Whole-list replay.** `src/auto-layout.ts:462` calls `routeDocument` on the placed
  document with existing contact routes removed, then replays the complete edit list on
  the original document (`auto-layout.ts:479` "whole-list replay") and refuses on
  failure. Every object id in the edits is literal: `planRouteNet` derives route ids
  from `document.revision` (`packages/edit-engine/src/route-net-planner.ts:214`,
  `deriveStableId("route-net", document.id, String(document.revision), part)` with
  `part` = `"trunk"` or a component id). `preview` increments the revision once per
  transaction, so today every group plans at its own revision and ids never collide.
  **Trap, hit by the prototype:** rebuilding the working Document from the base to drop
  a Net resets the revision, two Nets then both plan `"trunk"` at the same revision, the
  replay overwrites one route with the other, and the result has missing connections
  (the prototype's first run: dev missing connections 0 → 5). A re-routed Net must plan
  at a revision no retained edit used.
- **Scoring.** `src/routing-audit.ts:118` `auditRouting` returns `crossings` (a set of
  proper intersection points between routes of different `netId`, `routing-audit.ts:179`),
  `bends`, `wireLength`, `unsafeProblems`; `missingConnections` (`routing-audit.ts:34`)
  counts physical components minus one per Base Net. `src/refine.ts:61` `routedScore`
  combines them with R22's weights (`unrouted 10000, crossings 1000, bends 100,
wireLength 0.1`, plus readability terms).
- **Where plans are chosen.** `src/auto-layout.ts:120–218`: three strategies routed once
  (`route(strategy, overrides)`), ranked by `routedScore`; up to 40 instances the top two
  are refined (`refineLayout`, up to 14 candidates each, every candidate a full replan);
  the winner's placement is replanned once with `signalTrunks = false` (R44
  `rawAlternative`); both go through `repair` (R72 `repairBlockers`, which replans with
  exact placements when ports block wires, `auto-layout.ts:86`); `selectRoutingAlternative`
  keeps the lower R22 score. With `options.search`, `annealLayout` (`src/search.ts`)
  evaluates candidates through the same `planLayoutOnce`, then the best and its
  alternative are repaired and compared the same way (`auto-layout.ts:208–217`).
  `planLayoutOnce(document, resolver, options, overrides, strategy, signalTrunks,
given, bounds, exact)` (`auto-layout.ts:221`) skips placement when `exact` is given
  and routes that placement; `repair` already uses this.
- **Tests.** `test/routing.test.ts` (20 tests on `routeDocument`, including R39 at
  `routing.test.ts:939` with a pre-existing wire), `test/route-quality.test.ts` (R85–R87),
  `test/corpus.test.ts` (nine corpus documents with crossing and bend ceilings in
  `corpus-cases.json` and `baseline-metrics.json`), `test/held-out.test.ts` (seven
  held-out documents with crossing ceilings), `test/search.test.ts`.

### 2. Measured baseline

Human cases: 33 third-party drawings in git-ignored `tmp/human-cases/`, dev (18) and
val (15) by `sha256(id) % 3`. Quick-mode baseline for `078f407`:
`tmp/t028/base-quick.json`, drawings in `tmp/t028/base-svg/`; search baseline
(`--search 120 --seed 1 --jobs 12`): `tmp/t028/base-search120.json`.

| Quick mode, 33 completed                                |             dev |             val |
| ------------------------------------------------------- | --------------: | --------------: |
| Crossings                                               |             287 |             337 |
| Bends                                                   |             371 |             400 |
| Floating pins / missing connections                     |           0 / 0 |           1 / 1 |
| Wire length                                             |         127,850 |         148,260 |
| Label overlaps / clearance / departures                 |      0 / 32 / 8 |      1 / 31 / 6 |
| Symmetry (pairs/mirrored/level/orientation/axis/onAxis) | 58/58/58/58/7/7 | 29/29/29/29/4/4 |
| Humans: crossings / bends                               |        59 / 202 |        63 / 246 |
| Search 120 s, seed 1: crossings / bends / floating      |   221 / 327 / 0 |   296 / 389 / 1 |

Where the dev crossings come from (Opus's probe `tmp/t028/t028-probe-crossings.mjs`,
counts only): 187 of 335 Nets carry at least one crossing; a document's three worst
Nets carry 20–75% of its crossings; 69 of 287 crossings involve a wire longer than 600
units. By Net class (each crossing counted once per Net): Nets with ≥ 4 device pins 238,
two-pin Nets 161, rails 80, three-pin Nets 85, gate-dominated bias Nets 10. Rails are
routed as R43 trunks whose position does not depend on order, so they are not rip-up
candidates in this task.

### 3. Design

**R95 — Rip-up and reroute** (in `routeDocument`, after the R12–R14 pass):

1. Per-Net crossings: count proper crossings between routes of different Base Nets in
   the working Document, as `auditRouting` does, attributed to both Nets.
2. Candidates: every **signal** frozen group (not power) whose Net carries at least one
   crossing, in descending crossing count, ties in the R13 order. Power groups keep their
   first-pass routing.
3. For each candidate, in order: remove that group's routing from the working Document
   and from the edit list (its routes, the junctions those routes created, its R14 stubs
   and labels; nothing of any other group), then route the group again with the same
   R12–R14 procedure (contacts, trunk candidates, partial routing, crossing cost) against
   everything else now present. Accept the new routing only if the working Document's
   tuple `[missing connections, crossings, bends, wire length]` is strictly smaller
   lexicographically than before; otherwise restore the old routing exactly. A failed
   re-route (problem or thrown) restores the old routing.
4. Passes: at most two over the candidate list (recomputed per pass) up to 40
   instances, one pass above 40; a pass that accepts nothing ends the procedure.
5. Identity: the edits a re-routed group produces must not reuse an id any retained
   edit uses. Keep the working Document's revision monotonic (remove through edits
   applied by `preview`, or otherwise guarantee a revision no earlier plan used) so
   `planRouteNet`'s ids stay unique. The whole-list replay must reproduce the working
   Document: same routes, junctions, labels and audit.
6. Determinism: identical input gives identical edits; nothing depends on `Map`
   iteration of unsorted ids (sort candidates and ties with `compareIds`).
7. Cost: per candidate one group routing plus one scoring. Score incrementally where
   practical (the removed and added routes' own crossings, bends and length against the
   rest) and verify with one full `auditRouting` per pass; a full audit per candidate is
   acceptable only if the timing target still holds.

Rails, markers, contacts (R25/R38) and the router itself are unchanged; rip-up chooses
among the same bounded paths the first pass could have chosen, with more information.

**R96 — Where it runs.** Rip-up is a `routeDocument` option (default off). The quick
path applies it to its two finalists after R72 repair: the selected plan and its R44
alternative are each replanned once with their exact placements and rip-up on
(`planLayoutOnce(..., exact)` as `repair` does), and each replanned result replaces its
finalist only if its R22 `routedScore` is strictly lower. `selectRoutingAlternative`
then compares as before. The offline search (R66) applies the same to its final best
and alternative after repair; annealing evaluations, R58 refinement candidates and the
initial strategy ranking never rip up. Editor and Agent routing (`planRouteNet`,
`planWireBatch` defaults) are unchanged.

### 4. Binding constraints

- **Human cases.** They stay in git-ignored `tmp/human-cases/`. Never commit any case,
  excerpt, case id or id-keyed data. Nothing in CI or `pnpm test:local` may depend on
  them. Tune on dev only; report val separately; never choose a constant by its val
  result.
- **Frozen code.** `packages/edit-engine/**` (the planners, clearance, transaction),
  `packages/model`, `packages/derived`, `apps/`. In `packages/auto-layout/src`:
  `refine.ts` weights, `search.ts`, `place*.ts`, `layered.ts`, `stages.ts`,
  `template-placement.ts`, `symmetry.ts`, `recognize.ts`, `net-roles.ts`,
  `blocker-repair.ts`, the T021 files. R10, R16, R23 and `lostNameClaim` stay as they are.
- **No new router behaviour.** Rip-up re-runs the existing per-group procedure; it adds
  no path shapes, costs or clearance rules. Net order R13 for the first pass is unchanged.
- **Determinism** without `search`: identical input gives byte-identical edits.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/route.ts` (rip-up; factor the per-group body into a function
  the first pass and rip-up share)
- `packages/auto-layout/src/routing-audit.ts` (a per-Net crossing attribution helper, if
  `route.ts` needs one; `auditRouting`'s results are unchanged)
- `packages/auto-layout/src/auto-layout.ts` (R96 finalist replans; a `ripUp` argument
  through `planLayoutOnce`/`buildPlan` to `routeDocument`)
- new `packages/auto-layout/test/rip-up.test.ts`
- `packages/auto-layout/test/corpus-cases.json`, `test/baseline-metrics.json`,
  `test/held-out.test.ts` crossing or bend ceilings **only downward**, where a corpus or
  held-out result improves and the test pins the value (list every change in the report)
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- everything under "Frozen code" above; `scripts/**`; `packages/auto-layout/src/types.ts`
  (no public option: rip-up is always on for finalists);
- `pnpm-lock.yaml` and every package's dependencies.

## Steps

1. **Factor the group routing.** In `route.ts`, move the body of the per-group loop in
   `routeDocument` into a function that takes the working Document and a group and
   returns `{ document, edits, diagnostic?, problem? }` without touching outer state.
   The first pass calls it exactly as today; `routeDocument` without rip-up produces
   byte-identical edits and diagnostics (assert in a test on two corpus documents by
   comparing with `078f407`'s output captured as a fixture is **not** allowed: human
   cases and corpus outputs are not fixtures. Assert instead that the existing
   `routing.test.ts`, `route-quality.test.ts`, `corpus.test.ts` and `held-out.test.ts`
   pass unchanged with rip-up off.)
2. **R95.** Implement steps 1–7 of Design in `routeDocument` behind an options argument
   (`{ ripUp?: boolean }`; keep the existing `signalTrunks` parameter). Per-Net crossing
   attribution may live in `routing-audit.ts` as an exported helper used only by
   `route.ts`.
   - Tests (`rip-up.test.ts`, hand-built documents with fixed placements, as
     `routing.test.ts:939` does):
     - order dependence: the first-routed Net has two equal-cost paths and the second
       Net crosses the one it picked; `routeDocument` without rip-up gives 1 crossing,
       with rip-up 0, the second Net's edits unchanged, the first Net's replaced;
     - strict acceptance: a candidate whose re-route is not better leaves edits and
       audit identical to the first pass;
     - replay identity: for the rip-up result, `preview(document, edits)` yields a
       Document whose `auditRouting`, `missingConnections`, route count, junction count
       and label count equal the working Document's;
     - a ripped named Net that stays partial has exactly one R14 warning and one label
       per disconnected component, none duplicated;
     - determinism: two calls give equal edits; candidates with equal crossing counts
       follow the R13 order (construct two such Nets).
3. **R96.** In `auto-layout.ts`, after `repair`, replan the selected plan and the R44
   alternative with exact placements and `ripUp: true`; keep each replan only when its
   `routedScore` is strictly lower; then `selectRoutingAlternative` as before. Do the
   same after annealing. Refinement, strategy ranking and annealing evaluations stay as
   they are. Tests (`rip-up.test.ts`): `planAutoLayout` on a document where the finalist
   has a removable crossing returns the rip-up result and no error; `planAutoLayout(d,
r, { search: { seed: 1, evaluations: 0 } })` equals the quick result; `refinementMetrics`
   still reports the refinement candidate count unchanged by the finalist replans.
4. **Spec.** `docs/specs/auto-layout.md`: add R95 and R96 after R94; amend R13 ("the
   first pass; R95 may reroute signal Nets afterwards"), R22/R44/R58 ("R96 replans the
   finalists with R95"), R66 (search finalists), R87 ("Net order and placement are
   unchanged" → "the first pass's order is unchanged; R95 reroutes afterwards"), and the
   known-limits paragraph ("does not rip up earlier Nets" → describe R95's bound).
5. **Existing tests.** Expected to pass unchanged. A corpus or held-out ceiling may be
   lowered when the measured value improves; never raise one, never delete or weaken a
   test. List every changed value with old and new in the report.
6. **Investigate and report.**
   - Quick mode against `tmp/t028/base-quick.json`, dev and val: completed, crossings,
     bends, floating pins, missing connections, wire length, the three readability
     counts, the six symmetry counts; every document whose crossings rise, as counts.
   - Rip-up statistics from temporary instrumentation in ignored `tmp/t028/` (never in
     tracked code): per split, the number of candidates, accepted re-routes, passes
     used, and the share of the crossing reduction coming from the second pass.
   - `--search 120 --seed 1 --jobs 12` against `tmp/t028/base-search120.json`.
   - Paired planning time: build `tmp/t028/paired-base/` (a `git archive` of `078f407`,
     installed and built, `tmp/human-cases` linked; Opus has prepared it) and run its
     `pnpm auto-layout:eval tmp/human-cases --jobs 10` and this branch's quick evaluation
     one after the other with no test suite or other evaluator running
     (`pgrep -fl 'auto-layout-eval|vitest'` empty before each; record load). Report the
     summed and slowest planning time of both and the per-document ratio for the five
     largest documents.
   - Six rendered pairs, baseline quick beside result quick, in `tmp/t028/pairs/`: the
     three largest crossing reductions, one document whose crossings do not change, the
     largest document, and one where bends rise most.

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout|rip-up'    # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t028/base-quick.json --jobs 10   # expected: exit 0, 33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12                 # expected: exit 0, 33 completed
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent scripts pnpm-lock.yaml package.json   # expected: empty
git diff --stat 078f407 -- packages/auto-layout/src/refine.ts packages/auto-layout/src/search.ts packages/auto-layout/src/place.ts packages/auto-layout/src/place-markers.ts packages/auto-layout/src/place-fallback.ts packages/auto-layout/src/layered.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/template-placement.ts packages/auto-layout/src/symmetry.ts packages/auto-layout/src/recognize.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/types.ts packages/auto-layout/src/seat-labels.ts packages/auto-layout/src/readability.ts packages/auto-layout/src/face-ports.ts packages/auto-layout/src/finalize-facing.ts packages/auto-layout/src/timing.ts   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/'   # expected: no output
```

`pnpm auto-layout:eval` overwrites `tmp/auto-layout-eval/report.json`. Copy each report
to `tmp/t028/` (`result-quick.json`, `result-search120.json`) right after its run, and the
quick SVGs to `tmp/t028/quick-svg/`.

On `078f407`, `pnpm deadcode` exits 1 for findings outside these paths; only the
filtered output counts. Every other command above passes on `078f407`.

**Quick-mode targets**, against `tmp/t028/base-quick.json`:

| Measure                                      |                        `078f407` | Required                         |
| -------------------------------------------- | -------------------------------: | -------------------------------- |
| Completed documents                          |                         33 of 33 | 33 of 33                         |
| Crossings, dev                               |                              287 | ≤ 258 (−10%)                     |
| Bends, dev                                   |                              371 | ≤ 400                            |
| Floating pins, dev / val                     |                            0 / 1 | 0 / ≤ 1, none above its baseline |
| Missing connections, dev / val               |                            0 / 1 | 0 / ≤ 1                          |
| Wire length, dev                             |                          127,850 | ≤ 134,000                        |
| Label overlaps / clearance / departures, dev |                       0 / 32 / 8 | ≤ 1 / ≤ 36 / ≤ 9                 |
| Symmetry counts, dev and val                 | 58/58/58/58/7/7, 29/29/29/29/4/4 | unchanged                        |
| Unsafe problems; documents not equivalent    |                            0 / 0 | 0 / 0                            |
| Planning time, summed over the 33            |                                — | ≤ 1.25 × the paired baseline run |

Val is reported with the same measures; it is not a target. Corpus targets and held-out
ceilings must hold. With 2-minute search, report against `tmp/t028/base-search120.json`;
there is no hard target, but floating pins must not exceed the quick result's.

**A correct rule that costs time.** If the timing target fails with rip-up on both
finalists, report the per-document ratios and the cost split (first pass, rip-up pass 1,
rip-up pass 2, scoring); do not drop the rule or tune a constant on val. Opus decides.

## Notes for the implementer

- **Reuse the loop body.** The per-group function is the first pass's code, moved, not a
  second router. If it needs a parameter (the Document to route on), add it.
- **Removal, not rebuild.** Prefer removing a ripped group's objects from the working
  Document through edits (`remove_route_geometry`, `remove_junction`,
  `remove_schematic_annotation`) applied by `preview`, which keeps the revision
  monotonic, over rebuilding the Document from the base. If you rebuild instead, make
  the id invariant of Design step 5 hold explicitly and test it. The prototype's
  `{ ...document, revision }` hack is not acceptable in product code.
- **Score with the audit's definitions.** Crossings are `auditRouting`'s proper
  crossings between different Base Nets; bends and wire length as there; missing
  connections from `missingConnections`. An incremental version must agree with the full
  audit (assert in a test on a hand-built document).
- **Keep R14 honest.** A ripped Net that becomes partial, or a partial Net that becomes
  complete, must have exactly the diagnostics and labels the final routing warrants.
- **Report trade-offs.** Bends may rise where crossings fall; say so per document. Never
  key behaviour to a case, an instance id or a symbol id.
- **The prototype is evidence, not a model.** `tmp/t028/prototype-route.diff` shows the
  gain is real and where the id trap is; its rebuild-per-candidate loop and its revision
  hack must not be reproduced.
