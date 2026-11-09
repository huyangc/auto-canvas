# T024 — Auto-layout: cascode pairs, split tails and axis-seated bias ports

- Branch: `task/T024-auto-layout-cascode-symmetry`
- Base: `main` at `dcc2e62` (T022 merged)
- Lane: 2. Every acceptance command runs with `ICM_E2E_PORT=4273`,
  `AUTO_CANVAS_E2E_API_PORT=4321` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`. No browser test is
  expected.
- Parallel task: T023 (`task/T023-auto-layout-routing`, PR #26, lane 3) is open; its owned
  paths are listed under Scope.
- Status: approved

## Goal

On a rail-to-rail folded-cascode drawing, auto layout draws these devices without symmetry
and with more crossings than the human:

- the two cascode pairs;
- the parallel tail devices;
- the bias ports.

Opus diagnosed the cause in an experiment (Context 2). Three things are missing:

1. **Common-gate pairs.** Two cascode devices with one shared gate, stacked on a symmetric
   pair, are never recognized. So they get no symmetric template.
2. **Split tails.** Two parallel tail devices with different gates make the tail ambiguous.
   So the pair has no tail, and the two devices are not drawn back to back.
3. **Two-gate axis seat.** A bias port that drives exactly the two gates of such a pair
   goes to the layout edge. Its wire then crosses the input-gate verticals.

This task adds all three as general rules, keeps the T022 benchmark honest for them, and
reports layout effects.

The user confirmed two decisions on 2026-11-09:

1. **Split tails are included,** although their only real example is a val document. The
   report flags that this val figure is not a clean held-out measure.
2. **Common-gate pairs must be anchored** to a recognized symmetric unit. Unanchored
   shared-gate pairs stay free.

## Context

Opus verified everything below on `dcc2e62`. Paths are relative to
`packages/auto-layout/` unless they start at the repository root.

### 1. Where the code is

- **Recognition.** `src/recognize.ts`:
  - `recognizeSubstructures` (`:68`) returns structures with roles.
  - `movementUnits` (`:318`) picks two-member units, in the order cross-coupled, pair,
    mirror, matched.
  - `alignStackedLoads` (`:398`) orders a load unit to follow its pair's drains, using
    `channelPins`.
  - `persistedTemplates` (`:427`) rebuilds persisted groups.
- **Matched-pair rule.** It needs a shared gate (or both diode-connected) **and** a shared
  source or drain. A common-gate cascode pair shares neither, so today it is no structure
  at all.
- **Tails.** Several tail candidates on the common source make an `Ambiguity` of kind
  `tail` (R81) and no tail.
- **Template orientation is fixed by kind,** in `src/template-placement.ts:100-101` and
  `src/layered.ts:465-470`:
  - `differential-pair`: left `none`, right `horizontal`, so the gates face **outward**;
  - every other kind: left `horizontal`, right `none`, so the gates face **inward**.

  No other placement code reads the kind for orientation.

- **R71 local seat.** `placeCellPins` in `src/place-markers.ts:130-245`:
  - Only ports with exactly one non-rail host pin (`singleHost`, `:205`) get a seat, 80
    units out along the pin's exit (`:212-245`).
  - The seat is kept only if `geometryProblem` finds no overlap.
  - Every other non-rail port gets an edge seat by R19/R20 (`:246-…`). The side comes from
    the first host's x against the device box centre.
- **A tail that is a mirror member** already moves with its whole unit, in template and
  layered placement (T022 round 2).

### 2. The diagnosis

Opus ran this on one val document, for diagnosis only, with nothing tuned. The circuit is a
textbook complementary folded cascode:

- PMOS pair with tail;
- NMOS pair with two parallel tail devices;
- PMOS cascode pair on the PMOS drains, NMOS cascode pair on the NMOS drains;
- bias ports VB3 and VB4, each driving exactly one cascode pair's two gates.

| Variant (layered, routing unchanged)                                                | Crossings | Bends |
| ----------------------------------------------------------------------------------- | --------- | ----- |
| main                                                                                | 8         | 10    |
| flip the cascode devices only, in place                                             | 10–12     | 11    |
| cascode pairs as symmetric templates (gates inward)                                 | 8         | 8     |
| plus VB3/VB4 on the pair axis, beside the shared gate wire                          | 4         | 4     |
| plus the tail pair back to back (gates outward), each tail port beside its own gate | 2         | 0     |
| human drawing                                                                       | 6         | —     |

The scripts are in git-ignored `tmp/t022/val11-*.mjs`; the renders are in
`tmp/t022/render/v11-*.png`. Both tail ports have a single host, so R71 already seats
them once the tail pair faces outward.

### 3. Survey (counts only)

Script: `tmp/t022/survey-t024.mjs`.

| Measure                                                                                                               | Dev (18 documents) | Val (15 documents)         |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------- |
| Common-gate candidates (shared gate, distinct non-rail sources, distinct drains, compatible, outside every structure) | 21                 | 14                         |
| …with sources on a recognized pair's two drains                                                                       | 5                  | 3                          |
| …stacked on another such candidate (a chain)                                                                          | 7                  | 0                          |
| Non-rail ports whose Net reaches exactly two gates                                                                    | 24                 | 13                         |
| …which are the two gates of an anchored candidate                                                                     | 12                 | 2                          |
| Split tails                                                                                                           | 0                  | 1 (the diagnosed document) |
| Documents affected by anchored pairs or split tails                                                                   | 3                  | 2                          |

**The split-tail rule has no dev case.** Its benefit can only be seen on val, so the val
figure for that rule is not a clean held-out measure. Report it as such.

### 4. Benchmark data

The T022 benchmark is `scripts/auto-layout-recognition.mjs` and `src/recognition-score.ts`,
with local data in git-ignored `tmp/recognition/`.

- **LOADBench.** It labels 42 `MosfetGateConnectedCouple` structures. Each has pins
  `Input1/Input2` (the sources) and `Output1/Output2` (the drains), with two
  `MosfetNormalArray` children sharing a gate. These are independent common-gate-pair
  labels. Many sit inside `MosfetFoldedCascodeDifferentialPair` or
  `MosfetCascodedDifferentialPair`, which T022's converter defers for every kind.
- **CircuitGenome.** The telescopic and folded cascode `load` variants contain a common-gate
  pair. For example, `telescopic_cascode_load_pmos` has
  - `mp1 internal_0 bias1 in1`, and
  - `mp2 out bias1 in2`.

  Its sources are `in1`/`in2`, the pair drains. The module definitions are in
  `tmp/t022/cg-venv/lib/python3.14/site-packages/circuitgenome/synthesizer/config/opamp_modules.yaml`.
  T022 defers every device of those variants.

### 5. Baselines (main `dcc2e62`, git-ignored)

- **Quick:** `tmp/t024/main-quick.json`, all 33 documents completed.
  - Dev: 299 crossings.
  - Val: 385 crossings.
  - Total: 684 crossings, 738 bends, 71 floating pins, 241,110 wire length.
  - Label overlaps / clearance / terminal departures: 3 / 82 / 15.
- **Search:** `tmp/t024/main-search120.json`, from T022's own `--search 120 --seed 1 --jobs 12` run on identical code.
  - Before any change, re-measure both baselines on this branch with nothing else heavy
    running.
  - Use the fresh numbers if they differ, and report both.

### 6. Binding constraints

- **Human cases.** Third-party drawings in git-ignored `tmp/human-cases/`.
  - Never commit a case, an excerpt, a case id or id-keyed data.
  - Nothing in CI may depend on them.
  - Tune on dev only (`sha256(id) % 3 != 0`), and report val separately.
  - Hand-built test circuits may use textbook topologies, with generic names.
- **Frozen.** The router, R10, R23 and `lostNameClaim` stay as they are. So do
  `packages/model`, `packages/edit-engine`, `packages/derived` and `apps/`.
  `LayoutGroupSchema.kind` is unchanged: new structures persist as `matched-pair`.
- **T023 owns:**
  - `src/route.ts`, `src/routing-audit.ts` and `scripts/auto-layout-eval.mjs`;
  - the `unrouted` term in `src/refine.ts`;
  - `test/route-quality.test.ts`, plus named tests in `test/routing.test.ts`,
    `test/blocker-repair.test.ts` and `test/search.test.ts`;
  - spec rules R85–R87.

  T024 numbers its rules R90–R93. Whichever PR merges second rebases and re-measures.

- **Determinism.** Without `search`, planning stays deterministic.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/recognize.ts`, `src/types.ts`, `src/net-roles.ts`
- `packages/auto-layout/src/template-placement.ts`, `src/layered.ts`: only the orientation
  (`mirror`) code and tail-unit handling that steps 3–4 need
- `packages/auto-layout/src/place-markers.ts`: only `placeCellPins`'s R71 block, for step 5
- `packages/auto-layout/src/recognition-score.ts`, `scripts/auto-layout-recognition.mjs`
- `packages/auto-layout/test/recognize.test.ts`, `test/recognition-*.ts`,
  `test/recognition-cases.json`, `test/document-fixture.ts`; new test files
- `docs/specs/auto-layout.md`: R5, R81, R83 and R84, and new R90–R93

Out of scope (do not change):

- Every T023-owned path in Context 6, and `src/refine.ts`.
- `src/auto-layout.ts`, `src/place.ts`, `src/stages.ts`, `src/search*.ts` and
  `src/blocker-repair.ts`, and the T021 files.
- Edge seating by R19/R20 and its side choice, apart from what step 5 adds.
- Output-port sides, net labels in place of long wires, cascode current mirrors,
  source-degenerated pairs and larger OTA templates.
- `pnpm-lock.yaml` and every dependency.

## Steps

Notation as in T022: D/G/S, with C/B/E for a BJT. "Compatible" means
`familyCompatible`. A **symmetric unit** is a recognized differential pair, cross-coupled
pair, matched pair, or common-gate pair from this task.

1. **Baselines and benchmark labels first.**
   - Re-measure quick and search on the base (Context 5).
   - Then extend the benchmark, before changing recognition, so the old recognizer gets
     scored on the new labels:
     - **New kind `common-gate-pair`,** with roles `member` and `member`.
     - **Split tails:** a `differential-pair` expectation may carry two `tail` members.
     - **Per-kind deferral.** A case may carry `deferredByKind: {kind: ids[]}` next to
       `deferred`. A structure is unscored for a kind when it contains an id deferred for
       every kind, or for that kind.
     - **LOADBench converter:** label every `MosfetGateConnectedCouple` as a
       `common-gate-pair` of its two normal arrays' devices. For this kind only, do not
       defer devices of `MosfetFoldedCascodeDifferentialPair` or
       `MosfetCascodedDifferentialPair`; cascode-mirror deferral still applies.
     - **CircuitGenome converter.** Label each telescopic/folded `load` variant's
       common-gate pairs: two devices of that slot sharing one gate Net from a `bias*`
       port, with sources on the pair drains (`in1`/`in2`) or on the drains of an
       already-labeled common-gate pair. Read the variants in `opamp_modules.yaml`, and
       list them in the report. For this kind only, do not defer those devices.
     - **Hand-built cases** (`test/recognition-cases.json`), generic names:
       1. A complementary folded cascode: PMOS pair with tail, NMOS pair, PMOS cascode
          pair on the PMOS drains, NMOS cascode pair on the NMOS drains (cascode drains
          joined across), and two parallel NMOS tail devices with different gate ports.
          - Expected: both pairs, both common-gate pairs, and the NMOS pair with two
            `tail` members.
       2. A telescopic cascode: an NMOS pair, an NMOS common-gate pair on its drains, and
          a PMOS mirror load on the cascode drains.
          - Expected: a pair, a common-gate pair, a mirror and a composite.
       3. A two-level chain: one common-gate pair stacked on another, on a pair.
          - Expected: both common-gate pairs.
       4. **Negative (unanchored):** two devices sharing a bias gate, with sources on
          unrelated internal Nets. Expected: no common-gate pair.
       5. **Negative (one side):** shared gate, sources on the same drain Net. Expected:
          none.
       6. **Split tails:**
          - three parallel tail devices: ambiguous, no tail;
          - two tail devices with different source Nets: ambiguous.
   - Save `tmp/recognition/t024-before.json` and `t024-before-units.json`.

2. **R90 Common-gate pairs** (`recognizeSubstructures`).
   - **Candidates.** Two compatible branches `a` and `b` with:
     - the same gate Net;
     - distinct non-rail sources and distinct drains;
     - neither diode-connected nor `D = S`;
     - neither already in a mirror, differential, cross-coupled or matched structure.
   - **Anchor.** Accept a candidate only when it is anchored to an already-recognized
     symmetric unit `(p, q)`, matched by side:
     - its sources are `{net(p, D), net(q, D)}`; or
     - its drains are `{net(p, S), net(q, S)}` for a unit stacked above it.
   - **Iteration.** Iterate to a fixed point, so chains anchor on common-gate pairs found
     earlier.
   - **Ties.** A branch that would join two common-gate pairs gives an ambiguity and no
     pair. Never pick by id.
   - **Movement.** Recognized pairs become `matched-pair` movement units, after mirrors and
     before plain matched pairs. Their member order follows the anchor's left/right:
     generalize `alignStackedLoads` so a unit follows the unit it is stacked on, not only
     a differential pair.
   - **Persistence.** The persisted kind is `matched-pair`. `persistedTemplates` must
     rebuild them.

3. **R91 Split tails.** On a pair's common-source Net N, a tail ambiguity becomes a split
   tail when:
   - there are exactly two candidates;
   - both are transistors of the pair's polarity with drain on N;
   - they have the same source Net and different gate Nets;
   - their family is compatible.

   Then:
   - Both get the `tail` role.
   - The movement unit `[t1, t2]` is a `matched-pair` unit with a new
     `facing: "outward"`; the pair's `tailInstanceId` is its lower id.
   - Every other ambiguity stays one, as in R81.
   - Composites carry both tails.

4. **R92 Template facing.**
   - Add optional `facing?: "inward" | "outward"` to `RecognizedGroup`. The default comes
     from the kind, as today:
     - `differential-pair`: outward;
     - every other kind: inward.
   - Use it in `template-placement.ts` `expandTemplates` (`mirror`) and in `layered.ts`
     `assignColumns` (`:465-470`).
   - Only split-tail units set it.
   - A split-tail unit sits one row toward the supply (R81), centred on the pair axis,
     with its gates facing outward. Its single-host gate ports then take R71 seats on
     their own.

5. **R93 Two-gate axis seat** (`placeCellPins`). Seat a non-rail port beside the shared
   gate wire, instead of at the edge, when:
   - its Net reaches exactly two device pins, and both are gates;
   - the two gate pins lie on one horizontal line;
   - their exits point toward each other.

   The seat:
   - is on the midpoint x, `CELL_PIN_OFFSET / 2` (rounded to the grid) above the gate
     line; if that overlaps, below it;
   - faces the line, oriented as R71 orients its seats.

   Same overlap check as R71; if both seats overlap, use R19/R20. Run it with R71, before
   edge seating, in id order.

   This rule is purely geometric, so it also covers any other pair whose gates face each
   other.

6. **Tests.**
   - **Benchmark.** `test/recognition-bench.test.ts`: all hand kinds exact, with rename
     and shuffle invariance (existing harness).
   - **Placement,** in `template` and `layered`:
     - A common-gate pair stacked on a differential pair: same row, mirrored inward, each
       source pin on its anchor drain's column.
     - A split tail under an NMOS pair: back to back, gates outward, on the pair axis, one
       row below.
     - A port driving two inward-facing gates sits on their axis.
     - Blocked, it falls back to the edge.
     - A port driving two gates that do not face each other is unchanged.
   - **Persistence.** A persisted common-gate pair is rebuilt.
   - **Existing tests.** All of them must pass unchanged, except where a recognized
     structure legitimately changes an expectation. List each such change with its reason.

7. **Spec.** Add R90–R93. Amend:
   - R5 and R83 (movement order and the facing default);
   - R81 (split tails);
   - R84 (the new kind, per-kind deferral, the converters' new labels).

8. **Report.**
   - **Recognition.** For all four sources: before/after per kind (structures and
     `--units`), tail statistics, and the top mismatch shapes.
   - **Layout.** Quick and search against the re-measured base:
     - crossings for dev and val;
     - bends, floating pins and completed count;
     - wire length, the three label counts and the largest width ratio against base.
   - **Rule ablations, quick mode:** R90 alone, R91 + R92 alone, R93 alone, and all
     together.
   - **Counts per rule,** on dev and val: units added or changed, axis seats taken and
     fallen back, split tails.
   - **Effect per document,** anonymous, for every changed document.

## Acceptance

Run from the repository root, with the lane-2 variables set; all must pass.

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
pnpm auto-layout:recognition --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/t024-after.json          # expected: exit 0
pnpm auto-layout:recognition --units --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/t024-after-units.json  # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t024/main-quick.json             # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12 --baseline tmp/t024/main-search120.json   # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git diff --stat dcc2e62 -- packages/auto-layout/src/route.ts packages/auto-layout/src/routing-audit.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/auto-layout.ts packages/auto-layout/src/place.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/search.ts packages/auto-layout/src/search-moves.ts scripts/auto-layout-eval.mjs pnpm-lock.yaml   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|tmp/'   # expected: no output
```

**Recognition targets:**

| Measure                                        | Required                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Hand cases                                     | precision, recall and exact = 1 for every kind; rename and shuffle invariant |
| Every T022 kind on LOADBench and CircuitGenome | not below T022 (all 1 today)                                                 |
| `common-gate-pair` on LOADBench                | report precision and recall; explain every miss and false positive by shape  |

**Layout targets,** quick mode, all 33 documents against the re-measured base:

| Measure                                        | Required                                           |
| ---------------------------------------------- | -------------------------------------------------- |
| Crossings, dev and val                         | each not above base (299 / 385 unless re-measured) |
| Bends, floating pins                           | not above base (738 / 71)                          |
| Label overlaps, clearance, terminal departures | report; explain any rise                           |
| Width ratio against base                       | no document above 1.5                              |

- **Corpus and held-out.** Corpus targets and held-out ceilings hold.
- **Search.** Report it against the re-measured search base.
- **Correct rules that cost crossings.** Report them per document. Opus decides.

## Notes for the implementer

- **Precision over recall.** An unanchored shared-gate pair is not a cascode pair. Two
  devices that merely share a bias line are common in bias networks.
- **Determinism.** Recognition never breaks ties by instance id (R80). Unit choice follows
  T022's rules.
- **R93 is geometric.** It must not read recognition results; the template facing gives
  it the geometry.
- **Stop on blockers.** If a needed change falls in a T023-owned or out-of-scope file,
  stop and report it.
