# T072 report — round 1

## Summary

Drafting whose single-terminal wire disappears during routing now follows the
surviving pin of the same Net. A failed joint drafting candidate no longer
prevents independent, placeable groups from following the ordinary routed
result. Each touching component stays rigid; failed groups remain obstacles.
The fallback changes drafting only, retains routing/visual guards, and permits
a larger visible span only when the unchanged ownership metric improves.

Acceptance is partial: “New Circuit” still has one blocked Vref3 group. Its
intended pin has no accepted seat in the bounded R150 search without making
the group closer to another pin. Reserving more placement/routing clearance
would require changes outside the owned paths; an alternative seating policy
is an open design question. All final build/static/test commands, corpus
numeric gates, determinism, large-document identity and held-out timing gates
pass. Visual following remains incomplete.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                                                                    |
| ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Reproduced the named failure; classified all 264 final unowned groups in the 66 excess drawings (245 excess, 19 already unowned).                                                                                                                                                        |
| 2    | partial | Added the single-pin destination and guarded independent-group fallback in owned files. Pin contacts follow pin identity through facing; safe per-group fallback is implemented. Vref3 remains blocked by the bounded seat search; placement/routing clearance changes are out of scope. |
| 3    | done    | Added regressions for a circle/text stub, pin identity through mirroring, and independent following beside an unmappable group; updated the common-source corpus assertions. Existing rigid-block, locks and determinism tests pass.                                                     |
| 4    | done    | Evaluated all 628; rendered 32 comparison rows; verified 21 deterministic fixtures, six unchanged large plans and all seven held-out timing gates.                                                                                                                                       |

## Review findings addressed

Round 1: no `review.md` exists.

## Acceptance results

```text
pnpm build → 0; all builds complete (tmp/t072-r1/build.log).
pnpm typecheck → 0 (tmp/t072-r1/typecheck.log).
pnpm lint → 0; 2043 files, 0 errors, 3362 warnings (tmp/t072-r1/lint.log).
pnpm format:check → 0; all matched files use Prettier (tmp/t072-r1/format.log).
pnpm test:local → 1 in sandbox; EPERM on loopback sockets/PostgreSQL and
  one obsolete common-source assertion; 18 failed / 771 passed files,
  61 failed / 7976 passed tests, 2 errors (tmp/t072-r1/test-local.log).
pnpm test:local [outside sandbox, after assertion update] → 0;
  789 passed / 3 skipped files; 8070 passed / 117 skipped tests; 166.09 s
  (tmp/t072-r1/test-local-final.log).
pnpm test:slow → 0; 1 file, 7 tests passed; 99.29 s (tmp/t072-r1/test-slow.log).
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 completed, 439 dev / 189 val, none non-equivalent (tmp/t072-r1/eval-final.log).
node tmp/t072-r1/compare.mjs → 0; all numeric quality gates pass
  (tmp/t072-r1/comparison.json, comparison.log).
node tmp/t072-r1/verify.mjs → 0; 21 deterministic, error-free fixtures;
  six large plans byte-identical; all seven five-pair timing gates pass
  (tmp/t072-r1/verification.json, verification.log).
```

The sandbox run also had a 5000-ms socket-test timeout. No timeout setting was
changed. The unrestricted final run has no timeout failures. The first
unrestricted run isolated the common-source assertion as its only failure;
that assertion was updated as described below.

The final ownership-count implementation reproduces all 628 human input
measurements exactly, including both violations and opportunities:
`node tmp/t072-r1/check-human-metric.mjs` exits 0.

## Evaluation and visual review

| Metric                | Main → T072 dev               | Main → T072 val               | Gate |
| --------------------- | ----------------------------- | ----------------------------- | ---- |
| Unowned drafting      | 214 → 67 (−68.7%)             | 53 → 19 (−64.2%)              | pass |
| Readability composite | 130.322464 → 104.460085       | 57.165720 → 51.183946         | pass |
| Crossings             | 279 → 279                     | 153 → 153                     | pass |
| Bends                 | 1751 → 1751                   | 737 → 737                     | pass |
| Wire length           | 428454.629868 → 428454.629868 | 191616.116882 → 191616.116882 | pass |
| Median area ratio     | 1.273875 → 1.250031           | 1.226279 → 1.218725           | pass |

Every other weighted readability total is unchanged. All `VISUAL_*` totals
are unchanged: nonzero totals are clearance 191, overlap 5, owner distance 2,
run-on 40, terminal departure 49, terminal on foreign route 1, and wire through
symbol 17. Floating pins remain 6 and missing connections 16. The saved final
report is `tmp/t072-r1/final-report.json`.

The [comparison page](../../tmp/t072-r1/review.html) contains all eight named
drawings and the same 25 samples as T068: 32 unique drawings, with Human |
Main 19c0220 | T072 panels. All rows were rendered to `review-<id>.png` beside
the page. I inspected the eight named rows and all changed sample rows.
Only four of the 25 sample plans changed (`75k4jskamd`, `yb27wfgqkz`,
`6hnztg5nty`, `6n2s63bxv4`); the other 21 plan hashes match main.

| Named drawing | Human | Main | T072 unowned groups |
| ------------- | ----: | ---: | ------------------: |
| `qj62dz4qvm`  |     3 |   21 |                  15 |
| `nwarxxcwp7`  |     0 |   12 |                   1 |
| `59qxym4d4f`  |     0 |   10 |                   0 |
| `asq5c6m96w`  |     0 |   10 |                   0 |
| `ec8bty96h4`  |     0 |   10 |                   1 |
| `sgkrkm3czm`  |     0 |   10 |                   0 |
| `kyxytts7gz`  |     0 |    9 |                   1 |
| `75k4jskamd`  |     0 |    3 |                   1 |

The numerical improvement is **not complete visual acceptance**. In New
Circuit, Vref2 follows its amplifier input, but Vref3 remains fixed. Vin and
Vout still appear detached in the final render; proximity to other final
geometry can make an unchanged group count as owned. They must not be
reported as successfully attached to their intended wires. `qj62dz4qvm`
retains many disconnected drawing components, `ec8bty96h4` retains the remote
Vx annotation, and `kyxytts7gz` retains the remote R2 annotation. `asq5c6m96w`
is substantially less orphaned but its small D1/D2 annotations are crowded
near the upper device, so zero unowned groups does not prove correct pin
association for all text. These remain review/follow-up items; no validation
results were used for tuning.

## Determinism, large documents and runtime

The seven held-out fixtures pass five alternating baseline/task timing pairs
each. Median paired ratios are all below 1.10. No test suite, corpus evaluation
or browser rendering ran during these measurements. Baseline code is the
unmodified build copied before implementation to `tmp/t072-r1/main-dist`.

| Held-out fixture | Main median ms | T072 median ms | Median paired ratio |
| ---------------- | -------------: | -------------: | ------------------: |
| fd-two-stage     |         3898.1 |         3933.7 |             1.0092× |
| common-source-ac |         1035.1 |         1027.8 |             0.9940× |
| skew             |         1985.5 |         1843.7 |             0.9904× |
| deadtime         |        16068.5 |        15781.0 |             0.9889× |
| ota-sky130       |          711.5 |          696.6 |             0.9766× |
| widlar           |         5769.7 |         5751.7 |             1.0002× |
| ltc3452          |        28918.0 |        29311.3 |             1.0074× |

Evidence: `tmp/t072-r1/verification.json` and `verification.log`. The repeated
held-out and named plans are deterministic. All six large plans are
byte-identical to main and deterministic: `38m8wdesbh` (50 instances),
`4fb59zv76m` (50), `8b2n3zf9vj` (51), `b9afqhsjzv` (103),
`g47e465db5` (70), and `sm663cbs8b` (94). All 21 verification fixtures have
zero error diagnostics. No additional large-document renders are needed
because none changed.

The informational single pair for `qj62dz4qvm` is 932.8 → 1328.2 ms (+42.4%). The informational single pair for `sgkrkm3czm` is 282.7 → 332.8 ms (+17.7%). These are outside the held-out runtime gate, but show the extra fallback cost
on drafting-heavy drawings and remain a performance follow-up.

## Investigation results

The original reproduction, `node tmp/t072-r1/diagnose.mjs`, failed with
`3 !== 0` on `75k4jskamd`. The minimal single-resistor/circle/text regression
also failed: the circle stayed at `(495,380)` after placement. Both passed with
the initial single-pin fix. Visual inspection then exposed an ambiguous Vref3
seat: the circle had been moved nearer a different pin. The final version
keeps that group fixed, so the original named zero-unowned assertion now
reports `1 !== 0`; it is retained as an unresolved reproduction, not weakened.
A second regression demonstrated that one unmappable conductor prevented an
unrelated device note from moving; that now passes too.

The baseline was reproduced from this branch's unchanged product sources,
before editing them. Every excess drawing's final unowned groups were matched
to their input group by drafting object identity. Classification prioritizes
an unavailable owner over the resulting lack of movement:

| Cause                                               | Final groups | Interpretation                                                                      |
| --------------------------------------------------- | -----------: | ----------------------------------------------------------------------------------- |
| No input owner                                      |           19 | Already unowned in the input; not part of the 245 excess.                           |
| Owner removed/rerouted without a mapped destination |           58 | 29 single-terminal Nets, 29 zero-terminal Nets.                                     |
| Owner maps, but the group was not moved             |          183 | Whole-candidate refusal, including failure caused by another group.                 |
| Moved beyond the ownership radius                   |            4 | Clearance offsets or changed symbol orientation leave small ink outside the radius. |
| Total                                               |          264 | 66 drawings; 245 excess over their input count of 19.                               |

Per-group object IDs, input owner, input/result bounds and expected displacement
are recorded in `tmp/t072-r1/group-causes.json`; per-drawing counts are in
`tmp/t072-r1/investigation-summary.json`. The original reproduction log is
`tmp/t072-r1/diagnosis.log`. These cover every excess group, not only samples.

| Named drawing | Human → main | Removed owner | Mappable, unmoved | Already unowned | Observed joint rejection                                       |
| ------------- | -----------: | ------------: | ----------------: | --------------: | -------------------------------------------------------------- |
| `qj62dz4qvm`  |       3 → 21 |            13 |                 5 |               3 | Missing displacement; includes zero-terminal conductor owners. |
| `nwarxxcwp7`  |       0 → 12 |             6 |                 6 |               0 | Six removed single-terminal input stubs.                       |
| `59qxym4d4f`  |       0 → 10 |             0 |                10 |               0 | Finished routing/drafting audit guard.                         |
| `asq5c6m96w`  |       0 → 10 |             2 |                 8 |               0 | Removed single-terminal drain/source stubs.                    |
| `ec8bty96h4`  |       0 → 10 |             0 |                10 |               0 | No collision-free seat for a group.                            |
| `sgkrkm3czm`  |       0 → 10 |             8 |                 2 |               0 | Missing displacement.                                          |
| `kyxytts7gz`  |        0 → 9 |             0 |                 9 |               0 | No collision-free seat for a group.                            |
| `75k4jskamd`  |        0 → 3 |             1 |                 2 |               0 | Missing displacement for removed single-terminal stubs.        |

In “New Circuit”, Vin's owner is the Net with terminal `M1.G`, and VB4's owner
is the Net with terminal `M4.G`. Routing removes both singleton stubs. The old
mapper searched only final junctions, routes and multi-endpoint pin contacts;
neither singleton pin qualified, so it rejected all five groups. VB4 happened
to remain near other final geometry and was not itself counted as unowned.
The fix resolves the unique terminal on the matched Net; it does not infer Net
identity from text or create electrical connectivity.

`qj62dz4qvm` includes very large touching drawing components attached to
conductors with no terminals (`net: "[]"`). There is no unique surviving
electrical owner to map. They remain fixed if they cannot be moved safely;
other groups can now be considered independently.

The four moved-but-unowned examples are `3ze5gasahn/note-16` (30-unit clearance
shift beyond its preferred device displacement), `vkafsqxh8n/note-21_2`
(20-unit clearance shift beyond its conductor displacement), and
`m9knq7tpsz/note-2`, `ymgvbwf9jv/text-4` (translation follows the owner's centre,
but the changed symbol orientation leaves the small note outside its radius).
The ownership search already uses original input geometry. The final change
refines an already-owned group to a unique visible pin touched by its circle
or its selected conductor contact, without changing whether it has an owner.
A new failing-then-passing mirrored-amplifier regression demonstrated why
centre displacement alone can follow the wrong input after facing. The
final seat search also keeps a translated contact closest to its intended
pin (allowing coincident shared contacts).

### Proposed R150 spec text for Opus

Add after the conductor mapping rule:

> Refine an already-owned group to a unique visible terminal when its input
> circle touches that terminal (within one unit of its radius), or its
> conductor contact coincides with it. Preserve the pin identity through
> mirroring and rotation. Reject clearance offsets that put the translated
> contact at least as close to a different visible pin location.
> If a matched Net has exactly one terminal and its routed conductor has
> disappeared, map its drafting owner to that surviving terminal. Do not
> invent a destination for an empty or ambiguous terminal partition.

Replace the whole-plan failure behavior with:

> If the jointly seated candidate fails, try each owned touching component
> independently against the ordinary finished electrical plan, in input group
> order. Keep all other drafting as obstacles. Missing owners, unsupported
> rotations and failed seats leave that entire component fixed. Treat all
> unowned components as one rigid batch. Each accepted batch preserves the
> terminal partition and cannot increase crossings, bends, wire length,
> drafting-overlap count or any R146 routed guard. This fallback changes only
> drafting; it performs no placement or routing search. An owned batch may
> increase the R149 calibrated score only if it reduces the final number of
> unowned drafting groups. Otherwise require the existing score guard. Retain
> the original locked/fixed handling and nine-by-nine seating grid.

## Deviations and open questions

- The common-source corpus assertion previously required all drafting positions
  to remain unchanged. Two owned notes now follow safely. Its existing checks
  for exact content/style preservation, object IDs, text dimensions, locks and
  owner distance now cover this fixture too. Explicit assertions require the
  two movable notes to move and the blocked third note to remain unchanged.
  No test was removed or timeout raised.

- No metric, weight, ownership radius, parallel-work file, plan or review was
  edited. No dependencies were changed and no provider API was called.
- Zero-terminal conductors have no electrical destination. The fix preserves
  their affected groups instead of guessing a Net or changing connectivity.
- The proposed independent-group fallback and ownership-over-span preference
  extend R150 and are recorded above for Opus to apply to the spec.
- To complete Vref3 following in `75k4jskamd`, reserve caption clearance beside
  `X2.IN+` when placing/facing the devices, or preserve an external wire end in
  free space. At the preferred seat its text conflicts with `X1` and the
  `route-net-f0d301aea2404c98-route` conductor. Placement/facing/routing changes
  belong to the excluded parallel-work files; they were not attempted.
- Numeric and automated acceptance is complete. Visual acceptance remains
  partial for the specific reasons above. The task branch is unchanged and
  no commit, push, merge, rebase or branch switch was performed.
