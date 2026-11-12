# T052 report — round 1

## Summary

Implemented the four planned defect fixes in auto-layout: preserve a freed power
label's naming claim and RichText override, protect device-owned names during
cleanup, round persisted label coordinates, and replace unsafe bulk-contact wires
introduced by whole-transaction replay with clearance-checked wires.

The evaluation improves from **619 completed / 9 refused** to **627 completed / 1
refused**. All eight recovered drawings are electrically equivalent and have no
unsafe routing problems. All result metrics on the original 619 completed drawings
are identical to the base; there are no changed drawings to list in that set.

**Status: partial.** Strict behavioral acceptance is not met: recovered case
`qzszatannt` gains one floating pin and one missing connection through an additional
virtual-label connectivity defect described below. Thus seven recoveries meet all
behavioral conditions. `yje2n6eva2` remains refused by the existing bounded router;
its unnamed Net cannot use R14 labels. The prescribed package-filtered Vitest
command also finds no tests; the equivalent root invocation passes all 591 tests.

## Steps

| Step | Status  | Notes                                                                                                                                                                                                                                 |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | done    | Built and evaluated the unchanged implementation: 628 cases, exactly the nine listed refusals; every result metric matches `tmp/le10-base/report.json`. Saved this run in `tmp/t052/base-eval/` before the final evaluation.          |
| 2    | done    | Transfer matching power-marker claims to surviving annotations before freeing their anchors; retain those owners during later claim transfer. Preserve format overrides. Synthetic regression passes.                                 |
| 3    | done    | Traced name reassignment to edit-engine connectivity rebuilding. Temporarily free unlocked device-anchored claim-owning labels, restore frozen pin groups, then restore the original anchors. Synthetic regression passes.            |
| 4    | done    | Round midpoint fallback positions, seating fallback positions/local offsets, and separation candidates to integer page units. Existing drafting-label candidate coordinates were already rounded. Odd-endpoint-sum regression passes. |
| 5    | partial | Fixed replay-created unsafe bulk wires; this also resolves routing failures exposed after class B cleanup. Investigated the divider and preserved its refusal without widening R14 or search budgets.                                 |
| 6    | done    | Updated R10/R12/R15/R38/R73 to describe cleanup claim protection, integer coordinates, and the bounded bulk-contact repair.                                                                                                           |
| 7    | partial | Evaluation and comparison completed. Original 619 are identical; eight refusals recover, but `qzszatannt` fails the no-new-floating/missing condition.                                                                                |

## Review findings addressed

Round 1; no `review.md` exists.

## Acceptance results

Commands ran from the repository root. Logs and diagnostic harnesses are local,
git-ignored files under `tmp/t052/`.

```text
pnpm build
  → 0; apps/editor build: Done
  Base build and final build both passed. Final log: build-final.log.

pnpm --filter @icm/auto-layout exec vitest run
  → 1; No test files found, exiting with code 1
  RUN .../packages/auto-layout
  include: apps/**/*.test.{ts,tsx}, packages/**/*.test.{ts,tsx}, scripts/**/*.test.mjs
  Log: acceptance-vitest.log.

pnpm exec vitest run packages/auto-layout/test
  → 0; Test Files 37 passed (37); Tests 591 passed (591)
  Log: auto-layout-tests-final.log.

pnpm typecheck
  → 0; tsc -p tsconfig.check.json --noEmit
  Log: typecheck-final.log.

pnpm lint
  → 0; oxlint: 2009 files, 0 errors, 3210 warnings
  Log: lint-final.log.

pnpm format:check
  → 0; All matched files use Prettier code style!
  Log: format-check.log.

node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
  → 0; Wrote tmp/auto-layout-eval/report.json and index.html
  628 cases: 627 completed, 1 refused.
  Log: eval-final.log.

python3 -I tmp/le10-analysis/compare.py tmp/le10-base/report.json tmp/auto-layout-eval/report.json /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json
  → 0; eight refused→completed status changes; not equivalent in B []
  [all] n=619; metrics identical 619
  Log: compare-final.log.

git diff --check
  → 0
```

The filtered Vitest invocation changes the working directory, while the discovered
root configuration uses root-relative include globs. Configuration changes are
outside this task; no tests were skipped or disabled. The root invocation runs the
entire auto-layout test directory.

All four new tests in `packages/auto-layout/test/cleanup-labels.test.ts` were also
run against the original versions of the five changed source files: **4 failed / 4**
with the intended symptoms (`regressions-on-base.log`). The current sources were
restored immediately afterward, without changing branches or the index.

The first full package run exposed two obsolete corpus assertions: one required
every rail claim owner to be a Route, and one calculated cleanup length assuming
there were no claim transfers or temporary device-label edits. Updated those
assertions for the specified ownership and cleanup behavior; retained the
transaction, electrical graph, partition, annotation, and geometry checks.

## Investigation results

### A — Freed power label loses its semantic name

`boundAnnotationName` recognizes a power-marker claim owned by an annotation's
object anchor or by the annotation itself. Freeing the anchor removes the first
match, making a valid `V` + subscript `DD` override invalid before routing starts.

`preserveLabelClaims` now transfers the existing claim, unchanged except for its
owner, to the surviving annotation in the same cleanup transaction. Later
`transferPowerClaims` preserves that annotation owner instead of moving it again
to a wire. No user formatting is dropped and no name is invented.

Test: **preserves a junction-owned power label's rich-text name through cleanup**.
It checks transaction acceptance, the exact override, semantic `VDD`, and terminal
partition preservation.

### B — Removing a route-anchor junction moves a device label to another Net

The supplied `junction-repro.mjs` reproduces the conflict. In
`transaction-connectivity-rebuild.ts`, `rebuildEditedConnectivity` constructs
surviving endpoint groups and `partitionNet` can split the old Net. Geometry-only
route removal preserves surviving endpoint pairs, but a deleted junction cannot
serve as a surviving bridge. The original Net ID stays with its first preferred
terminal group; the device pin may temporarily move to a generated split Net.

`partitionNet` calls `retargetOwnerEvidenceAfterSplit` in
`transaction-connectivity.ts`. Its `partNetId` keeps the label's current Net only
if that Net still contains a terminal of the device. Otherwise `objectNetId` /
`instanceNetId` selects the device's first Net sorted by ID. The label binding and
its name claim follow that unrelated pin, introducing the reported name conflict.
The final rebuilding pass calls this retargeter again as well.

Auto-layout now prevents the transient anchor from making that decision: free
unlocked device-anchored labels owning net-label claims, restore original frozen
pin membership, then restore their anchors before placement. No edit-engine or
model behavior was changed. Locked device labels are left untouched.

Test: **keeps a device-anchored output name on its Net while deleting route anchors**.
It reproduces the conflict using an independently authored MOS/passive circuit
and checks the original names, Net IDs, device anchors, and partition afterward.

### C — Fractional persisted label positions

An odd sum of horizontal segment endpoint coordinates gives a half-unit midpoint.
The derived anchor may use `t: 0.5`, but its persisted fallback must contain
integers. `integerPoint` now rounds those fallbacks and the analogous seating and
separation outputs. This preserves precise route anchoring while satisfying the
coordinate schema.

Test: **rounds an odd horizontal leg midpoint before persisting a label fallback**.
A synthetic grid-1 segment from x=0 to x=21 retains `t: 0.5` and persists x=11.

The midpoint refusal is fixed in `qzszatannt`, but the recovered drawing exposes
an additional routing defect, independent of coordinate rounding:

- Before routing, same-name hidden power labels virtually group `M10n.B`,
  `M12.B`, `M13.B`, and `MN.S` in `deriveNetConnectivity`.
- `planRouteNet` requested for `I2.-` and `MN.S` selects `M12.B` from that virtual
  component, returns an `I2.-`→`M12.B` wire, and reports no unjoined component.
- `resolveNetLabelBinding` in `packages/derived/src/net-label.ts` prefers a
  same-Net Route whenever one exists; before there is a Route it falls back to
  endpoints. Adding the first wire therefore changes these object/free label
  attachments and removes the virtual connection the router relied upon.
- After replay, `MN.S` is a distinct physical component. It is reported as one
  floating pin, and missing connections increase from 0 to 1. Electrical
  equivalence remains true because logical membership is preserved.

The direct reproduction is `tmp/t052/route-target-probe.mjs`; its output records
both the requested pins and the actual wire, with `unjoined undefined`.
`label-components-probe.mjs` and the captured routing diagnostic provide the
component evidence. This requires a separate decision about routing with changing
virtual label components or label attachment semantics; it is not another integer
coordinate fix. `packages/derived` is not an owned path. No broader routing or
label-connectivity redesign was improvised.

### D — Unsafe replay-created bulk wires and blocked divider contact

For `s78j9fyzha`, `auditRouting` reports no unsafe problems on the router's preview.
Whole-list replay then adds two dashed routes from body interface pins to `M2.B`
and `M3.B`, crossing those instances. `reconcileTransformDirectContacts` in
`transaction-direct-contact.ts` materializes separated contacts with
`buildManualWirePath`; these wires do not pass through clearance planning. Normal
auto-layout routing excludes MOS bulk pins, so it never supplied replacement
physical wires. The same mechanism accounts for later-stage failures in
`rxdzz3wdry` and `vyqjt4w5gv` after their cleanup refusals are fixed.

`repairBulkContactRoutes` detects these unsafe implicit dashed routes after
whole-list replay, removes them only in the planning preview, plans checked wires
between the same terminal endpoints, maps Net references back to frozen identity,
and adds the replacement edits to the single returned transaction. Replaying the
complete list then sees the authored physical connection and does not materialize
the unsafe contact wire. A failed repair retains the existing refusal; ordinary
bulk routing, R14, and search budgets are unchanged.

Test: **routes a separated visible MOS bulk contact before transaction replay can add an unchecked wire**.
It uses one MOS and one interface port at the MOS's actual artwork contact, then
checks a safe final transaction and unchanged partition. It fails on the original
sources with `Route ... crosses Instance m`.

For `yje2n6eva2`, the separated `P12.P` / `XMASTER.dn` contact needs a route around
other-Net pins and device bodies. The first captured placement has endpoints
(-180,380) and (310,160). The direct candidate crosses `XMASTER.iref` at (310,180);
the opposite orientation crosses `XDREF.D` at (210,160). The existing tree router
also refuses. Checked detours at x=-220,270,230,150 encounter `XDREF.D` or `GND1`.
The Logical Net resolution has **no name**. Consequently the existing bounded
router finds no valid path, and label fallback would violate R14. This is not a
claim that no geometric path could ever exist: a broader obstacle-routing or
placement strategy is outside the approved search-budget/layout scope.
Evidence: `tmp/t052/stub-probe.log`. The case remains refused.

### Per-drawing before/after

All completed entries below have `equivalent: true` and `unsafeProblems: []`.
Floating/missing counts are compared with the source drawing because refused base
cases have no result drawing.

| Class | Gallery ID                             | Before  | After                  | Floating / missing, source → result |
| ----- | -------------------------------------- | ------- | ---------------------- | ----------------------------------- |
| A     | `a8fbcba9-e418-4a5e-9b42-ba979f911c5c` | refused | completed              | 0 / 1 → 0 / 1                       |
| A     | `eb25ea2c-790d-4e55-9453-4f78dcf0ba76` | refused | completed              | 0 / 0 → 0 / 0                       |
| A     | `vqdg9y347r`                           | refused | completed              | 0 / 0 → 0 / 0                       |
| B     | `dr4e8zhyjg`                           | refused | completed              | 0 / 0 → 0 / 0                       |
| B     | `rxdzz3wdry`                           | refused | completed              | 0 / 0 → 0 / 0                       |
| B     | `vyqjt4w5gv`                           | refused | completed              | 0 / 0 → 0 / 0                       |
| C     | `qzszatannt`                           | refused | completed, R14 warning | 0 / 0 → **1 / 1**                   |
| D     | `s78j9fyzha`                           | refused | completed              | 0 / 0 → 0 / 0                       |
| D     | `yje2n6eva2`                           | refused | refused                | no result; source 1 / 6             |

## Deviations and open questions

- Strict behavioral acceptance remains open for `qzszatannt`; its additional
  virtual-component routing defect needs a follow-up plan. This round must not be
  treated as fully accepted merely because eight refusals now return plans.
- The one retained divider refusal is documented above. No fallback names were
  invented and R14 was not widened.
- The prescribed Vitest command cannot discover tests with the current root
  configuration; the root invocation provides full package coverage without
  changing out-of-scope tooling.
- Existing corpus assertions were adapted to the planned ownership and cleanup
  changes, not removed or disabled. Four independent synthetic regressions were
  added; no third-party fixture or excerpt was added to the repository.
- No dependencies, lockfile, generated files, plan, or review were edited. No LLM
  provider calls were made. No commit, push, merge, rebase, or branch switch was
  performed. All debug instrumentation was removed from source; local diagnostic
  artifacts remain under git-ignored `tmp/t052/`.
