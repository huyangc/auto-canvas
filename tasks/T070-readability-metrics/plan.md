# T070 — Readability evaluation function

- Branch: `task/T070-readability-metrics`
- Base: `main` at `eb72cb1`
- Status: approved

## Goal

The user's goal (2026-11-13): "以电路可读性为目标，先优化评价函数，然后基于电路可读性进行整体电路优化，
在可读性的指标上，在人工图的20%浮动以内". This task is the first half: an
evaluation function that measures how readable a schematic is **as a circuit**
(signal flow, potential order, device conventions, structure, straight wiring,
space), not only wire geometry. The user found that crossings / bends / wire /
area cannot see defects such as a series resistor stood upright in a pointless
narrow band, a bendable jog, or an amplifier placed far from the transistor it
regulates. The output is a set of readability metrics computed identically for
the human Gallery drawing and the auto-layout result, a composite readability
score, and evidence that the function agrees with the human drawings and with
the user's flagged cases. A later task will optimize the planner against it.

## Context

- Today's "readability" is only label diagnostics:
  `packages/auto-layout/src/readability.ts` (`readabilityCounts`: label
  overlaps, label clearance, terminal departures), used by the planner's
  guards. Leave that file and its planner use unchanged.
- Evaluator: `scripts/auto-layout-eval.mjs`. Per-document `metrics(...)`
  (line 267) already merges `readabilityCounts`, `signalPathMetrics`
  (T068: `avoidableJogs`, `blockedJoins`, `signalSeriesVertical/Horizontal`),
  `visualCounts`, `netBreakdown` (crossings by net-kind pair), `branchVerticality`,
  `symmetryCounts` for R88 components and stages (lines 281-282). The
  scoreboard (around line 938) aggregates human / result per split (dev / val
  by sha256(id) % 3). It writes `<id>-human.svg` / `<id>-result.svg`
  (line 701) and `report.json`.
- Reusable inference (import, do not change): `classifyNets`
  (`net-roles.ts`; `byNet` roles input/output, `rails` supply/ground),
  `signalDistances` (`placement-connectivity.ts:33`), `inferSeriesChannels` /
  `signalSeriesParts` (`series-levels.ts`), `conductingPins`
  (`dc-connectivity.ts`), `recognizeStructures` (`recognize.ts`),
  `symmetryTopology` / `stageComponents`, `pinPoints` / `pinExit`
  (`geometry.ts`), `visibleInstanceBounds`, `resolveRouteGeometry`
  (`@icm/derived`).
- Data: `tmp/le10-input` (628 ≤10-part Gallery drawings; raw drawings must not
  be committed), baseline report `tmp/main-eb72cb1-report.json`, human |
  start | main sample renders in `tmp/le10-analysis/`.
- User-flagged drawings (2026-11-13), with the version the user judged:
  - Common-Source Amplifier `f1a0b46a-180f-47cc-9bb2-815554aa7575` at main
    `05050fd`: Rs upright in the top row, narrow pointless band.
  - Source degeneration `bv9zwmd835` at `05050fd`: bendable jog under Rd.
  - gain-boost cascode half-circuit and New Circuit (find their ids by title
    in `tmp/le10-input`): amplifiers not adjacent to the device they regulate;
    pseudo-ports drawn as circles + text not following their wire ends.
    Layouts at `05050fd` can be regenerated with an isolated build of that commit
    (`git worktree add /tmp/t070-05050fd 05050fd`, `pnpm install --offline`,
    `pnpm build`).
- Parallel work: T069 (tighter pitch) owns `packages/auto-layout/src/**` except
  the new files below, and `docs/specs/auto-layout.md`. Do not edit any
  existing file under `packages/auto-layout/src/`.

## Scope

Owned (create or edit):

- `packages/auto-layout/src/readability-metrics.ts` (new; pure functions of a
  placed, routed document)
- `packages/auto-layout/test/readability-metrics.test.ts` (new)
- `scripts/auto-layout-eval.mjs` (call the new module; scoreboard; report)
- `scripts/readability-fit.mjs` (new; weight fitting and validation)
- `docs/testing/readability.md` (new; metric definitions)
- `tasks/T070-readability-metrics/report.md`

Out of scope: every existing file in `packages/auto-layout/src/`, planner
behavior, `@icm/derived`, other packages. No LLM calls.

## Steps

1. **Metric set.** Implement each as a count of violations (lower is better)
   with its denominator (opportunities), deterministic and cheap, the same code
   for human and result documents. Start from this list; drop or merge a metric
   only with evidence in the report:
   - _flow_: signal connections between devices whose signal distance
     increases, but which run right-to-left; input ports/sources not left of
     output ports.
   - _potential order_: DC-conducting device pairs (supply side → ground side,
     from the existing inference) drawn with the ground side above; supply
     markers below / ground markers above their host pin.
   - _device convention_: transistors whose source points away from its rail
     side (NMOS source down, PMOS source up when the inference gives a
     direction); sources with + below −.
   - _structure_: R88 pairs not mirrored and level (reuse `symmetryCounts`);
     recognized structures whose bounding box contains a foreign device;
     amplifier / control devices far from the device whose gate or base their
     output drives (distance in pitches, normalized by drawing size).
   - _wiring_: crossings, crossings involving rails, bends, avoidable jogs,
     blocked joins, detour (routed length of each Net over its minimal
     rectilinear spanning length), wire through symbols.
   - _space_: median area; **narrow bands**: empty horizontal or vertical
     strips between occupied regions that are narrower than one grid pitch
     multiple chosen from the human distribution (define precisely; the
     Common-Source Amplifier at `05050fd` must register one); row-height
     irregularity if needed.
   - _labels_: the existing label diagnostics.
2. **Calibrate against humans.** For every metric report human and result
   totals and the ratio per split, the share of drawings where the human
   drawing has zero violations, and per-metric discrimination: the share of
   drawings where the human drawing scores strictly better than the result,
   strictly worse, or equal.
3. **Composite score.** `scripts/readability-fit.mjs`: fit non-negative weights
   on dev so that the composite prefers the human drawing over the result as
   often as possible (pairwise logistic or rank loss on per-drawing metric
   differences, normalized per metric; deterministic; no new dependency).
   Report dev and val pairwise accuracy of the composite and of each single
   metric, and the fitted weights. Print the composite ratio result / human
   per split in the evaluator scoreboard.
4. **Flagged cases.** Regenerate the four flagged drawings at `05050fd` and
   at main `eb72cb1`; show which metrics register each defect the user named
   (the `05050fd` Common-Source Amplifier and Source degeneration must score
   worse than at `eb72cb1` on the metric that names their defect).
5. **Review page.** `tmp/t070/readability.html`: for the 25 samples of
   `tmp/le10-analysis/main-05050fd-samples.html` and the four flagged
   drawings, human | result renders with every metric's violations listed
   (and highlighted on the SVG where practical).
6. Tests for each metric on small synthetic documents (one violating, one
   clean), determinism, and human/result symmetry of the code path. Document
   every definition in `docs/testing/readability.md`.

## Acceptance

```bash
pnpm build                                   # 0
pnpm typecheck                               # 0
pnpm lint                                    # 0 errors
pnpm format:check                            # 0
pnpm exec vitest run packages/auto-layout/test/readability-metrics.test.ts   # 0
pnpm test:local                              # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12   # 0; scoreboard has the readability metrics and composite
node scripts/readability-fit.mjs tmp/auto-layout-eval/report.json   # 0; prints weights and accuracies
```

Behavioral checks:

- Planner output unchanged: every `planHash` in the new report equals
  `tmp/main-eb72cb1-report.json`.
- Composite pairwise accuracy (human preferred) on val reported; each metric's
  human/result totals and ratio reported per split.
- The two named `05050fd` defects are registered by named metrics.
- Evaluation run time not more than +25% over the baseline run.

## Notes for the implementer

- General definitions only: no circuit-, id-, name- or coordinate-specific
  code. Use netlist roles and the existing inference, not label text.
- Fit on dev; report val. Do not tune definitions on val.
- If a metric needs inference that only exists inside a planner file you
  cannot edit, import it; if it is not exported, report it rather than editing
  the planner file.
