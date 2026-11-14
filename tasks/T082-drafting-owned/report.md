# T082 report — round 1

## Summary

Added a final drafting recovery pass after the ordinary layout winner is selected.
It restores collision-free terminal-free conductors and their junctions with one
rigid translation per Net, then searches for seats for stranded source-owned
ink. The ownership query can select just the moving component while preserving
full-document grouping and lock semantics, avoiding repeated unrelated work. Recovery replays through the edit engine and preserves terminal partitions,
R146 guards, drafting overlap limits, the frozen composite, and R150's calibrated
score exception. The frozen metric, ownership radius, and weights are unchanged.

The investigation gate passed before implementation: transaction-replayed
prototypes recovered six dev groups (four in `qj62dz4qvm`, one each in
`dr4e8zhyjg` and `nfa75tcbqf`) without increasing any of those drawings' frozen
composites. Final corpus, visual, and timing results are recorded below.

## Steps

| Step                         | Status | Notes                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Investigation gate        | done   | All 21 baseline-unowned groups in the ten named drawings investigated. Prototyped the first three requested drawings first. Six dev recoveries passed replay and score checks.                                                                                                                                                                     |
| 2. Carry terminal-free wires | done   | `recover-drafting-owners.ts`: connectivity-only eligibility; translate bends and shared junctions together; reject symbol, pin, junction, conductor, and drafting collisions. Explicitly reject replay into a terminal Net, which terminal-partition equality alone would not catch.                                                               |
| 3. Reseat stranded groups    | done   | Keep the ordinary result, try its local offsets, then search both sides around the projected owner through ±40 grid steps. Check owner identity and the complete batch guards before accepting a seat; a rejected seat does not end the search.                                                                                                    |
| 4. Synthetic tests           | done   | Block diagram with bent free conductor and caption; rigid translation; conductor/symbol collision rejection; terminal equivalence; stranded caption behind a locked obstacle outside the local search; source immutability and determinism; locked route-anchor reactivation rejection; scoped queries preserve unselected touching ink and locks. |
| 5. Corpus and review         | done   | Evaluated all 628 drawings and inspected the 38 unique human/main/T082 review comparisons. Six large documents remain deterministic and byte-identical. Held-out timing results are below.                                                                                                                                                         |

## Review findings addressed

Round 1; no `review.md` exists for this task.

## Acceptance results

```text
pnpm build → 0; all packages/apps built (existing Vite chunk-size warnings).
pnpm typecheck → 0.
pnpm lint → 0; 2067 files, 0 errors, 3457 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm test:local → 0; 798 files passed, 3 skipped;
  8195 tests passed, 117 skipped (8312), 95.45 seconds.
pnpm test:slow → 0; 2 files, 8 tests passed, 73.83 seconds.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628/628 equivalent.
```

The first sandbox `test:local` run failed on PostgreSQL/local listener access:
`EPERM`, including `syscall: 'listen', address: '127.0.0.1'`; 17 files failed,
780 passed, 3 skipped; 60 tests failed, 8096 passed, 150 skipped, two errors.
A permitted local-service rerun overlapped heavy evaluation work and had two
unrelated failures: `component-catalog.test.ts` exceeded its 5000 ms timeout,
and `host-lifecycle.test.ts` observed an alarm before its zero-fired assertion.
Both files subsequently passed (16 tests), and the complete suite then passed
with local-service access and no overlapping evaluation work. No unrelated
source or test was modified.

Build/check logs are `/tmp/t082-{build,typecheck,lint}-final.log`,
`/tmp/t082-test-local-final.log`, and `/tmp/t082-test-slow-final.log`.
Earlier evaluation and large-document runs overlapped implementation builds;
they were superseded, and the interrupted runs are not acceptance evidence.

### Corpus, determinism, large documents, and timing

The complete corpus comparison yields:

| Measure              | Dev: main → T082            | Val: main → T082            |
| -------------------- | --------------------------- | --------------------------- |
| Frozen composite sum | 61.058969146 → 59.827427297 | 33.575480766 → 33.047677117 |
| Composite / human    | 1.270882× → 1.245249×       | 1.244033× → 1.224477×       |
| Unowned drafting     | 29 → 22                     | 11 → 8                      |
| Floating pins        | 6 → 6                       | 0 → 0                       |
| Missing connections  | 4 → 4                       | 0 → 0                       |

All 628 drawings are equivalent. Seven composites improve, 621 are identical,
and none increases. Every `VISUAL_*` total is unchanged, including the
zero-weight label-clearance total; the per-drawing visual, floating, and missing
checks also have no regression. The gains are 1.231541848 dev composite units
and 0.527803649 validation units. The additional dev recovery beyond the gate
is `rxdzz3wdry`; no drawing-specific eligibility was added.
All 628 final plan hashes match the pre-optimization run, confirming that the
ownership-query optimization preserves the complete corpus output.

All six large documents are deterministic and byte-identical to main. None
contains a terminal-free route, so the final locked-route-anchor guard does not
execute on these fixtures. Full hashes are in `tmp/t082-round1/large.json`.

The first isolated timing run had one failure: deadtime was 1.447× main
(10000.6 → 14465.9 ms) with identical output. Profiling identified repeated
ownership calculations for all unrelated components at each rejected seat.
The scoped ownership query keeps all ink for grouping/locks, but calculates
owners only for the moving component; repeated terminal-partition keys are
cached within the query. A direct recovery profile fell from 4470.4 to
1375.9 ms with identical edits. This changes search cost, not candidates or
acceptance. The final isolated run passes all seven held-out cases (one warmup
per implementation, three measured runs each, alternating execution order):

| Case               | Main median (ms) | T082 median (ms) | Ratio  |
| ------------------ | ---------------- | ---------------- | ------ |
| `fd-two-stage`     | 1639.4           | 1649.8           | 1.006× |
| `common-source-ac` | 1064.0           | 1064.3           | 1.000× |
| `skew`             | 1789.3           | 1809.7           | 1.011× |
| `deadtime`         | 10009.1          | 11284.6          | 1.127× |
| `ota-sky130`       | 690.3            | 690.4            | 1.000× |
| `widlar`           | 5433.4           | 5403.8           | 0.995× |
| `ltc3452`          | 14162.2          | 14060.9          | 0.993× |

All seven plans are deterministic and byte-identical to main. The largest
median ratio is 1.127×, within the 1.2× limit. Samples, hashes, and phase timings
are in `tmp/t082-round1/timing.json`; the failed initial benchmark is retained
as `timing-before-optimization.json`.

### Visual review

[Human | main 8cdec30 | T082 review page](../../tmp/t082-round1/review.html):
38 unique drawings comprising all ten investigated drawings, the ten largest
score reductions (seven improvements plus three unchanged ties), and the
original 25 fixed samples. All 38 independent plan replays match the corpus
hashes. Diagnostic partition overlays are removed consistently from all columns.
The page has no horizontal overflow at 1800 pixels; all ten rendered sheets
were inspected and are archived alongside it.

The recovered captions/arrows sit closer to the circuit in `dr4e8zhyjg`,
`nfa75tcbqf`, `mbpnznx3p5`, `m9knq7tpsz`, `vkafsqxh8n`, and `rxdzz3wdry`.
The collision-rejected examples and the fixed samples retain main's layout.
The block diagram remains visibly fragmented and has eight unowned groups:
three restored conductors and two reseated large ink groups improve attachment,
but do not reconstruct its human-drawn signal flow. Its composite improvement
must not be read as full visual recovery of the diagram.

## Investigation results

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

After selecting the ordinary finished plan, recover source conductors whose
Nets contain no terminals. Translate each such Net's routes, bends and junctions
rigidly by the displacement of the nearest visible source instance, using the
wire envelope's bounds distance and instance ID to break ties. Keep a complete
Net together so shared junctions cannot receive conflicting translations.
Reject any collision with symbol bounds, pins, existing junctions or conductors,
or drafting ink; reject any replay that assigns the conductor to a terminal Net.
Reactivating route anchors must not move a locked touching component; compare
its resolved ink with the ordinary finished result before accepting the wire.

For R150's existing small-document scope, independently reseat any movable,
source-owned group still unowned in the finished result. Try the original local
offsets and then both sides of the projected owner through ±40 grid steps.
Reject positions outside the ownership radius before expensive geometry work.
Preserve instance identity, or terminal partition for rerouted conductors;
distinguish terminal-free owners by source Net identity. A collapsed singleton
conductor may use its surviving terminal's instance. Continue after an invalid
seat, including a failed audit, rather than rejecting the batch immediately.
Keep locked and other groups as obstacles, preserve the entire moving group,
and use the existing authoring transform for anchors and unsupported rotations.

Replay every accepted batch and the complete result. Preserve terminal
partitions, all R146 guards and label-owner-distance counts, and do not increase
drafting overlaps or the frozen composite. Crossings, bends and wire length may
increase only with a strictly lower composite. A calibrated-score increase must
reduce unowned groups. Keep the ordinary result if the complete recovery fails.
Do not reseat drafting in documents above 40 instances; collision-free conductor
recovery still applies there. Deadline/abort returns retain the ordinary result.

## Deviations and open questions

- Recovery runs once after finished-plan selection, so this task does not alter
  candidate ranking or spend the wider search on discarded candidates. It uses
  the existing R150 object transformer and acceptance contracts.
- Shared-junction conductors use one displacement per terminal-free Net,
  measured from its whole wire envelope. This makes the plan's rigid-translation
  requirement unambiguous when different segments have different nearest parts.
- The metric's ownership definition is unchanged. Adding `netId` to internal
  owner records distinguishes distinct empty terminal partitions for reseating;
  no source drawing IDs, names, text, or coordinates control eligibility.
- The no-ink-collision rule intentionally leaves several authored free wires
  dropped, including wires which would touch arrows. Restoring them would need
  a different collision policy; it was not relaxed here.
- The broader within-20%-of-human target remains unmet: the final composite
  ratios are 1.245249× dev and 1.224477× val. This task improves both splits
  without a per-drawing regression.
- No plan, review, dependency, lockfile, generated source, or frozen metric was
  edited. No LLM provider API was called. No commit, push, merge, rebase, or
  branch switch was performed.
