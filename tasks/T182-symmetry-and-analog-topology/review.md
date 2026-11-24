# T182 review

## Round 1

Verdict: **changes required** — Round 1's infrastructure (mirror fallback, unsplit topology plumbing, high-side p-channel tail) is clean and all unit/slow tests pass, and your spot-check pinpointed the exact three reasons the named symmetry targets stayed at baseline (`px5yta2b98` reached final selection with `2` vs `6` crossings, `0/4` vs `4/4` symmetry, `23,048` vs `27,894` score, `0` vs `1` guards, and was rejected; `vcgtzej894`/`6qg2h7weje`/`sbfkkj67cm` never tried `"template"`; `bv9zwmd835` dropped crossings `1 → 0` and failed admission). Fix all three in Round 2.

### Findings

1. **must-fix — Include `"template"` when building the `"unsplitSymmetry"` finalist (`packages/auto-layout/src/auto-layout.ts:1776-1783`).**
   When `unsplit` is true and `selected.strategy` is `"stages"` (as on `vcgtzej894`, `6qg2h7weje`, `sbfkkj67cm`, `x5jaqe94t7`), the current code only tries `selected.strategy` and `"layered"`, skipping `"template"` (which is the strategy that gave `px5yta2b98` its `6 → 2` crossing drop and `4/4 → 0/4` symmetry fix). Always try `"template"` in addition to `selected.strategy` and `"layered"` (deduplicating identical strategy calls) and pick the best `compareRuns` candidate.

2. **must-fix — Broaden admission for crossing-reducing or symmetry-reducing `"mirrorSymmetry"` and `"unsplitSymmetry"` candidates (`packages/auto-layout/src/auto-layout.ts:1793-1802`).**
   Currently `mirrorSymmetry` skips the crossing-improvement admission branch (`unsplit && ...`), causing `bv9zwmd835` (`crossings: 1 → 0`) to be rejected before finishing. Admit EITHER `"unsplitSymmetry"` or `"mirrorSymmetry"` whenever `distinctPlacements(incumbent, final)` AND any of:
   - `shouldFinishRunner(selected.run, candidate.run, resolver)` holds;
   - `auditRouting(final, resolver).crossings < auditRouting(incumbent, resolver).crossings`; or
   - `auditRouting(final, resolver).crossings <= auditRouting(incumbent, resolver).crossings && netlistSymmetry(final, resolver).violations < netlistSymmetry(incumbent, resolver).violations && routedScore(candidate.run, resolver) <= routedScore(selected.run, resolver) * 2.2`.

3. **must-fix — Symmetry-aware finished selection for explicit symmetry finalists (`packages/auto-layout/src/finished-selection.ts`, `packages/auto-layout/src/auto-layout.ts:750`).**
   Because `readabilityWeights` assigns weight `0` to symmetry metrics and weight `0.149` to `area` (larger than `crossings`'s `0.138`) plus hard zero-to-nonzero vetoes on minor metrics (`labelOverlaps`, `avoidableJogs`, `blockedJoins`, `portOrder`), `selectFinishedLayout` rejected `px5yta2b98` (`score 27,894 → 23,048`, `crossings 6 → 2`, `sym 4/4 → 0/4`, `guards 1 → 0`), `4qk6efgw4z` (`score 17,047 → 15,863`, `crossings 2 → 1`, `sym 3/5 → 1/5`), and `5nrdf75rpd` (`score 1,722 → 1,339`, `crossings 0 → 0`, `sym 4/4 → 0/4`).
   - Add an optional 6th parameter `kind?: FinalistKind` to `selectFinishedLayout(source, resolver, base, candidate, partition, kind)` and pass `kind` from `selectFinalLayout` (`auto-layout.ts`).
   - When `kind` is omitted or not `"unsplitSymmetry" | "mirrorSymmetry"`, keep existing behavior **100% unchanged**.
   - When `kind === "unsplitSymmetry" || kind === "mirrorSymmetry"`:
     - Still enforce: no candidate errors, valid previews, `compareRuns(candidate, base, resolver) < 0` (strictly lower `routedScore`, which already includes `readabilityTerm`), and ALL hard guards non-increasing (`routedGuards` + `VISUAL_LABEL_OWNER_DISTANCE`).
     - When `netlistSymmetry(after.document, resolver).violations < netlistSymmetry(before.document, resolver).violations` AND `auditRouting(after.document, resolver).crossings <= auditRouting(before.document, resolver).crossings`:
       - Do NOT reject solely on `readabilityTerm(after) > readabilityTerm(before)` or minor-metric zero-baseline vetoes;
       - STILL enforce zero-to-nonzero vetoes on severe safety/flow metrics: `crossings`, `railCrossings`, `sourcePolarity`, `wireThroughSymbols`, `unownedDrafting`.
     - Otherwise, apply the exact existing `readabilityTerm` and full zero-baseline checks.
   - Add a unit test verifying that a symmetry finalist with strictly lower `routedScore`, fewer symmetry violations, non-increasing crossings/guards, and zero severe regressions is accepted even when `area` or a minor metric increases, while a candidate with a `0 → 1` `railCrossings` or guard regression is still rejected.
   - Briefly update `docs/specs/auto-layout.md` to document this guarded symmetry-finalist selection rule.

### Notes for round 2

- Re-run all acceptance commands in `plan.md`, including sequential `--jobs 6` corpus runs into `tmp/t182/netlist` and `tmp/t182/drawing`, and report updated corpus deltas and named target case results (`px5yta2b98`, `vcgtzej894`, `6qg2h7weje`, `sbfkkj67cm`, `x5jaqe94t7`, `4qk6efgw4z`, `5nrdf75rpd`, `bv9zwmd835`) in `tasks/T182-symmetry-and-analog-topology/report.md`.
