# T021 — Auto-layout: readability in the score, and label seating

- Branch: `task/T021-auto-layout-readability`
- Base: `main` at `5a1af66`
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user chose readability as the next improvement (2026-11-08). Today
`routedScore` counts only five things:

- unrouted Nets;
- crossings;
- port direction;
- bends;
- wire length.

So refinement and annealing never see label overlaps, labels on wires, or wires
leaving a pin sideways, and nothing seats labels after placement. This task:

1. seats labels after routing;
2. adds the three readability problems Opus measured to the score;
3. reports them in the evaluation.

A later task (a pairwise preference tool) will calibrate the weights. This task uses
documented starting weights.

## Context

### Measured baseline

Opus ran `diagnoseVisualQuality` and `diagnoseLabelClearance` (`@icm/derived`) on the 32
completed human cases. Both the human drawings and T020's quick result were measured.
Totals:

| Diagnostic                                                            | Human | Auto (T020 quick) |
| --------------------------------------------------------------------- | ----: | ----------------: |
| `VISUAL_LABEL_OVERLAP` (label on label, clustered)                    |     1 |            **45** |
| `VISUAL_LABEL_CLEARANCE` (label on a wire or part ink)                |   116 |           **242** |
| `VISUAL_TERMINAL_DEPARTURE` (route leaves a pin sideways or backward) |     8 |            **68** |
| `VISUAL_LABEL_RUN_ON`                                                 |    10 |                 8 |
| `VISUAL_WIRE_THROUGH_SYMBOL`                                          |   100 |                 0 |

The probe script is git-ignored `tmp/diag/readability.mjs`.

### Code facts

- `routedScore` (`src/refine.ts:53-75`) is the energy for refinement (R22), portfolio
  ranking (R55/R58/R63), annealing (R66) and blocker repair (R72).
- Annotations (`packages/model/src/schema/annotations.ts:14-30`):
  - an instance label anchors to its part as `{kind: "object", objectId, localOffset,
fallbackPosition}`;
  - net labels and power labels can also anchor to a route.

  `upsert_schematic_annotation` edits can move them. The planner already emits these
  edits for freed annotations (`src/auto-layout.ts` `buildPlan`, R2/R15), and
  `reanchorLabels` (`src/labels.ts:21`) re-anchors freed net and power labels.

- `@icm/derived` exports the label tools the editor uses:
  - placement: `INSTANCE_LABEL_SIDES`, `placeUprightInstanceLabel`,
    `instanceLabelSlotAt`, `offsetFromPlacement`, `defaultInstanceLabelPlacement`,
    `portLabelCandidates`;
  - collision checks: `createLabelClearanceContext` (`label-clearance.ts:94`) and
    `diagnoseVisualQuality` (`visual.ts:849`).
- The editor has a full collision-avoiding arranger, `arrangeInstanceLabels`
  (`apps/editor/src/features/instance-display/arrange-instance-labels.ts`, 1430 lines).
  It depends on editor drag geometry, and `apps/` is out of scope. Do not move it; you
  may read it for its candidate order and grouping rules (a part's name and value stay
  together on one side).

### Binding constraints

Unchanged from T020:

- **Human cases.**
  - Keep them in git-ignored `tmp/human-cases/`.
  - Never commit any case, case id or id-keyed derived data.
  - Nothing in CI may depend on them.
- **Splits.** Tune on dev only and report val separately.
- **Frozen code.** R10, R23 and `lostNameClaim` stay as they are, and the router does
  not change.
- **Out-of-scope packages.** `packages/model`, `packages/edit-engine`,
  `packages/derived` and `apps/` do not change.
- **Determinism.** Without `search`, output stays deterministic.

## Scope

Owned paths:

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs` and `scripts/auto-layout-review.mjs`

## Steps

1. **R73 Label seating.** After routing and R15, seat every visible, unlocked annotation
   that is anchored to an instance the plan placed.
   - **Candidates.**
     - Instance labels: each side in `INSTANCE_LABEL_SIDES`, at the existing default
       rows (`placeUprightInstanceLabel`, `instanceLabelSlotAt`). A part's name and
       value move together.
     - Port and Cell Pin text: `portLabelCandidates`.
   - **Conflicts.** For each label, score every candidate with
     `createLabelClearanceContext`. In order of importance, it should not cover:
     1. another label;
     2. a wire;
     3. a part's ink.

     It should also stay near its owner.

   - **Order.** Greedy, most-conflicted label first, with id ties. Run at most two
     passes.
   - **Edits.** Emit `upsert_schematic_annotation` edits that change only the anchor's
     `localOffset` (and `fallbackPosition`) and the alignment the candidate needs.
     Never touch a locked annotation, content, binding or style. Every edit must pass
     the existing whole-list replay.
   - **Where it runs.** Every complete plan, so refinement, annealing and repair score
     the seated labels. Measure the time per plan; if seating adds more than 25%, report
     it and seat only the final plan of each search.

2. **R74 Readability energy.** Extend `routedScore` with three counts on the final
   preview:
   - label overlaps (`VISUAL_LABEL_OVERLAP`);
   - label clearance (`VISUAL_LABEL_CLEARANCE`);
   - terminal departures (`VISUAL_TERMINAL_DEPARTURE`).

   Use the `@icm/derived` diagnostics as they are, keep all weights in one exported
   object (T022 will refit it), and use these starting weights:
   - label overlap 400;
   - label clearance 150;
   - terminal departure 200.

   For scale, a crossing is 1000 and a bend 100.

   If the full `diagnoseVisualQuality` costs more than 25% of a plan, compute only these
   three codes through the narrowest exported functions, and report the time either way.

3. **Investigate: terminal departures.** On dev, classify the 68 departures by cause:
   - a part's orientation;
   - an R71 local port facing;
   - a marker stub;
   - routing around an obstacle;
   - other.

   Fix any cause that one general placement rule removes, for example choosing a local
   port's or attachment's orientation so its pin faces the wire. Report the rest.

4. **Evaluation.** In `scripts/auto-layout-eval.mjs`, record for both the human drawing
   and the result:
   - `labelOverlaps`;
   - `labelClearance`;
   - `terminalDepartures`.

   Add them to the totals and to the console table.

5. **Tests.** Hand-built only:
   - two parts whose default labels overlap get labels on different sides;
   - a label is never moved onto a wire when a free side exists;
   - a locked label is untouched;
   - a part's name and value stay together;
   - the score prefers a layout without a label overlap when wiring is equal;
   - quick mode is deterministic and transactions replay.

6. **Report.**
   - Quick mode, and `--search 120 --seed 1 --jobs 12`, against T020. For quick mode:
     crossings, bends and floating pins, from `tmp/t020-accept/quick.json`. For search:
     495 crossings, 612 bends, 59 floating pins. Add the three readability counts,
     split by dev and val.
   - Planning time against size, and the share spent on seating and on readability
     scoring.
   - The effect of steps 1 and 2 alone.
   - Six rendered pairs, chosen for label problems.

## Acceptance

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout'           # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12                 # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Round targets, quick mode, all 32 completed documents, against T020 quick:

| Measure             | T020 | Required    |
| ------------------- | ---: | ----------- |
| Label overlaps      |   45 | ≤ 10        |
| Label clearance     |  242 | ≤ 150       |
| Terminal departures |   68 | ≤ 40        |
| Crossings           |  647 | ≤ 680 (+5%) |
| Floating pins       |   63 | ≤ 63        |
| Completed           |   32 | ≥ 32        |
| Slowest quick plan  |    — | ≤ 15 s      |

Dev and val must both improve on the three readability counts. Corpus targets and
held-out ceilings must hold. With 2-minute search, crossings must stay at or below
520, and the readability counts must be no worse than in quick mode.

## Notes for the implementer

- One general mechanism per step. Never key behavior to a case, id or symbol id.
- The weights are starting values, not tuned results. Do not tune them on val.
- If a target conflicts with another, report the trade-off; do not drop a rule silently.
