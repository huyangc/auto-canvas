# T020 — Auto-layout: correct and extend structure recognition, place single-host ports by their host

- Branch: `task/T020-auto-layout-structures`
- Base: `task/T019-auto-layout-annealing` at `ddafcc1` (stacked on PR #22)
- Lane: 1 (`ICM_E2E_PORT=4173`, `AUTO_CANVAS_E2E_API_PORT=4311`,
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`); no browser
  test is expected.
- Status: approved

## Goal

The user reviewed annealed results and asked for three fixes, all approved on
2026-11-08:

1. Stop recognizing a gate-driver pair as a differential pair.
2. Recognize more substructures:
   - a two-terminal device in parallel with a MOS channel;
   - a cross-coupled pair;
   - a small stage that only drives one gate.
3. Place a port that serves a single pin next to that pin, not at the layout edge.

Every fix must be general: never keyed to a case, an instance id or a symbol id. Device
classes come from `@icm/devices`.

## Context

Opus diagnosed two annealed human results and surveyed all 33 human cases. Data stays in
git-ignored `tmp/diag/`.

### 1. Gate-driver pairs recognized as differential pairs

`recognizeStructures` (`src/recognize.ts:9-96`) accepts a differential pair when:

- two MOS of the same type share a source Net;
- that Net is neither supply nor ground;
- the drains differ, and the gates differ.

It does not check whether one member drives the other. In one surveyed document, MOS
`a` has `D=n2, S=n5, G=n6`, and MOS `b` has `S=n5, D=n6, G=port`. So `b`'s drain drives
`a`'s gate: `b` is `a`'s gate driver. Recognized as a pair, both are forced into the
mirrored template, which leaves a wire loop between them.

Of 35 recognized pairs, 3 have this one-way relation (one member's drain equals the
other's gate). Another 9 have no tail; these are unexamined.

Recognized groups become `set_layout_group` edits. `LayoutGroupSchema.kind`
(`packages/model/src/schema/presentation.ts:175`) allows only `differential-pair`,
`current-mirror`, `matched-pair` and `custom`. `packages/model` is out of scope.

### 2. Missing substructures

- **Parallel devices.** A two-terminal device can sit on exactly the D and S Nets of one
  MOS. Examples: a diode across a power switch, or a capacitor across a channel. Humans
  draw it right beside the MOS, its pins level with D and S. Today it goes into stages or
  rows like any device, often far away. There are 5 cases: 2 diodes and 3 capacitors.
- **Cross-coupled pairs.** Two same-type MOS can each have their gate on a Net that holds
  the other's D or S. Examples: a latch, or a source-coupled charge-pump pair. Humans
  draw them side by side and symmetric. They are not recognized today. A mutual
  drain-to-gate pair with a shared source currently matches as a differential pair.
- **Gate-driver stages.** `findStages` (`src/stages.ts`) produces small stages, such as
  one MOS between a port and a gate, whose only non-rail link to the rest of the circuit
  is one Net reaching only gate or control pins. Humans draw such a driver right next to
  the gate it drives. R59 (`src/stages.ts:184`) attaches only rail shunts and
  independent one-device stages.

### 3. Ports placed at the layout edge

`placeCellPins` (`src/place-markers.ts:126-…`):

- chooses a side from the Net role and from the host's position against the device
  box's centre (R19);
- puts every left or right port `CELL_PIN_OFFSET` (80, `src/geometry.ts:27`) outside the
  device box, level with its host (R20).

So a port that serves one gate deep inside the drawing gets a wire across the whole
layout. In one surveyed document, a bias port's wire crosses several vertical wires.
Humans draw such a port right at its pin.

### Binding constraints from earlier tasks

- The human cases are third-party drawings in git-ignored `tmp/human-cases/`.
  - Never commit any of them, any excerpt, any case id, or any id-keyed derived data.
  - Nothing in CI or `pnpm test:local` may depend on them.
- Tune on dev only (`sha256(id) % 3 != 0`). Report val separately.
- R10, R23 and `lostNameClaim` stay as they are. The router does not change.
- `packages/model`, `packages/edit-engine` and the editor do not change.
- Without `search`, planning stays deterministic. T019's R66/R67 annealing stays as it
  is; its moves must respect the new structures, as they already respect groups.

## Scope

Owned paths:

- `packages/auto-layout/**`
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs`, `scripts/auto-layout-review.mjs`

Out of scope:

- the router, model, Edit Engine and editor;
- energy weights;
- the preference tool;
- synthetic circuits;
- the backbone placement strategy.

## Steps

1. **R68 Exclude driver pairs; recognize cross-coupled pairs.**
   - A differential-pair candidate is rejected when exactly one member's gate Net holds
     the other member's drain or source.
   - A pair is **cross-coupled** when:
     - both MOS have the same type;
     - each one's gate Net holds the other's drain or source;
     - neither is diode-connected.

     Record it as a `matched-pair` group, the existing symmetric template. It never
     becomes a differential pair.

   - Investigate: classify the 9 tail-less differential pairs on the dev documents.
     Report how many are genuine, cross-coupled or driver pairs. Fix only by the rules
     above.

2. **R69 Parallel attachment.** A two-terminal device whose two Nets are exactly one MOS's
   D and S Nets attaches to that MOS:
   - it is placed beside the MOS, on the side away from the gate;
   - it is rotated so its pins are level with D and S where its symbol allows;
   - it moves with the MOS, in every strategy and in R66 moves.

   Keep this a placement unit, not a persisted layout group. If a device fits several
   MOS, attach it to the first by id.

3. **R70 Driver attachment.** A stage of at most 3 devices attaches to the gate it drives
   when its only non-rail link to the rest of the circuit is one Net reaching only gate
   or control pins of a single instance.
   - It is placed on the gate's side, its output level with the gate.
   - This extends R59 in the stages strategy. Apply the same rule in layered and template
     placement where it fits; report where it does not.
   - It must not overlap another device; if it would, leave the stage where it is.

4. **R71 Single-host ports.** When a non-rail port's Net reaches exactly one other device
   pin, place the port next to that pin instead of at the edge:
   - outward along the pin's exit direction, `CELL_PIN_OFFSET` away;
   - facing so its label reads upright.

   If that position overlaps an instance or another port, fall back to R19/R20. Rail
   ports, and ports with several hosts, keep R19/R20.

5. **Tests.** Hand-built only:
   - a gate-driver pair is not a differential pair;
   - a genuine pair with a tail still is;
   - a drain-coupled latch, and a source-coupled cross pair, are each recognized as
     `matched-pair`;
   - a diode across a MOS sits beside it with pins level with D and S, in each strategy;
   - a one-MOS driver stage sits next to its driven gate;
   - a single-gate port sits next to its gate, and falls back to the edge when blocked;
   - R66 never separates an attached device from its host;
   - quick-mode determinism and transaction safety still hold.

6. **Report.**
   - Quick mode and `--search 120 --seed 1`, against `tmp/t019-accept/quick.json` and
     T019's 2-minute result: main metric, dev and val, bends, floating pins, completed
     count, total wire length and the width ratio.
   - Corpus and held-out results.
   - How many pairs, attachments and single-host ports each rule touched, as counts
     only.
   - The effect of each step alone, in quick mode.
   - Six rendered pairs, including documents with a driver pair, a parallel diode and a
     single-gate port.

### Round 2 amendment

Added after round 1's review (see `review.md`). Keep R68–R71 as implemented.

7. **R72 Blocker repair.** After a complete plan, read the R14 failures it reports.

   **Repairable blockers.** A failure is repairable when its message names, as the
   obstruction, either:
   - a port (`port`, `port-filled`); or
   - a power marker (`ground`, `vdd`, `vdd-port` and the other net-marker classes).

   Collect those blocker instances.

   **Repair.** Replan once with every collected blocker moved:
   - an R71 local port falls back to R19/R20 at the edge;
   - an edge port takes the next free R20 slot away from the trunk it blocked;
   - a marker takes the next free position along its rail, as R6a and R12 order them,
     clear of the blocked branch's column or row.

   **Acceptance.** Keep the repaired plan only if it has strictly fewer floating pins
   and no more crossings than the plan before it; otherwise keep that plan. Allow at
   most two repair passes per plan.

   **Where it applies.** Quick mode always runs the repair. In R66 search, run it on
   the final best state only, before R44, so search cost per evaluation is unchanged.

   **Constraints.**
   - Never move a device or a fixed instance.
   - Never change the router.
   - Never key the repair to message text beyond the obstruction's instance id. If
     `planRouteNet` already returns the obstruction in structured form, use that
     instead, and report which source you used.

   **Tests.** Hand-built:
   - a local port blocking another Net's branch is moved back, and the Net routes;
   - a ground marker blocking a ground branch is moved, and the branch routes;
   - a repair that would add crossings is not kept;
   - quick mode stays deterministic.

Report round 2 as round 1, against T019 quick (755 / 766 / 82) and round 1
(621 / 701 / 101). Give the effect of R72 alone on top of round 1. The floating-pin
target (≤ 82) still applies.

## Acceptance

Run from the repository root; all must pass.

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
git status --short packages/edit-engine packages/model packages/project-protocol packages/spice apps fixtures   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/'  # expected: no output
```

Round targets, quick mode, against T019's quick result (755 / 766 / 82, 32 completed):

| Measure                      | Required                                |
| ---------------------------- | --------------------------------------- |
| Crossings, dev and val       | each not above its baseline (268 / 487) |
| Completed documents          | not fewer than 32                       |
| Bends, floating pins         | not above 766 / 82                      |
| Total wire length            | report; explain any rise above 5%       |
| Width ratio against baseline | no document above 1.5                   |

Corpus targets and held-out ceilings must hold in quick mode. With `--search 120`, report
the results against T019's 621 / 643 / 80.

These are readability fixes. If a rule is correct but costs a few crossings, report it
per document instead of dropping it, and say so plainly. Opus decides.

## Notes for the implementer

- One general mechanism per step.
- Keep each new rule's code next to the rule it extends:
  - recognition in `recognize.ts`;
  - attachments beside R59;
  - ports in `place-markers.ts`.
