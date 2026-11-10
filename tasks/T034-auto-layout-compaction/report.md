# T034 report — round 2

## Summary

Addressed the three round-1 review findings within the round-2 scope. R44 now
compares the alternative's placements with the winner before R97, observed through
`compactPlacements`. One exported `documentObjectIds` helper supplies all three
reservation sites, and all collision retry loops stop after 64 attempts with an
error naming the colliding ID. Added coverage for every Document object collection
and for success on the last allowed salt versus failure when all 64 are reserved.

The placement assertion now passes, exposing the adjacent choices-equality
assertion, which the review explicitly excludes from changes. That assertion is
unchanged pending scope clarification. This round is **partial** because both
required test suites fail only that assertion. No commits, branch changes, dependency
changes, or plan/review edits were made.

## Steps

| Step | Status  | Notes                                                                                                                          |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1    | done    | Round-1 R98 root-cause investigation retained below.                                                                           |
| 2    | done    | Centralized object-ID enumeration and bounded all reservation retries; added collection and exhaustion coverage.               |
| 3    | done    | Round-1 column compaction retained unchanged.                                                                                  |
| 4    | done    | Round-1 finalist-only compaction retained unchanged.                                                                           |
| 5    | done    | Round-1 synthetic compaction and repeated-placement tests retained.                                                            |
| 6    | partial | Authorized R44 placement comparison fixed; newly exposed choices assertion remains outside scope.                              |
| 7    | done    | Round-1 evaluation ratios and medians retained unchanged.                                                                      |
| 8    | done    | Round-1 specification updates retained unchanged.                                                                              |
| 9    | done    | Round-1 internal option documentation retained unchanged.                                                                      |
| 10   | done    | Reran all acceptance commands; all 33 evaluated plans match round 1. Prior paired timing retained as authorized by the review. |

## Review findings addressed

- **1 (must-fix):** Spied on `compactPlacements`, asserted it runs exactly once,
  and compared the alternative's instances with its input instances. The final
  routed-score assertion is unchanged. The previously unreachable choices
  assertion now fails; see deviations below.
- **2 (should-fix):** Exported `documentObjectIds` from `route-net-planner.ts`
  through the existing edit-engine barrel export. Both auto-layout callers and
  the route-net planner use it. `freshWirePlan` uses `Set.has` for membership.
  The new test covers instances, Nets, Routes, Junctions, annotations, groups,
  constraints, connectivity evidence, no-connects, couplings, drafting objects,
  Route legs and bends, including omitted optional collections.
- **3 (should-fix):** Bounded the outer route-net replan loop, its intent-ID salt
  loop, and `freshWirePlan` to 64 attempts each. Exhaustion throws an `Error`
  naming the colliding ID. A real `planRouteNet` call succeeds when salt 63 is
  free and throws when the reserved set also occupies that final attempt.

## Acceptance results

Every acceptance command uses lane 1:
`ICM_E2E_PORT=4173 AUTO_CANVAS_E2E_API_PORT=4311 AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`.
Round-2 logs are under git-ignored `tmp/t034/round2/`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files.
pnpm typecheck → 0 (final rerun).
pnpm lint → 0; 0 errors, 3053 warnings under the existing policy.
pnpm vitest run packages/edit-engine packages/auto-layout → 1;
  1 failed | 119 passed test files; 1 failed | 1429 passed | 4 skipped tests.
  Only failure: quality.test.ts R44 choices equality after winner compaction.
pnpm test:local → 1 (final rerun with local-service access);
  1 failed | 766 passed | 3 skipped test files;
  1 failed | 7823 passed | 117 skipped tests. Same R44 choices assertion.
pnpm deadcode 2>&1 | grep -E 'compact|route-net-planner|auto-layout' → 1;
  no output, as required (grep exits 1 when there are no matches).
pnpm build → 0.
pnpm auto-layout:review → 0;
  Wrote 9 corpus and 7 held-out SVGs and tmp/auto-layout-review/index.html.
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0; 33 completed.
git diff --stat 88eab98 -- packages/auto-layout/test/corpus.test.ts → 0; empty.
git status --short packages/model packages/derived packages/project-protocol apps fixtures docs/agent pnpm-lock.yaml package.json → 0; empty.
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/' → 1;
  no output, as required.
git diff --check → 0.
node tmp/t034/round2/compare-hashes.mjs → 0;
  33 round-1 cases, 33 round-2 cases completed, 33 matching plan hashes, 0 mismatches.
```

The initial typecheck found a missing `netId` in the new test annotation's
binding; it was corrected and the rerun passed. The initial sandboxed local
suite additionally failed on `listen EPERM 127.0.0.1` and
`connect EPERM 127.0.0.1:5432`; the final rerun with local-service access removed
all environment failures and retained only the R44 choices failure.

Round 2 changes no normal plan output: all 33 complete plan hashes match the
round-1 result. Per the review, no new paired base/result timing run was needed;
the previous paired results below remain the timing evidence. The round-2
report and hash counts are saved as `tmp/t034/round2/variant-result.json` and
`tmp/t034/round2/hash-comparison.json`. Round-1 paired artifacts are preserved.

## Investigation results

The following R98 investigation and paired measurements are retained from round 1.

### R98 reproduction and root cause

The new `fresh-ids.test.ts` uses the repository's public `two-inverters` fixture,
not a human evaluation case. It obtains a healthy `planLayoutOnce` result, then
renames one existing foreign-Net Junction and all its Route endpoint references
to the ID of a Junction that the healthy replan creates. Geometry and connectivity
of the input are otherwise unchanged. Before the fix, the test failed with:

```text
AUTO_LAYOUT_RULE_UNSATISFIED
R10: whole-list replay changed a terminal Base Net partition
```

The input Document is at revision 82. Cleanup and placement previews bring the
routing input to revision 84. The ground trunk derives its wire ID from
`deriveStableId("route-net", "document-82822626bf0850db", "84", "trunk")`, producing
`route-net-56dec49dde9522a4`. Its free end creates an `add_junction` edit with ID
`route-net-56dec49dde9522a4-to-junction`. The test gives that ID to the input's
`junction-ui-8` on output Net `net-75049abbe4dfc20a`. This is the same aliasing
mechanism as the plan's supply/ground example, reproduced on output/ground.

Stepwise routing has already removed the old Junction, so its preview succeeds.
Whole-list replay starts with the original Document and removes then recreates
that identity in one transaction. `rebuildEditedConnectivity` preserves bridges
between surviving representatives of the original Net's endpoint groups
(`transaction-connectivity-rebuild.ts`, `sourceGroups` / `representatives`).
The regenerated Junction's endpoint key looks like a surviving old endpoint;
it reconnects the new ground routing to the old output group. The subsequent
Base Net merge/materialization assigns the resulting membership. Thus correct
new edit Net hints do not protect against reuse of an old endpoint identity.
Changing only the ID reproduces the failure, ruling out a geometry change.

Reservations prevent reuse before authoring edits. Ordinary `planRouteNet` calls
without the option keep the original derivations. Auto-layout reserves the input's
object IDs even after cleanup has removed those objects; current preview objects
are also occupied. Deterministic salt retries cover base IDs, derived suffixes,
and actual emitted split-piece IDs, including hashed splits. An additional test
proves an unrelated reserved ID sharing a wire prefix does not change the plan.
No edit-list renaming
or transaction/normalization semantics were changed.

### Routing-path ID derivations

- `route-net-planner.ts`: stable wire intent IDs from Document ID, routing-preview
  revision and `trunk`/component key; salt is added only for a reserved collision.
- `auto-layout/src/route.ts`: `auto-layout-stub` from Document and pin/contact
  identities; `auto-layout-label` from Document and endpoint identity. A fallback
  label's wire intent is `<label-id>-stub`.
- `wire-intent-planner.ts`: `<intent>-route`, `<intent>-net`,
  `<intent>-from-junction`, `<intent>-to-junction`; split markers use the intent
  plus endpoint side.
- `split-route-ids.ts`: readable `<parent>-a-<marker>` / `-b-` pieces, switching to
  `deriveStableId("route", parent, side, marker)` above 128 characters.
- `wire-commit-planner.ts`: split-piece IDs for endpoint attachments; numbered
  Route parts for contact chains; Route member/selector suffixes. Route-path
  construction also derives leg/bend identities. The reservation input includes
  existing leg/bend IDs; generated Route/Junction/annotation IDs are checked.
- Transaction reconciliation can subsequently materialize/canonicalize topology
  objects. Those authority-owned derivations and semantics are unchanged.

### Behavioral evidence

The unchanged corpus passes R8/R71 seats, row/tail relations, symmetry and repeated
placement. The new integration test observes the actual pre-R97 finalist, proves
a narrower instance box and strictly lower routed score, commits the edits, and
plans again with no diagnostics or transform edits. Fixed-instance and partition
fixtures compare complete edit hashes captured from an isolated `88eab98` build;
both are byte-identical and neither invokes compaction.

### Paired evaluation

Built `88eab98` in an isolated archive and evaluated it, then evaluated the final
implementation on the same machine with `--jobs 7`, sequentially after tests and
builds had finished. Both runs completed all 33 drawings. The following medians
use the conventional average of the middle two observations for an even split.
No human case identifiers or excerpts are included here.

| Measure                        | Base dev | Result dev | Base val | Result val |
| ------------------------------ | -------: | ---------: | -------: | ---------: |
| Completed documents            |       18 |         18 |       15 |         15 |
| Median instance-box area ratio |   2.7686 |     2.5722 |   2.3666 |     2.2551 |
| Median layout-area ratio       |   2.6709 |     2.3225 |   2.3477 |     2.1866 |
| Median instance-width ratio    |   1.8885 |     1.8159 |   1.8386 |     1.7542 |
| Wire length                    |   128600 |     123280 |   148830 |     145190 |
| Crossings                      |      271 |        271 |      310 |        310 |
| Bends                          |      367 |        367 |      397 |        397 |
| Floating pins                  |        0 |          0 |        1 |          1 |
| Missing connections            |        0 |          0 |        1 |          1 |
| Label overlaps                 |        0 |          0 |        1 |          1 |
| Label clearance violations     |       33 |         32 |       31 |         31 |
| Terminal departures            |        8 |          8 |        6 |          6 |
| Mirrored symmetry pairs        |       58 |         58 |       29 |         29 |
| Documents compacted            |        0 |          9 |        0 |          5 |
| Planning time relative to base |   1.000× |     1.082× |   1.000× |     1.076× |

The aggregate paired planning-time ratio is **1.07884×**, computed from summed
per-case planner durations, below the 1.12× target. All split-level quality
constraints pass, including dev instance-area median ≤ 2.70 and validation no
worse than baseline.

The plan's quoted dev medians use the upper middle observation of the 18 cases.
Using that same convention reproduces its base figures: instance area
2.9216 → 2.6156, layout area 2.6781 → 2.3227, and width 1.9979 → 1.8528.
The evaluation script implements the standard median; the odd-sized validation
split is identical under both conventions.

R97 found a gap and attempted a replan on **17 documents**: 11 dev and 6 val.
It accepted 9 dev / 5 val and **rejected 2 dev / 1 val (3 total)**. The other 16
Documents had no compaction replan. A separate temporary module-load observer
counted only the evaluator's measured call, excluding its untimed quick reference.
All 33 observed plan hashes matched the uninstrumented result. Observation was
isolated from the paired timing and did not edit production source or generated
files.

Required artifacts:

- `tmp/t034/result/variant-base.json`
- `tmp/t034/result/variant-result.json`
- `tmp/t034/result/svg-result/` (33 result SVGs)

The temporary observation loader and raw logs also stay under the ignored
`tmp/t034/result/` directory. Product code has no environment switch or y mode.

## Deviations and open questions

After the authorized placement-assertion change, the R44 test reaches its next
assertion, `expect(alternative.choices).toEqual(selected.choices)`, and fails:
the alternative retains three Cell Pin side choices, while R97's exact replan
returns empty side/orientation choices. The review says “Nothing else in this
test changes.” No product or assertion change was improvised; scope clarification
was requested to compare choices with the pre-compaction winner as well.

The shared helper stays in the owned `route-net-planner.ts` and is already
exported by `@icm/edit-engine`, requiring no new barrel or model changes.
