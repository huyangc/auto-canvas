# T084 — Amplifier-driven gate rows without crossings (gated investigation)

- Branch: `task/T084-amp-gate-row`
- Base: `main` at `8c37219`
- Status: approved

## Goal

Close the last part of the user's readability goal (2026-11-13: readability
metrics within 20% of human drawings). On main `8c37219` the frozen composite
is dev 53.315 vs human 43.900 (**1.2145×**), val 1.164×. Dev must fall by
about **0.64 composite units** (≈ 6 ordinary crossings, or ≈ 4 rail
crossings) without val rising above 1.2×.

The largest remaining dev cause (Opus analysis, `tmp/gap3/ampbus.py`) is an
amplifier block whose output drives a shared gate (or base) line of two or
more transistors: 18 dev drawings, human 1 crossing / 0 rail crossings vs
result 25 / 10, about 4.44 composite units. With crossings (result, human):
`2adejzy693` (3 + 2 rail), `3cr8ap2k4c` (2 + 2), `54a79nkqef` (2 + 1),
`7d93gjqbw8` (2 + 1), `ecyqst76jd` (2 + 1), `x7evbngj49` (2 + 1),
`7aevq3rx4z` (2), `d2bpftaqyq` (2), `gh3gcb5h3a` (2), `ray97q5c2j` (1 + 1),
`rryf923yjz` (1 + 1), `2jhdk32et5`, `6qd8k68e2t`, `vhg3q4gax7`, `wkcb83t9pg`
(1 each); humans have 0. Many are near-duplicates (current-mirror /
LDO-like rows with an error amplifier). Val has one such drawing with no
excess, so the gain is dev-only; the rule must still be general.

Earlier attempts that did **not** work and must not be repeated as-is:
R156 (T077) already seats the amplifier on the receiver row's control-pin
side as an extra finalist; T081 rerouted the crossing signal net (17 of 18
already tried; rerouting the gate line beyond the rail adds ordinary
crossings, 3 → 6). An unverified observation: in many human drawings the gate
line runs straight along the row, with the amplifier placed between the two
branches it senses or on the far side of the row, so the source / drain drops
never cross it.

## Context

- R156 local-loop amplifier: `docs/specs/auto-layout.md:666`,
  `packages/auto-layout/src/local-loop-amplifier.ts`; finished finalists in
  `finished-selection.ts` (`rankedFinalists`: runner, localLoop, attachment)
  and `auto-layout.ts`; T078 margin rule and comparator.
- R148 rail search and signal reroute: `local-reroute.ts`; T081 branch
  `task/T081-rail-signal-reroute` (closed) has a probe of these crossings.
- Rows / stages: R53 stage order (`stages.ts`), R89 symmetry blocks
  (`symmetry.ts`), current-mirror templates.
- Frozen readability: `readability-metrics.ts`, `readability-weights.ts`
  (do not change).
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  baseline `tmp/main-8c37219-report.json`; `python3 tmp/excess.py <report>`;
  `python3 tmp/opus-compare.py tmp/main-8c37219-report.json <report>` (per
  drawing better / worse, guards). Dumps and renders of human vs result for
  the corpus: `tmp/gap3/dumps/`, `tmp/gap3/png/` (made on an older main),
  `tmp/gap3/dump3.mjs`, `render.py`. Main's build: `/tmp/t084-baseline/dist`.
  Large documents / timing: `tmp/t080-harness/` (fix `W`, output paths and
  baseline import; T080 needed a local module-resolution link for `@icm/*`).
  Dependencies are installed and `pnpm build` passed.

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts`,
`readability-rail-crossings.ts`, `readability-weights.ts`;
`packages/auto-layout/test/**`; `tasks/T084-amp-gate-row/report.md`.
Proposed spec text goes in the report.

## Steps

1. **Investigate (gate).** For the 15 drawings above, record for each
   crossing which nets cross (gate line vs source/drain drop, amplifier input
   vs row, rail stub), how the human arranges the amplifier, the gate line and
   the row (amplifier side, branch order, gate line side, which branch the
   amplifier input senses), and why R156's variant did not win (not built,
   built but worse after finishing, by how much). Group them into at most
   three arrangements.
2. **Prototype** the arrangement that covers the most crossings on three
   drawings, as an extra finished finalist (like R156/R157: fixed order after
   the existing finalists, ≤ 40 instances, its own budget, the T078
   comparator decides). **Gate:** continue only if the prototype removes at
   least 4 crossings (or 3 rail crossings) across those three drawings
   without raising any of their composites. Otherwise stop and report what
   blocked it, with numbers.
3. **Implement** it generally: recognition from connectivity, pin roles and
   device class only (amplifier output → gate/base line of ≥ 2 transistors;
   input sensing a conducting terminal of that row), no ids, names, text or
   coordinates. Keep every R89 / R94 block and template rigid; never break a
   symmetry pair; protected members and explicit floorplans stay put.
4. Tests: a synthetic amplifier driving a two-transistor gate row is laid out
   with fewer crossings; a row without an amplifier is unchanged; a worse
   variant is rejected; determinism. Synthetic circuits only — never commit a
   Gallery drawing.
5. Evaluate all 628; review page human | main | T084 for the 15 drawings, the
   ten whose composite falls most and the 25 samples.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0 (needs local-service access for PostgreSQL)
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-8c37219-report.json`:

- Dev composite lower (target ≤ 52.68, i.e. ≤ 1.2× human); val not higher
  than main; no drawing's composite higher than main.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance.
- Determinism; six large documents byte-identical; held-out medians within
  +20% (timing run alone, nothing else running).

## Notes for the implementer

- Tune on dev; report val.
- Do not change the frozen readability metrics or weights.
- If the gate fails, a clear negative report is a valid outcome.
