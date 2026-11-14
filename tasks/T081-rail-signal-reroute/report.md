# T081 report — round 1

## Summary

Implemented the planned signal-side R148 retries and two geometry-derived
outside tracks. The pass reuses R148's label finishing, calibrated comparison,
routing guards, protection checks and cancellation. Added synthetic regression
coverage for source-drop repair, rejected readability trades, protected and
locked signals, the 40-instance boundary and determinism.

**Partial: the prescribed search does not meet the corpus quality acceptance.**
Dev composite and rail crossings are unchanged. One validation drawing,
`3brrjxvweb`, has a composite increase of 0.000428115994. No placement,
marker-seating, frozen metric or weight changes were made to compensate.

## Steps

| Step                  | Status  | Notes                                                                                                                                                                                 |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — investigate       | done    | Traced all 16 named dev drawings with main; all baseline plan hashes reproduced. Classified 18 signal–rail crossings and the other two dev rail–rail crossings. Details below.        |
| 2 — signal retries    | done    | After rail retries, at most three eligible signals, ranked by rail crossings, total crossings and stable Net id. Rechecks retained crossings after each winner.                       |
| 3 — outside tracks    | done    | At most one extra track per axis beyond the crossed rails, on the side away from the signal-pin envelope. Unlocks legal candidates in two dev gate rows, but neither wins acceptance. |
| 4 — tests             | done    | Eleven tests in `rail-crossings.test.ts`, including the existing four R148 tests. Only synthetic circuits were added.                                                                 |
| 5 — evaluation/review | partial | All 628 evaluated; quality targets fail. Review page, determinism and timing evidence are recorded below.                                                                             |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

All seven required commands were run. Logs are in `tmp/t081-round1/`.

```text
pnpm build → 0; recursive package/app build completed (existing chunk-size warning).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2065 files, 0 errors, 3457 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 1; 1 failed | 8195 passed | 117 skipped (8313).
  Test Files: 1 failed | 796 passed | 3 skipped (800).
  local-rail-markers.test.ts:260: expected false to be true.
pnpm test:slow → 0; 2 files passed, 8 tests passed.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  completed 628/628; wrote report.json and index.html.
```

The required corpus-quality gates fail despite the evaluation command exiting
zero; see the measurements below. The existing local marker assertion is
explained separately and remains unchanged. The newly expanded focused suite
passes **11/11** (`pnpm exec vitest run
packages/auto-layout/test/rail-crossings.test.ts --maxWorkers=2`).

The first sandboxed local run had PostgreSQL/loopback `EPERM` failures
(`test-local-sandbox.log`). Rerunning the identical full command outside the
sandbox resolved those environment failures and isolated the one marker test.
Headless Chrome rendering likewise needed an approved sandbox escalation.
No assertion, timeout or skip configuration was relaxed.

Additional evidence commands:

```text
node tmp/t081-round1/verify-large.mjs → 0; six plans equal main and repeat exactly.
node tmp/t081-round1/verify-review.mjs → 0; 44/44 replay hashes match the evaluation.
node tmp/t081-round1/timing.mjs → 0; seven deterministic cases within +20%.
node tmp/t081-round1/render-review.mjs → 0; 11 sheets, no horizontal overflow.
```

## Investigation results

The investigation used the frozen `/tmp/t081-baseline/dist` build, with a
module-resolution link to this worktree's existing auto-layout dependencies.
An in-memory Node loader observed main's local-reroute trials without editing
its generated files. All 16 baseline hashes match `tmp/main-8cdec30-report.json`.
The additional routing probes remove one signal at a time from the finished
main geometry, retaining other routes. These geometry probes use identity
label finishing; the full evaluation exercises actual label finishing.

Across the 18 signal–rail crossings, **17 signals were tried by an earlier
signal pass**, and **12 have at least one legal standard-track candidate**
against the finished geometry. **Seven signals have a legal standard
candidate with different conductor geometry**; the other five legal cases
only reconstruct their existing geometry. Collinear intervals are merged
before comparison, so route IDs and segment splits do not count as a change.
“Earlier trials” and “rail trials” below count
all invocations during main's search, including speculative placement trials;
they do not imply that the trial survived final selection. The signal-side
probe tests tree and both-axis tracks; legal counts include unchanged routes.

| Drawing      | Signal Net                                 | Crossed rail Net                                          | Earlier trials | Rail trials | Legal / different | Legal kinds      |
| ------------ | ------------------------------------------ | --------------------------------------------------------- | -------------: | ----------: | ----------------: | ---------------- |
| `2adejzy693` | `net-eb4e64d55fe6b9b8`                     | `net-power-vdd1`                                          |             30 |           0 |             0 / 0 | none             |
| `2adejzy693` | `net-contact-q3`                           | `net-power-gnd7`                                          |              2 |           3 |             3 / 1 | horizontal, tree |
| `3cr8ap2k4c` | `net-split-7dac48e4d9c8ca65-copy-1-copy-1` | `net-split-bea6f4ed03ac2b08`                              |             15 |           2 |             1 / 0 | tree             |
| `3cr8ap2k4c` | `net-ui-81-copy-1-copy-1-copy-1-copy-1`    | `net-power-vdd1`                                          |             30 |           0 |             1 / 1 | tree             |
| `54a79nkqef` | `net-ui-9-copy-1`                          | `net-power-vdd1`                                          |             21 |           0 |             0 / 0 | none             |
| `69ksgcs72g` | `net-cell-pin-p2`                          | `net-power-agent-rail-0350a8230bee0e3d`                   |             66 |           0 |             1 / 1 | tree             |
| `6r2q6deeq9` | `net-5cadb12023293868`                     | `net-681813769330fd73`                                    |              0 |           2 |             1 / 0 | tree             |
| `6s67mqbxx9` | `net-cell-pin-d0916a5db65ff6c3`            | `net-power-instance-bf226033-ff5c-497a-a2db-465f35c29438` |             17 |           1 |             0 / 0 | none             |
| `7d93gjqbw8` | `net-e51d597502770757`                     | `net-power-vdd1`                                          |             24 |           0 |             1 / 0 | tree             |
| `ecyqst76jd` | `net-ui-301-copy-1`                        | `net-power-vdd1`                                          |             28 |           0 |             0 / 0 | none             |
| `fbnrez8q5g` | `net-contact-c1`                           | `net-power-gnd1`                                          |             35 |           2 |             2 / 1 | horizontal, tree |
| `ftrjkg4566` | `net-ui-1`                                 | `net-power-vdd1`                                          |             25 |           0 |             1 / 0 | tree             |
| `jz7rweg6gg` | `net-contact-p3`                           | `net-cell-pin-vdd3`                                       |             17 |           1 |             1 / 1 | tree             |
| `kjs4xgzkba` | `net-47d9affb30fc01ea`                     | `net-ui-3`                                                |              6 |           1 |             0 / 0 | none             |
| `ray97q5c2j` | `net-ui-9`                                 | `net-power-vdd1`                                          |             41 |           0 |             1 / 1 | tree             |
| `rryf923yjz` | `net-ui-1`                                 | `net-power-vdd1`                                          |             64 |           0 |             1 / 0 | tree             |
| `westxcef83` | `net-6256ba76b986652c_3`                   | `net-power-vdd1`                                          |              1 |           0 |             0 / 0 | none             |
| `x7evbngj49` | `net-ui-81-copy-1-copy-1`                  | `net-power-vdd1`                                          |             34 |           0 |             1 / 1 | tree             |

`6r2q6deeq9` exposes an important distinction: its control-source Net has
the legacy `supply` role but is absent from `roles.rails`. The earlier signal
pass skips it. The new pass uses the rail set and does retry it; its tree
candidate is legal but not an improvement. A synthetic grounded control-source
test covers this eligibility distinction.

Each row represents one crossing. The remaining two dev crossings are rail ×
rail: `ean7z7acmp` (`net-ui-46_4` × `net-split-7d5b00ef9416e7cc_2`) and
`yn2pjbpeby` (`net-ede067c7782ea5cf` × `net-d116ab7bd9b94c10`), which have no
signal side to retry. Main's R148 does not retry any signal Net by construction.

The extra tracks produce legal gate routes that the standard set cannot
express in `2adejzy693` and `ecyqst76jd`. The outside horizontal tracks
increase total crossings from 3 to 6 and
from 2 to 5, respectively; neither lowers the frozen composite. These are
candidate-access improvements, not accepted drawing improvements.
No Gallery drawing or drawing-specific recognition rule was added to tests
or product code.

Temporary evidence: `tmp/t081-round1/investigate.mjs`,
`*-investigation.json`, `investigation-summary.json`, and
`investigate-extra.mjs`; `geometry-probe.mjs` distinguishes actual conductor
changes from route reconstruction. Full evaluation evidence is
`tmp/t081-round1/final-report.json` and `tmp/t081-round1/comparison.json`.

## Existing marker-test failure

`pnpm test:local` also finds a behavioral interaction with
`packages/auto-layout/test/local-rail-markers.test.ts:260`,
“adds local markers through the public planner with fixed device poses”.
The test requires an `add_instance` edit. Main inserts one ground marker;
T081 instead removes the crossing by rerouting the signal and adds none.
A direct reproduction against both builds shows:

| Result                                       |           Main |           T081 |
| -------------------------------------------- | -------------: | -------------: |
| Added instances                              |              1 |              0 |
| Crossings                                    |              0 |              0 |
| Bends                                        |              0 |              0 |
| Wire length                                  |            280 |           1100 |
| Frozen composite                             | 0.026653961775 | 0.026588208550 |
| Equivalent terminals / fixed poses preserved |            yes |            yes |

This is a real failing existing assertion, not a sandbox failure. It remains
unchanged: the plan does not authorize weakening it, and forcing the old
marker-insertion choice would alter marker selection outside the requested
signal pass. Evidence: `tmp/t081-round1/marker-repro.mjs`,
`marker-repro.json` and `test-local.log`.

## Corpus acceptance

| Metric            |        Main dev |        T081 dev |        Main val |        T081 val |
| ----------------- | --------------: | --------------: | --------------: | --------------: |
| Frozen composite  | 61.058969145544 | 61.058969145544 | 33.575480766391 | 33.575908882385 |
| Composite / human |  1.270882303390 |  1.270882303390 |  1.244033081652 |  1.244048944134 |
| Rail crossings    |              20 |              20 |              15 |              15 |

Only `3brrjxvweb` changes its final plan hash: composite increases by
0.000428115994, bends decrease from 21 to 19, wire length increases from 2500
to 2520 and drawing width increases from 651 to 671. The other 627 plan hashes
match main exactly. No drawing's composite falls, so there is no top-ten
improvements set to report. The val-equality exception does not apply.

A direct trace of both finishing invocations for `3brrjxvweb` shows the
signal pass itself keeping the composite at 1.505537417248, rail crossings
at 4 and wire length at 2930, while reducing bends 23 → 21 and calibrated
score 66704.618269 → 66504.618269. Placements are identical across that pass.
The regression appears in subsequent finishing: final composite
1.212682285554 versus main's 1.212254169560. The existing R148 acceptance
licenses the intermediate bend reduction. Requiring a frozen-composite
improvement for every new signal winner, or changing later finishing, would
change the specified acceptance/design and was not substituted in this round.
See `tmp/t081-round1/regression-trace.mjs` and `regression-trace.json`.

Safety acceptance passes: **628/628 equivalent**; floating pins **6 → 6**;
missing connections **4 → 4**. Every `VISUAL_*` total is unchanged, including
label clearance. Nonzero totals: clearance 272, overlap 3, owner distance 2,
label run-on 29, terminal departure 34, terminal on foreign route 1, and wire
through symbol 4. All other visual totals remain zero.

## Review, determinism and timing

[Human | main | T081 review page](../../tmp/t081-round1/review.html): all 21
named drawings and the original 25 samples, **44 unique drawings**. There
are no composite reductions to add as a top-ten group. Main SVGs are reused
only for identical full plan hashes; `3brrjxvweb` was independently replanned
with the main build and its baseline hash verified. Diagnostic block overlays
are omitted from all three columns. All eleven rendered sheets were visually
inspected at 1800 pixels
without horizontal overflow. The 25 sample drawings and every named dev
drawing remain identical to main; the changed validation row exposes the
slightly wider final routing. All 44 independent review replays matched the
full evaluation plan hashes (`tmp/t081-round1/determinism.json`). Membership
and rendering evidence:
`tmp/t081-round1/review-cases.json`, `review-verification.json`, `render.json`.

All six large documents (50–103 instances) are byte-identical to main and
repeat exactly: `38m8wdesbh`, `4fb59zv76m`, `8b2n3zf9vj`, `b9afqhsjzv`,
`g47e465db5`, `sm663cbs8b`. Evidence: `tmp/t081-round1/large.json`.

Held-out timing ran alone, with warmups followed by three alternating
main/current pairs per case. Every median is within +20%, every repeated
plan is deterministic, and all seven plans equal main. Evidence:
`tmp/t081-round1/timing.json`.

| Held-out case      | Main median ms | T081 median ms |  Ratio |
| ------------------ | -------------: | -------------: | -----: |
| `fd-two-stage`     |         1577.3 |         1632.5 | 1.0350 |
| `common-source-ac` |         1041.2 |         1025.6 | 0.9850 |
| `skew`             |         1774.4 |         1818.6 | 1.0249 |
| `deadtime`         |         9910.2 |         9946.5 | 1.0037 |
| `ota-sky130`       |          683.0 |          682.6 | 0.9994 |
| `widlar`           |         5314.3 |         5341.1 | 1.0050 |
| `ltc3452`          |        13942.2 |        13947.6 | 1.0004 |

## Proposed R148 spec addition

After the rail-Net retries, retry at most three eligible non-rail Nets that
still properly cross a rail in the retained geometry. Rank by rail-crossing
points counted separately per rail/signal Net pair, then total crossings,
then stable Net id. Keep all other signal and rail geometry as obstacles.
Try the tree and the full horizontal/vertical pin-envelope trunk set. Add
at most two outside tracks, one per axis, one grid line beyond the crossed
rails on the side away from the signal-pin envelope; deduplicate tracks.

Finish labels before comparison. Retain only a strictly lower calibrated
score under R148's existing routing/connectivity, terminal partition,
name-claim, readability and visual guards. Crossing, bend or wire increases
require a strictly lower frozen composite. Ties retain the incumbent.
Skip protected, locked, member-owned, nonorthogonal and direct-contact
routing as in the rail pass, and check cancellation between trials. Keep
R148's existing default-mode, nonzero-budget and at-most-40-instance gate.

## Deviations and open questions

- The implementation follows the prescribed search, but the requested dev
  improvement and no-drawing-regression gates fail. It is not ready to be
  accepted on quality grounds. Further candidate/selection design belongs
  in a revised plan; this round does not change placement or relax guards.
- The extra tracks unlock legal geometry in two named gate cases but no
  accepted corpus improvement. Their small synthetic repair does not
  establish the expected 1.0–1.5 dev composite gain.
- The existing public marker-insertion test fails as described above. No
  existing test was weakened, skipped or removed.
- No dependencies were installed or changed, no provider API was called,
  and no commits, branch switches, pushes or plan/review edits were made.
