# T038 report — round 2

## Summary

Implemented the round 2 candidate-rule amendment. Non-polar passive candidates
are admitted by a matched non-self Net alone, and that match fixes their pin
correspondence. Self-mapped defaults no longer constrain correspondence selection.
The four capacitor pairs lost in round 1 are retained, and the user's swapped
resistor pair joins the symmetric block.

## Steps

| Step | Status | Notes                                                                                                                                                                                                      |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Retained pin correspondence through validation and Net propagation; `fits` ignores self defaults, with equal pin names preferred when ambiguous. Seeds and polar devices retain equal pin names.           |
| 2    | done   | A non-self Net match anchors the two passive pins without checking the other Nets. Mutual uniqueness remains unchanged. Self-Net candidates keep the existing equal-pin rule.                              |
| 3    | done   | Axis passives and unordered identical-topology twin exclusion remain covered. Across-output investigation: zero human and zero held-out occurrences.                                                       |
| 4    | done   | Added equal-pin and swapped-pin bias-Net regression cases. All 513 auto-layout tests pass, including placement, input-order independence, polarity, ambiguity, unpaired passives and across-output limits. |
| 5    | done   | R88 and R142 describe the amended correspondence and candidate rules, self-Net behavior and axis limit.                                                                                                    |
| 6    | done   | Repeated default quick measurements against `3526e33`; reports, SVGs, full plans and comparison evidence are under `tmp/t038/result/`.                                                                     |

## Review findings addressed

1. **Must-fix 1:** Removed the other-Net candidate constraint. A candidate's
   matching pin explicitly supplies the correspondence used by `applyDevices`.
   Fallback correspondence selection ignores self-map entries. Equal pin names
   win when both candidate pins lie on the matched Net.
2. **Must-fix 2:** Compared exact R88 pair sets and their pin correspondences,
   and compared serialized complete plans byte for byte, across all 33 human
   drawings and seven held-out fixtures. Final verification results are recorded
   below.
3. **Should-fix 3:** Added a synthetic capacitor regression with two distinct
   self-mapped bias Nets. The equal-pin case was also run against `3526e33` and
   passed. Both equal and swapped variants pass with the implementation and
   remain independent of instance/Net order.

Two tests introduced in round 1 were aligned with the amended rule: swapped
twins attached only to self Nets remain outside rather than pairing through
swapped self-Net pins; the combined unpaired/across-output fixture now records
the attempted pair's own conflicting Net implications. Separate assertions keep
the lone unpaired resistor and lone across-output resistor outside without
conflicts. Renamed the candidate test to describe resolution through the other
unique Net. No pre-existing baseline test expectation or other test file changed.

## Acceptance results

All commands ran from the repository root with `ICM_E2E_PORT=4173`,
`AUTO_CANVAS_E2E_API_PORT=4311` and
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date
pnpm format:check → 0
pnpm docs:check → 0
pnpm typecheck → 0
pnpm lint → 0
pnpm vitest run packages/auto-layout → 0; 29 files, 513 tests passed
pnpm test:local → 0; 770 files passed, 3 skipped;
  7864 tests passed, 117 skipped
pnpm deadcode 2>&1 | grep -E 'symmetry' → 1; no output (expected no matches)
pnpm build → 0
pnpm auto-layout:review → 0; 9 corpus and 7 held-out fixtures completed
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; baseline and final result
  each completed 33/33 drawings
 git status --short apps packages/model packages/derived packages/edit-engine scripts pnpm-lock.yaml package.json
  → 0; empty
 git ls-files tmp | head -1 → 0; no output
```

The local test suite used approved local PostgreSQL/loopback access, based on
round 1's sandbox failures. No tests were weakened or skipped to obtain a pass;
the skipped tests above are the suite's existing skips. The unfiltered deadcode
command exits 1 for unrelated findings; its required symmetry filter is empty.
Build retains its existing chunk-size warning. Logs are in
`tmp/t038/logs/round-2/`.

## Investigation results

### Baseline and measurement method

The only product source differing from `3526e33` is `symmetry.ts`. Temporarily
built that file's baseline revision with the owning TypeScript build, ran the
baseline evaluation and captured full plans, then restored the implementation
and built/evaluated it. No branch switch or commit was used. Both versions used
default quick mode and the same 18 dev / 15 validation drawings.

Complete plans were serialized without normalization and compared as bytes.
A temporary instrumented copy of the implementation exposed the internally
retained pin correspondences for comparison with the baseline's equal-pin
correspondences; no production export was added. Artifacts contain private
identifiers only under git-ignored `tmp/t038/`.

### Human drawing totals

Area is the median of each result's instance-box area divided by its human
reference's instance-box area; wire is in canvas units.

| Split / version | Mirrored / total R88 pairs | Crossings | Bends | Wire   | Floating pins | Missing connections | Median instance area ratio |
| --------------- | -------------------------- | --------- | ----- | ------ | ------------- | ------------------- | -------------------------- |
| Dev / `3526e33` | 58 / 58                    | 271       | 367   | 123280 | 0             | 0                   | 2.572207                   |
| Dev / result    | 59 / 59                    | 271       | 366   | 124330 | 0             | 0                   | 2.653567                   |
| Val / `3526e33` | 29 / 29                    | 310       | 397   | 145190 | 1             | 1                   | 2.255113                   |
| Val / result    | 29 / 29                    | 310       | 397   | 145190 | 1             | 1                   | 2.255113                   |

| Dataset                 | Baseline R88 pairs | Result R88 pairs | Added swapped passive pairs | Removed pairs | Changed existing correspondences | Byte-identical plans without additions |
| ----------------------- | ------------------ | ---------------- | --------------------------- | ------------- | -------------------------------- | -------------------------------------- |
| 33 human drawings       | 87                 | 88               | 1                           | 0             | 0                                | 32 / 32                                |
| Seven held-out fixtures | 7                  | 7                | 0                           | 0             | 0                                | 7 / 7                                  |

All four capacitor pairs lost in round 1 are restored. Human passive pairs
increase from **12 to 13**: the sole addition is the user's swapped resistor
pair in dev. The held-out passive pair remains unchanged. Only the user's
complete plan changes; every document without an added pair is byte-identical.
These assertions, including exact correspondence preservation for every existing
pair and swapped correspondence for every addition, are checked by
`tmp/t038/verify-round-2.mjs`. Aggregate evidence is in
`tmp/t038/result/round-2-preservation.json`; full baseline/result plans and
private topology probes are retained alongside the evaluation reports.

The user's drawing was identified by one axis current source, five MOS pairs
and a cross-coupled pair. Its crossings remain **13 → 13**, and bends improve
**16 → 15**. Both resistors are level, on opposite sides and mirrored about the
block axis. Their full visible bounds fit inside the bounding box of the
original block members, excluding the resistors themselves from that box.

| Target                                                | Result                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| User's resistors mirrored inside the block            | pass; both full bounds inside                               |
| Crossings and bends do not increase per split         | pass; dev 271/367 → 271/366, val 310/397 → 310/397          |
| Floating pins and missing connections do not increase | pass; dev 0/0 → 0/0, val 1/1 → 1/1                          |
| Only documents with an added passive pair change      | pass; only the drawing with the added resistor pair changes |

### Across-output passives

Scanned resistor/capacitor/inductor descriptors with exactly two pins against
the R88 Net involution. Devices whose distinct connected Nets map to each
other: **0 in 33 human drawings and 0 in seven held-out fixtures**, on both
versions. The synthetic lone across-output resistor remains outside the
component, rather than becoming an axis device.

## Deviations and open questions

No production changes outside the owned paths, dependency or lockfile changes,
hand-edited generated files, plan/review edits, LLM calls, commits or branch
operations. Baseline/result copies and measurement scripts remain git-ignored.

No unresolved findings or unmet targets. Dev wire length increases by 1050
canvas units, and its median area ratio increases from 2.572207 to 2.653567;
both are reported measures without non-increase targets. Validation metrics
are unchanged. Placement and routing code were not modified.
