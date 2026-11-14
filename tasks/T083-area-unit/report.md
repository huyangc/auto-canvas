# T083 report — round 1

## Summary

Implemented area normalization using `READABILITY_AREA_UNIT = 10` document
units, with a comment explaining independence from the editor grid. Other
uses of `pitch`, metrics, planner code, and frozen weights/scales are unchanged.
The regression test checks the fixed unit, grid-1/grid-10 equality before and
after shrinking a layout, and both full and weighted measurement modes.
The existing narrow-band assertions remain covered separately.

Corpus acceptance passes, but overall acceptance is **partial**: the change
exposes a reproducible grid-1 drafting-caption regression in an existing test
outside this task's owned paths. No test was weakened or removed.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | Area divides the enclosing bounds by the square of the named fixed unit. |
| 2 | done | All 16 readability-metric tests pass, including the new fixed-unit regression. |
| 3 | done | Evaluated all 628 drawings, compared all grid-10 hashes/metrics with main, tabulated the seven grid-1 drawings, and checked all six large documents. |
| Acceptance | partial | Required commands were run; the drafting-caption regression prevents a passing local suite. See below. |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Logs and scratch verification harnesses are in `tmp/t083-round1/`.

```text
pnpm build → 0; all package/application builds completed (bundle-size warnings only).
pnpm typecheck → 0.
pnpm lint → 0; oxlint: 2065 files, 0 errors, 3455 warnings.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 1 (initial sandbox run); 19 failed / 778 passed / 3 skipped files,
  62 failed / 8095 passed / 150 skipped tests, 2 errors. Local PostgreSQL and
  listeners were blocked by EPERM; also included load-related timeouts and
  the drafting-caption assertion below. Log: test-local.log.
pnpm test:local → 1 (local-service access, concurrent evaluation);
  3 failed / 794 passed / 3 skipped files; 3 failed / 8187 passed / 117 skipped tests.
  Failures: two server tests timed out at 5000 ms, plus the drafting assertion.
  Log: test-local-services.log.
pnpm test:slow → 1 (concurrent evaluation); 7 passed, 1 failed.
  ltc3452 timed out at the unchanged 60000 ms limit. Log: test-slow.log.
pnpm test:slow → 0 (after evaluation); 2 files / 8 tests passed in 41.74 s.
  Log: test-slow-retry.log.
pnpm test:local → 1 (final run, local-service access, no concurrent evaluation);
  1 failed / 796 passed / 3 skipped files; 1 failed / 8189 passed / 117 skipped tests.
  Only the drafting-caption assertion fails; both server timeouts are resolved.
  Duration: 101.21 s. Log: test-local-final.log.
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0;
  Wrote tmp/auto-layout-eval/report.json and index.html. Log: eval.log.
python3 tmp/t083-round1/compare.py → 0; 621 grid-10 hashes/metrics identical,
  628 equivalent, no per-drawing floating/missing regressions.
python3 tmp/excess.py tmp/auto-layout-eval/report.json → 0; output: excess.log.
node tmp/t083-round1/verify-large.mjs → 0; all six baseline/current/repeat plans identical.
```

The focused command
`pnpm test:local packages/auto-layout/test/readability-metrics.test.ts packages/auto-layout/test/follow-drafting-labels.test.ts`
exits 1: the 16 readability tests pass and the drafting test fails.
`pnpm exec vitest run --config tmp/t083-round1/vitest-baseline.config.mjs`
exits 0: a scratch copy of that same drafting test, importing the supplied
main planner build, passes unchanged assertions. Logs: `test-focused.log` and
`test-follow-baseline.log`.

## Investigation results

### Baseline and corpus invariance

Compared against `tmp/main-8cdec30-report.json` (main `8cdec30`). All 628 input
IDs match. All 621 grid-10 cases have identical SHA-256 plan hashes, complete
readability metric objects, and composite scores for human, result, and quick
layouts. All 628 complete with electrical equivalence. Floating pins remain
6 and missing connections remain 4 (all in dev; val stays 0/0), with no increase
on any individual drawing. Full comparison data, including grid-1 hashes,
are in `tmp/t083-round1/comparison.json`.

### Split composites

Values are the evaluator's summed frozen composites; ratio is result/human.

| Split | Drawings | Human before | Human after | Result before | Result after | Ratio before | Ratio after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| dev | 439 | 48.044550611 | 43.899767814 | 61.058969146 | 54.370761083 | 1.270882303 | 1.238520470 |
| val | 189 | 26.989218584 | 23.595473540 | 33.575480766 | 27.996936455 | 1.244033082 | 1.186538444 |
| all | 628 | 75.033769195 | 67.495241354 | 94.634449912 | 82.367697538 | 1.261224792 | 1.220348218 |

The ratios improve beyond the plan's rescaling-only estimate because three
grid-1 drawings select different plans. Weights and scales were not refitted.

### Seven grid-1 drawings

Before → after values below use each version's own selected layout and area
unit. Human area is divided by 100 in every case; result area can also reflect
a changed layout. Values are rounded here; full precision is in the comparison JSON.

| Split / drawing | Human area | Result area | Human composite | Result composite | Plan changed? |
| --- | ---: | ---: | ---: | ---: | --- |
| dev `3ze5gasahn` | 80981.919828 → 809.819198 | 58038.656832 → 580.386568 | 1.679254094 → 0.172890125 | 1.090495830 → 0.010904958 | no |
| dev `dr4e8zhyjg` | 48337.813993 → 483.378140 | 133400.945018 → 1334.009450 | 0.908225439 → 0.009082254 | 2.790947796 → 0.309525062 | no |
| dev `rxdzz3wdry` | 38775.129229 → 387.751292 | 82089.840000 → 899.498400 | 0.904485468 → 0.183220059 | 1.826856807 → 0.125426428 | yes |
| dev `tr828v3mrc` | 54728.090253 → 547.280903 | 64886.258939 → 839.462847 | 1.136818802 → 0.118808568 | 1.550062490 → 0.124298412 | yes |
| val `qzszatannt` | 79945.925927 → 799.459259 | 88601.532322 → 1082.250399 | 1.902477556 → 0.415384356 | 2.390685772 → 0.237385815 | yes |
| val `s78j9fyzha` | 57475.299720 → 574.752997 | 69059.881380 → 690.598814 | 1.744387831 → 0.675276099 | 1.737006857 → 0.452407564 | no |
| val `vyqjt4w5gv` | 45026.041300 → 450.260413 | 115080.784179 → 1150.807842 | 0.846000114 → 0.008460001 | 2.379319011 → 0.238673950 | no |

### Large documents

Used a scratch copy of the supplied harness with the current worktree/input
and output paths and `/tmp/t081-baseline/dist/index.js` as the baseline. Its
existing module-resolution link worked. Compared serialized complete plans,
not just summary metrics, and reran each current plan to check determinism.
All six use grid 10; all match byte-for-byte and have no error diagnostics.
The supplied baseline's compiled JavaScript differs from this worktree's
build only in `readability-metrics.js`.

| Drawing | Instances | Baseline = current = repeat SHA-256 |
| --- | ---: | --- |
| `38m8wdesbh` | 50 | `4458efc1175dec18d7d3d490621f35788695b1c1d060073a607c6e1158377029` |
| `4fb59zv76m` | 50 | `d161eee65e7df08e225c767e934de0e746b59246997310e5070ec46e7addbb1c` |
| `8b2n3zf9vj` | 51 | `18f8a763ffc0a44cc82b90fe3f60797d499c4bd202cb77b8d3da85c0fe5544e6` |
| `b9afqhsjzv` | 103 | `17a349567a59cd582a62073a8043b7e1d41d693e8e4042843984f283e21aaed6` |
| `g47e465db5` | 70 | `3daf09718ae2709487691ec39cca0b506e863cdbf0fb3de1f6674f830b6cc848` |
| `sm663cbs8b` | 94 | `1c97643de4048a58f4f9cd782e547ef3d7e8d6180a36364c2ce0515e3f87c82d` |

### Unresolved drafting regression

`packages/auto-layout/test/follow-drafting-labels.test.ts:72` fails reliably
with the new area unit. The fixture explicitly uses grid 1. The device caption
`m` is expected to have `{ kind: "object", objectId: "lower" }`, but the
selected plan leaves its anchor `{ kind: "free" }`. The assertion fails both
in the full local suite and in a focused run; the same assertion passes using
the main planner build. This is a real behavior regression, separate from
sandbox restrictions and timing failures, even though the 628-drawing corpus
and large-document acceptance checks pass.

## Deviations and open questions

- Acceptance remains partial. Fixing the drafting regression requires a
  follow-up plan that owns the relevant planner/drafting code, or an explicit
  decision about its behavior. Those paths and this existing test were left
  unchanged under AGENTS.md's out-of-scope rule.
- Initial test suites overlapped the 12-worker evaluation and hit timeouts;
  reruns retain the original test assertions and timeout limits. All timeout
  failures cleared after the evaluation finished; only the drafting regression
  remains in the final local suite.
- `docs/specs/auto-layout.md` does not state this readability area's unit, so
  the plan's conditional documentation update was unnecessary.
- No dependency changes, generated weights, LLM-provider calls, commits,
  pushes, branch switches, or plan/review edits.
