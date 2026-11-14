# T082 — Keep drafting groups owned: carry terminal-free wires and reseat stranded groups

- Branch: `task/T082-drafting-owned`
- Base: `main` at `8cdec30`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main `8cdec30` the frozen composite is dev 1.271×,
val 1.244× human. `unownedDrafting` (drafting groups with no part, junction or
wire within 1.5 × their larger ink side) is dev 29 vs human 15 (2.46 composite
units), val 11 vs 7 (0.70). It never improves in the human direction and is
not a crossing trade-off. The Opus analysis (2026-11-14, `tmp/gap3/`,
`unowned.py`, `draftsplit.py`) found:

- `qj62dz4qvm` (dev, 3 → 12): a block diagram, 5 instances, about 16 wires
  that touch no terminal. R16 removes every route and only terminal Nets are
  rerouted, so the result has no wires at all; 9 labels / arrows owned by
  those wires lose their owner, and 3 large ink groups stay 400–970 units
  from any part.
- Owner was a terminal-free wire that routing removed: dev `6n2s63bxv4`,
  `jkbdeaz3fr`, `qgc6fm8kpe`; val `qk9r4bb46n`.
- Owned group never moved (seat failed, cause not verified): dev
  `dr4e8zhyjg`, `nfa75tcbqf`; val `mbpnznx3p5`.
- Followed its owner but landed just outside a small ownership radius: val
  `m9knq7tpsz`, `vkafsqxh8n`.

Expected gain (estimate): dev 0.6–2.0, val 0.5–0.7 composite units.

## Context

- R16 removes all routes and junctions: `auto-layout.ts:1762`. Only Nets with
  terminals are routed afterwards, so a wire on a terminal-free Net (a
  drafting-like conductor) disappears.
- R150 (`docs/specs/auto-layout.md:1393`) drafting follows layout: groups in
  `drafting-groups.ts` (`draftingGroups` `:63`, owner within 1.5 × larger ink
  side; terminal-less owner fallback `:245` uses the nearest source
  instance's displacement), seating in `follow-drafting-groups.ts`
  (`followDraftingGroups` `:132`, `seatDraftingGroups` `:169`, offset grid
  ±4 steps around the translated position), labels in
  `follow-drafting-labels.ts`, search in `drafting-search.ts`. Acceptance per
  batch: terminal partition preserved, no new drafting overlap, no R146 guard
  regression; crossings/bends/wire may increase only with a strictly lower
  frozen composite; an owned batch may raise the calibrated score only when
  it reduces unowned groups.
- Metric: `readability-metrics.ts:395` counts `draftingGroups(final)` with no
  owner. Frozen; do not change it.
- Tests: `packages/auto-layout/test/follow-drafting-groups.test.ts`,
  `follow-drafting-labels.test.ts`.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  baseline `tmp/main-8cdec30-report.json`; `python3 tmp/excess.py <report>`;
  `python3 tmp/per-case-excess.py <report> unownedDrafting dev 20`.
  Dependencies are installed and `pnpm build` passed. Main's build is at
  `/tmp/t081-baseline/dist` (`index.js`, `timing.js`). Large documents and
  held-out timing: `tmp/t080-harness/` (`large-input/`, `verify-large.mjs`,
  `timing.mjs` — fix the worktree path `W`, output paths and baseline import;
  T080 needed a local module-resolution link for `@icm/*`).

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts`,
`readability-rail-crossings.ts` and `readability-weights.ts`;
`packages/auto-layout/test/**`; `tasks/T082-drafting-owned/report.md`.
Proposed spec text (R150 addition or new R158) goes in the report.

## Steps

1. **Investigate (gate).** For each drawing above, record each unowned group
   in the result: its source owner, why it lost it (wire removed, seat
   failed and why, radius) and whether a legal seat next to an owner exists.
   Prototype on `qj62dz4qvm`, `6n2s63bxv4` and `dr4e8zhyjg` first. If fewer
   than 6 dev groups can become owned without raising the frozen composite,
   stop and report before step 2.
2. **Carry terminal-free wires.** A route whose Net has no terminal (no
   device pin, port or marker; a drafting-like conductor) is not deleted for
   good: after placement, re-create it rigidly translated by the
   displacement R150 already uses for terminal-less owners (nearest visible
   source instance), with its junctions, when it collides with no symbol,
   pin, other conductor or drafting ink; otherwise drop it as today. It must
   not join any terminal Net (terminal partition unchanged). Groups it owned
   keep that owner.
3. **Reseat stranded owned groups.** When an owned group's seat fails or
   lands outside its owner's radius, widen the search around the owner
   (more offsets, both sides of the owner) and accept only a seat that keeps
   the group owned, under R150's batch acceptance.
4. Tests: a block diagram with terminal-free wires keeps them and their
   labels owned; a terminal-free wire that would collide is dropped; terminal
   Nets and equivalence unchanged; a stranded label is reseated beside its
   owner; determinism. Synthetic circuits only — never commit a Gallery
   drawing.
5. Evaluate all 628; review page human | main | T082 for the drawings above,
   the ten whose composite falls most, and the 25 samples.

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

Against `tmp/main-8cdec30-report.json`:

- Readability composite lower on dev and val; unowned drafting lower on dev
  and val; no drawing's composite higher than main.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical (or, if one has
  terminal-free wires, explain the change); held-out medians within +20%
  (timing run alone).

## Notes for the implementer

- Recognise terminal-free wires from connectivity only; no ids, names, text
  or coordinates.
- Tune on dev; report val.
- Do not change the frozen readability metrics or weights.
