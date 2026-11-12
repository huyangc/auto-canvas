# T053 report — round 1

## Summary

Added opt-in `components: "physical"` routing and enabled it for both
auto-layout callers. The planner splits label-joined visible components by
the electrical topology projection, keeps attachment candidates within each
selected physical piece, and skips pieces containing no requested pin.
Unsplit component ids and the default editor/Agent behavior remain unchanged.
R11 now explicitly requires physical connectivity through Routes and contacts.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Added the planner option, projection lookup, deterministic split ids, and endpoint-key fallback. Downstream routing is unchanged. |
| 2 | done | Enabled physical components in first-pass routing and local rerouting; Agent caller untouched. |
| 3 | done | Synthetic A/B/C regression verifies the existing default result and physical routing for A/C and A/B/C. |
| 4 | done | Synthetic four-terminal MOS regression covers hidden instance-anchored ground labels, no unrouted warning, and zero floating pins/missing connections. |
| 5 | done | Amended R11 without introducing a new rule. |
| 6 | done | All acceptance commands passed; evaluated all 628 cases and compared every case against the supplied base report. |

## Review findings addressed

Not applicable: round 1; no `review.md` was present.

## Acceptance results

```text
pnpm build → 0; all packages built (Vite reported its large-chunk warning).
pnpm typecheck → 0; tsc -p tsconfig.check.json --noEmit.
pnpm lint → 0; oxlint: 2009 files, 0 errors, 3210 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm exec vitest run packages/edit-engine packages/auto-layout/test → 0;
  Test Files 131 passed (131)
  Tests 1553 passed | 4 skipped (1557)
  Duration 56.85s
git diff --check → 0; no output.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 cases: 627 completed, 1 refused (same statuses as base).
  Wrote tmp/auto-layout-eval/report.json and index.html.
python3 -I tmp/le10-analysis/compare.py tmp/le10-t053-base/report.json tmp/auto-layout-eval/report.json /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json → 0;
  Full output below.
```

Both new regressions passed on the implementation. To verify the base failure
without switching branches, temporarily restored only the three production
files from `b507797`, rebuilt edit-engine, and ran:

```text
pnpm exec vitest run packages/edit-engine/src/route-net-planner.test.ts packages/auto-layout/test/routing.test.ts -t 'routes label-joined|routes a MOS source physically'
Base → 1; 2 failed, 42 skipped.
  Planner: A and C belong to different physical components.
  Auto-layout: AUTO_LAYOUT_NET_UNROUTED,
    "Net ground: floating pins: source.-, mos.S".
Implementation → 0; 2 passed, 42 skipped.
```

Restored the implementation and rebuilt before running the full acceptance
suite. Logs are under git-ignored `tmp/t053/`, including
`base-regressions.log`, `build.log`, `typecheck.log`, `lint.log`,
`format.log`, `tests.log`, `eval.log`, and `comparison.log`.

### Gallery comparison

Only `qzszatannt` changed result metrics. It remains `completed` and
`equivalent: true`, with an empty diagnostics list (the former
`AUTO_LAYOUT_NET_UNROUTED` warning is gone). Every changed metric is listed
below; bends remain 15 and all other result metrics are unchanged.

| Metric | Base | Implementation |
| --- | --- | --- |
| Crossings | 6 | 5 |
| Floating pins | 1 (`MN.S`) | 0 |
| Missing connections | 1 | 0 |
| Wire length | 3127 | 3361 |
| Layout height | 484 | 485 |
| Area ratio | 2.288259068908737 | 2.2929868769023503 |

The other 626 completed drawings have identical complete `result` objects.
All 627 completed drawings remain electrically equivalent; the one refused
case remains refused. An additional comparison over all 628 ids confirmed
no status changes and no increases in crossings, bends, floating pins, or
missing connections for any case. Existing connectivity deficits elsewhere
are unchanged. Per-case changes are also saved in
`tmp/t053/changed-metrics.json`.

The supplied comparison script uses the historical headings `main` and
`pr46`; here they mean the supplied T053 base and this implementation.
Timing values below are cumulative case times, not wall-clock duration;
acceptance tests ran concurrently with the start of this evaluation.

```text
status changes []
not equivalent in B []

[all] n=627
  crossings            human       234  main       581  pr46       580  (-0.2%)
  bends                human      2356  main      2998  pr46      2998  (+0.0%)
  wireLength           human    465224  main    772356  pr46    772590  (+0.0%)
  floatingPins         human        86  main        11  pr46        10  (-9.1%)
  missingConnections   human        92  main        19  pr46        18  (-5.3%)
  labelOverlaps        human         4  main         5  pr46         5  (+0.0%)
  terminalDepartures   human        30  main       117  pr46       117  (+0.0%)
  median area ratio main 1.66 pr46 1.66
  mirrored pairs main 313 pr46 313
  per-doc (3*crossings+bends): better 1 worse 0 metrics identical 626
  docs at human level (crossings <= human, bends <= 1.1*human+1): main 281 pr46 281

[0-4] n=184
  crossings            human        18  main        24  pr46        24  (+0.0%)
  bends                human       428  main       430  pr46       430  (+0.0%)
  wireLength           human     68807  main    101450  pr46    101450  (+0.0%)
  floatingPins         human         8  main         0  pr46         0  (+0.0%)
  missingConnections   human        15  main         1  pr46         1  (+0.0%)
  labelOverlaps        human         0  main         0  pr46         0  (+0.0%)
  terminalDepartures   human         5  main        36  pr46        36  (+0.0%)
  median area ratio main 1.50 pr46 1.50
  mirrored pairs main 6 pr46 6
  per-doc (3*crossings+bends): better 0 worse 0 metrics identical 184
  docs at human level (crossings <= human, bends <= 1.1*human+1): main 126 pr46 126

[5-10] n=443
  crossings            human       216  main       557  pr46       556  (-0.2%)
  bends                human      1928  main      2568  pr46      2568  (+0.0%)
  wireLength           human    396417  main    670906  pr46    671140  (+0.0%)
  floatingPins         human        78  main        11  pr46        10  (-9.1%)
  missingConnections   human        77  main        18  pr46        17  (-5.6%)
  labelOverlaps        human         4  main         5  pr46         5  (+0.0%)
  terminalDepartures   human        25  main        81  pr46        81  (+0.0%)
  median area ratio main 1.75 pr46 1.75
  mirrored pairs main 307 pr46 307
  per-doc (3*crossings+bends): better 1 worse 0 metrics identical 442
  docs at human level (crossings <= human, bends <= 1.1*human+1): main 155 pr46 155

most improved:
  qzszatannt    9p Feedback Loop to Reduce Class AB Dra human 2/5  main 6/15/3127 -> pr46 5/15/3361
  23wahmw6b2    6p fine-tuning sw-cap bank              human 0/0  main 0/3/1120 -> pr46 0/3/1120
  244ym7g4ht    4p Time response of unity-gain sampler  human 0/3  main 0/8/1510 -> pr46 0/8/1510
  296p9s5vn2    9p Fully differential telescopic op amp human 1/1  main 0/0/1560 -> pr46 0/0/1560
  29hn4q6qbk    5p Figure 10.39 (a)                     human 0/3  main 1/2/550 -> pr46 1/2/550
  2adejzy693   10p Alternative low-voltage BG circuit   human 0/0  main 12/25/3920 -> pr46 12/25/3920
  2b6xxwhh59    9p Gilbert Cell                         human 5/9  main 4/8/2450 -> pr46 4/8/2450
  2bgg3pxz64    6p MFB                                  human 0/3  main 1/4/1230 -> pr46 1/4/1230
most regressed:
  zv2a26bzbe    5p 5-stage ring OSC                     human 0/3  main 0/2/590 -> pr46 0/2/590
  zsgcm4w69n   10p Noise Analysis                       human 0/1  main 1/3/1810 -> pr46 1/3/1810
  zsfb4htxsk    2p VREF_BUF                             human 0/3  main 0/1/310 -> pr46 0/1/310
  zqcksjfxg2    9p Gain-split two-stage inverter TIA    human 0/6  main 1/8/2580 -> pr46 1/8/2580
  zp8mp5jyyf    6p MFB                                  human 0/4  main 0/9/910 -> pr46 0/9/910
  zp3r9haqg7   10p Self Bias Circuit                    human 2/6  main 1/6/2420 -> pr46 1/6/2420
  znhrweves6    4p NOR                                  human 0/0  main 0/0/710 -> pr46 0/0/710
  zkpzejysxn    8p The_3_level                          human 0/3  main 0/5/1340 -> pr46 0/5/1340

median ms main 1199 pr46 1275 total s main 944 pr46 1057
pr46 missing/floating: [('64fy6zcx24', 1, 2), ('6c96e7eb-659e-48e9-b242-03719b64aeb5', 5, 0), ('a8fbcba9-e418-4a5e-9b42-ba979f911c5c', 1, 0), ('adb08a44-24c0-496c-adb2-cc95c63f453a', 1, 0), ('ebe93ae5-943e-46cc-89e5-886c8c2b8a0e', 1, 0), ('en97w8v92y', 1, 2), ('ne46whs3fw', 2, 3), ('s75dft4ssy', 2, 3), ('xt4casmbc4', 2, 0), ('zsgcm4w69n', 2, 0)]
```

## Investigation results

No separate investigation step. The synthetic auto-layout fixture uses the
built-in MOS definition with its default three-terminal variant disabled, so
bulk pins remain visible routing candidates. It asserts the initial visible
component sizes are 1 and 3; all fixture content is synthetic.

## Deviations and open questions

None. No dependencies, generated sources, label-binding semantics, or
out-of-scope paths changed. No LLM API calls, commits, or branch switches.
