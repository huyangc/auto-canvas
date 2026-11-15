# T082 report — round 3

## Summary

Preserve R150's current clearance seat when explicitly re-anchoring movable
drafting to fresh carried conductor IDs. Junction anchors recompute their
local offset; route anchors recompute their along-segment fraction and normal
offset. Fallback positions match the current seat. A route anchor that cannot
represent the current position or orientation keeps its existing seated anchor.
This keeps touching captions aligned and mixed-anchor arrows rigid.

All 628 corpus plan hashes and scores exactly match the pre-round-3 branch.
Against main `8387e36`, dev composite is 54.370761083 → 53.315153784 and
val is 27.996936455 → 27.469132806; six drawings improve and none regresses.
All 628 remain equivalent and all six large documents are byte-identical.

Removed the provisional Opus rejection guard: the regression shows that it
prevents splitting by dropping a legal conductor, while position-preserving
re-anchoring retains both the conductor and the seat without the guard.

## Steps

| Step                         | Status | Notes                                                                                                                                                                 |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigation gate        | done   | Prior-round per-group evidence retained below. Round 3 reproduced the latest finding through the real planner before changing implementation.                         |
| 2. Carry terminal-free wires | done   | Re-anchoring preserves current geometry; existing eligibility, fresh IDs, collision checks and per-Net acceptance remain intact.                                      |
| 3. Reseat stranded groups    | done   | Existing bounded owner search is unchanged; its current seat survives re-anchoring.                                                                                   |
| 4. Synthetic tests           | done   | Four new real-planner regressions: junction, horizontal/vertical route anchors, and an arrow with mixed endpoint anchors. All fail on d1b883a and pass with this fix. |
| 5. Corpus and review         | done   | All 628 evaluated; 38 visual comparisons reviewed; six large documents identical and deterministic.                                                                   |

## Review findings addressed

**Round 2 must-fix #1 — rigid drafting groups during re-anchoring.** The fixture
has two touching captions at `(850,420)` and `(880,420)` beside an isolated
bent conductor, plus locked ink at `(308,394)`. Through `planAutoLayout`, R150
seats the captions at `(310,420)` and `(340,420)`: ten units below the owner's
rigid translation. On `d1b883a`, conductor recovery resets only the anchored
caption to `(310,410)`. The arrow variant similarly stretches one endpoint.

The first regression was written and run against the exact `d1b883a` recovery
source before the fix. HEAD differs from that commit only in the provisional
guard and review text. The narrowed planner test fails with the observed
10-unit split; the completed four-case regression also fails all four cases.
No fake seated base or mocked planner is used. With the provisional guard,
the caption alignment passes but the required retained-conductor assertion
fails. With the fix and without that guard, all 21 focused tests pass.

The cause is restoring the source anchor's old offsets after R150 has chosen
a different clearance seat. Rebinding now measures each current resolved
position relative to the carried junction or route leg. The same operation
covers an object's main anchor, arrow endpoints, and leader/callout targets.
Already-seated anchors are retained when the original route leg cannot encode
the seat or would change its orientation. Locked drafting remains untouched.

## Acceptance results

```text
pnpm build → 0; all packages/apps built (existing Vite chunk-size warnings).
pnpm typecheck → 0.
pnpm lint → 0; 2067 files, 0 errors, 3467 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 0; 798 files passed, 3 skipped;
  8212 tests passed, 117 skipped (8329), 172.34 seconds.
pnpm test:slow → 0; 2 files, 8 tests passed, 81.23 seconds.
pnpm exec vitest run packages/auto-layout/test/recover-drafting-owners.test.ts
  → 0; 21 tests passed.
```

`test:local` ran with approved local-service access for PostgreSQL and loopback
listeners. Logs use `/tmp/t082-r3-{build,typecheck,lint,format,test-local,test-slow,focused}.log`.

Red/green evidence: `/tmp/t082-r3-red.log` is the first pre-fix planner failure;
`/tmp/t082-r3-red-all.log` records all four new regressions failing against
`d1b883a`; `/tmp/t082-r3-guard.log` records the provisional guard rejecting the
conductor. No test was weakened or deleted.

`node tmp/t082-round3/verify-large.mjs` → 0. All six documents (50, 50,
51, 103, 70, and 94 instances) are byte-identical to main `8387e36` and a
second current run. Baseline source was exported with `git archive` to
`/tmp/t082-r3-main-8387e36` and compiled with the installed toolchain, without
switching branches or installing dependencies. Evidence:
[`large.json`](../../tmp/t082-round3/large.json), `/tmp/t082-r3-large.log`.

### Corpus against main 8387e36

```text
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628/628 equivalent, no per-drawing composite or guard regressions.
python3 tmp/t082-round3/compare.py → 0.
```

| Measure              | Dev: main → round 3         | Val: main → round 3         |
| -------------------- | --------------------------- | --------------------------- |
| Frozen composite sum | 54.370761083 → 53.315153784 | 27.996936455 → 27.469132806 |
| Composite / human    | 1.238520× → 1.214475×       | 1.186538× → 1.164170×       |
| Unowned drafting     | 28 → 22                     | 11 → 8                      |
| Floating pins        | 6 → 6                       | 0 → 0                       |
| Missing connections  | 4 → 4                       | 0 → 0                       |

Six drawings improve, 622 are unchanged, and none is worse than main. All
`VISUAL_*` totals, including zero-weight label clearance, are unchanged; no
per-drawing guard regresses. Dev and val sums exactly equal the prior branch's
53.315153784 / 27.469132806, comfortably within the allowed +0.05. All 628
plan hashes also equal the pre-round-3 evaluation. Evidence:
[`report.json`](../../tmp/t082-round3/report.json),
[`summary.json`](../../tmp/t082-round3/summary.json),
[`previous-report.json`](../../tmp/t082-round3/previous-report.json), and
`/tmp/t082-r3-{eval,summary}.log`.

### Visual review and deterministic replay

```text
node tmp/t082-round3/review.mjs → 0; 38 independent plan hashes verified.
node tmp/t082-round3/render.mjs → 0; 38 sections, 1800px content/viewport.
```

[Human | main 8387e36 | round 3 review page](../../tmp/t082-round3/review.html)
contains all ten named drawings, the ten largest composite reductions (six
improvements plus four unchanged ties), and the original 25 samples: 38 unique
drawings. All ten rendered sheets were inspected. The page has no horizontal
overflow. Recovered labels/arrows remain beside their owners in `dr4e8zhyjg`,
`nfa75tcbqf`, `mbpnznx3p5`, `m9knq7tpsz`, and `vkafsqxh8n`; collision-rejected
examples and sampled layouts retain main's geometry. The block diagram still
has fragmented signal flow and eight unowned groups despite its improvement.
The complete corpus is unchanged by this round's fix; the synthetic planner
regressions exercise the corrected mixed-anchor behavior.

All 38 review replays independently match the corpus plan hashes. Evidence:
[`review-verification.json`](../../tmp/t082-round3/review-verification.json),
[`review-layout.json`](../../tmp/t082-round3/review-layout.json),
`review-1.png` through `review-10.png`, and `/tmp/t082-r3-{review,render}.log`.

## Investigation results

### Round 3 reproduction

The public planner reproducer above isolates the source-anchor reset from
R150 seating and later owner search: restoring source offsets reintroduces the
split, the provisional carry rejection avoids it by losing the conductor, and
rebinding at the current positions preserves both. Horizontal-route coverage
exercises normal-offset adjustment; vertical-route coverage exercises the
along-leg fraction. The arrow case verifies both endpoints and the main anchor.

### Prior-round design gate (historical main 8cdec30)

The following original investigation is retained as the design gate evidence;
round 3 acceptance uses main `8387e36`, as required by the latest review.

The input protocol resolves `qj62dz4qvm` into 74 routes, including 49 routes on
23 terminal-free Nets; this is more than the plan's approximate wire count.
Main removes all its routes. Every other named drawing has one baseline-unowned
group; the block diagram has twelve. Group identities below use the first
member ID and member count. Full member lists, bounds, source owners, candidate
offsets, collision IDs, and prototype scores are in
[`tmp/t082-round1`](../../tmp/t082-round1).

### Gate evidence

| Dev drawing  | Main unowned → prototype | Main composite → prototype | Replay                             |
| ------------ | ------------------------ | -------------------------- | ---------------------------------- |
| `qj62dz4qvm` | 12 → 8                   | 2.113795673 → 1.410057474  | accepted; terminal partition equal |
| `dr4e8zhyjg` | 1 → 0                    | 2.790947796 → 2.615013246  | accepted; terminal partition equal |
| `nfa75tcbqf` | 1 → 0                    | 0.179744663 → 0.003810113  | accepted; terminal partition equal |

The block-diagram prototype restores `net-ui-76`, `net-ui-175`, and
`net-ui-268`. Two large groups receive new legal seats; the label of
`net-ui-175` stays owned. A label formerly owned by the dropped `net-ui-73`
incidentally falls within the restored `net-ui-175`'s ownership radius. That
last recovery is a geometric metric result, not preservation of its old wire.
The six-group gate counts final geometric ownership, as the frozen metric does.
An initial scratch trial that did not distinguish empty terminal partitions or
translate bends correctly was discarded; only the corrected and replayed
prototype results above were used for the gate.

### The nine single-group drawings

| Drawing / group                              | Source owner                                    | Why main loses ownership                                                                                                                                                   | Legal recovery found                                                                          |
| -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `6n2s63bxv4` / `polarity-7`                  | Junction on terminal-free `net-ui-44`           | Owner removed; old group stays fixed. The required wire translation `(180, 100)` intersects `route-net-40c81dd2a552790f-route`.                                            | No collision-free wire restoration at the required displacement; retain main.                 |
| `dr4e8zhyjg` / `inferred-output-arrow-IoutP` | Instance `M11`                                  | All local seats fail clearance. Conflicts include `M11`, `inferred-output-IoutP`, `text19`, the OUTP route and interface marker.                                           | Yes: offset `(25, 25)` from the preferred owner displacement; total translation `(120, 197)`. |
| `jkbdeaz3fr` / `note-59_2`                   | Route on terminal-free `net-ui-106_2`           | Wire removed; ink followed a nearby instance by `(-70, 10)`. Restoring that wire intersects `arrow-58_2` and `arrow-58_3`.                                                 | No legal restoration under the no-drafting-collision rule; retain main.                       |
| `qgc6fm8kpe` / `note-159`                    | Junction on terminal-free `net-ui-309`          | Wire removed; restoring it at `(0, -60)` intersects `arrow-158`.                                                                                                           | No legal restoration of its owner; retain main.                                               |
| `nfa75tcbqf` / `note-18-copy-1-copy-1`       | Instance `P2`                                   | First clear local seat `(-10, -10)` is later rejected: `Instance X6 intersects drafting note-18-copy-1-copy-1`. R150 does not try another seat after that audit rejection. | Yes: next valid offset `(-20, -10)`, translation `(-230, 140)`.                               |
| `qk9r4bb46n` / `note-46`                     | Junction on terminal-free `net-ui-105`          | Wire removed; its `(0, -70)` restoration intersects `arrow-48`. Another free wire (`net-ui-101`) collides with `R1`, its pin, and a route.                                 | No legal owner restoration; retain main.                                                      |
| `mbpnznx3p5` / `note-92`                     | Route connecting `C1.1`, `C2.1`, `C3.2`         | First clear offset `(20, 0)` is rejected: `Instance C1 intersects drafting note-92`.                                                                                       | Yes: offset `(20, -10)`, translation `(40, 159)`, same terminal-partition owner.              |
| `m9knq7tpsz` / `note-2`                      | Instance `P1-copy-3`                            | Rounded preferred translation `(5, 35)` leaves the small ink just outside its 16.33-unit radius.                                                                           | Yes: offset `(10, 0)`, total translation `(15, 35)`.                                          |
| `vkafsqxh8n` / `note-21_2`                   | Route connecting `M2.D`, `M2.G`, `M4.D`, `P3.P` | Followed the conductor, but clearance puts the ink outside its small ownership radius.                                                                                     | Yes: offset `(-20, -20)`, translation `(-31, -30)`, same terminal-partition owner.            |

### All twelve block-diagram groups

Long note IDs are abbreviated only in this table; the full IDs and memberships
are in [the block-diagram investigation](../../tmp/t082-round1/t082-qj62dz4qvm-investigation.json).

| Group (first member; size)                        | Source owner / cause                                                                                                                                    | Legal recovery found                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rectangle-17`; 30                                | Junction on `net-ui-34`, singleton `X1.OUT`; owner conductor disappears. Every local seat collides with parts, annotations, or fixed ink.               | Yes: wider seat beside surviving `X1`; rigid translation `(-678, 565)`.                                                                                             |
| `note-41`; 1                                      | Already unowned in source.                                                                                                                              | Not eligible for source-owned reseating; remains unowned.                                                                                                           |
| `note-24-copy-1`; 33                              | Junction on terminal-free `net-ui-175`; local fallback seats collide with fixed ink.                                                                    | Yes: carry its wire and reseat the rigid group by `(-901, 151)`.                                                                                                    |
| `note-41-copy-1`; 1                               | Already unowned in source.                                                                                                                              | Not eligible; remains unowned.                                                                                                                                      |
| `rectangle-60`; 5                                 | Junction on singleton `P2.P` conductor; local seats collide with ports, labels and fixed ink.                                                           | No same-owner legal seat found within the wider tested grid after earlier accepted groups. This is a bounded-search result, not proof that no seat exists anywhere. |
| `note-4`; 1                                       | Route on `net-4b3ef5ec1c826cf2`; wire removed. Required restoration intersects rectangles/arrows and other fixed ink.                                   | No legal restoration of its original conductor.                                                                                                                     |
| `note-10`; 1                                      | Route on `net-ui-88`; wire removed. Restoration intersects `rectangle-62`, `arrow-10`, and `arrow-11`.                                                  | No legal restoration.                                                                                                                                               |
| `arrow-22`; 3                                     | Route on `net-ui-386`; wire removed. Local geometric seat exists, but main rejects the calibrated-score increase without a reduction in unowned groups. | Original conductor restoration collides with `arrow-124`, `arrow-24`, `arrow-28`, and `arrow-25`; remains unowned.                                                  |
| `arrow-24`; 1                                     | Same removed `net-ui-386` owner; followed nearest instance but remains remote.                                                                          | No legal original-conductor restoration.                                                                                                                            |
| Note ID ending `copy-1-copy-1-copy-1`; 1          | Route on `net-ui-73`; restoration collides with `rectangle-13`.                                                                                         | Original owner cannot be restored; the restored neighboring `net-ui-175` makes this note geometrically owned.                                                       |
| Note ID with one further `copy-1`; 1              | Route on `net-ui-175`; wire removed and caption followed the instance.                                                                                  | Yes: restoring `net-ui-175` preserves ownership at the existing caption seat.                                                                                       |
| Note ID ending `copy-1-copy-1-copy-1-3-copy-1`; 1 | Already unowned in source.                                                                                                                              | Not eligible; remains unowned.                                                                                                                                      |

### Proposed R158 clarification for Opus

When explicitly re-anchoring movable drafting to a carried conductor's fresh
IDs, preserve each anchor's current resolved position and orientation after
R150 seating. Compute a junction's local offset, or a route leg's fraction and
normal offset, from that current seat, and store the same position as its
fallback. If the new route anchor cannot represent that seat or orientation,
retain the existing seated anchor. Apply this rule to primary anchors and
arrow/leader/callout endpoint or target anchors, so conductor recovery neither
splits touching components nor stretches their members. Locked drafting stays
unchanged. All existing R158 acceptance and identity rules remain in force.

## Deviations and open questions

- Latest review supersedes the plan's old corpus baseline with `8387e36` and
  waives timing for a change confined to re-anchoring. No timing run was made.
- Dev remains above the broader 1.20× human goal at 1.214475×; val is within
  it at 1.164170×. The block diagram still has eight unowned groups.
- Only the owned implementation, tests, and this report are changed. Scratch
  evidence is under `tmp/t082-round3` and `/tmp/t082-r3-*`.
- No plan/review, dependencies, lockfile, generated source, or frozen metric
  edits; no LLM API calls, commits, pushes, merges, rebases, or branch switches.
