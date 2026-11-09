# T025 report — round 4

## Summary

Fixed the PR 29 round-2 finding: symmetric blocks could reverse order across
rows, causing alignment registration to reject a merge and split a rigid block.
`orderRows` now derives one canonical block order from the mean positions after
its initial tie sort (ties by block id using `compareIds`). It reapplies that
order in the existing sweeps and before scoring adjacent transpositions.
Only block slots are reordered; non-block nodes retain their slots.

Both prescribed fixtures now preserve every pair midpoint on its tail axis in
all three strategies, with no geometry problem. All acceptance checks pass
with local-service access. Quick and search each complete 33/33 drawings;
all 87 detected pairs remain mirrored and level and all 11 axis devices remain
on-axis. Fresh paired planning time is 0.975× baseline.

## Steps

| Step | Status | Notes                                                                                                                                               |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | R88 detection retained unchanged; prior accepted findings remain fixed.                                                                             |
| 2    | done   | Rule O constrains block order after the initial sort, every row sweep and each transposition candidate, keeping every scored/best order consistent. |
| 3    | done   | Layered, stages and template use the shared fix; both linked-block variants covered in each.                                                        |
| 4    | done   | Existing rigid-search, finishing, determinism and zero-budget tests pass unchanged.                                                                 |
| 5    | done   | Evaluation unchanged; fresh quick, search and conditional paired timing collected.                                                                  |
| 6    | done   | R89 explicitly requires one left-to-right block order across rows.                                                                                  |
| 7    | done   | Six new regression cases; all 371 auto-layout tests pass without rebuilding an existing expectation.                                                |
| 8    | done   | Per-document round-3 comparisons, dev/val totals, timing and six refreshed rendered comparisons below.                                              |

## Review findings addressed

**PR 29 codex review, round 2, P2 — blocks split by contradictory row order.**
The two plan fixtures were added before the fix, each run through all three
strategies. The command
`pnpm vitest run packages/auto-layout/test/symmetry.test.ts -t 'blocks rigid across rows'`
failed five cases: cross-linked layered/template and mirrored layered/stages/template.
The layered failures reproduce the review's exact midpoint mismatches:
620 versus axis 90, and 700 versus axis 90. Template translates these to
660 versus 130 and 740 versus 130. Cross-linked stages already passed.

The fix leaves half-layout offsets, alignment and finishing unchanged and
constrains only the existing row ordering. All six cases now pass; the combined
symmetry/layered run passes 47/47. This confirms the ordering-cycle diagnosis.
The tests assert two detected blocks, four pairs and one axis device per block,
no placement problem, no R10 geometry problem, and every pair's origin midpoint
exactly at the tail's `+` pin x. Half layouts have no blocks, so their ordering
is unchanged. No remaining must-fix finding is open.

## Acceptance results

All commands use lane 1: `ICM_E2E_PORT=4173`,
`AUTO_CANVAS_E2E_API_PORT=4311`, and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
The repository runner's dependency-verification flags remain disabled; the
explicit offline frozen install still ran. Base/path changes follow the
round-3 and round-4 amendments.

```text
pnpm install --frozen-lockfile --offline → 0; frozen offline install; no dependency or lockfile change
pnpm format:check → 0; all matched files use Prettier style
pnpm docs:check → 0; links valid
pnpm typecheck → 0; no errors
pnpm lint → 0; 0 errors; warnings remain
pnpm vitest run packages/auto-layout → 0; 371 passed, 18 files
pnpm test:local → 1; 60 failed, 7564 passed, 149 skipped; PostgreSQL connect EPERM and loopback listen EPERM
pnpm deadcode 2>&1 | grep -E 'auto-layout|symmetry' → 1; no output; expected grep status
pnpm build → 0; all packages built
pnpm auto-layout:review → 0; 9 corpus and 7 held-out SVGs
pnpm test:local (local-service access) → 0; 7657 passed, 116 skipped; 755 files passed, 2 skipped
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t025/base-quick.json --jobs 10 → 0; 33/33 completed
pnpm auto-layout:eval tmp/human-cases --jobs 10 (in tmp/t025/paired-base) → 0; 33/33 completed
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 → 0; 33/33 completed
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent pnpm-lock.yaml package.json → 0; empty
git diff --stat f8f15fe -- packages/auto-layout/src/recognize.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/route.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/routing-audit.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/search.ts packages/auto-layout/src/place-markers.ts packages/auto-layout/src/place-fallback.ts scripts/auto-layout-recognition.mjs scripts/auto-layout-review.mjs → 0; empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1; empty
```

The first full-suite run was blocked by sandbox service restrictions. Its
successful rerun enabled local PostgreSQL and loopback listeners without
changing tests. Headless Chrome similarly needed local-process access to
render the six comparisons. Both attempts are logged. Logs and private
artifacts are under ignored `tmp/t025/round4/`.

## Investigation results

### Quick mode

| Split | Run              | Completed | Crossings | Bends | Floating | Missing | Wire length | Labels / clearance / departures |
| ----- | ---------------- | --------- | --------- | ----- | -------- | ------- | ----------- | ------------------------------- |
| dev   | f8f15fe          | 18/18     | 295       | 401   | 0        | 0       | 123,660     | 0 / 40 / 7                      |
| dev   | Accepted round 3 | 18/18     | 287       | 371   | 0        | 0       | 127,850     | 0 / 32 / 8                      |
| dev   | Round 4          | 18/18     | 287       | 371   | 0        | 0       | 127,320     | 0 / 33 / 8                      |
| val   | f8f15fe          | 15/15     | 321       | 391   | 1        | 1       | 147,150     | 0 / 31 / 5                      |
| val   | Accepted round 3 | 15/15     | 338       | 403   | 1        | 1       | 148,230     | 1 / 31 / 6                      |
| val   | Round 4          | 15/15     | 337       | 400   | 1        | 1       | 148,260     | 1 / 31 / 6                      |

All quick targets pass: dev crossings 287 ≤ 310, bends 371 ≤ 440,
wire length 127,320 ≤ 136,000, readability 0/33/8 ≤ 1/44/10.
Floating pins remain dev 0 / val 1; no document exceeds its own baseline.
Unsafe problems and inequivalent documents are zero in both splits.
Val was reported separately and no constants were tuned.

Six symmetry counts below are
`pairs / mirrored / level / orientationMirrored / axisDevices / onAxis`.

| Split | Human                     | f8f15fe layout            | Accepted round 3          | Round 4                   |
| ----- | ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| dev   | 58 / 31 / 54 / 34 / 7 / 4 | 58 / 13 / 57 / 34 / 7 / 1 | 58 / 58 / 58 / 58 / 7 / 7 | 58 / 58 / 58 / 58 / 7 / 7 |
| val   | 29 / 19 / 29 / 23 / 4 / 3 | 29 / 12 / 29 / 19 / 4 / 0 | 29 / 29 / 29 / 29 / 4 / 4 | 29 / 29 / 29 / 29 / 4 / 4 |

Dev fractions: mirrored 58/58, level 58/58, on-axis 7/7 (all 100%).
Val: 29/29, 29/29, 4/4 (all 100%). Across all 33 drawings:
87/87, 87/87, 11/11. There are no detected dev pairs left unmirrored:
conflicted 0, different rows 0, collision repair 0, other 0.

### Every changed document against accepted round 3

Quick compares with `tmp/t025/review3/paired-result.json`.
Only the following document changes crossings, bends or symmetry counts;
all others match for those measures. Counts only, with no human-case identifiers.

| Split | Crossings before → after | Bends before → after | Six counts before     | Six counts after      |
| ----- | ------------------------ | -------------------- | --------------------- | --------------------- |
| val   | 35 → 34                  | 31 → 28              | 8 / 8 / 8 / 8 / 2 / 2 | 8 / 8 / 8 / 8 / 2 / 2 |

Search compares with `tmp/t025/review3/search120.json`. Every document that
changes one of those three measures is listed here:

| Split | Crossings before → after | Bends before → after | Six counts before         | Six counts after          |
| ----- | ------------------------ | -------------------- | ------------------------- | ------------------------- |
| dev   | 29 → 28                  | 24 → 18              | 10 / 10 / 10 / 10 / 1 / 1 | 10 / 10 / 10 / 10 / 1 / 1 |
| val   | 1 → 1                    | 9 → 8                | 0 / 0 / 0 / 0 / 0 / 0     | 0 / 0 / 0 / 0 / 0 / 0     |
| dev   | 6 → 5                    | 12 → 10              | 1 / 1 / 1 / 1 / 1 / 1     | 1 / 1 / 1 / 1 / 1 / 1     |
| dev   | 0 → 0                    | 6 → 5                | 0 / 0 / 0 / 0 / 0 / 0     | 0 / 0 / 0 / 0 / 0 / 0     |
| val   | 29 → 26                  | 25 → 30              | 8 / 8 / 8 / 8 / 2 / 2     | 8 / 8 / 8 / 8 / 2 / 2     |
| dev   | 5 → 5                    | 23 → 22              | 0 / 0 / 0 / 0 / 0 / 0     | 0 / 0 / 0 / 0 / 0 / 0     |
| val   | 22 → 20                  | 33 → 33              | 0 / 0 / 0 / 0 / 0 / 0     | 0 / 0 / 0 / 0 / 0 / 0     |

Search is time-budgeted (`--search 120 --seed 1 --jobs 12`), so differences
between runs can include different numbers of evaluations completed within
the budget. This is not an evaluation-count determinism comparison.

### Quick crossing increases against f8f15fe

The required symmetry rule still costs crossings on these documents. All are
reported rather than dropping the rule; the aggregate dev result improves.
Baseline symmetry is the accepted round-3 measurement of the same baseline
placements, reused because R88 detection is unchanged.

| Split | Crossings before → after | Six counts before        | Six counts after          |
| ----- | ------------------------ | ------------------------ | ------------------------- |
| dev   | 17 → 29                  | 10 / 6 / 10 / 10 / 1 / 0 | 10 / 10 / 10 / 10 / 1 / 1 |
| val   | 20 → 29                  | 10 / 4 / 10 / 4 / 0 / 0  | 10 / 10 / 10 / 10 / 0 / 0 |
| dev   | 52 → 66                  | 12 / 0 / 12 / 6 / 0 / 0  | 12 / 12 / 12 / 12 / 0 / 0 |
| dev   | 12 → 15                  | 6 / 0 / 6 / 2 / 2 / 1    | 6 / 6 / 6 / 6 / 2 / 2     |
| dev   | 3 → 8                    | 2 / 0 / 2 / 1 / 0 / 0    | 2 / 2 / 2 / 2 / 0 / 0     |
| dev   | 8 → 10                   | 3 / 2 / 3 / 3 / 0 / 0    | 3 / 3 / 3 / 3 / 0 / 0     |
| dev   | 7 → 15                   | 1 / 1 / 1 / 1 / 1 / 0    | 1 / 1 / 1 / 1 / 1 / 1     |
| val   | 25 → 34                  | 8 / 0 / 8 / 5 / 2 / 0    | 8 / 8 / 8 / 8 / 2 / 2     |
| dev   | 11 → 13                  | 5 / 3 / 5 / 3 / 1 / 0    | 5 / 5 / 5 / 5 / 1 / 1     |

### Recognition investigations carried from accepted round 3

Detection was not edited in round 4. The accepted topology investigations
remain applicable: 12 dev / 8 val devices previously conflicted in round 1 are
paired; 4 dev / 1 val pairs use the side convention; 1 dev row has a two-device
axis run, and val has none. Round 2 had rail-based proposals involving 14 dev
devices, of which 6 devices (3 pairs) depended on rails; the other 8 retain
non-rail evidence. All 12 val devices with rail proposals retain non-rail evidence.
Relative to the original 61-pair dev probe, the 3 excluded rail-only pairs are
outside seeded components; the retained 58 are all mirrored. These are prior
accepted counts, not a new instrumented detector run.

### Paired timing

The quick summed planning time changed from 269,845.5 ms in accepted round 3
to 183,412.2 ms (-32.0%). This exceeds the round-4
10% trigger, so a fresh baseline was run from `tmp/t025/paired-base/`.
The fresh result and baseline ran sequentially, result first, with 10 jobs;
no tests or other evaluator ran alongside either. Before each run, the required
`pgrep -fl 'auto-layout-eval|vitest'` produced no output when run with process-list
access. The sandbox itself could not read the process list. No wait for another
session was needed. Search and rendering started only after both timing runs.

| Run              | Documents | Summed planning ms | Slowest planning ms | Elapsed s | One-minute load before → after |
| ---------------- | --------- | ------------------ | ------------------- | --------- | ------------------------------ |
| Round 4 quick    | 33        | 183,412.2          | 15,747.8            | 50.58     | 2.41 → 6.60                    |
| f8f15fe baseline | 33        | 188,198.7          | 15,862.9            | 52.41     | 4.29 → 7.86                    |

Summed ratio 0.975×, below the 1.25× ceiling and more than 0.1 below it.
The accepted round-3 quick measurement ran alongside its baseline, as recorded
in review.md; the fresh pair ran sequentially. The fresh pair is the comparable
performance evidence for this round.

### Search

| Split | Run              | Completed | Crossings | Bends | Floating | Missing | Wire length | Labels / clearance / departures |
| ----- | ---------------- | --------- | --------- | ----- | -------- | ------- | ----------- | ------------------------------- |
| dev   | f8f15fe          | 18/18     | 235       | 354   | 0        | 0       | 125,400     | 0 / 23 / 5                      |
| dev   | Accepted round 3 | 18/18     | 221       | 328   | 0        | 0       | 130,990     | 0 / 22 / 7                      |
| dev   | Round 4          | 18/18     | 219       | 318   | 0        | 0       | 131,170     | 0 / 21 / 7                      |
| val   | f8f15fe          | 15/15     | 288       | 386   | 1        | 1       | 150,260     | 0 / 28 / 5                      |
| val   | Accepted round 3 | 15/15     | 299       | 384   | 1        | 1       | 149,760     | 1 / 30 / 6                      |
| val   | Round 4          | 15/15     | 294       | 388   | 1        | 1       | 148,630     | 1 / 30 / 6                      |

Search completes 33/33; no document has more floating pins than quick.
Both splits have zero unsafe problems and zero inequivalent documents.
Search symmetry remains dev 58/58/58/58/7/7 and val 29/29/29/29/4/4.
Elapsed 381.58 seconds; one-minute load
6.80 → 10.46.
Only lightweight analysis, local comparison rendering and report work overlapped
search; no test suite or second evaluator did.

### Rendered comparisons and artifacts

Refreshed all six baseline/result quick comparisons under `tmp/t025/pairs/`
(`index.html`, `pair-01.html` through `pair-06.html`, and matching PNGs).
All six were rendered and visually inspected: drawings are complete and fit
inside both panels. They retain the three fully symmetric human selections
(10/10, 10/10, 5/5), low-human-symmetry selections (0/12 and 1/9), and examples
where the required symmetry increases crossings. The paired branches are
visibly level and mirrored; the crossing trade-offs remain visible.

Quick and search reports were copied immediately after their runs to
`tmp/t025/result-quick.json` and `tmp/t025/result-search120.json`. Quick SVGs
are preserved in `tmp/t025/quick-svg/`. Human cases, excerpts, case identifiers
and case-keyed analysis remain ignored and untracked.

## Deviations and open questions

No implementation deviation or unresolved finding remains. Canonical block
rank is computed once from the initial tie-sorted row positions and kept
throughout the sweeps, so reordering one row cannot change the constraint for
another row. It is applied before every crossing-objective evaluation.
No existing test expectation was changed, deleted or weakened this round.

The only source/spec/test edits in round 4 are `layered.ts`, `symmetry.test.ts`
and R89, plus this report. Frozen paths, protected packages, dependencies,
lockfile, `plan.md` and `review.md` are unchanged. No commit, push, rebase,
merge or branch switch was performed. This is topology/display work with
planner electrical-equivalence checks; no simulation behavior is changed.
