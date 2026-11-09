# T022 — Auto-layout: role-aware substructure recognition and a recognition benchmark

- Branch: `task/T022-auto-layout-recognition`
- Base: `main` at `a188149` (rebased from `5a1af66` after round 1)
- Lane: 2. Every acceptance command runs with `ICM_E2E_PORT=4273`,
  `AUTO_CANVAS_E2E_API_PORT=4321` and
  `AUTO_CANVAS_TEST_DATABASE_URL=postgresql:///auto_canvas_test_2`. The database
  exists. No browser test is expected.
- Parallel task: T021 (`task/T021-auto-layout-readability`) runs at the same time.
- Status: approved

## Goal

Today `recognizeStructures` scans MOS pairs in id order, keeps the first match, and fixes
every group at two members. It loses mirror branches, ignores BJTs, mixes device
families, misses PMOS tails, and pairs unrelated switches that happen to share a source.

After this task:

- Recognition returns **structures**. Each structure has a kind, all of its members, and a
  role for every member. A device may hold roles in several structures.
- Placement uses **movement units**. These are chosen from the structures by explicit
  rules. They have the same shape the placers consume today, so placement behaviour only
  changes where recognition changed.
- A **recognition benchmark** reports per-kind precision, recall and exact member-and-role
  match. It runs on hand-built cases and on two external labeled datasets.

Rules stay deterministic. No sizes are used, no SAT, no learned model.

The user confirmed four decisions on 2026-11-08:

1. **Shared source Nets.** When three or more candidates share one source Net, there is
   no pair unless a mirror load spanning both drains identifies it. The three synthetic
   R32 tests get mirror loads.
2. **Multi-output mirrors.** The movement unit is the reference plus one partner; other
   outputs place freely. The persisted group lists every member.
3. **Families.** Descriptor ids must be equal, and model names too when both carry one.
   Sizes are never compared.
4. **Committed data.** Up to 6 small CircuitGenome cases may be committed with MIT
   attribution. LOADBench stays local.

## Context

Opus verified everything below on `5a1af66`. Paths are relative to
`packages/auto-layout/` unless they start at the repository root.

### 1. Today's recognizer

`src/recognize.ts:10-114` `recognizeStructures(document, roles)`:

- Takes all MOS, sorted by id. For each kind in the order `cross-coupled`,
  `differential-pair`, `current-mirror`, `matched-pair`, it scans pairs `(a, b)`.
- It compares only `mosBulkClass` (`:32-34`). So `nmos` and `depletion-nmos` pair up.
- It takes the first match and marks both members used (`:87-90`).
- Tails (`:73-86`): another MOS with D on the common source, or a `current-source` with
  `+` on it. With several candidates it takes the first by id.
- Stacked loads (`:94-112`): a non-pair group touching a pair's drains has its members
  reversed so that left and right follow the pair.
- Ids: `auto-<kind>-<lower member id>`. A cross-coupled pair is recorded as
  `matched-pair` (R68).

`persistedTemplates` (`:117-132`) rebuilds templates for persisted `layoutGroups`. It
recognizes the document without layout groups, then keeps inferred groups of the same
kind whose members all lie in the persisted group.

`RecognizedGroup` (`src/types.ts:27-33`) is
`{ id, kind, members: [string, string], diodeInstanceId?, tailInstanceId? }`. It is
exported from `src/index.ts` and returned in `AutoLayoutResult.groups`.

### 2. The four reproduced failures

Opus ran these on the built `5a1af66`:

| #   | Circuit                                                                  | Today's result                 |
| --- | ------------------------------------------------------------------------ | ------------------------------ |
| 1   | NMOS `r` with G=D, outputs `x` and `y` sharing G and S                   | `members: [r, x]`; `y` is lost |
| 2   | NPN `q1` (B=C) and `q2` sharing B and E                                  | nothing                        |
| 3   | `nmos` reference with G=D, `depletion-nmos` output                       | accepted as a mirror           |
| 4   | PMOS pair; `current-source` with `+` at VDD and `-` on the common source | no `tailInstanceId`            |

### 3. Consumers of recognized groups

Every consumer stays inside `packages/auto-layout`. None in `apps/` or other packages
imports `@icm/auto-layout`.

- `src/auto-layout.ts:261` recognizes groups for placement and emits them. `:365-374`
  emits one `set_layout_group` per group, with `objectIds: group.members`. `:440-443`
  recognizes again, without layout groups, for routing order.
- `src/route.ts:271-283` `signalPriority` reads `kind` and `members`. The router is
  frozen; this file must not change.
- `src/place.ts:138` merges groups with `persistedTemplates`. `:396-410` keeps each
  template (members and tail) rigid in collision repair.
- `src/template-placement.ts:83-161` `expandTemplates` and `:205-223` reads `members[0]`
  and `members[1]` as left and right, plus the tail. The `channel` helpers at `:22-36`
  and `:96-100` treat only MOS D/S as channel pins.
- `src/layered.ts:176-215` (group nodes, shared tails), `:427-511` (mirrors, R18 pitch,
  tail axis), `:599-606` and `:692-693` (shared tails). The `shared` helper at `:433-449`
  treats only MOS D/S, or both pins of a two-pin part, as channel pins.
- `src/stages.ts:129-134` joins each group's members and tail into one stage.
- `src/search-moves.ts:51-71` builds R66 units from groups, persisted templates, tails
  and R18 stacks.
- `src/place-fallback.ts:258-261` skips grouped members and tails in R21 orientation.

Since all of them use only `kind`, `members`, `diodeInstanceId` and `tailInstanceId`, a
movement unit that keeps the `RecognizedGroup` shape needs no change in these files. The
exceptions are the BJT channel pins (step 6) and one line in `auto-layout.ts`.

### 4. Device registry facts

`deviceDescriptor(symbolId)` (`packages/devices/src/registry.ts:41`) gives
`deviceClass`, with `mosBulkClass` for MOS. The built-in MOS descriptor ids are `nmos`,
`pmos`, `depletion-nmos`, `depletion-pmos`, `ndmos` and `pdmos`. The BJT ids are `npn`
and `pnp`. A BJT descriptor has no polarity field, so polarity comes from the
descriptor id. Pins: MOS `D G S B`, BJT `C B E`, current source `+ -`. The model
identity is `instance.netlist.binding`: `{kind: "model", name}` or
`{kind: "external-subcircuit", definitionId}`. `src/stages.ts:35-36` already conducts a
BJT through C/E. `src/layered.ts:57` gives levels only to MOS, sources and rail two-pin
parts.

### 5. Human corpus survey

Counts only, dev split, 18 documents (`tmp/t022/survey*.mjs`, git-ignored):

- **Devices:** 184 MOS (118 `nmos`, 66 `pmos`, no depletion or DMOS) and 5 PNP.
- **Recognized today:** 19 differential pairs, 7 mirrors, 6 matched pairs.
- **Mirror references:** 15 diode-connected references; 1 has two outputs.
- **Absent:** no mixed-family mirror, no model-name mismatch, no BJT mirror or pair, no
  resistor tail.
- **Fingers:** 1 parallel-finger group (2 devices).
- **Tails:** 2 pairs have a current source with `-` on the common source.
- **Shared source Nets:** 3 non-rail source Nets carry three or more same-symbol,
  non-diode MOS.
  - One document has two banks of decoder-driven current-steering switches: 4 and 5
    NMOS on one source Net. Today they become four id-ordered "differential pairs".
  - One case is a pair plus a gate driver, which R68 already handles.
- **Composites:** no pair has a simple mirror load spanning both drains. Two pairs have
  diode loads on both sides; each diode is the reference of a separate mirror.

So layout changes on the human corpus should be small. The benchmark is the main evidence.

### 6. Benchmark data (local, git-ignored)

Opus fetched both datasets into `tmp/recognition/` (see `tmp/recognition/README.md`).
The Codex sandbox has no network, so use only what is on disk.

**LOADBench**: `tmp/recognition/loadbench/<Archive>/<Topology>/`, 101 op-amp topologies,
CC BY 4.0, 5.8 MB.

- `example_run/CombinedTestBench.cir`: the first `.subckt <Topology> <ports>` block is the
  op-amp. It contains only
  - `X<name> d g s b sky130_fd_pr__{n,p}fet_01v8_lvt <params>` lines, and
  - `C`/`c` capacitor lines.

  Its ports include `sourceNmos` (ground) and `sourcePmos` (supply).

- `struct_recognition.xml`: nested `<structure name="Mosfet...[k]">` elements with
  `<pins>` and `<devices><device name="/m<name>"/>`.
  - `MosfetSimpleCurrentMirror`: pins `Input`, `Output`, `Source`. It holds a
    `MosfetDiodeArray` child (the reference) and a `MosfetNormalArray` child (the
    output).
  - `MosfetDifferentialPair`: pins `Input1`, `Input2`, `Output1`, `Output2`, `Source`.
    It holds two `MosfetNormalArray` children.
- Totals: 227 mirror references, 98 of them with two or more outputs, 101 differential
  pairs, and 19 pairs whose two outputs are the Input and Output nets of one simple
  mirror.

**CircuitGenome**: `tmp/recognition/circuitgenome/<topology>/circuit_NNNN_{flat,hier}.ckt`.
864 op-amps from CircuitGenome 0.3.0 (MIT).

- The flat file is one `.subckt` named `<ref>_<slot>`, for example `m1_input_pair` or
  `mnref_bias_gen`. Its rails are `vdd!` and `gnd!`. Its models are bare `nmos`/`pmos`.
- The hier file's top `.subckt` has one `X<slot> ... <variant>` line per slot.
- Variants seen:
  - `input_pair`: `differential_pair_{nmos,pmos}` (432),
    `differential_pair_*_degenerated` (432).
  - `load`: `active_load_{nmos,pmos}` (156) and others.
  - `tail_current`: `current_mirror_tail_*` (288), `resistor_tail_*` (288),
    `cascode_current_mirror_tail_*` (288).
- Module definitions: `tmp/t022/cg-venv/lib/python3.14/site-packages/circuitgenome/synthesizer/config/opamp_modules.yaml`.
  For example, `active_load_pmos` is `m1 in1 in1 vdd`, `m2 in2 in1 vdd`, so `in1` is the
  reference side.

### 7. SPICE import

`importSpiceSources([{ path, bytes }], entryPath)` (`packages/spice/src/importer.ts:1846`)
returns `{ successful, diagnostics, project }`. `bytes` is a `Uint8Array`. Instance ids
equal SPICE references (`M1` → id `M1`, symbol `nmos`, binding
`{kind: "model", name}`). Imported nets carry no names or power claims.

`classifyNets` therefore finds no rails unless the converter makes them explicit. Opus
checked this on a CircuitGenome file:

- map the ground rail to node `0`;
- add `Vsupply <supply net> 0 1.8`;
- add `.model nmos nmos level=1` and `.model pmos pmos level=1` (for LOADBench, name
  the models after the sky130 models).

With rails, today's recognizer finds that file's tail mirror and pair. It returns the
bias mirror as `[mn1, mnref]` and loses `mn7` (failure 1 on generated data). Without
rails, it reports false pairs on the ground Net.

### 8. Binding constraints

- **Human cases.** They are third-party drawings in git-ignored `tmp/human-cases/`.
  - Never commit any case, excerpt, case id or id-keyed data.
  - Nothing in CI or `pnpm test:local` may depend on them.
  - Tune on dev only (`sha256(id) % 3 != 0`). Report val separately.
- **Frozen code.** The router (`src/route.ts`), R10, R23 and `lostNameClaim` stay as they
  are. `packages/model`, `packages/edit-engine`, `packages/derived` and `apps/` do not
  change. `LayoutGroupSchema.kind` stays `differential-pair | current-mirror |
matched-pair | custom`.
- **T021 owns** these files; do not edit them:
  - `src/refine.ts` and `src/index.ts`;
  - `scripts/auto-layout-eval.mjs` and `scripts/auto-layout-review.mjs`;
  - its new files `seat-labels.ts`, `readability.ts`, `face-ports.ts`,
    `finalize-facing.ts` and `timing.ts`.

  Edit `src/auto-layout.ts` only as step 5 says. T021 numbers its new spec rules from
  R73; this task uses R80–R84.

- **Baselines** (T020, `tmp/t020-accept/`):
  - Quick: 647 crossings (dev 260, val 387), 703 bends, 63 floating pins, 32 of 33
    completed, largest width ratio 1.
  - `--search 120 --seed 1 --jobs 12`: 495 crossings (dev 181, val 314).
- **Without `search`**, planning stays deterministic.

## Scope

Owned paths (may be created, edited or deleted):

- `packages/auto-layout/src/recognize.ts`, `src/types.ts`, `src/net-roles.ts`
- `packages/auto-layout/src/template-placement.ts`, `src/layered.ts`: only the channel-pin
  helpers named in step 6
- `packages/auto-layout/src/auto-layout.ts`: only the `set_layout_group` block (step 5)
- new `packages/auto-layout/src/recognition-score.ts`
- `packages/auto-layout/test/**`
- new `scripts/auto-layout-recognition.mjs`; one `scripts` entry in the root
  `package.json`
- `docs/specs/auto-layout.md`

Out of scope (do not change):

- `src/route.ts`, `src/stages.ts`, `src/search-moves.ts`, `src/place.ts`,
  `src/place-fallback.ts` and every T021-owned file. If one of them needs a change,
  stop and report it.
- Level and row rules for BJTs (`src/layered.ts:57`, R30/R31).
- Energy weights, the router and the preference tool.
- Cascode, source-degenerated pairs, transmission gates and larger OTA blocks.
- Hierarchy-driven placement, a general VF2 matcher, and size-based checks.
- `pnpm-lock.yaml` and every package's dependencies. The script imports built
  `packages/*/dist` like `scripts/auto-layout-eval.mjs` does.

## Steps

Notation: for a MOS, D/G/S mean drain/gate/source. For a BJT, read C/B/E in their
place. `net(x, D)` is `roles.pinNet(x, "D")`. A **rail Net** has role `supply` or
`ground` in `roles.byNet`.

1. **Benchmark first, then the baseline.** Build the benchmark before changing the
   recognizer, so the old recognizer gets measured.

   - **`test/recognition-cases.json`.** An array of labeled cases. Each case has:
     - `id` and `source` (`"hand"` or `"circuitgenome"`);
     - `symbols`: `{instanceId: symbolId}`;
     - `nets`: `{netId: ["inst.pin", ...]}`, the format `circuit()` in
       `test/document-fixture.ts` takes;
     - optional `models`: `{instanceId: modelName}`, which becomes
       `netlist.binding = {kind: "model", deviceClass, name}`;
     - `expected`: an array of `{kind, members: {instanceId: role}}`;
     - optional `deferred`: instance ids;
     - optional `tailUnlabeled: true` on a differential-pair expectation.

     Extend `circuit()` for `models`.

   - **`src/recognition-score.ts`.** Export `scoreRecognition(cases)`, where each case
     carries its expected and predicted structures. It returns, per kind:
     - expected count, scored predicted count and matched count;
     - precision, recall and exact rate;
     - tail statistics: labeled, found correct, found wrong, missed and ambiguous.

     Scoring rules:
     - A prediction **matches** an expectation of the same kind when their instance sets
       are equal. It is **exact** when every instance's role is equal too.
     - Under `tailUnlabeled`, compare differential pairs without their tail.
     - A structure, expected or predicted, that contains a `deferred` instance is
       scored on neither side.
     - A kind is scored only for sources that label it. Report predictions of other
       kinds as counts.

   - **`scripts/auto-layout-recognition.mjs`.** Usage:
     `node scripts/auto-layout-recognition.mjs [--loadbench <dir>] [--circuitgenome <dir>] [--units] [--out <file>]`.
     It always scores the committed cases, then any dataset given. It prints one table
     per source and kind, and writes JSON with per-case mismatches to `--out`.
     - `--units` scores the movement units `recognizeStructures` returns, converted:
       - a mirror's `diodeInstanceId` is its `reference` and the other member its
         `output`;
       - a pair's members are `input` and its tail is `tail`;
       - matched pairs are not scored.

       Without `--units`, it scores `recognizeSubstructures` (step 4).

     - **LOADBench converter:**
       - Take the first `.subckt` of `CombinedTestBench.cir`.
       - Rewrite `X<name> d g s b <model> …` as `m<name> d g s b <model>`. Rewrite
         capacitor values as `1p`.
       - Map `sourceNmos` to `0`. Add `Vsupply sourcePmos 0 1.8` and
         `.model sky130_fd_pr__nfet_01v8_lvt nmos level=1` (and the pfet as `pmos`).
       - Mirrors: merge every `MosfetSimpleCurrentMirror` that shares a
         `MosfetDiodeArray` device set into one mirror. Its `reference` is the diode
         array's devices; its `output` is every normal array's devices.
       - Differential pairs: each `MosfetDifferentialPair` gives `input` to both normal
         arrays' devices, with `tailUnlabeled`.
       - Composite: a pair whose `Output1`/`Output2` nets equal a mirror's
         `Input`/`Output` nets.
       - Deferred: devices inside `MosfetCascodeCurrentMirror`,
         `MosfetWideSwingCascodeCurrentMirror`, `MosfetWilsonCurrentMirror`,
         `MosfetImprovedWilsonCurrentMirror`, `MosfetFoldedCascodeDifferentialPair`,
         `MosfetCascodedDifferentialPair` and `MosfetVoltageReference`.
       - Device `/mX` is instance `mX`.
     - **CircuitGenome converter:**
       - Take the flat body without `.subckt`/`.ends`. Map `gnd!` to `0`. Add
         `Vsupply vdd! 0 1.8` and the two models.
       - Read slot variants from the hier file.
       - Only these are labeled:
         - `input_pair = differential_pair_{nmos,pmos}`: a `differential-pair`, with
           `input` on `m1_input_pair` and `m2_input_pair`.
         - `tail_current = current_mirror_tail_*`:
           - a `current-mirror`: `reference` is `m1_tail_current`, and `output` is
             every same-type MOS in the circuit with the same gate and source Nets that
             is not diode-connected;
           - the device on the pair's source Net is its `tail`.
         - `tail_current = resistor_tail_*`: `r1_tail_current` is the pair's `tail`.
         - `load = active_load_{nmos,pmos}`:
           - a `current-mirror` from `m1_load` (`reference`), with outputs found as
             above;
           - the composite with the pair; the reference side is the input whose drain
             is `m1_load`'s drain.
       - Every device of any other slot or variant is `deferred`. Other `load` variants
         (resistor, current-source) are labeled with no structure, so predictions on
         them count.
     - Add the script to the root `package.json` as
       `"auto-layout:recognition": "node scripts/auto-layout-recognition.mjs"`.
   - **Hand-built cases.** Add at least these to `recognition-cases.json`:
     1. **The four failures from Context 2.** Expected:
        - (1) a mirror `{r: reference, x: output, y: output}`;
        - (2) a BJT mirror `{q1: reference, q2: output}`;
        - (3) no mirror;
        - (4) a pair `{a: input, b: input, t: tail}`.
     2. A `ndmos` reference with an `nmos` output: no mirror.
     3. The same symbol with two different `models`: no mirror.
     4. An NMOS pair whose current source has `-` on the common source and `+` to
        ground: a pair without a tail.
     5. An NMOS pair with two tail candidates: a pair without a tail (an ambiguous tail).
     6. A PMOS pair with a resistor from the common source to VDD: tail is the resistor.
     7. A BJT pair (NPN, common non-rail E, distinct B and C) with an NMOS tail: a pair
        with that tail.
     8. A diode-connected reference split into two fingers (identical nets and model)
        with one output:
        - one mirror, `reference` on both fingers;
        - no matched pair between the fingers.
     9. A 5T OTA (NMOS pair, PMOS mirror load, NMOS tail):
        - a pair, a mirror and a `differential-pair-mirror-load` composite;
        - correct sides: the pair input on the reference's drain is
          `input-reference-side`.
     10. The negative composite: the mirror reference is on one pair drain, its output
         drives another Net.
         - the pair and the mirror are recognized;
         - no composite.
     11. Four NMOS on one non-rail source Net, distinct gates and drains, no loads: no
         pair.
     12. The same four, where each two have their own simple mirror load:
         - two pairs and two composites, matched by load;
         - the shared tail is the tail of both.
     13. A drain-coupled latch (R68): `cross-coupled-pair`. A one-way driver pair: none.
   - **Up to 6 CircuitGenome cases**, converted to the same JSON by a `--emit-cases <file>`
     option on the script.
     - Cover these: an NMOS pair with `active_load_pmos`, a PMOS pair with
       `active_load_nmos`, a `current_mirror_tail_*`, a `resistor_tail_*`, and a fully
       differential circuit with `dda_cmfb`.
     - Keep the total under 20 KB.
     - Add `"provenance"` with the tool, its version, the command, and
       `MIT License, Copyright (c) 2026 Analog ML`.
   - **Baseline.** Before any recognizer change, run the script with `--units` on all
     three sources. Save `tmp/recognition/before-units.json`.

2. **R80 Logical branches and families.** In `src/net-roles.ts` (or a new
   `src/device-family.ts`), add these helpers:
   - `channelPins(symbolId)`: `{drain, gate, source}` names for MOS (`D/G/S`) and BJT
     (`C/B/E`), otherwise `undefined`;
   - `polarity(symbolId)`: `"n"` for an `nmos`-class MOS or `npn`, `"p"` for a
     `pmos`-class MOS or `pnp`;
   - `familyCompatible(a, b)`: the descriptor ids are equal, and the model identities
     are equal wherever both instances have one.

   So `depletion-*` and `*dmos` pair only with their own descriptor id. Sizes and
   parameters are never compared.

   In `recognize.ts`, group transistors into **branches**: the same descriptor id, the
   same model identity, and the same Net on every pin of the symbol (unconnected counts
   only when both are). The representative is the lowest id. Recognition runs on
   representatives. Every structure member lists all the instances of its branch.

3. **R5 rewrite: candidates by terminal and Net.**
   - **Current mirror.**
     - A reference is a branch with `net(D) = net(G)` and `net(D) ≠ net(S)`.
     - Its outputs are every compatible branch with the same G and S, where
       `net(D) ≠ net(G)` and `net(D) ≠ net(S)`.
     - At least one output is required. Roles are `reference` and `output`.
     - If two reference branches share one family, G and S, record an ambiguity and no
       mirror.
   - **Differential pair.** For every non-rail Net N:
     - The candidates are the compatible branches with `net(S) = N` that are neither
       diode-connected nor `net(D) = net(S)`.
     - Group the candidates by family. Within a group:
       1. Remove every **driver**: a candidate whose D or S Net is another candidate's
          gate Net. A cross-coupled pair is removed too (R68).
       2. If exactly two remain, with distinct G and distinct D, they form a pair with
          two `input` members.
       3. If three or more remain, pair only by composite evidence (step 4). Record the
          rest as an ambiguity.
   - **Tail of a pair on N.** Candidates, other than the pair's members:
     - a transistor of the pair's polarity with its drain (collector) on N;
     - a current source with `+` on N for an n pair, or `-` on N for a p pair, its
       other pin not on N;
     - a resistor with one pin on N and the other on a ground-role Net (n pair) or a
       supply-role Net (p pair).

     Count candidates by branch. Exactly one is the `tail`. Several give no tail and an
     ambiguity. None is a pair without a tail: a tail is supporting evidence, never
     necessary.

   - **Cross-coupled pair (R68).** Two compatible, non-diode branches whose gate Nets each
     hold the other's D or S. Roles are `member`, `member`. A branch with more than one
     such partner yields an ambiguity.
   - **Matched pair.** Keep the existing R5 rule:
     - both diode-connected or a shared G;
     - and a shared S or D.

     Apply it only to compatible branches that are in no mirror, pair or cross-coupled
     structure, in id order, as today. Roles are `member`, `member`.

4. **R82 First composite: differential pair plus mirror load.** A pair (inputs A, B) and
   a mirror form a `differential-pair-mirror-load` composite when:
   - the mirror's reference drain Net equals `net(A, D)`;
   - one of its outputs `O` has `net(O, D) = net(B, D)`;
   - `net(A, D) ≠ net(B, D)`.

   Roles: `input-reference-side` (A), `input-output-side` (B), `load-reference`,
   `load-output` (O), and `tail` when the pair has one. A load touching only one side
   is not a composite.

   For a source Net with three or more remaining candidates (step 3), two candidates
   form a pair exactly when they are the A and B of one composite with one mirror.
   A candidate fitting two composites stays unpaired and becomes an ambiguity.

   Export `recognizeSubstructures(document, roles)`. It returns
   `{ structures: Structure[], ambiguities: Ambiguity[] }` and ignores
   `document.layoutGroups`.
   - Define `Structure`, `StructureMember` (`{ role, instanceIds }`, one per branch)
     and `Ambiguity` (`{ kind, netId?, instanceIds }`) in `src/types.ts`.
   - Sort the output canonically: by kind, then by the lowest instance id; members by
     role, then by lowest id.

5. **R83 Movement units and persisted groups.** Rebuild `recognizeStructures(document,
roles)` on top of `recognizeSubstructures`. It keeps its signature and returns
   `RecognizedGroup[]`. Choose units in the order cross-coupled, differential pair,
   mirror, matched:
   - **Members.** A unit's `members` are two representatives in ascending id, as today.
     The existing stacked-load reversal (`recognize.ts:94-112`) is kept unchanged.
   - **Skipping.** A unit is skipped when either member is already a member of an
     earlier unit, or lies in an existing `document.layoutGroups` entry (today's
     suppression).
   - **Tail.** `tailInstanceId` is the tail branch's representative. Tails may overlap
     other units, as today.
   - **Mirror partner.** The output of a composite whose pair is already a unit;
     otherwise the output representative with the lowest id.
   - **Mirror reference.** `diodeInstanceId` is the reference representative.
   - **Kind.** A cross-coupled pair is a `matched-pair` unit (R68).
   - **Extra members.** Add `extraMemberIds?: string[]` to `RecognizedGroup`. It holds
     the structure's other instances: other outputs, their fingers and the members'
     fingers. Drop any already in a layout group; leave out the tail; sort ascending.
     Omit the field when it is empty, so existing `toEqual` expectations hold. These
     devices are placed freely, as today.
   - **Ids** stay `auto-<kind>-<lower member id>`.

   In `src/auto-layout.ts`, change only `objectIds: group.members` (`:371`) to
   `objectIds: [...group.members, ...(group.extraMemberIds ?? [])]`.

   `persistedTemplates` keeps its logic. The routing call at `auto-layout.ts:440` keeps
   using `recognizeStructures`.

6. **BJT channel pins in templates.** Use `channelPins` in:
   - the `channels` helper in `src/template-placement.ts:22-36`;
   - `channel` in `expandTemplates` (`:96-100`);
   - `shared` in `src/layered.ts:433-449`.

   A BJT template then aligns on C/E as a MOS does on D/S. Do not change BJT levels or
   rows.

7. **Tests.**
   - `test/recognition-bench.test.ts` loads `recognition-cases.json`. Every case must
     have exact structures. For every hand-built case, three seeded rename-and-shuffle
     runs must give the same structures after mapping back:
     - a bijective rename of instance ids that changes their order;
     - shuffled instance, net and terminal order.

     Score all committed cases. Require precision = recall = exact = 1 on `hand`.

   - Keep `test/recognize.test.ts` expectations where the rules agree. For each test
     whose expectation changes, write the reason in the report.
     `assigns differential pairs before shared-gate matched candidates` is expected to
     change, because `a` and `c` now share a gate on one source Net.
   - Three tests rely on four id-paired MOS on one source Net:
     - `test/layered.test.ts:95`;
     - `test/layered.test.ts:389`;
     - `test/routing.test.ts:213`.

     Under step 3 these are ambiguous. Give each pair its own simple mirror load (case 12
     shape) so the composite evidence creates the same two pairs and shared tail. Keep
     every geometric assertion. If an assertion no longer holds, report it rather than
     changing it.

   - Add placement tests:
     - in `template` and `layered`, a BJT mirror's two members share y and mirror
       about one axis;
     - a multi-output mirror's persisted `set_layout_group` lists all three members,
       and its unit has two members;
     - the 5T OTA's load unit follows the pair's drains.
   - All existing corpus, held-out, quality, search and attachment tests must pass
     unchanged.

8. **Spec.** In `docs/specs/auto-layout.md`:
   - rewrite R5 as step 3;
   - amend R68 for branches and families;
   - add R80 (branches and families), R81 (tails), R82 (composite), R83 (movement units
     and persisted groups), and R84 (the recognition benchmark: case format, scoring,
     deferred rule, the two converters, and the script's usage).

   State the family rule for depletion and DMOS explicitly.

9. **Report.**
   - **Recognition.** For each source (hand, committed CircuitGenome, all of
     `tmp/recognition/circuitgenome`, `tmp/recognition/loadbench`) and each kind:
     - before (`--units` at the base) and after;
     - after with `--units`;
     - with and without units, so the reader sees what layout consumes.

     Include tail statistics and the five most common mismatch shapes per source, as
     counts.

   - **Layout.** Quick mode and `--search 120 --seed 1 --jobs 12` against
     `tmp/t020-accept/quick.json` and `search120.json`:
     - crossings for dev and val;
     - bends, floating pins and completed count;
     - total wire length and the largest width ratio.
   - **Counts per rule** on dev and val, counts only:
     - movement units changed, added or removed against T020;
     - pairs dropped as ambiguous;
     - tails gained or lost;
     - BJT units, family rejections and finger branches.
   - **Effect per document** of the ambiguous-source rule in quick mode, for every
     affected document, using anonymous labels.
   - Report the family rule chosen for depletion and DMOS.

### Round 2 amendment

Added after round 1's review (see `review.md`) and approved by the user on 2026-11-08. Keep everything round 1 built, except
what the review's must-fix findings change.

- **A0 Base.** Opus rebased the branch onto `main` at `a188149`, where T021 has merged.
  The plan commit is now `37bb4f7`. T021 added
  - R73 label seating (`src/seat-labels.ts`);
  - R74 readability terms in `routedScore` (`src/refine.ts`, `src/readability.ts`);
  - port facing (`src/face-ports.ts`, `src/finalize-facing.ts`).

  Those files stay out of scope.

- **A1 Tail direction.** A tail sits one row toward its supply side: below an n pair,
  above a p pair. Polarity comes from `polarity()` on the pair members.
  - **Code that may change:** the tail blocks of `src/template-placement.ts`
    `expandTemplates`, and the tail-row code in `src/layered.ts` (`:207-220` and the other
    tail sites the review lists). The rest of those files stays in its round-1 scope.
  - **Spec:** state the rule in R7 and R81.
- **A2 Persisted mirror partners.**
  - `persistedTemplates` rebuilds each persisted group's unit from the recognized
    structures, sharing the unit-building code with `recognizeStructures`.
  - The assertion and comment at `test/search.test.ts:371` may change to `[["a", "c"]]`.
    Nothing else in that file may change.
- **A3 Baselines.** Layout targets now compare against T021 on `a188149`:
  - **Quick, measured by Opus:** `tmp/t022/t021-quick.json`. On the 32 documents T021
    completes, it has 650 crossings (dev 263, val 387), 702 bends, 63 floating pins,
    219,860 wire length, 3 label overlaps, 59 label clearance and 13 terminal departures.
  - **Search:** `tmp/t022/t021-search120.json`, measured by Opus with
    `--search 120 --seed 1 --jobs 12`.

  Compare on the documents both runs complete. Report the newly completed document
  separately. The quick targets become:

  | Measure, 32 common documents                         | Required                        |
  | ---------------------------------------------------- | ------------------------------- |
  | Crossings, dev and val                               | each not above T021 (263 / 387) |
  | Bends, floating pins                                 | not above 702 / 63              |
  | Label overlaps, label clearance, terminal departures | report; explain any rise        |
  | Completed documents                                  | not fewer than 32               |
  | Width ratio                                          | no document above 1.5           |

  Report search on common documents against `t021-search120.json`. Search depends on
  wall-clock time, so run it with nothing else heavy running.

  Use the baseline file in every place the steps and the acceptance list name
  `tmp/t020-accept/` or `tmp/auto-layout-eval/baseline.json`:
  - `tmp/t022/t021-quick.json` for quick mode;
  - `tmp/t022/t021-search120.json` for search.

  The frozen-file `git diff --stat origin/main …` check now compares against
  `a188149`, so it must be empty again.

- **A4 Report.** Report quick mode with each round-2 fix alone (A1 tail direction, A2
  persisted partners) and together. Also report the four recognition sources again,
  with the corrected scorer.

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
pnpm deadcode 2>&1 | grep -E 'auto-layout|auto-layout-recognition'   # expected: no output
pnpm build                                           # expected: exit 0
pnpm auto-layout:review                              # expected: exit 0
pnpm auto-layout:recognition --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/after.json          # expected: exit 0
pnpm auto-layout:recognition --units --loadbench tmp/recognition/loadbench --circuitgenome tmp/recognition/circuitgenome --out tmp/recognition/after-units.json  # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --baseline tmp/auto-layout-eval/baseline.json   # expected: exit 0
pnpm auto-layout:eval tmp/human-cases --search 120 --seed 1 --jobs 12                 # expected: exit 0
git status --short packages/edit-engine packages/model packages/derived packages/project-protocol packages/spice apps fixtures   # expected: empty
git diff --stat origin/main -- packages/auto-layout/src/route.ts packages/auto-layout/src/refine.ts packages/auto-layout/src/index.ts packages/auto-layout/src/stages.ts packages/auto-layout/src/search-moves.ts packages/auto-layout/src/place.ts packages/auto-layout/src/place-fallback.ts scripts/auto-layout-eval.mjs scripts/auto-layout-review.mjs pnpm-lock.yaml   # expected: empty
git ls-files | grep -E 'human-cases|auto-layout-eval/|tmp/'   # expected: no output
```

**Recognition targets:**

| Measure                                        | Required                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Hand-built cases                               | precision, recall and exact = 1 for every kind; rename and shuffle invariant |
| LOADBench and CircuitGenome, every scored kind | precision and recall not below the `--units` baseline                        |
| A structure found exactly by the baseline      | still found exactly, or listed in the report with the reason                 |

**Layout targets**, quick mode, against T020's quick result:

| Measure                      | Required                                |
| ---------------------------- | --------------------------------------- |
| Crossings, dev and val       | each not above its baseline (260 / 387) |
| Completed documents          | not fewer than 32                       |
| Bends, floating pins         | not above 703 / 63                      |
| Total wire length            | report; explain any rise above 5%       |
| Width ratio against baseline | no document above 1.5                   |

- **Corpus and held-out.** Corpus targets and held-out ceilings must hold in quick mode.
- **Search.** With `--search 120`, report against 495 crossings.
- **Correct rules that cost crossings.** Report them per document instead of dropping
  them, and say so plainly; Opus decides. This applies especially to the
  ambiguous-source rule.

## Notes for the implementer

- **Recognition is pure.** It never depends on placement or on layout groups.
  Movement-unit choice is the only place where persisted groups, priority and ids
  matter.
- **Never break ties by instance id inside recognition.** Ties are either structurally
  resolved or recorded as ambiguities. Id order is allowed only where step 5 says.
- **Keep files small and local.** Recognition goes in `recognize.ts`; scoring in
  `recognition-score.ts`; dataset parsing only in the script. Regex parsing of the
  LOADBench XML is fine; add no dependency.
- **The datasets stay in `tmp/`.** Commit no LOADBench file or excerpt; aggregate
  metrics in the report are fine. Per-case mismatch lists stay in `tmp/recognition/`.
  The committed CircuitGenome cases carry their provenance.
- **Report T021-file blockers.** If a needed change falls in a T021-owned file, stop and
  report it. T021 is expected to merge first; Opus will rebase and rerun acceptance.
