# T025 — Auto-layout: a symmetry axis for mirrored half-circuits

- Branch: `task/T025-auto-layout-symmetry` (renamed from `task/T024-auto-layout-symmetry`
  after round 2; see "Round 3: renumber and rebase" below)
- Base: `main` at `f8f15fe` (T024 cascode pairs merged); the plan was written against
  `5314954` and round 1–2 ran there
- Lane: 1. Every acceptance command runs with `ICM_E2E_PORT=4173`,
  `AUTO_CANVAS_E2E_API_PORT=4311` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test`. No other task runs
  at the same time. No browser test is expected.
- Status: approved

## Goal

A differential circuit has a mirror symmetry: the input pair, its cascodes, its loads,
the two output branches and the bias devices feeding both halves map onto each other
when the drawing is reflected about a vertical axis. Textbooks and the human cases draw
such circuits that way. Today auto-layout places only the recognized two-member groups
symmetrically (R7, R18); every other partner lands wherever the row order and column
compaction put it. In the human case with the strongest symmetry (a fully differential
folded-cascode OTA with two bias branches), humans draw all 10 partner pairs mirrored
about one axis; the planner mirrors 1.

After this task:

- recognition finds the mirror symmetry of a Document: partner pairs, devices on the
  axis, and the devices outside the symmetry;
- every connected symmetric component is laid out as one rigid block: the half-circuit
  is laid out with the existing layered rules, then unfolded about the axis, so partners
  share a row, mirror each other's orientation and sit at mirrored x; axis devices sit
  on the axis;
- the block takes part in row ordering, column compaction, stage composition and
  annealing as one unit, as templates do today;
- the evaluation reports how symmetric the human drawing and the result are.

## Context

Opus verified everything below on `5314954`; see "Round 3" for `f8f15fe`. Paths are relative to
`packages/auto-layout/` unless they start at the repository root.

### 1. What exists

- `src/recognize.ts`: `recognizeSubstructures` (`:68`) returns `Structure[]` with roles
  (R80–R82). `recognizeStructures` (`:304`) turns them into `RecognizedGroup` movement
  units through `movementUnits` (`:318`), which `alignStackedLoads` (`:398`) orders
  left/right by the pair's drains. `persistedTemplates` (`:427`) rebuilds units for
  persisted layout groups. `src/types.ts:27` defines `RecognizedGroup`; `:33–60` define
  `Structure`, `StructureMember` and `Ambiguity`.
- `src/net-roles.ts`: `channelPins` (`:25`) gives D/G/S or C/B/E; `polarity` (`:36`);
  `familyCompatible` (`:55`) compares descriptor ids and model identities, never sizes.
- `src/layered.ts`, the layered strategy (R30–R33):
  - `netLevels` (`:54`), `deviceRows` (`:124`). A recognized group is one `RowNode`
    with both members (`:176–198`); its members take the group's smaller row.
  - `orderRows` (`:301`): barycentre sweeps over `RowNode`s; `bundleTails` (`:357`)
    keeps pairs that share a tail contiguous.
  - `assignColumns` (`:421`): sets group members' mirrors (`:462`), derives R18 stack
    pitches, builds alignment components with relative offsets (`:540–561`), links
    shared channel pins (`:582`), compacts with a 40-unit gap, pulls components to
    median pin positions, and rounds to the grid (`:697`).
- `src/stages.ts`: `findStages` (`:78`) joins recognized group members into one stage
  (`:129–134`). `placeStages` (`:422`) lays each stage out with `deviceRows`,
  `orderRows` and `assignColumns` in local coordinates (`:514–534`), marks a stage with
  a group `canMirror: false` (`:562`), composes stages left to right (`:721–760`), tries
  mirroring stages that may mirror (`:809`) and applies R57 (`:858`).
- `src/template-placement.ts` (R7, R18, ≤ 40 instances): `expandTemplates` (`:89`)
  places each group at an axis; stacked groups share an axis; tails go on the axis
  (`:125–170`). `templatePlacement` (`:224`) then ranks the remaining devices by signal
  distance (`:256`).
- `src/place.ts`: `placeDocument` dispatches the strategy (`:174–228`), restores fixed
  placements, repairs collisions in id order (`resolveCollisions`, `:44–108`), seats
  attachments and markers. For a search state (`given`), it refuses a finishing pass
  that split a template, a parallel attachment or an aligned stack (`:420`, `:442`,
  `:460`).
- `src/search-moves.ts` (R66): rigid units are built by union-find from groups, tails,
  R18 stacks and parallel attachments (`:51–92`); moves are same-row swaps, shifts,
  single mirrors, port flips, stage moves and stage mirrors (`:132–190`); a stage that
  contains a group may not mirror (`:169–176`).
- `scripts/auto-layout-eval.mjs`: `metrics` (`:74`) computes per-document counts;
  totals and the console table list the readability and missing-connection counts
  (`:299`, `:344–352`).
- `docs/specs/auto-layout.md`: R5 recognition (`:47`), R7 templates (`:72`), R18 stacks
  (`:163`), R32 order (`:222`), R33 columns (`:228`), R51 stage layout (`:281`), R66
  annealing (`:347`), R80–R87 (`:471–588`). R88 is the next free rule number.

### 2. Measured baseline

Human cases: 33 third-party drawings in git-ignored `tmp/human-cases/`, dev (18) and
val (15) by `sha256(id) % 3`. Quick-mode baseline for `5314954`:
`tmp/t024/base-quick.json`, with the drawings in `tmp/t024/base-svg/`. It equals T023's
accepted result document by document.

| Quick mode, 33 completed                |        dev |        val |
| --------------------------------------- | ---------: | ---------: |
| Crossings                               |        314 |        346 |
| Bends                                   |        386 |        414 |
| Floating pins                           |          0 |          1 |
| Wire length                             |    125,920 |    156,770 |
| Label overlaps / clearance / departures | 0 / 37 / 8 | 0 / 25 / 7 |

Opus's throwaway probe (`tmp/t024/symmetry-probe2.mjs`) seeded an involution from the
recognized differential and cross-coupled pairs, propagated it over the device–net
graph, split the result into connected components and measured both the human drawing
and the planner's result. "Mirrored" means the two partners' pin centres satisfy
`|x_a + x_b − 2·axis| ≤ 40` with the axis the median midpoint of the component's
pairs; "level" means `|y_a − y_b| ≤ 20`; "on axis" means a self-mapped device's pin
centre is within 60 of the axis.

| Seeded components, quick mode      | dev human | dev planner | val human | val planner |
| ---------------------------------- | --------: | ----------: | --------: | ----------: |
| Documents with a seed              |         9 |           9 |         6 |           6 |
| Partner pairs                      |        61 |          61 |        31 |          31 |
| Pairs mirrored about the axis      |        35 |          21 |        23 |          12 |
| Pairs level                        |        55 |          57 |        31 |          30 |
| Partners with mirrored orientation |        34 |          24 |        25 |          16 |
| Axis devices on the axis           |     4 / 7 |       0 / 7 |     3 / 4 |       1 / 4 |

Humans keep almost every pair level and mirror about 60% of them. Per document it is
bimodal: fully differential analog blocks are drawn with every pair mirrored (10/10,
10/10, 5/5 in three cases), while a current-steering mixer and a two-stage amplifier
with common-mode feedback keep pairs level but not mirrored. A symmetric drawing of the
latter is still the textbook form.

**Why not a post-pass.** Opus also tried the obvious shortcut in a scratch worktree
(`tmp/t024/prototype-symmetry.ts`, `tmp/t024/prototype-place.diff`): after the
strategy placed everything, mirror each right partner onto `2·axis − x_left` and centre
axis devices. Symmetry reached the human level (dev mirrored pairs 54 of 61), but the
mirrored partners landed on devices that were already there, collision repair pushed
things around, and dev crossings rose from 314 to 411 (one document 33 → 71, another
54 → 104). Val rose 346 → 354. The symmetric block has to be laid out as a block, with
the rest of the circuit placed around it. That is the design below.

### 3. Design

**Detection (R88).** An involution σ over devices and Nets:

- Seeds: every recognized `differential-pair` (its two `input` representatives) and
  `cross-coupled-pair`. Seeds come from `recognizeSubstructures`, not from movement
  units, so persisted layout groups do not change the symmetry.
- Rails are their own mirror. Markers (`ground`, `vdd-port`, `port`, `port-filled`)
  are not devices here.
- Propagation to a fixpoint, in rounds:
  - a device pair (a, b) implies Net pairs `net(a, p) ↔ net(b, p)` for every symbol pin
    name p (D↔D, G↔G, S↔S, 1↔1, …; MOS bulk included);
  - a Net pair (n, m) with n ≠ m implies a device pair for each unmapped device x on n
    and the unique unmapped device y on m that has the same pin name on m and is
    family-compatible with x (`familyCompatible` and equal `symbolId`), provided x is
    also the unique such candidate from m's side;
  - a self-mapped Net n ↔ n implies a device pair between two unmapped same-family
    devices on it with the same pin name when they are each other's only candidate;
  - an unmapped device whose Nets are all self-mapped and that has no unmapped twin
    (same family, same Nets on every pin) is self-mapped: an axis device.
- Each round computes all implications from the current mapping, then applies them.
  An implication that contradicts the current mapping, or two implications in one
  round that disagree, mark the device or Net **conflicted**: it keeps no mapping and
  nothing propagates through it. Ties are never broken by id.
- Components: pairs and axis devices joined through non-rail Nets. Keep only components
  that contain a seed. Side: within a component, the seed pair with the lowest member
  id has its lower-id member on the left (as the R7 template does); sides propagate
  along pairs. Each `SymmetryComponent` lists `pairs: [left, right][]`, `axis: string[]`
  (self-mapped devices) and the ids of conflicted devices it touches.

**Symmetric block layout (R89), shared by every strategy.** For one component:

1. Rows. Partners take one row: the smaller of their two `deviceRows` rows, as group
   members do today (`layered.ts:187`). Axis devices keep their row.
2. Half layout. Build the half document: the left partners and the axis devices, with
   every right Net replaced by its left partner Net. Run `orderRows` and
   `assignColumns` on it with the rows above and with the recognized groups whose two
   members both lie in the half. In every row, move the axis devices to the right end of
   the row's order before `assignColumns`.
3. Axis. `A` is the smallest grid x such that every left partner's visible bounds end
   at least 40 units left of the widest axis device's left edge when that device's
   channel pin (MOS D/S or BJT C/E; otherwise the symbol's pin-centre) is at `A`. With
   no axis device, `A` is the left partners' right extent plus 40, snapped to the grid.
   Place every axis device with that pin at x = `A`.
4. Unfold. For each pair, the right partner gets
   `{ position: { x: 2A − x_left, y: y_left }, ...reflectOrientation(left, "left-right") }`.
   Pins then mirror exactly, so R18 pin alignment inside the half carries over.
5. Block. The component's members become one rigid unit with these relative offsets.

**Strategies.**

- Layered (`layered.ts`): after `deviceRows` has assigned rows, a new step builds each
  component's block (half layout, axis, unfold) and replaces the component's nodes with
  one `RowNode` per row whose `members` are that row's left partners in half-layout
  order, then the axis devices, then the right partners in reverse. `orderRows` treats
  it like any multi-member node. `assignColumns` takes the block offsets and registers
  the whole block as one alignment component before stack links are applied, so
  compaction and median pulls move it as a unit; R18 links from outside devices (a
  mirror load over a pair) still attach to it.
- Stages (`stages.ts`): `findStages` joins every member of a component into one stage.
  The stage's local layout reaches the symmetric block through the same `deviceRows`,
  `orderRows` and `assignColumns`. A stage with a component has `canMirror: false`.
- Template (`template-placement.ts`): a component is placed as one template unit at its
  own axis, in place of the per-group templates of the groups inside it; its members
  leave the ranked singles.
- Search (`search-moves.ts`, R66): the block is one rigid unit; a stage containing one
  may not mirror. `placeDocument`'s `given` validation refuses a finishing pass that
  split a block, like templates and stacks.
- Collision repair (`place.ts:44`) moves a block's members together, as it does for a
  parallel attachment's unit.

Devices outside the symmetry (conflicted, unmapped, bias generators, common-mode
feedback blocks) are placed by the unchanged rules around the block.

### 4. Binding constraints

- **Human cases.** They stay in git-ignored `tmp/human-cases/`.
  - Never commit any case, excerpt, case id or id-keyed data.
  - Nothing in CI or `pnpm test:local` may depend on them.
  - Tune on dev only. Report val separately. Never choose a constant by its val result.
- **Frozen code.** The router (`src/route.ts`), `src/refine.ts` and its weights,
  `src/routing-audit.ts`, R10, R23 and `lostNameClaim` stay as they are.
  `packages/model`, `packages/edit-engine`, `packages/derived` and `apps/` do not
  change. `LayoutGroupSchema.kind` is unchanged: a symmetric block is a placement
  unit, not a persisted group.
- **Recognition stays pure.** `recognizeSubstructures` and `movementUnits` are
  unchanged. Symmetry detection reads their structures and the Document; it never
  reads placements or layout groups, and never resolves a tie by id.
- **Determinism.** Without `search`, identical input gives byte-identical edits.

## Scope

Owned paths (may be created, edited or deleted):

- new `packages/auto-layout/src/symmetry.ts`
- `packages/auto-layout/src/types.ts`: add `SymmetryComponent`
- `packages/auto-layout/src/layered.ts`, `src/stages.ts`, `src/template-placement.ts`,
  `src/place.ts`, `src/search-moves.ts`
- `packages/auto-layout/src/index.ts`: export the new type if the script needs it
- new `packages/auto-layout/test/symmetry.test.ts`
- existing tests in `packages/auto-layout/test/` only where a rebuilt expectation is
  named in step 7
- `docs/specs/auto-layout.md`
- `scripts/auto-layout-eval.mjs`

Out of scope (do not change):

- `src/recognize.ts`, `src/net-roles.ts`, `src/route.ts`, `src/refine.ts`,
  `src/routing-audit.ts`, `src/blocker-repair.ts`, `src/search.ts`, the T021 files
  (`seat-labels.ts`, `readability.ts`, `face-ports.ts`, `finalize-facing.ts`,
  `timing.ts`), `src/place-markers.ts`, `src/place-fallback.ts`.
- `packages/edit-engine/**`, `packages/model/**`, `packages/derived/**`, `apps/**`,
  `scripts/auto-layout-recognition.mjs`, `scripts/auto-layout-review.mjs`.
- Energy weights. Net order and routing. Net labels in place of long wires.
- `pnpm-lock.yaml` and every package's dependencies.

## Steps

1. **R88 Symmetry detection.** `symmetry.ts`:
   `detectSymmetry(document, resolver, roles): SymmetryComponent[]` as in Design,
   plus `symmetryCounts(document, resolver, components)` returning
   `{ pairs, mirrored, level, orientationMirrored, axisDevices, onAxis }` with the
   tolerances of Context 2, for the evaluation. Both are pure.
   - Tests (`symmetry.test.ts`, hand-built):
     - a differential pair with cascodes, a mirror load and two bias branches feeding
       both halves: every branch device is paired, the tail is an axis device, the
       mirror load's reference and output are conflicted (the diode connection breaks
       the mapping) and listed as such;
     - a cross-coupled pair seeds a component;
     - a device with two equally plausible partners is left unmapped, not chosen by id;
     - renaming instances and shuffling input order gives the same components;
     - a Document without a seed gives no component.

2. **R89 Block layout in the layered strategy.** In `layered.ts`, add the half layout,
   axis and unfold of Design step "Symmetric block layout"; let `deviceRows` emit block
   nodes, and `assignColumns` register blocks as alignment components. Keep the group
   template behaviour for groups outside blocks exactly as it is: the existing tests in
   `layered.test.ts` and `recognition-placement.test.ts` must pass unchanged, except
   where step 7 names a rebuilt expectation.
   - Tests: the fixture of step 1 through `placeDocument(..., "layered")`:
     - every pair level, mirrored orientation, `x_left + x_right = 2A` for every pin
       of the pair, the tail's channel pin at `A`;
     - the mirror load sits over the pair with its members on the pair's drains (R18
       still applies to an outside group);
     - an unrelated single device does not overlap the block and the block is not
       split; no R10 problem; determinism.

3. **Stages and template.** `findStages` joins component members; `placeStages`
   reaches the block through the shared functions; `templatePlacement` places a
   component as one unit. Tests: the same fixture through `"stages"` and
   `"template"` gives the same block geometry up to translation; a Document with two
   seeded components places them as two blocks without overlap.

4. **Search and finishing.** `search-moves.ts` joins component members into one unit;
   `place.ts` refuses a finishing pass that split a block and moves a block together in
   collision repair. Tests: `planAutoLayout` with `search: { seed, evaluations: 8 }`
   never separates partners or moves an axis device off its axis; a zero-budget search
   equals quick mode.

5. **Evaluation.** In `scripts/auto-layout-eval.mjs`, record `symmetryCounts` for the
   human drawing and the result (components detected on the input Document), add
   them to the totals and to the console table. Change nothing else there.

6. **Spec.** In `docs/specs/auto-layout.md`: add R88 (detection, conflicts, components,
   sides), R89 (block layout: rows, half layout, axis, unfold, rigid unit), R94
   (strategies and search: block nodes, stage joining, template unit, rigid moves,
   finishing refusal); amend R7, R18, R32, R33, R51 and R66 with one sentence each
   pointing at the block; add the evaluation counts to "Acceptance criteria".

7. **Existing tests.** Expected to pass unchanged. If a test's geometry changes only
   because its fixture now forms a symmetric block, keep the rule it names, rebuild the
   expectation, and list it in the report with the old and new values. Never delete or
   weaken a test.

8. **Investigate and report.**
   - Quick mode against `tmp/t024/base-quick.json`, split by dev and val: completed,
     crossings, bends, floating pins, missing connections, wire length, the three
     readability counts, and the six symmetry counts for human and result.
   - `--search 120 --seed 1 --jobs 12`, against T023's accepted search result
     (`tmp/t023/review1/search120.json`: 32 common documents, 477 crossings, 709
     bends, 1 floating pin).
   - Every document whose crossings rise against the baseline, with its symmetry
     counts before and after, as counts only.
   - Investigate: on dev, every pair that is not mirrored after the change, by cause
     (conflicted, different rows, outside a seeded component, collision repair moved
     it, other). Report counts per cause.
   - Investigate: the planner's time against the baseline's `milliseconds`, summed
     and slowest, noting machine load.
   - Six rendered pairs, baseline quick beside result quick, including the three
     documents whose humans mirror every pair, one where humans mirror few, and one
     whose crossings rise. Keep them in `tmp/t024/pairs/`.

## Acceptance

Run from the repository root, with the lane-1 variables set; all must pass.

```bash
pnpm install --frozen-lockfile --offline             # expected: exit 0
pnpm format:check                                    # expected: exit 0
pnpm docs:check                                      # expected: exit 0
pnpm typecheck                                       # expected: exit 0
pnpm lint                                            # expected: exit 0
pnpm vitest run packages/auto-layout                 # expected: all tests pass
pnpm test:local                                      # expected: exit 0
pnpm deadcode 2>&1 | grep -E 'auto-layout|symmetry'  # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/t024/base-quick.json --jobs 10   # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12                 # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures docs/agent pnpm-lock.yaml package.json   # expected: empty
git diff --stat origin/main -- packages/auto-layout/src/recognize.ts packages/auto-layout/src/net-roles.ts packages/auto-layout/src/route.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/routing-audit.ts packages/auto-layout/src/blocker-repair.ts packages/auto-layout/src/search.ts packages/auto-layout/src/place-markers.ts packages/auto-layout/src/place-fallback.ts scripts/auto-layout-recognition.mjs scripts/auto-layout-review.mjs   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|^tmp/'   # expected: no output
```

`pnpm auto-layout:eval` overwrites `tmp/auto-layout-eval/report.json`. Copy each report
to `tmp/t024/` (`result-quick.json`, `result-search120.json`) right after its run.

On `5314954`, `pnpm deadcode` exits 1 for findings outside these paths; only the
filtered output counts. Every other command above passes on `5314954`.

**Quick-mode targets**, against `tmp/t024/base-quick.json`:

| Measure                                      |  `5314954` | Required                                |
| -------------------------------------------- | ---------: | --------------------------------------- |
| Completed documents                          |   33 of 33 | 33 of 33                                |
| Pairs mirrored about the axis, dev           |   21 of 61 | ≥ 85% of the pairs in seeded components |
| Pairs level, dev                             |   57 of 61 | ≥ 95%                                   |
| Axis devices on the axis, dev                |     0 of 7 | ≥ 85%                                   |
| Crossings, dev                               |        314 | ≤ 330                                   |
| Floating pins, dev / val                     |      0 / 1 | ≤ 0 / ≤ 1, none above its baseline      |
| Bends, dev                                   |        386 | ≤ 425                                   |
| Wire length, dev                             |    125,920 | ≤ 138,500                               |
| Label overlaps / clearance / departures, dev | 0 / 37 / 8 | ≤ 1 / ≤ 41 / ≤ 10                       |
| Unsafe problems; documents not equivalent    |      0 / 0 | 0 / 0                                   |
| Planning time, summed over the 33            |          — | ≤ 1.25 × a paired baseline run          |

The probe's pair counts (61 dev, 31 val) are reference values: the conflict rule of R88
may change which pairs a component holds, so the symmetry targets are fractions of the
pairs the implementation finds, and the report gives both the counts and the fractions.
Val is reported with the same measures; it is not a target. Corpus targets and held-out
ceilings must hold. With 2-minute search, report against T023's result; there is no hard
target, but floating pins must not exceed the quick result's.

**A correct rule that costs crossings.** Report it per document instead of dropping it,
and say so plainly. Opus decides.

## Notes for the implementer

- **One general mechanism.** Never key behaviour to a case, an instance id or a symbol
  id. The only id-dependent choice is the seed's left member, which matches R7.
- **The half layout reuses the layered functions.** Do not write a second row-ordering
  or compaction algorithm. If a function needs a parameter (the rows to use, the nodes
  to keep contiguous), add it.
- **Mirror the placement, not the pins.** `reflectOrientation(p, "left-right")` with
  `x = 2A − x_left` mirrors every pin exactly, as the stage mirror in `stages.ts:730`
  already relies on.
- **Groups inside a block keep their template roles.** The seed pair's `RecognizedGroup`
  still exists (routing order, persisted groups, R18); the block decides where its
  members go. Do not change what `recognizeStructures` returns.
- **Report trade-offs.** If a target conflicts with another, say so; do not drop a rule
  or tune a constant on val.
- **The prototype is a warning, not a model.** `tmp/t024/prototype-symmetry.ts` shows
  the detection the probe used and a post-pass that must not be reproduced.

## Round 2 amendment

Added after round 1's review (`review.md`). Round 1 implemented R88, R89 and R94 (then
numbered R90) in all three
strategies and in search; its block geometry works. It exposed six defects in this plan,
corrected below. Everything not mentioned here stands. Where this section disagrees with
Design or Steps above, this section wins.

### A. R88 conflict rule (review finding 1)

A recognized current mirror stacked on a differential pair has its reference's drain, its
reference's gate and its output's gate on one Net (the left drain). The pair maps that Net
to the right drain; the mirror's shared gate implies the same Net maps to itself. Round 1
treated the two implications as a conflict and dropped the mirror from the symmetry; the
mirror then had to sit outside the block although R18 stacks it over the pair's drains
inside it, which is impossible. Humans draw such a mirror as a mirrored pair with the diode
on one side; the one crossing wire is an accepted asymmetry.

Corrected rule. Net implications are evidence for pairing devices; they never undo a
device pair.

- A device pair (a, b) and a pin p with `n = net(a, p)`, `m = net(b, p)`:
  - `n ≠ m` proposes the Net pair `n ↔ m`;
  - `n = m` is a **shared connection**: it proposes `n ↔ n` only as a **default**. A
    default never conflicts with anything. When `n` has a non-self proposal `n ↔ m'`,
    from this round or an earlier one, the default is dropped and `n ↔ m'` stands; when
    `n` already holds a default self mapping and a non-self proposal arrives later, the
    non-self proposal replaces it. Rails are hard self mappings, as before.
- A Net with two different non-self proposals (counting its existing non-self mapping)
  is conflicted: it keeps no mapping and nothing propagates through it. Its proposed
  partners are conflicted too, as `applyRound` already does.
- A device pair is invalid only when a device would have two different partners
  (device-level disagreement, as `applyRound` judges). Net conflicts never invalidate
  device pairs: remove round 1's `invalidDevices` check.
- Everything else in R88 (seeds, unique-candidate propagation, axis devices, components)
  is unchanged. The common source of a seed pair still becomes self-mapped, because it
  has only the default proposal, so a tail is still an axis device.

With this rule the mirror reference and output become partners through the drains
(`reference.D` on the left drain, `output.D` on the right drain, unique on both sides),
and they lie inside the block where R18 stacks them on the pair.

### B. Sides that no seed determines (finding 2)

A pair reached from the component's seeds only through self-mapped Nets (a shared bias
wire, a rail) has no derivable side: both orientations are valid mirror drawings. Such a
pair takes the R7 convention, lower id on the left, like the seed itself. This is a drawing
convention, not a structural choice, and it is the only other id-dependent decision.
`detectSymmetry` never throws on a valid Document. Report how many pairs needed it.

### C. Several axis devices in one row (finding 3)

Centring each of them on the axis collides. Axis devices that share a row form one
**run**: side by side in half-layout order with the R33 40-unit gap between visible
bounds, the run's pin-centre midpoint on the axis. A lone axis device keeps its channel
pin (or pin centre) on the axis. The `onAxis` count measures each device against the
60-unit tolerance as before, so a run of two may report as off-axis; that is accepted.

### D. Orientation inside the block (finding 4)

Round 1 gave every left member mirror `none`, so a recognized mirror or matched pair faced
its gates outward, against R7, and the `fig-17-19b` corpus expectation was rewritten to
match. Instead, in the half layout set each left member's mirror in `deviceRows`'
placements before `assignColumns`, so R18 pin alignment uses the oriented pins:

- a member of a recognized group follows R7: differential `none`, mirror and matched
  `horizontal`;
- any other paired device with a gate pin (`channelPins(symbolId).gate`): `horizontal`
  when that pin's Net is self-mapped (a shared gate or bias wire, so the wire runs between
  the partners), `none` otherwise (its own gate Net, like a differential input);
- two-pin parts and axis devices keep `deviceRows`' orientation.

The right partner is always `reflectOrientation(left, "left-right")`. Block members stay
out of `orientByWireCost`, as in round 1. Revert the `fig-17-19b` mirror expectation in
`test/corpus.test.ts` to `main`.

### E. Axis position and pitches (finding 5)

Round 1 put the axis at the left half's visible right extent plus 40, so pair pitches no
longer followed R7/R18, and the R18 pitch test and the `five-t-ota` / `fig-17-19b` pitch
expectations were rewritten. Replace Design step 3 ("Axis"): `A` is the smallest grid x
such that

1. every pair's origin pitch `2·(A − x_left) ≥ MEMBER_PITCH` (so the pair whose left
   member is rightmost gets exactly `MEMBER_PITCH` and R18-shifted pairs get more, as
   R18 derives today);
2. in every row, the left partners' visible right extent lies at least 20 units left of
   `A` (mirrored bodies are then 40 apart) and, when the row has an axis run, at least 40
   units left of the run's left edge with the run centred on `A`.

Revert the pitch expectations in `test/quality.test.ts` and `test/corpus.test.ts` to
`main`; both tests are expected to pass unchanged. If a corpus value still differs, step 7
applies: rebuild it, list old and new values and say which rule moved it.

### F. BJT rows (finding 6)

`netLevels` names channel pins only for MOS, so a BJT block's members share one row and a
BJT mirror load lands beside its pair ("stacks a BJT mirror load over its pair by
collector" fails). Extend `netLevels`: a device with `channelPins` that is not MOS uses
`polarity === "n" ? ["C", "E"] : ["E", "C"]`, parallel to NMOS `["D", "S"]` and PMOS
`["S", "D"]`. Opus verified on a scratch copy of `5314954` that this two-line change
passes `pnpm typecheck` and all 289 auto-layout tests. Add one `netLevels` test in
`layered.test.ts`: an npn's collector Net is above its emitter Net, a pnp's emitter Net
above its collector Net. Say so in R31.

### G. Outside devices in a block's row

A device outside every block that shares a row with a block is placed beside the block,
never inside its horizontal span. If R18 would align such a device to a block member's
pin, the alignment is skipped (the existing `align` refusal). Say so in R89.

### H. Tests

- Step 1's first test now expects the mirror load as a pair inside the component
  (`["r", "o"]`, reference left by the pair's drains) and no conflicted device. Add one
  detection test: a pair's common source Net and a shared bias Net are self-mapped, and a
  Net paired through the drains is not turned into a conflict by a shared gate on it.
- Step 2's test keeps its R18 assertion: the mirror sits over the pair's drains, now
  inside the block. Add orientation assertions for the fixture: `a`/`b` `none`/`horizontal`,
  `r`/`o` `horizontal`/`none`, `e`/`f` (shared `bias` gate Net) `horizontal`/`none`,
  `c`/`d` (own gate Nets) `none`/`horizontal`.
- Round 1's "retains self-Net twin partners" test passes with `x` left of `y`.
- One axis-run test: the fixture plus a resistor from `tail` to `gnd` (an axis device in
  the tail's row): no R10 problem, the two bodies 40 units apart, their pin-centre
  midpoint on the axis, every pair still mirrored.
- The existing BJT mirror-load test and the R18 pitch test pass unchanged.

### I. Spec

Rewrite R88's conflict sentence to rule A and add rule B; add rules C, D, E and G to R89;
add the BJT sentence to R31.

### J. Report for round 2

As step 8, against the same baselines, plus: devices the corrected rule pairs that round 1
left conflicted; pairs that took the convention side (B); rows with an axis run (C); and
the three acceptance fractions on all 33 documents. The quick-mode targets of Acceptance
apply unchanged, including 33 of 33 completed.

## Round 3: renumber, rebase and the four remaining failures

Added after round 2's review. Where this section disagrees with anything above, this
section wins.

### Renumber and rebase

While round 2 ran, another task merged into `main` under the number T024
([PR 27](https://github.com/huyangc/auto-canvas/pull/27), `f8f15fe`, folder
`tasks/T024-auto-layout-cascode-symmetry`). This task is therefore **T025**, its branch
`task/T025-auto-layout-symmetry`, its rules **R88, R89 and R94** (the rule numbered R90
in rounds 1–2 is R94; R90–R93 belong to the merged task). The base is `f8f15fe`. Opus
rebased the round-2 working tree onto it; Codex starts round 3 on that tree and never
rebases or switches branches itself. The frozen-path acceptance check compares against
`f8f15fe`, not `origin/main`.

What the merged T024 adds, and how R88/R89 interact with it:

- **R90 anchored common-gate pairs** (`recognize.ts`): cascode devices sharing a gate,
  stacked on a symmetric unit, become `matched-pair` movement units aligned by the
  anchor's sides. R88 already pairs them through their sources and drains; inside a
  block the R89 half layout decides their geometry, as for any group (R7 note).
- **R91 split tails**: two parallel tail devices with different gates form a
  `matched-pair` unit with `facing: "outward"`, centred on the pair axis one row toward
  the supply. Under R88 they are a partner pair (shared D and S, distinct G Nets), so
  they lie inside the block in the tail row; the block reproduces R91's placement. The
  merged tests in `test/recognition-cascode.test.ts` must pass unchanged.
- **R92 facing** (`RecognizedGroup.facing`, `facesOutward(g)` in `recognize.ts`):
  amendment D's first bullet becomes: a member of a recognized group follows R92,
  `facesOutward(g)` gives left `none` / right `horizontal`, otherwise left
  `horizontal` / right `none`. This is R7's convention plus the split-tail override.
- **R93 two-gate axis seats** (`place-markers.ts`): reads geometry only; no interaction.
  `place-markers.ts` and `recognize.ts` stay out of scope.

Baselines move to `f8f15fe`, kept in `tmp/t025/` (`base-quick.json`, `base-svg/`,
`base-search120.json`). A plain build of `f8f15fe` for paired timing is in
`tmp/t025/paired-base/` (a `git archive`, installed and built; its `tmp/human-cases`
links to the cases, and its `scripts/auto-layout-eval.mjs` imports this branch's
`packages/auto-layout/dist/symmetry.js` for the symmetry columns, so run `pnpm build`
here first). Run it with `pnpm auto-layout:eval tmp/human-cases --jobs 10` from that
directory; its report lands in its own `tmp/auto-layout-eval/report.json`. Copy evaluation reports to `tmp/t025/result-quick.json` and
`tmp/t025/result-search120.json`; rendered pairs go to `tmp/t025/pairs/`.

| Quick mode on `f8f15fe`, 33 of 33 completed        |           dev |           val |
| -------------------------------------------------- | ------------: | ------------: |
| Crossings                                          |           295 |           321 |
| Bends                                              |           401 |           391 |
| Floating pins                                      |             0 |             1 |
| Wire length                                        |       123,660 |       147,150 |
| Label overlaps / clearance / departures            |    0 / 40 / 7 |    0 / 31 / 5 |
| Search 120 s, seed 1: crossings / bends / floating | 235 / 354 / 0 | 288 / 386 / 1 |

**Quick-mode targets against `tmp/t025/base-quick.json`** (replacing the table in
Acceptance): completed 33 of 33; dev pairs mirrored ≥ 85% of the pairs in seeded
components, level ≥ 95%, axis devices on the axis ≥ 85%; dev crossings ≤ 310, bends
≤ 440, wire length ≤ 136,000, label overlaps / clearance / departures ≤ 1 / 44 / 10;
floating pins dev 0 / val ≤ 1, no document above its baseline; unsafe problems and
inequivalent documents 0; planning time ≤ 1.25 × a paired baseline run. Val is reported,
not a target. Search is reported against `base-search120.json`; floating pins must not
exceed the quick result's.

### K. Rails never pair devices (round-2 failure 1)

The PMOS-tail fixture's tail `t` and its mirror reference `r` were paired because both
have `S` on the supply and were each other's only candidate there. Rail connectivity is
not symmetry evidence: the self-Net device-pairing rule of R88 excludes rails. (Rails stay
hard self mappings for Net implications.) A tail whose gate Net is not mapped then stays
outside the block and keeps the existing R7 tail rules: in the layered strategy the
tail-alignment code already seats it (its unit moves whole); in `templatePlacement` an
outside unit that holds a block pair's `tailInstanceId` is seated by R7 on the block's
axis one row toward the supply, never by rule G ("beside the block"). Both
"moves a PMOS tail's entire mirror unit above its pair" tests pass unchanged. Report how
many dev devices round 2 paired through a rail.

### L. A pair must be consistent with itself (round-2 failure 2)

The stage-mirror fixture's recognized cross-coupled pair `b`/`e` maps one Net to two
different Nets from its own pins (`b.D ↔ e.D` and `b.G ↔ e.G` both involve `top2`). An
involution cannot do that. Restore the within-pair check that amendment A removed, with
defaults excluded: **a device pair whose own pins propose two different non-self partners
for one Net is invalid**, seed or not; its devices are conflicted. A true cross-coupled
pair (each gate on the other's drain) proposes `n1 ↔ n2` twice and stays. Conflicts
_between_ pairs remain Net conflicts under rule A and never invalidate device pairs. With
the fixture's pair rejected there is no seed and the stage behaves as on `main`; the test
passes unchanged. Add a detection test with both shapes.

### M. Axis-run spacing on the grid (round-2 failure 3)

Visible bounds are fractional, so an exact 40-unit visible gap with on-grid origins is
impossible. Rule C means what R33 means: **at least 40 units** between visible bounds,
origins snapped up to the grid, so a gap lies in `[40, 40 + grid)`. The run's pin-centre
midpoint lies within half a grid of the axis. Fix the two exact assertions in "centres a
run of axis devices" accordingly and say "at least 40" in R89. The round-2 layout itself
(gap 41.87) satisfies this.

### N. Detect once (round-2 failure 5, timing)

Detection runs in `placeDocument`, again in `templatePlacement` or `placeStages`, again
as `deviceRows`' default argument and again inside `symmetryRows` for the Net map, for
every strategy and candidate. Detect once per `placeDocument` call: `symmetryTopology`
runs there, and its components and Net map are passed to `templatePlacement`,
`placeStages`, `deviceRows` and `symmetryRows` (add parameters; no module-level cache).
`createMoveGenerator` keeps its single call. The evaluation script keeps its call.
Behaviour is unchanged; the determinism test and the "zero-budget search equals quick"
test cover it.

Measure paired time only when no other evaluator or test run is on the machine: check
`pgrep -fl 'auto-layout-eval|vitest'` shows nothing but your own processes before the
baseline run and before the result run, and record the one-minute load before and after
each. If another session's benchmark keeps running, wait for it, and say so in the
report; Opus remeasures before accepting if the ratio is within 0.1 of the ceiling.

### Report for round 3

As the Round 2 report, against the `f8f15fe` baselines, plus the rail-pairing count of K,
and the acceptance fractions on all 33 documents. The six rendered pairs compare
`tmp/t025/base-svg/` with the round-3 quick result.

## Round 4: consistent block order across rows

Added after the codex PR review of `7bdd199` (PR 29, round 2, P2; reproduced by Opus).
Everything above stands; this section adds one rule and one regression.

**Defect.** Two symmetric blocks joined through asymmetric devices (two copies of the
step-1 fixture linked by resistors from one block's drain Nets to the other's input
Nets) can be ordered differently in different rows by `orderRows`: block X left of
block Y in one row and right of it in another. `assignColumns` then registers each
block's rows as one alignment component through `align`, which rejects a merge that
would create an ordering cycle, so the block is silently split across components and
compaction moves its rows apart (`placeDocument(..., "layered")` completes with one
pair's midpoint hundreds of units from the block's other pairs). R89 says the block is
one rigid unit; the layered and stage strategies both use this path.

### O. Blocks keep one order in every row

In `orderRows`, blocks that share rows keep one left-to-right order in all of them.
After the initial tie sort, after every barycentre sweep of a row, and after the
adjacent-transposition pass, apply `orderBlocks(row)` the way `bundleTails` is applied:

- the canonical block order ranks blocks by the mean position of their nodes over all
  rows of the current order (ties by block id, `compareIds`);
- within a row, the block nodes are re-placed into the slots that block nodes occupy, in
  canonical order; non-block nodes stay where they are.

The crossing objective is evaluated on the consistent order, so `best` is always
consistent, and `assignColumns`' block alignment never meets a cycle. `orderRows` learns
which nodes belong to which block from `rows.blocks` (the half layout passes no blocks,
so nothing changes there). Do not add a second ordering algorithm: this is a constraint
applied inside the existing sweeps, like `bundleTails`.

### Tests

- Regression in `symmetry.test.ts`: two copies of the step-1 fixture with distinct ids,
  linked by two resistors (first block's `right` Net to the second block's `ina`, second
  block's `left` Net to the first block's `inb`), through `placeDocument` in all three
  strategies: no problem, and in every block every pair's midpoint
  `(x_left + x_right) / 2` equals the block's axis (the tail's `+` pin x); the two blocks
  do not overlap (`geometryProblem` undefined). Add the mirrored variant (second block's
  `right` to the first block's `ina`, plus a resistor between the two `ba`/`bb` bias Nets)
  as a second case. Both fail before the fix (Opus reproduced midpoints 90 vs 620 and
  90 vs 700 for the second block).
- Existing tests pass unchanged; `layered.test.ts` ordering tests in particular.

### Spec

R89: add "Blocks that share rows keep one left-to-right order in every row; `orderRows`
enforces it inside its sweeps."

### Report for round 4

Acceptance as before (lane 1, base `f8f15fe`, baselines in `tmp/t025/`). Quick and search
results on the 33 human drawings against `tmp/t025/review3/paired-result.json` and
`tmp/t025/review3/search120.json` (the accepted round-3 results): report every document
whose crossings, bends or symmetry counts change. No paired timing needed unless the
quick summed time changes by more than 10% against `tmp/t025/review3/paired-result.json`.
