# T058 report — round 1

## Summary

Implemented R148's bounded rail search after the existing device and port
searches. It searches seats for existing rail markers using connected pin
geometry, then compares rail trees and horizontal trunk tracks against the
finished signal routing. It retains the calibrated routed score and visual /
connectivity guards. No marker instances are added or removed.

The round is **partial**: full evaluation reduces rail-involving crossings
from 135 to 104 (22.96%), short of the required 30% reduction (at most 94).
Total crossings, bends and wire improve on both dev and val; completion,
equivalence, visual/connectivity guards, determinism and paired timing pass.
The implementation and evidence are ready for review, with the quantitative
rail-crossing target explicitly unfulfilled.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Replayed the baseline and classified every dev rail crossing; results below. |
| 2 | partial | Implemented marker-seat search and rail routing alternatives with R140 contacts, but the overall 30% rail-crossing target is not met. |
| 3 | done | Fixed evaluation budgets; paired median and p95 comfortably within limits. |
| 4 | done | Synthetic supply-tree, lower-row drop / trunk-choice, marker-seat, legal-contact, determinism and fixed-device tests. |
| 5 | done | R148 documented; evaluated all 628 drawings and report dev/val below. |

## Review findings addressed

Round 1; no `review.md` was present.

## Acceptance results

```text
pnpm build → 0; all workspace builds completed.
pnpm typecheck → 0.
pnpm lint → 0; 2016 files, 0 errors, 3256 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm exec vitest run packages/auto-layout/test → 0;
  Test Files 40 passed (40); Tests 624 passed (624); 66.38 s.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  628 drawings, 627 completed, 0 non-equivalent.
```

Logs are in `tmp/t058-logs/`: `build-final.log`, `typecheck-final.log`,
`lint-final.log`, `format-check-final.log`, `vitest-isolated-final.log`, and
`eval-final.log`. A preceding test run concurrent with build/evaluation hit
an unchanged 5000 ms timeout in the fingerprint mining CLI test (623 passed,
one timed out). The exact full-suite command passed when rerun alone; no
existing test or timeout was modified.

Frozen final dev results (`tmp/t058-dev-final/report.json`): rail-involving
crossings 92 → 64 (30.43% lower); total crossings 348 → 320; bends
2061 → 2024; wire 490213.35 → 484083.35. Every dev visual guard is no higher.

| Measure | Dev base → final | Val base → final | All base → final |
| --- | ---: | ---: | ---: |
| Rail-involving crossings | 92 → 64 | 43 → 40 | 135 → 104 |
| Total crossings | 348 → 320 | 154 → 151 | 502 → 471 |
| Bends | 2061 → 2024 | 784 → 775 | 2845 → 2799 |
| Wire length | 490213.35 → 484083.35 | 201924.68 → 201504.68 | 692138.03 → 685588.03 |

The completed split counts are dev 439, val 188. None is non-equivalent.
Floating pins remain 10 and missing connections remain 18. Every `VISUAL_*`
total is no higher on either split: overall label-clearance findings fall
195 → 189 and terminal-departure findings 97 → 90; other totals are unchanged.

The independent repeat has identical plan hashes and non-timing results for
all 628 drawings. Every dev hash also matches the frozen dev evaluation.
The clean baseline replay matches the supplied T057 report, including every
plan hash and non-timing result.

Paired timing uses the same 12 workers and fixed evaluation counts, with the
two final runs and clean baseline run executed sequentially without competing
build/test jobs:

| Full-corpus run | Median ms | p95 ms | Median / base | p95 / base |
| --- | ---: | ---: | ---: | ---: |
| Clean T057 baseline | 1877.91 | 8577.58 | 1.000 | 1.000 |
| T058 final | 1889.98 | 9167.67 | 1.006 | 1.069 |
| T058 repeat | 1900.68 | 9113.93 | 1.012 | 1.063 |

Both timing limits pass (median ≤ 2× and p95 ≤ 1.5×). The six large documents
are byte-identical to the baseline; optimized, zero-budget and ten successful
partition comparisons also remain byte-identical.

Additional verification:

```text
node tmp/t058-repeat-eval.mjs tmp/le10-input --jobs 12 → 0.
node tmp/t058-base-eval.mjs tmp/le10-input --jobs 12 → 0.
node tmp/t058-modes.mjs → 0; 12 comparisons identical.
node tmp/t058-large.mjs → 0; 6 large documents identical.
node tmp/t058-verify.mjs → 1; overall rail reduction 22.96% < 30%.
  All other quality, guard, determinism, mode and timing predicates pass.
```

Full results: `tmp/auto-layout-eval/report.json`,
`tmp/t058-repeat/report.json`, `tmp/t058-paired-base/report.json` and
`tmp/t058-verification.json`. SVGs and comparison galleries accompany the
reports. Detailed rail-kind totals and every `VISUAL_*` count are in the
verification JSON.

## Investigation results

The fresh baseline run (`tmp/t058-paired-base/report.json`) reproduces all 628
plan hashes in `tmp/le10-t057r2/report.json`. Investigation used only dev.
All 54 dev drawings with a rail-involving crossing were inspected, accounting
for all 92 crossings: 62 rail–signal, 17 port–rail and 13 rail–rail.

The table counts **rail incidences**, so each rail–rail crossing contributes
twice: 105 incidences in 92 crossing events. Marker branches include their
bends and long detours, not just short vertical stubs. Other terminal branches
are drops; horizontal interior routes are trunk segments. A branch's device
is its terminal device; for interior routing, the nearest rail pin in x is
used. Outer row means the extreme device-centre y for that rail's side.

| Rail segment at crossing | Outer device row | Inner device row | Total |
| --- | ---: | ---: | ---: |
| Horizontal trunk | 5 | 1 | 6 |
| Drop / terminal branch | 15 | 18 | 33 |
| Marker branch | 21 | 45 | 66 |
| Total | 41 | 64 | 105 |

For the 79 rail crossings with a non-rail conductor, its intersecting segment
lies as follows relative to the rail's longest non-marker horizontal segment
when present. Marker-only / tree drawings without such a reference have no
trunk side to report. Rail–rail incidences (26) are excluded from this table.

| Non-rail segment position | Supply | Ground | Total |
| --- | ---: | ---: | ---: |
| Above the reference trunk | 3 | 9 | 12 |
| Below the reference trunk | 17 | 3 | 20 |
| Spans the trunk level | 6 | 3 | 9 |
| No reference trunk | 3 | 35 | 38 |

The dominant problem is marker seating, rather than long horizontal trunks:
52 of the 66 marker-branch incidences, across 22 drawings, have **no eligible
host** under the existing `powerHosts` filter. Its channel / two-pin eligibility
excludes other connected device pins, leaving some markers far from their
actual terminals. This is addressed with a generic pin-geometry search in the
new default-mode finishing pass, without changing shared placement behavior.

Representative dev drawings:

- `3m85qkkgkt`: a ground marker at pin position `(420, 200)` connects to a
  device pin at `(870, 390)` through a long branch. Its rail has no eligible
  legacy host.
- `55g7v28588`: a marker at `(310, 270)` connects to a device pin at
  `(860, 250)`; again, no eligible legacy host.
- `4vtqat76zf`: a marker branch from `(390, 320)` to `(550, 380)` crosses
  other wiring. A finished nearby seat reduces total crossings from 4 to 2.
- `2adejzy693`: includes trunk, drop and marker-branch crossings, including
  rail–rail interactions; routing-only alternatives improve this case.

Artifacts: `tmp/t058-investigation.json`, `tmp/t058-hosts.json`, and the
reproducible `tmp/t058-investigate.mjs` / `tmp/t058-hosts.mjs` harnesses.
Baseline replayed documents and SVGs are under `tmp/t058-paired-base/`.
Third-party documents remain untracked.

## Deviations and open questions

- Chose marker-seat search plus finished rail rerouting from the investigation
  data; the placement estimator is unchanged.
- Marker candidates check only the moved marker against other bounds and pins.
  A whole-document clearance check incorrectly rejects unrelated legal
  contacts already present in the finalist. Replanning uses the existing
  R140 declared-pair policy to retain those contacts; its safety checks remain
  in force. The regression exercises this path with a real touching-pin pair.
- Budgets are at most eight fully finished marker-seat trials (two per marker)
  and three rail Nets, with at most six routing alternatives per Net. They
  are evaluation counts, independent of machine speed.
- Routing-only dev exploration reduced rail-involving crossings from 92 to 78;
  the initial marker search reduced them to 71. Inspecting rejected trials
  exposed the existing-contact barrier, leading to the final policy wiring.

- Validation was evaluated after the final dev implementation was frozen.
  The overall improvement is concentrated on dev; val removes only three of
  its 43 rail-involving crossings. The 30% overall target needs at least ten
  additional crossing removals. This remains open for the next review round;
  no changes were tuned against val drawings.
