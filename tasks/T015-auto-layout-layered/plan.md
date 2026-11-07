# T015 — Auto-layout: general layered placement

- Branch: `task/T015-auto-layout-layered`
- Base: `task/T013-auto-layout-quality` at `309a368` (stacked on open PR #17)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The planner handles about five devices well and larger circuits badly. On 33
real human-drawn circuits, the 24 it completes have 550 crossings against the
humans' 73. The user wants this fixed by general means, "not one rule per
observed failure", without degrading any existing result. This task replaces the
chain of special cases in placement with one layered graph layout: rows from
device polarity, order from crossing minimization, columns from pin alignment.
The lock field and editor button stay in T014.

## Context

Verified on `309a368`.

### Why the current placement fails

`placeDocument` (`packages/auto-layout/src/place.ts`) is a cascade: `rankRows`
walks channel paths outward from `supply` nets, `expandTemplates` places groups,
ranked devices go left to right by distance, and whatever is left falls into
`placeFallback`'s single signal row.

- `mcbrza282w` has no recognizable supply, so `rankRows` ranks nothing and 22
  parts land in one row. Original 0 crossings, result 44.
- `b23bz45g2q` (15 parts): rows come out, but the left-to-right order ignores
  connectivity, so two side-by-side stages interleave. Original 0, result 6.
- Group axes are spaced by a constant, regardless of what connects to them.

### Data handling, which is binding

The 33 cases are other people's drawings from a site whose terms forbid bulk
collection. They were copied to the git-ignored `tmp/human-cases/` (`<id>.json`,
`<id>.meta.json`). **Never commit any of them, any excerpt, or any id-keyed
derived data.** Nothing in CI or `pnpm test:local` may depend on them. The
evaluator takes the folder as an argument and is run by hand. Case ids may appear
only in `tmp/` output and in `report.md`.

### Split

`sha256(id) % 3 == 0` is the validation half, the rest development. Tune on
development only. Rules and constants may not refer to any case. Validation shows
whether the change generalizes.

| Set | Documents | Completed today | Human crossings / bends on those | Auto crossings / bends |
| --- | --------: | --------------: | -------------------------------- | ---------------------- |
| dev |        18 |              14 | 26 / 149                         | 288 / 338              |
| val |        15 |              10 | 47 / 152                         | 262 / 256              |

Today's refusals: six over the 40-instance limit (`TOO_LARGE`, 50 to 103
instances), two `R10` and one `R7` (two pairs sharing a tail). Slowest completed
call: 5.8 s at 40 instances.

### What must not regress

- The nine corpus cases keep their `corpus.test.ts` crossing and bend targets and
  every explicit geometry assertion (pin alignment, `+` above `-`, Vout right).
- The seven held-out cases keep committing with `unsafeProblems` empty, and none
  gets more crossings than at `309a368`: `fd-two-stage` 12, `common-source-ac` 2,
  `skew` 4, `deadtime` 17, `ota-sky130` 3, `widlar` 5, `ltc3452` 22.
- R10, R23 and `lostNameClaim` stay as they are: they are why every completed case
  is electrically identical today.

### Reuse

`classifyNets`, `recognizeStructures`, `placeMarkers`/Cell Pin rules (R19, R20),
`refineLayout`, `route.ts`, `auditRouting`, `routedScore`. Only row, order and
column assignment are replaced.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-review.mjs`, `scripts/auto-layout-eval.mjs` (new), and one
  `package.json` script entry `"auto-layout:eval"`

Out of scope (do not change):

- `packages/edit-engine/**`, `packages/model/**`,
  `packages/project-protocol/**`, `packages/spice/**`, `fixtures/**`, `apps/**`
- `.gitignore`, and anything that would add a case file to git
- A new general-purpose router, lock fields and the editor button

## Steps

1. **Evaluator first.** `scripts/auto-layout-eval.mjs <folder>`: for every case in
   the folder, parse, plan, commit, and record status, planning time, crossings,
   bends, wire length, `unsafeProblems` and electrical equivalence, for both the
   human drawing and the result. Print one table per split and totals over
   documents completed in both the baseline and the current run. Write
   `tmp/auto-layout-eval/report.json` and an `index.html` of side-by-side pairs.
   `--baseline <report.json>` adds the before column. Run it now, before any
   placement change, and keep that output as `tmp/auto-layout-eval/baseline.json`.

2. **Spec.** Replace R6 and the placement part of R9 (see R36 and R37) in
   `docs/specs/auto-layout.md` with R30–R35. Keep every other rule.

   - **R30 Net levels.** Each device contributes vertical constraints between
     Nets: NMOS `D` above `S`; PMOS `S` above `D`; a source's `+` above `-`. A
     two-pin passive with one pin on a `supply` or `ground` Net is directed away
     from that Net. Other passives add no constraint. `supply` Nets are forced to
     the top and `ground` Nets to the bottom when they exist, but neither is
     required. Levels are longest paths over these constraints. A cycle is broken
     deterministically by dropping the back edge found in `id`-ordered depth-first
     search. No document may fall through to a single row merely because it lacks
     a supply Net.
   - **R31 Rows and orientation.** A device with two channel terminals on
     different levels occupies the row of its upper Net and stands vertically. A
     two-pin part with both Nets on one level lies horizontally in that row. Gate
     and block input Nets create no constraint: they only pull order and columns.
     Multi-pin blocks sit in the row of their output Net. A document with no
     vertical constraint at all uses R9's signal-row layout unchanged.
   - **R32 Order.** Treat a recognized group as one node, its members adjacent and
     symmetric. A vertical channel chain may be kept together. Seed each row by
     signal distance, then run barycentre sweeps down and up over every Net that
     spans adjacent rows, keeping the order with the fewest net crossings. Eight
     sweeps at most; ties break by signal distance, then `id`. Two pairs sharing a
     tail sit adjacent, with the tail centred between their axes: this replaces the
     R7 refusal.
   - **R33 Columns.** Assign `x` by alignment, in the spirit of Brandes–Köpf:
     devices joined through a channel Net align the pins they share (R18), the
     longest chains first, and every other device goes to the median of its
     neighbours' pins, subject to order and to a 40-unit gap between instance bounds.
     Group symmetry wins over median alignment.
   - **R34 Scale.** The instance limit becomes 120. `MAX_CANDIDATES` stays 24 up to
     40 instances and is 8 above that.
   - **R36 Strategy portfolio.** Up to 40 instances, plan twice: once with the
     T013 template placement (`rankRows`, templates, R9 fallback, restored from
     `309a368` as one strategy module) and once with R30–R33, each with its own R22
     refinement. Return the plan with the lower R22 routed score; a tie goes to the
     template plan. Above 40 instances, use R30–R33 only. This is how existing
     results cannot get worse, without a rule per circuit. This supersedes step 3's
     deletion of `rankRows`.
   - **R37 Rails.** R30's forced top and bottom, and its passive direction, use
     rails only: Nets with a VDD or Ground claim or marker, a supply or ground Cell
     Pin, or R12's MOS supply test (at least two MOS D/S pins). A grounded source
     driving passives is not a rail. R30–R33 apply only when the document has a
     transistor channel constraint; otherwise R9 places it.
   - **R38 Touching pins, generalized.** R25 now covers every Net: any two non-`B`
     pins that touch in the input and are on one frozen group get one exact,
     clearance-checked stub after placement, unless placement keeps them touching.
     Then `reconcileTransformDirectContacts` has nothing to add. This targets the
     six refusals caused by its unchecked Routes.
   - **R39 Trunks for high-fanout Nets.** A signal Net with at least three routable
     pins is planned three ways: as today, with a horizontal trunk at its pins'
     median `y` spanning them, and with a vertical trunk at the median `x`. Count
     each candidate's proper crossings with Routes of other Nets already planned,
     and keep the fewest crossings, then the fewest bends, then the shortest; a tie
     keeps the order listed. A candidate that throws is dropped. In round 1, Nets
     with four or more pins took part in 161 of 233 dev crossings.
   - **R40 Order objective.** R32's sweeps also count Nets inside one row, by span,
     and Nets crossing more than one row, through a virtual position in each row in
     between, as in standard layered drawing.
   - **R41 Integer geometry.** Any point computed through rotation or mirroring is
     rounded to an integer before use, so no trunk or tap lands at
     `50.00000000000001`.
   - **R42 Scale.** `MAX_CANDIDATES` is 24 up to 40 instances, 8 from 41 to 80 and 0
     above 80.
   - **R43 No floating rail pins (replaces R12's "remaining membership stays
     unrouted").** Every non-`B` pin of a rail is drawn connected. A pin with its own
     marker keeps its stub. All other pins of the rail join one horizontal rail
     trunk, above the top row for a supply and below the bottom row for ground,
     together with one marker's host so the marker and trunk are one drawing. Never
     add an instance to do this. A failure is an R14 warning that names the pins.
     This applies to rails of every size and to both strategies.
   - **R44 Routing alternative.** After R36 selects a plan, replan it once with R39
     off, without refinement, and keep the lower routed score. R39 chooses greedily,
     Net by Net, and can be worse overall: `8pvqfhsxqr` went from 52 to 73 crossings.
   - **R35 Unchanged small cases.** R7, R8, R18–R26 still apply. Corpus results may
     change only if their targets still hold.

3. **`src/layered.ts`** (new) with one function each for levels, rows, order and
   columns. Each is pure, with unit tests on hand-built graphs. Delete `rankRows`
   and any code the new path leaves unreachable.

4. **Tests.** Unit tests:
   - a circuit with no supply Net gets more than one row;
   - a cycle terminates deterministically;
   - two side-by-side stages do not interleave;
   - barycentre reduces crossings on a known permutation;
   - a shared tail centres between its pairs.

   Add one synthetic 60-device fixture built in the test, never from a case, to pin
   the limit and determinism. Keep every existing test. A corpus assertion may
   change only if it encodes the old mechanism and not the outcome, and each such
   change goes in the report.

5. **Investigate and report:** the full eval table for both splits against the
   baseline; each remaining refusal and its cause; planning time against instance
   count; each corpus or held-out metric that changed. Inspect at least six pairs
   from `index.html` across sizes, and say plainly what still looks wrong.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output (deadcode itself exits 1 on main)
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Baseline on `309a368`: all pass, with 7360 tests.

Evaluation targets, for **each** of dev and val over documents completed in both
runs:

- crossings at most half the baseline; bends not above the baseline;
- every completed document electrically equivalent, with `unsafeProblems` empty.

A **floating pin** is a non-`B` pin that is the only pin of its physical component
while its Base Net has other pins. The evaluator reports them per document, for
human drawing and result, and in the totals. Floating pins must reach 0 on the nine
corpus cases, and on human and held-out cases every remaining one must be a pin
named in an R14 warning. Drawing these wires will raise crossings against the
current numbers. That is expected: those wires were missing. Compare against the
baseline and report both. Never leave a pin floating to protect a crossing count.

Over all 33 documents:

- at least 32 complete;
- no document throws;
- at most 15 s for the 103-instance case on a developer machine.

If a target is missed, report where it stands. Do not chase it with a rule for one
case.

## Notes for the implementer

- This replaces a cascade with one mechanism. A new `if` for a kind of circuit is a
  sign of the wrong design. Prefer changing the graph, weights or order.
- Never key behavior to a case, a Reference, an instance id or a symbol id, other
  than the existing MOS and marker classifications and pin polarity.
- Tune on dev only. If dev improves and val does not, say so.
- Keep `planAutoLayout` deterministic: no clock in any decision.
- Do not change the Edit Engine or the router to reach a target. Record it.
