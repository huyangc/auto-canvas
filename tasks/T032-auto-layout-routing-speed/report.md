# T032 report — round 1

## Summary

Added conservative padded bounds to clearance checks, precomputed foreign Route
segments, and reused the winning signal-trunk candidate's previewed Document.
Conflict order and wording remain unchanged. Added differential clearance tests,
literal boundary regressions, the R39 preview-count regression, and the R87 sentence.

## Steps

| Step | Status | Notes                                                                                                                                                                       |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Bounds filters and test-only `exhaustive` option in `route-clearance.ts`; new differential, path and boundary tests. Very short segments retain exhaustive pin/Route scans. |
| 2    | done   | Retain the best candidate's Document without a cast; shortcuts still preview once. Added a separate R39 test retaining every existing fixture assertion.                    |
| 3    | done   | Added the requested sentence in R87.                                                                                                                                        |
| 4    | done   | Identity 49/49; simultaneous ratio 0.579 (target ≤ 0.70); sequential evaluation ratio 0.606 (target ≤ 0.85). Profile and five largest costs recorded below.                 |

The clearance sweep compares 68,672 directed lattice segments, 320 two-bend
paths, hundreds of diagonal segments and terminal-start exemptions. It verifies
all five conflict-message families. Path equality covers 36 endpoint pairs both
with and without crossing cost; literal boundaries include outline/stroke contact,
foreign Route ends, tolerance offsets and sub-unit segments.

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

All acceptance commands use `ICM_E2E_PORT=4173`,
`AUTO_CANVAS_E2E_API_PORT=4311` and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files.
pnpm typecheck → 0.
pnpm lint → 0; 0 errors, 2982 warnings.
pnpm vitest run packages/edit-engine packages/auto-layout → 0; 114 files passed, 1350 tests passed, 4 skipped.
pnpm test:local → 0 with local test access; 761 files passed, 3 skipped; 7745 tests passed, 117 skipped.
pnpm deadcode 2>&1 | grep -E 'route-clearance|auto-layout' → 1 (grep no matches); no output, as required.
pnpm build → 0.
pnpm auto-layout:review → 0; Wrote 9 corpus and 7 held-out SVGs and tmp/auto-layout-review/index.html.
node tmp/t032/ab-run.mjs tmp/t032/result-hashes.json → 0; 49 documents, 140950 ms planning.
node tmp/t032/ab-compare.mjs tmp/t032/base-hashes.json tmp/t032/result-hashes.json → 0; documents 49; identical 49; different 0.
pnpm auto-layout:eval tmp/human-cases --jobs 10 → 0; 33 completed; report copied to tmp/t032/result-quick.json.
git status --short packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent scripts pnpm-lock.yaml package.json → 0; empty.
git diff --stat 65bd206 -- packages/edit-engine/src ':!packages/edit-engine/src/route-clearance.ts' ':!packages/edit-engine/src/route-clearance.test.ts' → 0; empty.
git diff --stat 65bd206 -- packages/auto-layout/src ':!packages/auto-layout/src/route.ts' → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1 (grep no matches); no output, as required.
```

The final focused clearance run (`pnpm vitest run
packages/edit-engine/src/route-clearance.test.ts`) passed all five tests, including
the additional short-Route regression; the full local run also includes it.

The first typecheck caught an unsupported `name` field in the new test's Net;
removed it and reran successfully. The first new R39 test expected three previews;
see the fixture finding below. No existing test assertions were changed.

The initial sandboxed `pnpm test:local` exited 1 (18 failed files, 62 failed tests,
2 unhandled errors), including `listen EPERM: operation not permitted 127.0.0.1`
and local database access failures. The same command passed with the local access
required by those tests. Logs are in `/tmp/t032-local.log` and
`/tmp/t032-local-unsandboxed.log`.

## Investigation results

Identity: all 33 human drawings, 9 corpus documents and 7 held-out documents match
the prepared baseline hashes. The initial identity run took 140.950 s; the stored
baseline was 228.061 s (0.618 ratio). This is not the paired timing measurement.

### Simultaneous one-process timing

Both commands were launched together from the repository root:

```text
AB_ROOT=tmp/t032/paired-base node tmp/t032/ab-run.mjs tmp/t032/base-rerun.json → 0; 49 documents, 304815 ms planning.
node tmp/t032/ab-run.mjs tmp/t032/paired-result.json → 0; 49 documents, 176606 ms planning.
node tmp/t032/ab-compare.mjs tmp/t032/base-rerun.json tmp/t032/paired-result.json → 0; identical 49; different 0; ratio 0.579.
```

The required ratio is ≤ 0.70: **passed** (42.1% less planning time).
Five largest documents, identified only by instance count:

| Instances | Baseline ms | Result ms | Ratio |
| --------- | ----------- | --------- | ----- |
| 103       | 34723       | 11572     | 0.333 |
| 94        | 14699       | 9544      | 0.649 |
| 70        | 12214       | 6330      | 0.518 |
| 51        | 2344        | 1802      | 0.769 |
| 50        | 6361        | 4375      | 0.688 |

Load averages immediately before launch were 18.86 / 10.73 / 8.62; at completion,
17.30 / 14.66 / 11.03. No other workload from this task ran during the pair. Two
unrelated evaluations were observed during the run (`--split dev --jobs 6
--search 120`, and `--partition llm --samples 3 --split dev --jobs 6 --search 120`).
The simultaneous comparison therefore includes external machine contention.

### Result profile

```text
node --cpu-prof --cpu-prof-dir=tmp/t032/prof-after tmp/t032/profile-run.mjs dev → 0; 18 documents, 89599 ms planning.
node tmp/t032/analyze-prof.mjs tmp/t032/prof-after routeDocument planRouteNet planNetTree conflict path preview executeTransaction deriveNetConnectivityContext auditRouting routedScore buildPlan → 0.
```

The profile spans 90.040 s. The five largest self-time costs (non-overlapping):

| Cost                                                                        | Self ms | Share |
| --------------------------------------------------------------------------- | ------- | ----- |
| `structuredClone`                                                           | 7531    | 8.4%  |
| Garbage collection                                                          | 4884    | 5.4%  |
| `fnv1a64` stable IDs                                                        | 4690    | 5.2%  |
| Logical-net grouping callback (`logical-net.js:108`)                        | 2808    | 3.1%  |
| Clearance candidate compilation/scoring callback (`route-clearance.js:628`) | 2639    | 2.9%  |

For context, inclusive costs overlap: `routeDocument` 63.7%, `preview` 45.2%,
`planRouteNet` 30.0%, clearance `path` 12.2%,
`deriveNetConnectivityContext` 6.9%, and clearance `conflict` 4.1%.
The latter was 28.8% in the plan's original profile; preview/transaction work
now dominates. No additional optimization was made. External evaluation jobs
remained active during profiling, so percentages describe this observed run.
Raw profile and summaries remain under `tmp/t032/prof-after/`,
`tmp/t032/profile-after-summary.txt` and `tmp/t032/profile-after-callees.txt`.

### Sequential 10-worker evaluation

Ran `pnpm auto-layout:eval tmp/human-cases --jobs 10` in
`tmp/t032/paired-base/` first, then in the repository root. Both exited 0 and
completed all 33 drawings. The exact required
`pgrep -fl 'auto-layout-eval|vitest'` returned no output immediately before
each run. The checks and local suite were idle during both measurements.

| Measure                                | Baseline             | Result               |
| -------------------------------------- | -------------------- | -------------------- |
| Summed planning time                   | 232890.706 ms        | 141034.593 ms        |
| Slowest planning time                  | 25107.783 ms         | 11992.229 ms         |
| Pre-run load averages (1 / 5 / 15 min) | 8.14 / 13.31 / 11.26 | 8.94 / 12.44 / 11.13 |

Summed planning ratio: **0.606**, passing the required ≤ 0.85 (39.4% less time).
Reports were copied to `tmp/t032/paired-base-quick.json` and
`tmp/t032/result-quick.json`. Measurements sum each case's `milliseconds`
(the planning interval), not process wall time or rendering time.

All required correctness and speed targets pass.

## Deviations and open questions

- The plan's fixed-distance premise does not hold for arbitrarily short inputs to
  `pointOnSegment`: its cross/dot tolerance is not a distance tolerance. Pin and
  Route bounds filters therefore remain disabled when either relevant segment
  list contains a sub-unit segment. Body filters still apply. Literal regressions
  cover a tiny path matching a distant pin, a tiny foreign Route matching a distant
  path point, and a tiny path matching a normal Route's endpoint. This follows the
  plan's instruction to leave out filters where exactness cannot be shown.
- The R39 fixture tries three candidates, but its horizontal median trunk throws
  before preview. The new regression verifies `return / throw / return`, exactly
  two candidate previews and no winner replay, plus every original output
  assertion. Requiring three previews would change the existing routing behavior.
- No remaining blockers or out-of-scope follow-up changes are required.
- No dependencies, lockfile, frozen source, existing test assertions, plan or
  review were changed. No commits or branch operations were performed. Human
  drawings and evaluation artifacts remain in ignored `tmp/` directories; this
  report contains no human case identifiers.
