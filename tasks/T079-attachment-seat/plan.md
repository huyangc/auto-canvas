# T079 — Seat attachments next to the pin they serve, as a finished finalist

- Branch: `task/T079-attachment-seat`
- Base: `main` at `a1b022f`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main `a1b022f` the frozen composite is dev 62.66
(1.304× human), val 34.46 (1.277×). Crossings are 66% of the remaining dev
excess (243 vs 154).

The Opus analyses (2026-11-13 / 14; scripts in `tmp/gap2/`) classified a
large share of the excess crossings as **attachments parked away from the pin
they serve**: two-pin parts (shunt or coupling capacitors, load / bias / RC
resistors, BJTs or sources treated as attachments) placed by `placeFallback`
or grouped in one row, or seated on the inner side while their gate / node
faces outward. Measured by net heuristics: 2-pin attachment nets +17
crossings (after T074); "attachment more than 4 pitches from its net" +45
(before T074). Examples: `386ggqhz53`, `kaxfrg2ass`, `6r2q6deeq9`,
`m3ek9hty4p`, `6qg2h7weje`.

This task adds a general "attachments beside their node" placement variant
and offers it as an additional finalist in the finished selection (as T077
does for local-loop amplifiers), so it is used only when the finished layout
is better.

## Context

- R59 attached parts (`docs/specs/auto-layout.md:504`, single-device stage
  with one non-rail Net and a rail pin takes no separate column), R69 parallel
  attachments (`:608`, two-terminal device across a MOS drain/source), R70
  gate-driver attachments, R156 local-loop amplifier (T077).
- Finished selection: `packages/auto-layout/src/finished-selection.ts`
  (`FinalistKind = "runner" | "localLoop"`, `shouldFinishRunner` margin rule,
  `selectFinishedLayout` comparator: completeness first, then routed score +
  30000 × frozen readability). T077 shows how a placement variant becomes an
  extra finalist (`place.ts`, `auto-layout.ts`).
- Placement code: `template-placement.ts`, `place-fallback.ts` (R9 fallback,
  where many attachments land), `stages.ts`, `layered.ts`.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  base `tmp/main-a1b022f-report.json`; `python3 tmp/excess.py <report>`;
  `tmp/gap2/causes.py` classifies excess crossings by net (paths may need
  adapting).

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts` and
`readability-weights.ts`, `packages/auto-layout/test/**`,
`tasks/T079-attachment-seat/report.md`. Write proposed spec text in the
report; Opus applies it.

## Steps

1. **Investigate** on dev: for drawings whose crossings exceed the human
   drawing, which crossings involve a two-pin part (or single-device stage)
   whose non-rail Net(s) all lead to one host device pin or one node; where
   each strategy puts it and why (fallback packing, row grouping, wrong
   side). Count and report with examples.
2. **Variant.** An attachment (two-pin part, or single-device stage) whose
   non-rail connections reach one host node is seated beside that node:
   on the host pin's exit side, oriented along the pin, nearest free grid
   seat with body clearance; a part bridging two nodes of one host goes
   between them (R69-style). Rail pins point to their rail side. Protected
   members (fixed, template, symmetry blocks, layout groups) are not moved; a
   collision keeps the old placement.
3. **Finalist.** Offer the variant of the winning strategy as an extra
   finalist in `finished-selection.ts` (new kind), finished under the same
   margin rule and compared with the same comparator.
4. Tests: a shunt capacitor and a load resistor parked far away are seated at
   their node with fewer crossings; a variant that finishes worse is
   rejected; protection; determinism.
5. Evaluate all 628; review page human | main | T079 for the five example
   drawings, the ten whose composite falls most, and the 25 samples.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-a1b022f-report.json`:

- Readability composite lower by at least 2% on dev and lower on val; no
  drawing's composite higher than main; crossings lower on dev and val.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical; held-out medians within
  +20%.

## Notes for the implementer

- Recognise attachments from connectivity and pin roles only; no ids, names,
  text or coordinates.
- Tune on dev; report val.
