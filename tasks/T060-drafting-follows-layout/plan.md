# T060 — Drafting follows the layout instead of pushing it down

- Branch: `task/T060-drafting-follows-layout` (stacked on `task/T059-compactness`, PR #54)
- Base: `task/T059-compactness` at `408d0a7`
- Status: approved

## Goal

Next step toward the user's goal (2026-11-12): default-mode auto-layout within
20% of the human Gallery drawings by general methods. After T059, ratios to
human on the 627 completed ≤10-part drawings: crossings 2.01, bends 1.18,
wire 1.46, median area 1.55 (`tmp/le10-t059r2/report.json`).

T059's investigation (`tasks/T059-compactness/report.md`, "Vertical margin
attribution") found that **85.6% of the excess vertical margin on dev comes
from drafting**: human-authored notes, arrows, rectangles, construction lines
(1,095 dev objects in 213 drawings, 1,058 of them free-anchored). They stay at
their input coordinates while the devices move, and R10 then pushes the whole
layout down until it clears them, leaving drafting stranded far from what it
annotates (visible in the Gallery bandgap `2adejzy693`: reference names and
"A"/"nA" notes float above an empty band). This task makes drafting move with
the parts it annotates.

## Plan change after round 1 (Opus, 2026-11-12)

- **Contract tests.** The three failing assertions encode the R10 rule this
  task replaces. Round 2 may rewrite them as follows; no other assertion may be
  weakened.
  - `routing.test.ts:578`: split into two cases. (a) The rectangle that
    overlaps the resistor in the input is owned by it: it moves with the
    resistor, keeping its input offset, and may keep overlapping its own owner
    as it did in the input (an owner is not a collision for its own drafting;
    fix the implementation accordingly instead of seating it beside the
    owner). (b) A new rectangle far from every part (no owner in reach) keeps
    the old contract: drafting unchanged, layout translated down by the
    minimum grid amount, the same clearance assertions.
  - `corpus.test.ts:201` (`rc-lowpass`, `rc-highpass`): assert drafting
    content, style, dimensions, z-order and lock state unchanged, and each
    moved object within reach of its owner; positions may change.
- **Timing.** The plan's p95 criterion is aggregate (current p95 / base p95 ≤
  1.5); round 1 measured 1.40×, which passes. Keep reporting the per-case
  ratio p95 for information.

## Context

- R10 (`docs/specs/auto-layout.md:242-244`), implemented in `place.ts:500-556`:
  device bounds grown by 60 on every side must clear all drafting bounds;
  otherwise translate the whole layout down by grid steps (never up or
  sideways), refusing with "drafting clearance cannot be achieved…" when fixed
  instances or a search limit stop it.
- `follow-drafting-labels.ts`: only single-line, unlocked, unrotated text
  "local labels" near branch junctions or routes follow the layout
  (`placementDrafting` lines 195-216, `followDraftingLabels` from line 319);
  `AUTO_LAYOUT_DRAFTING_OVERLAP` warnings (35 in the ≤10 set) report an
  instance or route intersecting drafting.
- Edits: `upsert_drafting_object` (`packages/edit-engine/src/edit-schema.ts:418`).
  Geometry: `resolveDraftingObjectGeometry`, `resolveDraftingTextInkBounds`,
  `visibleInstanceBounds` in `@icm/derived`.
- Search score and guards: `routed-search-score.ts` (`calibratedScore` includes
  the T059 span term; `routedGuards`).

Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`; base
`tmp/le10-t059r2/report.json` (rerun on the base commit if you need per-case
diagnostics). Third-party data under `tmp/le10-input/`, never committed. Take
the next free rule number after T059's.

## Scope

Owned: `packages/auto-layout/src/**`, `packages/auto-layout/test/**`,
`docs/specs/auto-layout.md`, `tasks/T060-drafting-follows-layout/report.md`.

Out of scope: other packages; deleting or rewriting drafting content (only
positions/anchors may change); locked drafting objects (they stay, and remain
obstacles as today); optimized and partition modes (fallback follows plain
planning); documents above 40 instances (byte-identical).

## Steps

1. **Ownership.** In the input drawing, group drafting objects that touch or
   nearly touch each other (an arrow with its text, a note with its box).
   Assign each group to the nearest owner by ink distance: a visible instance,
   a route segment, or a junction, within a reach proportional to the group's
   size; groups with no owner in reach are "free-floating" (titles, captions).
   Record the group's offset from its owner.
2. **Follow.** After placement, move each owned group by its owner's
   displacement, keeping its offset; free-floating groups move as one block,
   keeping their relative layout, to the same side of the new layout they had
   relative to the old one. Replace R10's "push the layout down" with this, and
   keep a fallback to the current behavior when a group cannot be seated.
3. **Seat.** Resolve collisions of moved groups with devices, routes, labels
   and other drafting by a small search of nearby offsets around the owner,
   ranked by distance to the original offset; accept the plan only if the
   finished calibrated score is not higher than the base plan's and no guard
   increases.
4. Tests: synthetic drawings with a note beside a device, an arrow-plus-text
   pointing at a wire, a title above the circuit, a locked note, and a seat
   collision; determinism.
5. Spec (R10 drafting clause, new rule); evaluate all 628 drawings; report dev
   and val, with the vertical-margin attribution rerun.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm exec vitest run packages/auto-layout/test    # all pass, existing timeouts unchanged
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/le10-t059r2/report.json`:

- Median area ratio lower on dev **and** val (report the reached value; the
  drafting share of the excess suggests ≤ 1.35 is reachable).
- Crossings, bends and wire not higher on either split.
- Guards: completed ≥ 627; none non-equivalent; floating ≤ 10; missing ≤ 18;
  every `VISUAL_*` total not above the base; `AUTO_LAYOUT_DRAFTING_OVERLAP`
  warnings not above the base count.
- Determinism; the 6 large documents byte-identical; paired timing median ≤ 2×
  and p95 ≤ 1.5× the base.

## Notes for the implementer

- Geometry only: no branches on text content, circuit type, symbol family,
  tag, id, name or coordinates.
- Tune on dev; report val.
- If a tested contract blocks this, report it; do not edit the test.
