# T052 — Fix the auto-layout refusals on the small Gallery set

- Branch: `task/T052-small-gallery-refusals`
- Base: `main` at `b7c03cd`
- Status: approved

## Goal

`planAutoLayout` in default mode refuses 9 of the 628 Gallery drawings with
at most 10 parts (2026-11-12 runs on ef9f890, on PR46 66a6626 and on b7c03cd: same
nine). None is too large or too complex: two are five-transistor OTAs. They
fall into four independent defects in cleanup, label handling and routing.
When this task is done, all nine plan without an error diagnostic. The other
619 keep their results. Each defect gets a synthetic regression test that does
not depend on third-party data.

## Context

Data and evaluation (local, git-ignored, never committed):

- `tmp/le10-input/` holds symlinks to the 628 projects in
  `/Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/by-size/{0-4,5-10}/`.
  These are third-party Gallery drawings (permission obtained for local use).
  Do not copy them, or excerpts of them, into the repository.
- `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12` takes about
  3 min and writes `tmp/auto-layout-eval/report.json` (field `cases[]`, with
  `status`, `diagnostics`, `result.{crossings,bends,wireLength,floatingPins,missingConnections,labelOverlaps}`).
  Move the output aside before the next run; the folder is reused.
- Reference report for the base: produced by Opus on b7c03cd and kept
  at `tmp/le10-base/report.json`. Comparison script:
  `python3 -I tmp/le10-analysis/compare.py <base report> <new report> /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json`.
- Step reproductions exist under `tmp/t052/` (`cleanup-repro.mjs`,
  `junction-repro.mjs`). They import from `packages/*/dist`; run `pnpm build` first.

The nine refusals, with the stage that refuses (all `AUTO_LAYOUT_RULE_UNSATISFIED`):

| Class | Gallery id                                                                                   | Message                                                                                       |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A     | `a8fbcba9-e418-4a5e-9b42-ba979f911c5c`, `eb25ea2c-790d-4e55-9453-4f78dcf0ba76`, `vqdg9y347r` | R10 cleanup rejected: "A bound RichText format override must preserve the semantic name text" |
| B     | `dr4e8zhyjg`, `rxdzz3wdry`, `vyqjt4w5gv`                                                     | R10 cleanup rejected: "Transaction introduces conflicting Logical Net names"                  |
| C     | `qzszatannt`                                                                                 | R73 label seating preview rejected: `fallbackPosition.x` expected int                         |
| D     | `s78j9fyzha`, `yje2n6eva2`                                                                   | R10: Route crosses Instance; touching-pin stub has no clear path                              |

Root causes verified so far:

- **A.** `packages/auto-layout/src/auto-layout.ts:770-781` frees every
  annotation from `freedAnnotations` (`labels.ts`) by rewriting its anchor to
  `{kind:"free"}`. Freeing alone is enough to fail (cleanup-repro "free only").
  The failing annotation is a `power-label` with
  `binding {kind:"net-name", netId:"net-power-vdd1"}`, a `formatOverride`
  spelling V<sub>DD</sub>, and an object anchor on junction `junction-vdd1-end`.
  `boundAnnotationName` (`packages/model/src/schema/bound-annotation-text.ts:54-96`)
  finds the net name through a `name-claim` whose owner is a `power-marker`
  with `objectId === annotation.anchor.objectId` (or the annotation id). Once
  the anchor is free, the claim no longer matches, the semantic name becomes
  `""`, and `document.ts:500-512` rejects the override. A later step already
  moves power claims (`transferPowerClaims`, auto-layout.ts:907-909) but runs
  after this preview.
- **B.** Removing routes and freeing annotations is accepted; removing all
  junctions is not. The rejected junctions have `role: "route-anchor"` on a
  named output Net (`n-OUT`, `n-OUTN`, `n-OUTP`) whose net label is anchored on
  a device instance (for example `source-output-Iout` anchored on `M8`).
  Removing the junction merges that Net's name with another Net
  (`edu-body-M8`, `n-g5`, `n-g1`) and replay reports conflicting Logical Net
  names. Why the junction's removal reassigns the name is not yet known.
- **C.** `labels.ts:99-102` sets `fallbackPosition` to a segment midpoint,
  `(from.x + to.x) / 2`, which is a half unit when the sum is odd. The schema
  requires integers. `separate-labels.ts:78` also writes `fallbackPosition`;
  check it the same way.
- **D.** Not yet investigated. `s78j9fyzha` fails the routing audit
  (`routing-audit.ts:224`, Routes crossing Instances M2 and M3).
  `yje2n6eva2` (34 instances, a CML divider with a hierarchical block
  `XMASTER`) fails in `route.ts`: the direct stub from `P12.P` to
  `XMASTER.dn` passes over pin `XMASTER.iref` of another Net. The message
  itself suggests a trunk or Net Labels at both ends.

Rules involved: R10 (validity), R14 (labels only as a failure fallback, only
for already named Nets), R16 (one transaction), R38 (contacts), R73 (label
seating), in `docs/specs/auto-layout.md`. The last rule number is R145; new
rules, if any, take R146 and up.

## Scope

Owned paths:

- `packages/auto-layout/src/**`
- `packages/auto-layout/test/**`
- `docs/specs/auto-layout.md`
- `packages/edit-engine/src/**` and `packages/model/src/**` only if a root
  cause is there (report why; prefer fixing in auto-layout)
- `tasks/T052-small-gallery-refusals/report.md`

Out of scope:

- Any third-party drawing or excerpt in the repository.
- Layout quality changes unrelated to the four defects (crossings, bends,
  compaction, search budgets, LLM partition mode).
- `scripts/auto-layout-eval.mjs` except to fix a bug that stops the evaluation.

## Steps

1. Build and run the evaluation on the base; confirm the same nine refusals.
2. **A.** Free the annotation without losing its semantic name. Preferred:
   when an object-anchored annotation's net name comes from a power-marker
   claim owned by its anchor object, move the claim to the annotation (owner
   `objectId` = annotation id, which `boundAnnotationName` already accepts),
   or keep the format override valid some other way, in the same cleanup
   edits. Do not drop the user's format override. Add a synthetic test: a
   drawn power rail whose label is anchored on a junction and has a format
   override; `planAutoLayout` completes and the label still presents V<sub>DD</sub>.
3. **B. Investigate:** reproduce with `tmp/t052/junction-repro.mjs` and report
   which edit-engine step reassigns the name when a route-anchor junction is
   removed, and why the device-anchored label ends up on another Net. Then fix
   it in auto-layout (for example free or re-anchor such labels with the
   others, or keep the Net's claim on its own Net). Add a synthetic test with
   a named output Net whose label is anchored on a device and whose route ends
   at a route-anchor junction.
4. **C.** Round every `fallbackPosition` (and any other integer schema field)
   that auto-layout computes from midpoints or offsets to the grid, as the
   schema requires. Test with a segment whose endpoint sum is odd.
5. **D. Investigate** both drawings and report the cause of each. Fix what is
   a defect (for example a stub planned over another Net's pin, or an
   unchecked route). If a drawing can only complete through a fallback that
   R14 does not allow, say so in the report with the evidence and leave it
   refused rather than widening R14.
6. Update `docs/specs/auto-layout.md` where behavior changes.
7. Run the evaluation again and compare with the base report.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm build                                   # expected: succeeds
pnpm --filter @icm/auto-layout exec vitest run   # expected: all pass, including the new tests
pnpm typecheck                               # expected: succeeds
pnpm lint                                    # expected: succeeds
pnpm format:check                            # expected: succeeds
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12   # expected: 628 cases, see below
python3 -I tmp/le10-analysis/compare.py tmp/le10-base/report.json tmp/auto-layout-eval/report.json /Users/huzhifeng/workspace/auto-canvas-cases/library/gallery/catalog.json
```

Behavioral checks:

- At least 8 of the 9 refusals complete without an error diagnostic, with
  `equivalent: true`, no unsafe problems, and no new floating pins or missing
  connections. Any one left refused has a root cause and the reason it cannot
  be fixed in scope in the report.
- On the 619 drawings that already completed: no status change, and for each
  drawing crossings, bends, floating pins and missing connections are not
  higher than on the base. List any drawing whose metrics change at all.
- Each fixed class has a synthetic regression test that fails on the base.

## Notes for the implementer

- Decisions: fix root causes, not the nine drawings. No case-specific code
  (ids, names, coordinates). Never widen R14's label fallback.
- Keep each fix as one small, separate change; the classes are independent.
- The report lists, per class: root cause, fix, test name, and the before and
  after status of each listed drawing.
