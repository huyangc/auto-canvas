# T037 report — round 2

## Summary

Fixed both must-fix findings from the round 1 review. Block connectivity now
accepts validated magnetic couplings, and prompt version 5 says so explicitly.
Cross-coupled candidates now join across R50 stages, keeping rail-fed latches
atomic. R143 and R110 document these exceptions.

The round 1 roles, canonical/anonymized payloads, recognition and coupled-inductor
placement remain in place. Synthetic regression tests cover the two fixes and
malformed coupling rejection. No provider API calls, cache writes, dependency
changes, commits or branch switches were made.

## Steps

| Step | Status | Notes                                                                                                                                                                                                                                                                                                         |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done   | Both block roles and display titles remain implemented. LOADBench mappings stay unchanged because no existing label unambiguously identifies either role.                                                                                                                                                     |
| 2    | done   | Prompt stays at version `5`; its connectivity sentence now permits non-rail nets or listed couplings, exactly as amended.                                                                                                                                                                                     |
| 3    | done   | Retained whitelisted, canonical/anonymized coupling payloads, omitting the key when empty.                                                                                                                                                                                                                    |
| 4    | done   | Valid coupled inductors remain atomic. Cross-coupled candidates now union across stage boundaries. The invariant checker reuses recognized valid coupling pairs as graph edges without modifying electrical nets.                                                                                             |
| 5    | done   | Retained the existing `matched-pair` movement/persistence template and dotted-pin placement from round 1; all strategies, re-planning and seeded search pass.                                                                                                                                                 |
| 6    | done   | `coupled.test.ts` now has 18 passing tests. Added transformer block connectivity with/without coupling, three malformed-member cases, a rail-fed latch variant, and the exact amended prompt sentence. No expectations in `partition-prompt.test.ts` or `units.test.ts` changed; both files remain untouched. |
| 7    | done   | Updated R143 connectivity and cross-stage unit rules, and qualified R110's stage restriction. R143 remains after R140, as the review requests.                                                                                                                                                                |
| 8    | done   | Fresh baseline and result evaluations both completed 33/33 drawings; all 33 plan hashes match. Unit membership changes are quantified below.                                                                                                                                                                  |

## Review findings addressed

1. **Magnetically connected blocks:** `partitionInvariantErrors` traverses both
   non-rail wired connections and valid `coupled-inductors` structures from the
   existing recognizer. This reuses validation for missing/non-inductor members,
   duplicate members and invalid dot pins. The synthetic amplifier's primary and
   secondary circuits form one valid block with their coupling; removing it yields
   exactly `Disconnected block: amplifier`. Missing/non-inductor member variants
   remain disconnected. The prompt uses the exact requested sentence and remains
   version `5`.
2. **Rail-fed latch units:** `recognitionUnits` joins every cross-coupled candidate
   before the usual stage-local component splitting, just as it already does for
   magnetic coupling. The latch test covers both common-tail and grounded-source
   topologies, asserting one pair unit, the `cross-coupled` role and its rule-block
   title. On the 33 human drawings, two drawings change membership: four old units
   become two combined units, reducing the total from 577 to 575. Results agree
   against both `3526e33` and the round 1 implementation.
3. **Spec note:** R143 stays immediately after R140. No rule renumbering.

## Acceptance results

All commands use lane 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
`AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`). The runner removes
API-key variables and authentication tokens. Logs and case-keyed measurements
remain ignored under `tmp/t037-round2/`.

```text
pnpm install --frozen-lockfile --offline → 0; Already up to date.
pnpm format:check → 0; All matched files use Prettier code style!
pnpm docs:check → 0; Validated local Markdown links in 74 files.
pnpm typecheck → 0.
pnpm lint → 0; 0 errors, 3102 warnings.
pnpm vitest run packages/auto-layout → 0; 30 files, 521 tests passed.
pnpm test:local → 0; 771 files passed, 3 skipped; 7872 tests passed, 117 skipped.
pnpm deadcode 2>&1 | grep -E 'coupl|partition-prompt|units' → 1; no output, matching the acceptance expectation (grep exits 1 with no matches).
pnpm build → 0.
pnpm auto-layout:review → 0; wrote 9 corpus and 7 held-out SVGs.
pnpm auto-layout:eval tmp/human-cases --jobs 7 → 0 for baseline and result; each completed 33/33 drawings; all 33 plan hashes match 3526e33.
node scripts/auto-layout-llm-partition.mjs tmp/human-cases --dry-run → 0; 33 jobs, 192851 payload bytes, 0 cached, no API calls.
git status --short packages/model packages/derived packages/edit-engine apps pnpm-lock.yaml package.json → 0; empty.
git ls-files tmp | head -1 → 0; empty.
```

The focused pre-fix command was
`pnpm vitest run packages/auto-layout/test/coupled.test.ts -t "block connected|latch unit|prompt v5"`.
It failed on precisely the disconnected transformer, two rail-fed latch units,
and the old prompt sentence (3 failed, 1 passed). After the fixes,
`pnpm vitest run packages/auto-layout/test/coupled.test.ts` passed all 18 tests.
No existing assertion was weakened or removed.

The full suite runs with approved local-server permissions because the prior
round established that sandboxed loopback listeners fail with `listen EPERM`.

## Investigation results

- **Movement mechanism:** retained round 1's `RecognizedGroup` pair membership,
  using the model-supported `matched-pair` kind plus derived `coupledDotPins`.
  It supplies grouping to all strategies, stage placement, annealing and compaction.
  Dotted-pin coordinates determine offsets; a top/bottom reflection accommodates
  opposite electrical dot pins while retaining parallel vertical winding axes.
  Collision repair unions the members; attachments cannot separate them.
  Re-planning reconstructs metadata from the coupling record. Conflicting fixed
  placements are refused.
- **Block connectivity:** traverse recognized coupling edges separately from
  electrical nets. Magnetic coupling does not create a conductive connection or
  alter stored connectivity. The change is confined to the owned invariant check.
- **Unit impact:** compare sorted member sets, ignoring ordinal unit identifiers
  that can shift after a merge. Both baseline comparisons find 31 unchanged
  drawings and 2 changed drawings, with 4 member sets removed and 2 added;
  total units change from 577 to 575.
- **Baseline isolation:** exported `3526e33` into ignored `tmp/t037-round2/base/`,
  compiled its auto-layout source and used its evaluator. Unchanged dependency
  packages and installed dependencies are linked from the workspace. No branch
  switching or source replacement was needed. Baseline evaluation ran before the
  result evaluation, both with default mode and 7 jobs. Both completed all 33
  drawings, and every plan hash is identical.
- **LOADBench/schema:** `positiveFeedbackPart` is broader than a cross-coupled
  pair; no dedicated coupled-inductor label exists. Existing mappings remain
  unchanged. The partition script already imports `BLOCK_ROLES` for its strict
  schema, so no script change is needed.
- **Electrical validation:** synthetic tests execute real edit-engine
  transactions and verify terminal partitions and coupling records survive.
  These establish topology/layout behavior, not analog simulation performance.

## Deviations and open questions

- The round 1 connectivity and stage-boundary limitations are resolved within
  the amended scope. No implementation finding remains open.
- The absent R142 anchor is handled as directed by the review: R143 follows R140.
- The amended cross-stage unit rule intentionally changes partition payload units
  for two human drawings without changing the prompt version beyond `5`.
- LLM resampling and partition-mode evaluation remain Opus's follow-up after user
  approval; only the no-API dry run was performed here.
