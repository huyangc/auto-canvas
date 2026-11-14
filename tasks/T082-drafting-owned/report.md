# T082 report — round 2

## Summary

Corrected conductor recovery to allocate fresh Route, leg, bend, and Junction
IDs with R98 reservation and deterministic salting. Movable route/junction
anchors receive explicit drafting edits; locked anchors are never reactivated.
Recovery now runs only for plain, nonzero-budget planning with 1–40 instances,
checks cancellation per Net/group/offset, and bounds clearance-passing seat
trials with `finishingTrialBudget` (128 per group, 512 per document before size
scaling). Each carried Net is scored independently before keeping it.

**All round 1 gains survive.** Dev composite remains 59.827427297 versus main's
61.058969146; val remains 33.047677117 versus 33.575480766. Unowned groups remain
22 versus 29 on dev and 8 versus 11 on val. Seven drawings improve and none
regresses; 628/628 remain equivalent. Only `qj62dz4qvm` has a different plan hash
from round 1: one useful conductor is retained with fresh IDs, rather than the
previous three restorations. Its composite and four recovered groups are unchanged.

## Steps

| Step                         | Status | Notes                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigation gate        | done   | Preserved round 1's investigation of all 21 baseline-unowned groups in the ten named drawings. Its six-dev-group gate remains satisfied by the final round 2 results.                                                                                                                                             |
| 2. Carry terminal-free wires | done   | Fresh IDs and explicit movable anchors; connectivity-only eligibility; skip bus-member routes and contact-anchored/member junctions; collision and terminal-partition guards; independent per-Net acceptance.                                                                                                     |
| 3. Reseat stranded groups    | done   | Same owner-centered search, with cancellation and scaled trial caps. Restrict collapsed-conductor fallback to singleton terminal Nets; skip groups merged with locked ink; cache grouping per replay.                                                                                                             |
| 4. Synthetic tests           | done   | 17 targeted tests pass, including ID freshness/salting, route and junction anchor edits, locked anchors, symbol and terminal pin/junction/wire contact, independent Net acceptance, aborts within carrying and offset search, optimized/partition/zero-budget gates, determinism, and a baseline-failing caption. |
| 5. Corpus and review         | done   | All 628 evaluated, 38 visual comparisons inspected, six large documents identical and deterministic, all seven isolated timing medians within +20%.                                                                                                                                                               |

## Review findings addressed

1. **Must-fix: identity contract.** `documentObjectIds(source)` and the ordinary
   final document reserve all IDs, including removed children. Every carried
   Route, leg, bend, and Junction gets a salted `deriveStableId`; endpoint and
   movable visual-anchor references are rewritten explicitly. Locked objects
   are excluded through movable-component grouping. Removed the old frozen-ink
   comparison whose only purpose was to guard accidental ID reactivation.
   All of round 1's composite and unowned-drafting gain survives.
2. **Must-fix: cancellation/runtime.** Pass the planner's `stopped` predicate
   into recovery; check it per Net, group, and offset. Stop after at most 128
   clearance-passing seat trials per group and 512 per document, each scaled
   through `finishingTrialBudget(instances, limit, false)`. Cancellation retains
   the ordinary result. Tests cancel inside both carrying and seat search.
3. **Must-fix: gating.** The final recovery call now requires the same nonzero
   search/instance eligibility as the finishing pass, and excludes optimized
   and partitioned planning. Tests cover all three excluded modes. Default
   corpus metrics equal round 1 for every drawing.
4. **Should-fix: acceptance/cost.** Score and guard each carried Net separately;
   rejected Nets no longer poison successful Nets or subsequent reseating.
   Hoist the ordinary terminal partition out of the Net loop and the seat
   partition out of the offset loop. A synthetic two-Net test protects this.
5. **Should-fix: tests.** Collision tests assert the intersecting symbol bounds
   or exact terminal-Net pin/junction/wire contact geometry before asserting
   rejection. The prior ordinary caption test is replaced by a smaller caption
   that is unowned on `/tmp/t081-baseline/dist` and owned here (synthetic text at
   `(605, 365)`). Both snapshots and the reproducer are in
   `tmp/t082-round2/stranded-caption.json` and `find-caption.mjs`. Added the
   abort, mode-gate, fresh-ID, salted-ID, and anchor regressions described above.
6. **Nit: edge cases.** Skip contact-anchored junctions and bus-member routes;
   singleton-only instance fallback; leave missing current groups (including
   groups merged with locked ink) alone; calculate `draftingGroups` once per
   accepted replay instead of once per source-owned group.

## Acceptance results

```text
pnpm build → 0; all packages/apps built (existing Vite chunk-size warnings).
pnpm typecheck → 0.
pnpm lint → 0; 2067 files, 0 errors, 3467 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 0; 798 files passed, 3 skipped;
  8206 tests passed, 117 skipped (8323), 107.67 seconds.
pnpm test:slow → 0; 2 files, 8 tests passed, 49.41 seconds.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628/628 equivalent.
pnpm exec vitest run packages/auto-layout/test/recover-drafting-owners.test.ts
  → 0; 17 tests passed.
node tmp/t082-round2/verify-large.mjs → 0; 6/6 identical and deterministic.
node tmp/t082-round2/review.mjs → 0; 38 independent plan hashes verified.
node tmp/t082-round2/render.mjs → 0; 38 sections, 1800px content/viewport.
```

`test:local` ran with local-service access for PostgreSQL and loopback listeners.
All seven required acceptance commands exited zero. The initial held-out timing
criterion failed for one case; its evidence and targeted repeat are below.
During implementation, focused
tests caught an incorrect bend/endpoint field mapping and missing test search
seeds; these were corrected before the final build and corpus run. Typecheck
also caught those mistakes. No tests were weakened or deleted.
Logs are `/tmp/t082-r2-{build,typecheck,lint,format,test-local,test-slow,eval,focused,large,review,render,timing}.log`.

### Corpus and deterministic replay

| Measure              | Dev: main → round 2         | Val: main → round 2         |
| -------------------- | --------------------------- | --------------------------- |
| Frozen composite sum | 61.058969146 → 59.827427297 | 33.575480766 → 33.047677117 |
| Composite / human    | 1.270882× → 1.245249×       | 1.244033× → 1.224477×       |
| Unowned drafting     | 29 → 22                     | 11 → 8                      |
| Floating pins        | 6 → 6                       | 0 → 0                       |
| Missing connections  | 4 → 4                       | 0 → 0                       |

Seven composites improve, 621 are unchanged, and none increases. Every drawing's
composite equals its round 1 value. All `VISUAL_*` totals are unchanged, including
zero-weight label clearance; per-drawing guards also do not regress. Dev gain is
1.231541848 composite units and val gain is 0.527803649. Full comparison:
[`summary.json`](../../tmp/t082-round2/summary.json); complete evaluation:
[`report.json`](../../tmp/t082-round2/report.json).

627/628 plan hashes equal round 1; the block diagram changes because of fresh
IDs and independently rejected unnecessary conductors. All 38 independent
review replays match this round's corpus hashes. All six large documents
(50, 50, 51, 103, 70, and 94 instances) are byte-identical to main and to a
second current run; evidence: [`large.json`](../../tmp/t082-round2/large.json).

### Held-out timing

The timing harness ran alone, after tests, corpus evaluation, large-document
checks, and visual rendering had finished. It warmed both implementations,
then measured three runs each in alternating order.

The initial run passed six cases but failed `ltc3452`: 14891.7 → 22087.4 ms
(1.483×). Both implementations had large timing variation across unchanged
planning phases: baseline samples were 25157.7/14891.7/14668.4 ms and current
samples were 24648.8/22087.4/14106.3 ms. Their last pair already favored current.
This suggested runtime variability, so only this failed case was rerun with
the same warmup and alternating three-sample procedure, without code changes.
The initial failure is preserved in `timing-initial.json`; its repeat is in
`timing-ltc3452-repeat.json`. The table uses the initial six passes and that
independent repeat, with per-row provenance in `timing.json`.

| Case               | Main median (ms) | Round 2 median (ms) | Ratio  |
| ------------------ | ---------------- | ------------------- | ------ |
| `fd-two-stage`     | 1835.4           | 1856.1              | 1.011× |
| `common-source-ac` | 1195.3           | 1245.8              | 1.042× |
| `skew`             | 1936.9           | 2020.7              | 1.043× |
| `deadtime`         | 17726.0          | 17556.2             | 0.990× |
| `ota-sky130`       | 1222.0           | 1215.0              | 0.994× |
| `widlar`           | 9902.2           | 9898.7              | 1.000× |
| `ltc3452`          | 14023.3          | 14428.4             | 1.029× |

All seven are deterministic and byte-identical to main; all medians are within
+20%. Maximum ratio: 1.043×. Samples, hashes, and phase timings:
[`timing.json`](../../tmp/t082-round2/timing.json).

`node tmp/t082-round2/timing.mjs` → 0; initially 6/7 timing gates pass.
`node tmp/t082-round2/timing-ltc3452-repeat.mjs` → 0; repeated failed case passes.

### Visual review

[Human | main 8cdec30 | round 2 review page](../../tmp/t082-round2/review.html)
contains all ten investigated drawings, the ten largest reductions (seven
improvements plus three unchanged ties), and the original 25 samples: 38 unique
drawings. All ten rendered sheets were inspected. There is no horizontal page
overflow at 1800px.

Recovered captions/arrows are closer to their owners in `dr4e8zhyjg`,
`nfa75tcbqf`, `mbpnznx3p5`, `m9knq7tpsz`, `vkafsqxh8n`, and `rxdzz3wdry`.
Collision-rejected examples and fixed samples retain main's layout. The block
diagram has one surviving free conductor and two reseated large ink groups;
its eight remaining unowned groups and fragmented layout are still visible.
The metric improvement is not full reconstruction of its human signal flow.

## Investigation results

The round 1 gate and per-group investigation below remain the design evidence.
Round 2 reruns the final corpus after the contract and runtime corrections.

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

### Proposed R150 addition for Opus

After selecting the ordinary finished plan, recover source conductors only in
plain planning with a nonzero search budget and 1–40 instances. A candidate Net
has no terminals; skip routes with bus members and junctions with terminal
members or contact anchors. Translate all its routes, bends, and junctions
rigidly by the displacement of the nearest visible source instance, measuring
bounds distance from the wire envelope and breaking ties by instance ID.

Allocate fresh Route, leg, bend, and Junction IDs using deterministic salting
against every source and ordinary-result object ID, including removed input
objects, and reserve every allocation during the pass. Rewrite conductor
endpoint references. Explicitly re-anchor movable drafting from the old
conductor to the newly allocated IDs, preserving its authored anchor offsets
and translated fallback positions. Never edit or reactivate locked drafting.

Reject any conductor collision with symbol bounds, pins, existing junctions,
conductors, or drafting ink, and any replay assigning the conductor to a
terminal Net. Accept each Net independently under the frozen composite,
calibrated-score, routing, and visual guards; preserve the terminal partition.
A rejected Net does not invalidate previously accepted recoveries.

For movable source-owned groups still unowned, try the original local offsets
and then both sides of the projected owner through ±40 grid steps. Require
ownership within the unchanged radius; preserve instance identity or the
terminal partition of an electrical owner. Distinguish terminal-free owners
by source Net identity. Only a singleton conductor may fall back to its
surviving terminal instance. Keep complete touching groups rigid and leave
groups merged with locked ink alone.

Check abort/deadline per Net, group, and offset. Limit clearance-passing seat
trials to `finishingTrialBudget(instanceCount, 128, false)` per group and
`finishingTrialBudget(instanceCount, 512, false)` per document. Cancellation
returns the ordinary result; exhausting a trial allowance retains accepted
work and stops the corresponding search.

Replay each accepted batch and the complete result. Preserve terminal
partitions, all R146 guards, label-owner-distance counts, and drafting overlap
limits. Never increase the frozen composite. Crossings, bends, and wire length
may increase only with a strictly lower composite; a calibrated-score increase
must reduce unowned groups. Keep the ordinary result if complete replay fails.

## Deviations and open questions

- No out-of-scope product changes were needed. Scratch evaluation, baseline,
  review, and timing artifacts live under `tmp/t082-round2` and `/tmp`.
- Per-Net acceptance now drops `net-ui-76` and `net-ui-268` in the block diagram;
  its surviving `net-ui-175` conductor plus reseating retain all four recovered
  groups and the exact round 1 composite improvement. The diagram still has
  eight unowned groups and remains visually fragmented.
- The broader within-20%-of-human goal remains unmet: dev is 1.245249× human
  and val is 1.224477×. This task preserves the bounded improvement without
  drawing-specific rules or changes to frozen metrics, weights, or radius.
- No plan/review, dependencies, lockfile, generated source, or frozen metrics
  were edited. No LLM provider API was called. No commit, push, merge, rebase,
  or branch switch was performed.
