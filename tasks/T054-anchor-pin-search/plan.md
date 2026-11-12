# T054 — Anchor and bound optimized pin-search proposals

- Branch: `task/T054-anchor-pin-search`
- Base: `main` at `5c366ac` (reproductions and baseline measured on `b7c03cd`; T052 only shifted the `auto-layout.ts` lines cited below)
- Status: approved (user confirmed anchor + 1.5× bound, 2026-11-12)

## Goal

In `quality: "optimized"`, every pin-search proposal must keep the drawing
where the input put it (R10) and stay within the quick layout's span bound
(R67) before it is routed. Today the proposals bypass both, so an optimized
plan can move a placed circuit by hundreds of units or turn a one-row chain
into a block five times taller than the quick result. Codex review raised this
twice on PR #46 (P2, deferred to this task). Default quality must not change.

## Context

- `packages/auto-layout/src/pin-portfolio.ts:41-108` `optimizePins` runs only in
  optimized quality, for at most 40 instances with no fixed instance, constraint,
  coupling or layout group (`packages/auto-layout/src/auto-layout.ts:579-598`).
  Its loop at `pin-portfolio.ts:85-89` sends each `pinSearch` pose map straight
  to `replan`, which is `planLayoutOnce(..., exact = placements, ...)`
  (`auto-layout.ts:551-568`).
- The `exact` path (`auto-layout.ts:713-728`) only runs a geometry check. It
  skips `placeDocument`, so neither the R10 whole-layout translation
  (`packages/auto-layout/src/place.ts:471-499`, `oldBox` = input envelope or
  `searchLimit.anchor`) nor the R67 checks run.
- `pinSearch` (`packages/auto-layout/src/pin-search.ts:44`) searches in its own
  integer grid coordinates; its poses have no relation to the input position.
- R67 helpers already exist in `packages/auto-layout/src/search-bounds.ts`:
  `searchBounds(quick, resolver)` (anchor = quick envelope, max = 1.5× quick
  width/height), `spanProblem(document, resolver, placements, bounds)` and
  `anchorPlacements(document, resolver, mutablePlacements, fixed, bounds)`,
  which snaps the translation to the Document grid. Annealing uses them before
  routing at `packages/auto-layout/src/search-moves.ts:305-309`; repair uses
  `spanProblem` at `auto-layout.ts:177`.
- The quick reference is available in `planAutoLayoutMeasured` as
  `quickRun.final` (`auto-layout.ts:435-438`, in scope at the `optimizePins`
  call); `repairBounds` is built from it at `auto-layout.ts:474` but only when
  the search beat quick, so do not rely on `repairBounds`.
- `searchPinContacts` (`packages/auto-layout/src/contact-search.ts:34`) shares
  the same `replan`. It is out of scope: it moves only to establish R38 contacts
  from the finished layout and was not flagged.
- Spec: R10 (`docs/specs/auto-layout.md:232-237`) requires the resulting corner
  within half a grid step of the input corner. R67
  (`docs/specs/auto-layout.md:538-550`) bounds search proposals at 1.5× the
  quick box. Pin search itself is not yet described in the spec.
- Existing tests: `packages/auto-layout/test/pin-search.test.ts` (unplaced
  chains, zero budget). They cover no placed input.

Reproductions verified on `b7c03cd` (grid 10; four `resistor` instances
`r1..r4` placed at `(1000 + 200j, 1000)`, rotation 0, no mirror; chain nets
`r1.2–r2.1`, `r2.2–r3.1`, `r3.2–r4.1`; ring adds `r4.2–r1.1`). Envelope =
`enclosingBox` of the previewed result:

| Case  | Input corner      | Default box                         | Optimized box                              |
| ----- | ----------------- | ----------------------------------- | ------------------------------------------ |
| chain | (994.01, 979)     | (999, 983.63) 202 × 12.36           | (1133.63, 879) 12.74 × 162                 |
| ring  | (994.01, 979)     | (999, 983.63) 202 × 12.36           | (983.63, 933.63) 62.74 × 62.36             |

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/pin-portfolio.ts`
- `packages/auto-layout/src/auto-layout.ts` (only the `optimizePins` call site)
- `packages/auto-layout/src/search-bounds.ts` (only if a small helper is needed)
- `packages/auto-layout/test/pin-search.test.ts`
- `docs/specs/auto-layout.md` (one short paragraph, Step 4)
- `tasks/T054-anchor-pin-search/report.md`

Out of scope (do not change):

- Default quality behavior and every other search path (`searchPinContacts`,
  annealing, repair, compaction, reroute portfolio).
- `pinSearch`'s own cost model and move set.
- Existing test expectations and timeouts.

## Steps

1. In `planAutoLayoutMeasured` (`auto-layout.ts`), build the reference for
   `optimizePins`: span limits from `searchBounds(quickRun.final, resolver)`
   and anchor = the R10 `oldBox` of the input, i.e.
   `enclosingBox(document, resolver)` (same as `place.ts:471` without a search
   limit). Anchoring at the input envelope, not the quick box, keeps the
   result within half a grid of the input instead of compounding two
   half-grid snaps. If `quickRun.final` is missing, skip `optimizePins` and
   return `contactResult`. Pass the bounds into `optimizePins`.
2. In `optimizePins`, for each distinct proposal and before `replan`:
   clone the pose map, call `anchorPlacements(source, resolver, copy,
   new Set(), bounds)`, then `spanProblem(source, resolver, copy, bounds)`.
   Skip the proposal (no routing) on any problem. Compute the `seen` key from
   the anchored poses so translated duplicates are not routed twice.
   Use the instances the box is measured on consistently: check whether the
   poses cover markers/power symbols as well as devices, and measure both the
   anchor and the span on the same instance set the quick reference uses.
   Investigate: report which instance set `pinSearch` returns poses for and
   how you matched it.
3. After `replan`, reject a trial whose routed `final` envelope corner is more
   than half a grid from the anchor or whose span exceeds the bounds (R67's
   "check both raw proposals and the finishing result"). With the `exact` path
   this should be a no-op; keep it as a guard.
4. Spec: add one paragraph to `docs/specs/auto-layout.md` next to the R95/R97
   finishing text (around line 1126) describing optimized pin search briefly
   and stating that its proposals are translated to the input envelope (R10)
   and rejected before routing when they exceed the R67 span bound.
5. Tests in `packages/auto-layout/test/pin-search.test.ts`, optimized quality,
   using the two reproductions above:
   - chain: previewed envelope corner within `grid / 2` of the input corner on
     both axes; no error diagnostics; preview ok.
   - ring: same anchor check, and width/height ≤ 1.5 × the default-quality
     result's width/height.
   - A default-quality assertion for the chain that the box equals today's
     `(999, 983.63) 202 × 12.36` (rounded to 2 decimals), to pin default
     behavior.
6. Report in `tasks/T054-anchor-pin-search/report.md`: what changed, the
   Investigate finding, the optimized boxes for both cases after the fix, and
   test counts/times.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm -r build                                                       # expected: exit 0 (scripts used by two tests import dist/)
pnpm exec vitest run packages/auto-layout/test/pin-search.test.ts   # expected: all pass, including the new tests
pnpm exec vitest run packages/auto-layout/test                      # expected: all 36+ files pass
pnpm exec prettier --check packages/auto-layout docs/specs/auto-layout.md
git diff --check
```

Baseline on `b7c03cd` (verified by Opus): after `pnpm -r build`, all 36
files of `pnpm exec vitest run packages/auto-layout/test` pass (~28 s wall).
Without the build, `fingerprint-mine.test.ts` and
`partition-provider.test.ts` fail on missing `dist/` modules; that is not a
regression.

Behavioral checks:

- Both reproductions in optimized quality: corner within 5 units of
  (994.01, 979); ring height ≤ 18.54, width ≤ 303.
- Default quality output for both reproductions is byte-identical to `main`
  (compare `planAutoLayout(d, resolver)` edits before/after).

## Notes for the implementer

- Decision: anchor to the input envelope and bound by 1.5× the quick box. A
  proposal outside the bound is dropped, not shrunk; for these two circuits
  that means optimized quality may simply return the base result.
- Do not route a proposal that fails anchoring or span; checking after routing
  only is not enough.
- Fixed instances never reach `optimizePins`; pass an empty fixed set.
- Do not key on circuit names, coordinates or instance counts.
