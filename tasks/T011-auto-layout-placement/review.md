# T011 review

## Round 1 — changes-requested

Reviewed: `git status` / `git diff 09d78ae` on `task/T011-auto-layout-placement`
after round 1, the report, the full timeline and every new source file; Opus
reran a spike for the RLC finding (below). The full acceptance rerun is
deferred to round 2, because the corpus cannot pass until the plan changes
below are implemented.

Both blockers in the report are plan defects, not implementation defects. The
round handled them correctly: it stopped, kept the failing assertions and
reported the evidence. **plan.md was edited for round 2**: R1, R2, R10, step 7
item 4 and the `executeTransaction` context. Read those sections again.

| #   | Severity   | Where                                                                                                                                      | Finding                                                                                                                                                | Expected fix                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix   | `packages/auto-layout/src/place.ts` (`placeDocument`, R10 corner check, both the early `dx % grid` refusal and the final `finalBox` check) | The approved R10 corner rule cannot be met: visible envelopes have fractional edges and origins must stay on the grid.                                 | Implement the revised R10: translate by `(snap(oldBox.x - newBox.x), snap(oldBox.y - newBox.y))`; drop both exact-corner refusals. Corpus test: `\|resultBox.x - oldBox.x\| <= grid / 2`, same for `y` (replace `corpus.test.ts:97-102`).                                                                                                                  |
| 2   | must-fix   | `packages/auto-layout/src/auto-layout.ts` (edit emission)                                                                                  | RLC: the Edit Engine refuses `remove_route_geometry` for `wire-28` / `wire-32` because `net-label-wire-28` / `net-label-wire-32` have `route` anchors. | Implement the revised R2 step (a): before the Route removals, one `upsert_schematic_annotation` per `route`-anchored annotation, identical except `anchor: { kind: "free", position: anchor.fallbackPosition }`. Opus spike: on RLC this commits, leaves both labels free, and `compareElectricalGraphs` is `equal`. Add corpus item 4's anchor assertion. |
| 3   | must-fix   | `packages/auto-layout/test/corpus.test.ts:205-222` (independent route-removal check)                                                       | It commits a hand-built list of Route removals instead of the planner's own edits, so after fix 2 it would test something the planner no longer emits. | Commit the planner's own R2 (a)+(b) edits (re-anchors followed by Route removals) in this check, and keep its equivalence assertion.                                                                                                                                                                                                                       |
| 4   | must-fix   | `place.ts` (fixed-instance handling) and `docs/specs/auto-layout.md` R1                                                                    | The code restores a fixed instance's old placement after placing everything else, so a fixed instance is not an obstacle as the old R1 said.           | Match the revised R1: the fixed instance keeps its exact placement; a collision returns no edits plus an R10 diagnostic; obstacle-aware placement is T013. Update the spec's R1 wording. Add one unit test: a fixed instance that collides yields an R10 diagnostic and no edits; one that does not collide keeps its placement exactly.                   |
| 5   | should-fix | `scripts/auto-layout-review.mjs`                                                                                                           | Once layouts commit, the review page is the visual evidence.                                                                                           | For each case, list the recognized groups with their members and any diagnostic, and render original and result at the same scale. Keep the nonzero exit for a blocked case.                                                                                                                                                                               |
| 6   | note       | `packages/auto-layout/src/place.ts` (`rankRows`)                                                                                           | The PMOS/NMOS drain adjustment raises only the NMOS row, not the devices below it. With templates on the corpus this is likely harmless.               | No change required unless a corpus assertion fails. If one does, report it rather than special-casing.                                                                                                                                                                                                                                                     |

Accepted as is: the `knip.config.js` package entry (`includeEntryExports:
false`, with T013 as removal point), the 22-line lockfile importer, the
`auto-layout:review` script entry and the spec index row.

Acceptance rerun: deferred to round 2 (see above).

## Round 2 — changes-requested

Reviewed: `git status`, the report, the timeline and the source of round 2.
Opus reran `pnpm vitest run packages/auto-layout` (4 failed, 26 passed, the
four failures matching the report) and inspected six of the nine rendered
pairs (`five-t-ota`, `fig-17-19b`, `common-source`, `two-stage-symbolic`,
`two-inverters`, `rlc`). Findings 1-4 of round 1 are fixed.

The round stopped correctly at the Route assertion. That assertion was too
strict in the plan: the Edit Engine's direct-contact reconciliation is
documented behavior that preserves connections. **plan.md was edited again,
with the user's agreement**: R6a (new), R8, R9, R10, step 7 items 4, 8, 8a and
8b. Read them again. This is round 3, the last allowed round.

| #   | Severity | Where                                                                                                                           | Finding                                                                                               | Expected fix                                                                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | must-fix | `packages/auto-layout/test/corpus.test.ts` (`expect(after.routes).toEqual([])`), `scripts/auto-layout-review.mjs` (Route check) | The assertion rejects Routes that the Edit Engine adds to preserve separated contacts.                | Replace with step 7 item 4 as revised. The review script reports those Routes without failing. An input Route id surviving, or a new Route joining endpoints on different Base Nets, must still fail. |
| 2   | must-fix | `place.ts` `placeMarkers`                                                                                                       | Right-side Cell Pins use rotation 180, so the label is upside down in `five-t-ota`.                   | R8: `rotation: 0, mirror: "horizontal"`.                                                                                                                                                              |
| 3   | must-fix | `place.ts` `placeMarkers`                                                                                                       | Cell Pins on one side overlap (`Vin1`/`Vin2`, `bot`/`nbit`, both `Vout`, `Vin`).                      | R8: ordered, at least 40 units apart.                                                                                                                                                                 |
| 4   | must-fix | `place.ts` `placeMarkers`                                                                                                       | All grounds on a net go to the lowest pin (`rlc`: V1's ground sits under C1).                         | R6a.                                                                                                                                                                                                  |
| 5   | must-fix | `place.ts` `placeFallback`                                                                                                      | Series parts stack vertically in `rlc`, and the amplifiers stack in `two-stage-symbolic`, against R9. | R9 as revised, with the separate roles as separate functions. Keep `place.ts` readable; split a new file if it grows past a single concern.                                                           |
| 6   | must-fix | `place.ts` ranked placement                                                                                                     | `common-source`: RD is not above XM1.D.                                                               | R8's last sentence.                                                                                                                                                                                   |
| 7   | note     | spec                                                                                                                            | `docs/specs/auto-layout.md` must state R6a, R8, R9 and R10 as revised.                                | Update the spec. Keep labels (`in`, `out`, VDD) floating until T012 stated as a known limit.                                                                                                          |

Keep the rules general. Never key behavior to a corpus case, a Reference or an
instance id.

Acceptance rerun: package tests only, as above; the full rerun follows round 3.

## Round 3 — accepted

Reviewed: `git status`, the report, the timeline, every source and test file
of round 3, and all nine rendered pairs in `tmp/t011-round3/` (Opus viewed
`five-t-ota`, `rlc`, `two-stage-symbolic`, `common-source`, `fig-17-19b`,
`two-inverters`). Round 2 findings 1-7 are fixed. No source file keys behavior
to a corpus case, Reference or instance id; the corpus ids appear only in the
corpus test's case-specific assertions. The fixed-instance collision test was
moved to a position that collides under the revised R9; it still asserts no
edits plus an R10 diagnostic, so it was not weakened.

Acceptance rerun by Opus on lane 1 (`tmp/t011-opus/`):

```text
pnpm install --frozen-lockfile --offline        → 0 (Already up to date)
pnpm format:check                               → 0
pnpm docs:check                                 → 0
pnpm typecheck                                  → 0
pnpm lint                                       → 0
pnpm vitest run packages/auto-layout            → 0 (4 files, 30 tests)
pnpm test:local                                 → 0 (740 files passed, 2 skipped; 7311 tests passed, 116 skipped)
pnpm deadcode | grep auto-layout                → no output (deadcode exits 1, as on main)
pnpm build                                      → 0
node scripts/auto-layout-review.mjs             → 0 (9 SVGs + index.html)
git diff --stat origin/main -- pnpm-lock.yaml   → 22 lines, new importer only
git status --short packages/spice packages/edit-engine packages/model packages/project-protocol apps fixtures → empty
```

Known limits, carried to T012/T013, not defects of this task:

- No routing yet: placed parts are joined by unrouted membership, except the
  short Routes the Edit Engine adds where placement separates a direct pin
  contact (`common-source` has one bending toward an old Junction).
- Re-anchored and free labels (`in`, `out`, `VDD`) stay at their old page
  positions and can overlap new parts (`rlc`). T012 re-anchors them.
- Annotation artwork is outside the overlap check: in `two-inverters` the
  `nbit` Cell Pin label touches the `XSN` instance label.
- Both differential inputs of `five-t-ota` sit on the left edge; Razavi puts
  the second input on the right. A side rule for differential inputs is a
  candidate refinement for T012's spec update.
- Fixed instances are not yet placed around (T013).
