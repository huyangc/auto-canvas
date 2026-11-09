# T024 report — round 1

## Summary

Implemented R90–R93: anchored common-gate recognition and chain alignment,
split-tail roles and outward-facing movement units, and geometric two-gate bias
port seats. Extended independent benchmark labels, per-kind deferral, synthetic
cases, placement/persistence tests, and the spec. No existing test expectations
were changed. No commits or branch changes were made.

All quick-mode targets pass: crossings **299 → 298 dev** and **385 → 369 val**,
bends **738 → 728**, floating pins **71 → 59**, and 33/33 completed. Maximum
width/base is **1.0979**. Every labeled hand structure is exact; every T022
external structure kind retains its baseline score. Eligible LOADBench
common-gate precision/recall are 1/1; CircuitGenome common-gate precision/recall
are 1/0.5, with all misses explained by the required anchor restriction.

## Steps

| Step | Status | Notes                                                                                                                                                                                         |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Re-measured both base modes before recognition changes; extended LOADBench/CircuitGenome labels and hand cases; saved both before snapshots.                                                  |
| 2    | done   | Common-gate candidates require symmetric anchors; fixed-point reachability rejects conflicting partners without ID tie-breaking. Units and persisted templates follow anchor sides.           |
| 3    | done   | Exactly two compatible parallel transistor tails with distinct gates carry both tail roles; composites retain both. Other ambiguities remain.                                                 |
| 4    | done   | Both placement strategies honor optional facing and center split-tail units one row toward supply.                                                                                            |
| 5    | done   | R93 seats geometrically eligible ports above, then below the gate line, with R71 overlap checks and unchanged edge fallback.                                                                  |
| 6    | done   | Hand exactness and rename/shuffle invariance; both placement strategies; inward/outward and blocked seats; persistence, BJT pins, incompatible families, rails, conflicts and tail negatives. |
| 7    | done   | Updated R5/R81/R83/R84 and added R90–R93.                                                                                                                                                     |
| 8    | done   | Before/after recognition, quick/search, rule ablations, counts, anonymous document effects and held-out caveats below.                                                                        |

## Review findings addressed

Round 1; no review.md was present. A new generic compatibility test exposed a
one-sided mirror orientation regression during implementation. Preserving the
previous one-drain orientation before propagating complete stack links fixed it.
The test remains; no existing expectation was weakened or changed.

## Acceptance results

All commands ran from the repository root with:

```bash
export ICM_E2E_PORT=4273
export AUTO_CANVAS_E2E_API_PORT=4321
export AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2
```

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm vitest run packages/auto-layout → 0; 16 files, 335 tests passed.
pnpm test:local → 0; 752 files passed, 2 skipped; 7,616 tests passed, 116 skipped.
pnpm deadcode 2>&1 | grep -E 'auto-layout' → grep 1; no output (expected).
pnpm build → 0
pnpm auto-layout:review → 0; 9 corpus and 7 held-out results rendered.
pnpm auto-layout:recognition --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/t024-after.json → 0
pnpm auto-layout:recognition --units --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/t024-after-units.json → 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t024/main-quick.json → 0; 33/33 completed.
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 --baseline tmp/t024/main-search120.json → 0; 33/33 completed.
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures → 0; empty.
git diff --stat dcc2e62 -- packages/auto-layout/src/route.ts packages/auto-layout/src/routing-audit.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/auto-layout.ts packages/auto-layout/src/place.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/search.ts packages/auto-layout/src/search-moves.ts scripts/auto-layout-eval.mjs pnpm-lock.yaml → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|tmp/' → grep 1; no output (expected).
```

The first sandboxed `pnpm test:local` exited 1: 17 files failed, 735 passed,
2 skipped; 57 tests failed, 7,521 passed, 149 skipped, with one unhandled error.
Relevant output was `connect EPERM 127.0.0.1:5432` and
`listen EPERM: operation not permitted 127.0.0.1`. The permitted rerun with
loopback/PostgreSQL access passed. No tests were disabled or changed to bypass
those failures. Logs and dataset-backed JSON/SVGs remain under git-ignored
`tmp/t024/`, `tmp/recognition/` and the existing evaluation/review directories.

## Investigation results

### Baseline integrity and method

The fresh quick baseline exactly reproduced the supplied counts: dev/val
crossings 299/385; 738 bends; 71 floating pins; 241,110 wire length; label counts
3/82/15; 33 completed. Baselines ran without concurrent heavy work.

The supplied search file has an inconsistent cached dev subtotal (188).
Summing its case records gives **248 dev + 301 val = 549 crossings**. Its other
summary counts are 642 bends, 77 floating pins, 235,970 wire length and labels
4/75/14. The fresh search baseline is **244 dev + 296 val = 540 crossings**,
629 bends, 77 floating pins, 235,810 wire length and labels 4/72/12. Both files
were preserved as `supplied-main-*.json` and `fresh-main-*.json`; the acceptance
baseline paths `main-*.json` now contain the fresh results.

Quick runs are deterministic. Search uses the requested 120-second wall-clock
budget, seed 1 and 12 jobs, so exact evaluation counts and results vary with
scheduling. The final search run also ran without concurrent heavy work.
Ablations were compiled from isolated source copies under `tmp/t024/`, with
only the selected rules enabled; the tracked router/evaluator and production
source were not edited for ablations. Ablations use quick mode with 12 jobs.

### Independent labels and exclusions

Read the installed CircuitGenome `opamp_modules.yaml`. Its eight relevant load
variants are:

- `folded_cascode_load_nmos_input_single_output`
- `folded_cascode_load_pmos_input_single_output`
- `folded_cascode_load_nmos_input_differential_output`
- `folded_cascode_load_pmos_input_differential_output`
- `telescopic_cascode_load_pmos`
- `telescopic_cascode_load_nmos`
- `telescopic_cascode_load_wideswing_pmos`
- `telescopic_cascode_load_wideswing_nmos`

The converter derives labels from hierarchical bias-port bindings and flat
load-slot connectivity, independently of recognition. It starts at in1/in2 and
follows sources onto previously labeled pair drains. Those devices remain
deferred for other kinds. LOADBench labels all 42 `MosfetGateConnectedCouple`
structures: **27 overlap `MosfetCascodeCurrentMirror` and remain globally
deferred; all 15 eligible labels match exactly, with no misses or false
positives.** Folded/cascoded input-pair deferral no longer masks this kind.

CircuitGenome has 336 common-gate labels: 168 recognized, zero false positives,
and 168 misses. Every miss has a source-degenerated input variant, so there is
no recognized input-pair anchor. Missing shapes: PMOS folded single-output 12,
PMOS telescopic 12, PMOS wide-swing telescopic 12, NMOS folded single-output 12,
NMOS wide-swing telescopic 12, PMOS folded differential-output 54, and NMOS folded
differential-output 54. These remain free under the explicitly required anchor
rule; recognizing source-degenerated pairs is out of scope.

All four sources are reported below: `hand`, committed `circuitgenome`, local
`loadbench`, and local `circuitgenome-all`. Every previously labeled T022
structure kind remains exact. Unit-mode losses are unchanged: multi-output or
multi-finger mirrors cannot be represented exactly by two representatives,
composites and cross pairs are not emitted as those unit kinds, and a selected
mirror unit can be eligible where its full multi-output structure is deferred.
Unlabeled plain matched structures are unchanged: 1 in committed CircuitGenome,
1 in LOADBench, and 216 in the full CircuitGenome source; these are reported
as unscored, not as false positives. Unit mode intentionally excludes plain
matched units.
Common-gate units are scored by their recognized identity despite persisting
as `matched-pair`; split-tail units supply both tail members to pair scoring.

The requested one-side negative still meets the pre-existing plain matched-pair
rule. Its expectation includes that matched pair and no common-gate pair.
All newly added hand topologies use generic textbook devices and names.

### Structures

E = expected; P = predicted; M = matched. P/R/X = precision/recall/exact rate. Values are before → after; E is unchanged.

| Source            | Kind                          |   E | P         | M         | P/R/X before → after         |
| ----------------- | ----------------------------- | --: | --------- | --------- | ---------------------------- |
| hand              | current-mirror                |   8 | 8 → 8     | 8 → 8     | 1/1/1 → 1/1/1                |
| hand              | differential-pair             |  18 | 18 → 18   | 17 → 18   | 0.9444/0.9444/0.9444 → 1/1/1 |
| hand              | differential-pair-mirror-load |   4 | 3 → 4     | 3 → 4     | 1/0.75/0.75 → 1/1/1          |
| hand              | common-gate-pair              |   5 | 0 → 5     | 0 → 5     | 1/0/0 → 1/1/1                |
| hand              | cross-coupled-pair            |   1 | 1 → 1     | 1 → 1     | 1/1/1 → 1/1/1                |
| hand              | matched-pair                  |   2 | 2 → 2     | 2 → 2     | 1/1/1 → 1/1/1                |
| circuitgenome     | current-mirror                |   6 | 6 → 6     | 6 → 6     | 1/1/1 → 1/1/1                |
| circuitgenome     | differential-pair             |   5 | 5 → 5     | 5 → 5     | 1/1/1 → 1/1/1                |
| circuitgenome     | differential-pair-mirror-load |   2 | 2 → 2     | 2 → 2     | 1/1/1 → 1/1/1                |
| circuitgenome     | common-gate-pair              |   0 | 0 → 0     | 0 → 0     | 1/1/1 → 1/1/1                |
| loadbench         | current-mirror                | 199 | 199 → 199 | 199 → 199 | 1/1/1 → 1/1/1                |
| loadbench         | differential-pair             |  59 | 59 → 59   | 59 → 59   | 1/1/1 → 1/1/1                |
| loadbench         | differential-pair-mirror-load |  19 | 19 → 19   | 19 → 19   | 1/1/1 → 1/1/1                |
| loadbench         | common-gate-pair              |  15 | 0 → 15    | 0 → 15    | 1/0/0 → 1/1/1                |
| circuitgenome-all | current-mirror                | 336 | 336 → 336 | 336 → 336 | 1/1/1 → 1/1/1                |
| circuitgenome-all | differential-pair             | 432 | 432 → 432 | 432 → 432 | 1/1/1 → 1/1/1                |
| circuitgenome-all | differential-pair-mirror-load |  78 | 78 → 78   | 78 → 78   | 1/1/1 → 1/1/1                |
| circuitgenome-all | common-gate-pair              | 336 | 0 → 168   | 0 → 168   | 1/0/0 → 1/0.5/0.5            |

Tail statistics (labeled / correct / wrong / missed / ambiguous), identical between structure and unit modes:

| Source            | Before        | After         |
| ----------------- | ------------- | ------------- |
| hand              | 18/14/0/0/4   | 18/15/0/0/3   |
| circuitgenome     | 5/5/0/0/0     | 5/5/0/0/0     |
| loadbench         | 0/0/0/0/0     | 0/0/0/0/0     |
| circuitgenome-all | 288/288/0/0/0 | 288/288/0/0/0 |

Mismatch shapes:

| Source            | Kind / shape                            | Before | After |
| ----------------- | --------------------------------------- | -----: | ----: |
| circuitgenome-all | common-gate-pair / missing              |    336 |   168 |
| hand              | common-gate-pair / missing              |      5 |     0 |
| hand              | differential-pair / missing             |      1 |     0 |
| hand              | differential-pair / unexpected          |      1 |     0 |
| hand              | differential-pair-mirror-load / missing |      1 |     0 |
| loadbench         | common-gate-pair / missing              |     15 |     0 |

### Movement units

E = expected; P = predicted; M = matched. P/R/X = precision/recall/exact rate. Values are before → after; E is unchanged.

| Source            | Kind                          |   E | P         | M         | P/R/X before → after                        |
| ----------------- | ----------------------------- | --: | --------- | --------- | ------------------------------------------- |
| hand              | current-mirror                |   8 | 8 → 8     | 6 → 6     | 0.75/0.75/0.75 → 0.75/0.75/0.75             |
| hand              | differential-pair             |  18 | 18 → 18   | 17 → 18   | 0.9444/0.9444/0.9444 → 1/1/1                |
| hand              | differential-pair-mirror-load |   4 | 0 → 0     | 0 → 0     | 1/0/0 → 1/0/0                               |
| hand              | common-gate-pair              |   5 | 0 → 5     | 0 → 5     | 1/0/0 → 1/1/1                               |
| hand              | cross-coupled-pair            |   1 | 0 → 0     | 0 → 0     | 1/0/0 → 1/0/0                               |
| circuitgenome     | current-mirror                |   6 | 6 → 6     | 6 → 6     | 1/1/1 → 1/1/1                               |
| circuitgenome     | differential-pair             |   5 | 5 → 5     | 5 → 5     | 1/1/1 → 1/1/1                               |
| circuitgenome     | differential-pair-mirror-load |   2 | 0 → 0     | 0 → 0     | 1/0/0 → 1/0/0                               |
| circuitgenome     | common-gate-pair              |   0 | 0 → 0     | 0 → 0     | 1/1/1 → 1/1/1                               |
| loadbench         | current-mirror                | 199 | 199 → 199 | 116 → 116 | 0.5829/0.5829/0.5829 → 0.5829/0.5829/0.5829 |
| loadbench         | differential-pair             |  59 | 59 → 59   | 59 → 59   | 1/1/1 → 1/1/1                               |
| loadbench         | differential-pair-mirror-load |  19 | 0 → 0     | 0 → 0     | 1/0/0 → 1/0/0                               |
| loadbench         | common-gate-pair              |  15 | 0 → 15    | 0 → 15    | 1/0/0 → 1/1/1                               |
| circuitgenome-all | current-mirror                | 336 | 444 → 444 | 336 → 336 | 0.7568/1/1 → 0.7568/1/1                     |
| circuitgenome-all | differential-pair             | 432 | 432 → 432 | 432 → 432 | 1/1/1 → 1/1/1                               |
| circuitgenome-all | differential-pair-mirror-load |  78 | 0 → 0     | 0 → 0     | 1/0/0 → 1/0/0                               |
| circuitgenome-all | common-gate-pair              | 336 | 0 → 168   | 0 → 168   | 1/0/0 → 1/0.5/0.5                           |

Tail statistics (labeled / correct / wrong / missed / ambiguous), identical between structure and unit modes:

| Source            | Before        | After         |
| ----------------- | ------------- | ------------- |
| hand              | 18/14/0/0/4   | 18/15/0/0/3   |
| circuitgenome     | 5/5/0/0/0     | 5/5/0/0/0     |
| loadbench         | 0/0/0/0/0     | 0/0/0/0/0     |
| circuitgenome-all | 288/288/0/0/0 | 288/288/0/0/0 |

Mismatch shapes:

| Source            | Kind / shape                            | Before | After |
| ----------------- | --------------------------------------- | -----: | ----: |
| circuitgenome     | differential-pair-mirror-load / missing |      2 |     2 |
| circuitgenome-all | common-gate-pair / missing              |    336 |   168 |
| circuitgenome-all | current-mirror / unexpected             |    108 |   108 |
| circuitgenome-all | differential-pair-mirror-load / missing |     78 |    78 |
| hand              | common-gate-pair / missing              |      5 |     0 |
| hand              | cross-coupled-pair / missing            |      1 |     1 |
| hand              | current-mirror / missing                |      2 |     2 |
| hand              | current-mirror / unexpected             |      2 |     2 |
| hand              | differential-pair / missing             |      1 |     0 |
| hand              | differential-pair / unexpected          |      1 |     0 |
| hand              | differential-pair-mirror-load / missing |      4 |     4 |
| loadbench         | common-gate-pair / missing              |     15 |     0 |
| loadbench         | current-mirror / missing                |     83 |    83 |
| loadbench         | current-mirror / unexpected             |     83 |    83 |
| loadbench         | differential-pair-mirror-load / missing |     19 |    19 |

### Layout aggregates

All quick rows cover 18 dev and 15 val documents. Width is the largest per-document rendered-width ratio against the corresponding freshly measured base, computed directly from case widths (the evaluator’s built-in ratio compares against its own quick result).

| Run            | Completed | Dev crossings | Val crossings | Bends | Floating | Wire length | Labels O/C/D | Max width/base |
| -------------- | --------: | ------------: | ------------: | ----: | -------: | ----------: | ------------ | -------------: |
| Quick base     |        33 |           299 |           385 |   738 |       71 |      241110 | 3/82/15      |         1.0000 |
| R90 only       |        33 |           336 |           371 |   755 |       65 |      241740 | 3/83/14      |         1.7788 |
| R91 + R92 only |        33 |           299 |           383 |   734 |       71 |      241040 | 3/82/15      |         1.0000 |
| R93 only       |        33 |           296 |           387 |   735 |       71 |      240280 | 3/80/14      |         1.0000 |
| All rules      |        33 |           298 |           369 |   728 |       59 |      236370 | 3/81/14      |         1.0979 |
| Search base    |        33 |           244 |           296 |   629 |       77 |      235810 | 4/72/12      |         1.0000 |
| Search after   |        33 |           237 |           289 |   632 |       65 |      230800 | 4/75/11      |         1.0536 |

### Rule counts

Movement units are compared by stable group identity, member order, tail representative and facing against base. R93 seat counts describe initial placement for the strategy selected by the quick planner, before routing/blocker repair. “Fallback” counts only eligible geometric seats when R93 is enabled; disabled rules have no attempts.

| Rules     | Split | Common-gate structures | Split tails | Units added / changed | Axis seats taken / fallback |
| --------- | ----- | ---------------------: | ----------: | --------------------- | --------------------------- |
| R90       | dev   |                     12 |           0 | 12 / 1                | —                           |
| R90       | val   |                      3 |           0 | 3 / 0                 | —                           |
| R91 + R92 | dev   |                      0 |           0 | 0 / 0                 | —                           |
| R91 + R92 | val   |                      0 |           1 | 1 / 1                 | —                           |
| R93       | dev   |                      0 |           0 | 0 / 0                 | 2 / 0                       |
| R93       | val   |                      0 |           0 | 0 / 0                 | 1 / 0                       |
| All       | dev   |                     12 |           0 | 12 / 1                | 14 / 0                      |
| All       | val   |                      3 |           1 | 4 / 1                 | 3 / 0                       |

### Anonymous per-document effects

Anonymous labels are assigned within each split; no source identifiers or drawing excerpts are included. Only documents with at least one changed metric or movement unit in any measured variant appear. C/B/F/W = crossings/bends/floating pins/wire length deltas; O/C/D = label overlap/clearance/terminal departure deltas. Width is after/base. R90, R91+R92 and R93 columns are quick crossing deltas. Search changes include the variability of a wall-clock-bounded search.

| Document | All quick ΔC/B/F/W | Quick labels ΔO/C/D | Quick width | R90 ΔC | R91+R92 ΔC | R93 ΔC | Search ΔC/B/F/W  | Search labels ΔO/C/D | Search width |
| -------- | ------------------ | ------------------- | ----------: | -----: | ---------: | -----: | ---------------- | -------------------- | -----------: |
| dev-01   | -15/-12/+0/-810    | +0/+0/+0            |      1.0979 |    +13 |         +0 |     +0 | -13/-9/+0/-2050  | +0/+0/+0             |       0.8679 |
| dev-03   | +15/+15/-7/+1130   | +0/-1/-1            |      1.0048 |    +25 |         +0 |     -3 | +19/+20/-7/+1060 | +0/+3/+0             |       1.0180 |
| dev-05   | -1/+5/+0/-1320     | +0/-2/+0            |      0.6381 |     -1 |         +0 |     +0 | -13/+4/+0/-1930  | +0/-1/+0             |       0.5748 |
| dev-13   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/+0/+0/-750    | +0/+0/+0             |       0.9265 |
| dev-15   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/+0/+0/-20     | +0/+0/+0             |       1.0000 |
| dev-16   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/+0/+0/-10     | +0/+0/+0             |       1.0000 |
| val-01   | -12/-9/-5/-3350    | +0/+2/+0            |      0.7344 |    -12 |         +0 |     +0 | -4/-7/-5/-1110   | +0/+3/-1             |       0.6586 |
| val-02   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/-1/+0/-30     | +0/+0/+0             |       1.0000 |
| val-03   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/+0/+0/-320    | +0/+0/+0             |       0.9202 |
| val-08   | +0/+0/+0/+0        | +0/+0/+0            |      1.0000 |     +0 |         +0 |     +0 | +0/+1/+0/-50     | +0/-2/+0             |       0.9884 |
| val-10   | +2/+1/+0/-170      | +0/+0/+0            |      0.9828 |     +0 |         +0 |     +2 | +1/-1/+0/-110    | +0/+0/+0             |       1.0253 |
| val-15   | -6/-10/+0/-220     | +0/+0/+0            |      1.0442 |     -2 |         -2 |     +0 | -4/-4/+0/+310    | +0/+0/+0             |       1.0536 |

### Layout interpretation

The combined quick result meets all required ceilings: dev crossings 298 ≤ 299,
val 369 ≤ 385, bends 728 ≤ 738, floating pins 59 ≤ 71, 33/33 completed, and
maximum width/base 1.0979 ≤ 1.5. Total wire length falls by 4,740. Label overlaps
stay at 3; clearance falls from 82 to 81; terminal departures fall from 15 to 14.

There are two combined quick crossing regressions to review: **dev-03 +15**
(with seven fewer floating pins, one fewer clearance finding and one fewer
terminal departure), and **val-10 +2**. R90 alone costs +13 on dev-01 and +25
on dev-03; adding R93 changes those to −15 and +15. R93 alone reproduces the
val-10 +2 cost with unchanged label counts; it is a geometrically valid axis
seat interacting with the unchanged router. No rule was altered to fit that val
outcome. R91+R92 alone affects only val-15 (−2 crossings, −4 bends); combined
rules yield −6 crossings and −10 bends there.

The only combined quick label-count increase is **val-01 clearance +2**.
R90 alone reproduces it; the selected strategy changes from template to layered
when common-gate templates are available. Its crossings drop 30 → 18, floating
pins drop by five, and width is 0.7344× base. Label overlaps and terminal
departures do not rise. This is a placement/strategy tradeoff, not a change to
label or routing rules. Dev-03 clearance falls by one and dev-05 by two.

Ablations demonstrate why the complete ruleset matters: R90 alone has 336 dev
crossings, 755 bends, and a 1.7788 width ratio on val-15. Those are not acceptable
standalone results. The combined result satisfies all three limits. All 17
eligible axis seats in the selected initial placements are taken (14 dev,
3 val); no real-document eligible seat falls back. Synthetic tests cover the
blocked-above, blocked-both and non-facing fallback paths.

Search improves crossings **540 → 526** (dev 244 → 237; val 296 → 289),
floating pins 77 → 65, and wire length 235,810 → 230,800. All 33 complete;
maximum width/search-base is 1.0536. Bends rise **629 → 632** and label clearance
**72 → 75**; overlaps stay at 4 and terminal departures fall 12 → 11. Search is a reporting comparison in the plan; the required bend ceiling is for
quick mode.
Search clearance rises by three each on dev-03 and val-01, offset by dev-05 −1
and val-08 −2. The same two common-gate-affected drawings account for the rises;
search changes their routed geometry and label seats under the unchanged
scorer/router. Search also costs dev-03 +19 crossings and val-10 +1. The table
includes search-only changes on otherwise identical quick layouts, which are
wall-clock-search variability rather than evidence of another recognition rule.
Both final modes preserve electrical equivalence in all 33 documents and report
zero unsafe routing problems.

## Deviations and open questions

- No implementation scope deviation, dependency change, hand-edit of generated files,
  router change, branch switch or commit. The final branch remains
  `task/T024-auto-layout-cascode-symmetry`.
- The telescopic hand case requires a composite through the common-gate stack;
  R90 documents that extension while R82 itself remains unchanged.
- **Split-tail benefit is not a clean held-out measure:** the only real split
  tail is in a val document used in the motivating diagnosis. There is no dev
  split-tail example. This limitation applies to its ablation and combined
  val result. No rule was tuned on the val measurements.
- Correct rules can cost crossings in individual drawings. The anonymous table
  and discussion identify those costs for Opus to review; no case-specific
  exceptions or router changes were introduced.
