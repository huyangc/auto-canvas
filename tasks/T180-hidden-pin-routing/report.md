# T180 report — round 1

## Summary

Physical routing excludes non-visible terminals while cleanup restores their
original Base Net membership alongside excluded MOS bodies. Authored body leads
still use eligible visible peers or other authored bodies. Signal-trunk
planning skips axes with zero span.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 | done | `freezePinGroups` filters physical targets with `isVisibleEndpoint`. The `includeBulk: true` callers retain full membership. |
| 2 | done | Body-lead targets, R144 cross-coupled drain targets and R155 hosts enforce physical eligibility. The R162 warning still considers electrical peers, and the body-target filter preserves authored MOS bodies during cleanup. |
| 3 | done | R39 keeps the plain tree and tries each median trunk only when its axis spans distinct coordinates. |
| 4 | done | `restoreBulkPins` joins one representative per uncovered cleaned component, including on hidden-only Nets. |
| 5 | done | Added 14 regression cases covering marker and netlist layouts, component restoration, claims, collinear trunks, body leads and local rails. |
| 6 | done | Updated R2(c2), R11, R12, R39 and R43. |
| 7 | done | Both evaluations and the strict gate passed. All 15 targeted netlist cases recovered and every baseline completion was preserved. |

## Review findings addressed

Round 1 had no `review.md`.

## Acceptance results

```text
pnpm build → 0; packages and editor built. Vite reported chunks above 500 kB.
pnpm typecheck → 0; tsc completed after correcting the wire-planner spy's union type.
pnpm lint → 0; 2,200 files, 0 errors, 3,852 warnings.
pnpm format:check → 0; all matched files use Prettier code style.
pnpm docs:check → 0; validated local Markdown links in 75 files.
pnpm vitest run packages/auto-layout apps/editor/src/features/auto-layout → 0; 1,243 passed in 91 files.
pnpm test:slow → 0; 8 passed in 2 files.
pnpm vitest run packages/auto-layout/test/hidden-pin-routing.test.ts → 0; 14 passed.
mkdir -p tmp/t180 → 0.
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/t180/netlist --jobs 3 → 0; 514 of 515 completed.
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --out tmp/t180/drawing --jobs 3 → 0; 612 of 628 completed.
node -e '<strict gate from plan.md>' → 0; no throws, lost completions, missed targets, or invalid completed cases in either corpus.
```

The strict gate verified identical unique case sets, electrical equivalence,
valid plan hashes, zero missing connections, floating pins and unsafe routing
problems, and zero introduced ERC defects for every completed case. Metrics
below compare the cases completed at baseline.

| Corpus | Completions | Changed plan hashes | Crossings | Bends | Wire length |
| --- | --- | ---: | --- | --- | --- |
| Netlist | 499/515 → 514/515 | 19 | 265 → 261 | 1,865 → 1,872 | 441,238 → 442,298 |
| Drawing | 612/628 → 612/628 | 31 | 312 → 312 | 2,047 → 2,047 | 524,703 → 524,683 |

## Investigation results

- One visible device pin and one hidden peer with a removed Route claim form a
  singleton with `needsPowerStub` set. R26 draws a one-segment stub at the
  visible pin and transfers the original claim ID, name, scope and power
  domain to its replacement Route.
- A visible `vdd-port` and a hidden peer leave the marker as the only physical
  target. The marker branch has no eligible host or additional visible pin
  and produces no wire. The terminal partition is preserved and replay succeeds.
- A hidden-only Net has no routable group or anchor. Without a surviving
  owner for its removed Route claim, R10 refuses with zero edits and names
  the claim that would be lost.
- The staged reports match the baseline counts at the task's stated base
  `c5f1678`: netlist 499/515 completed with 15 hidden-pin refusals, and
  drawing 612/628 completed. The worktree HEAD is `c5f1678`.

## Deviations and open questions

The SPICE importer assigns shelf positions, so the R165 regression clears
instance placements before invoking the unplaced entry point. It keeps the
imported symbols, connectivity, and Cell Pin data. The R155 regression uses
a crossed ground rail with a hidden op-amp `VDD` terminal and asserts that
neither wiring planner attempts the hidden endpoint. Temporarily removing
only the R155 visibility guard reproduced the hidden-pin planner error in
the fixture. The guard was restored before acceptance testing.

The one remaining refused netlist case is the baseline dense multi-pin case
outside the plan's scope. Its refusal no longer contains the zero-length
trunk error.
