# T129 — Rail symbols in netlist mode

- Branch: `task/T129-netlist-rail-symbols` (stacked on T128, PR 86)
- Base: `task/T128-netlist-input-eval` at `10bbcf0`
- Status: approved (owner decisions 2026-11-17: add netlist-only input beside
  the drawing-input path; without node 0 a Net named like ground may be drawn
  with ground symbols)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

With the new option `presentation: "netlist"`, automatic layout decides the
rail symbols a netlist does not carry: each grounded device gets a ground
symbol at its pin, and a supply Cell terminal is drawn as a supply symbol. On
netlist input the rail wire then approaches what the planner reaches on a
drawing (82k against 156k–159k today on 507 paired cases), and crossings with
rails fall (15 against 63–94). Without the option nothing changes: every
drawing-input plan stays byte-equal.

## Context

- Measured by T128 (`docs/testing/readability.md`, "Netlist input";
  `scripts/netlist-input.mjs`, `scripts/netlist-input-compare.mjs`). Base
  reports are staged: `tmp/inputs/base-drawing-report.json`,
  `base-netlist-vss-report.json`, `base-netlist-global-report.json`.
- Why rails cost so much on netlist input: the import creates no ground or
  supply marker instances. Ground is one Base Net holding every grounded pin
  (node 0 with a `global-declaration` ground claim in the `global` form; a
  `port` Cell terminal named `VSS` with only a `net-name-hint` in the `vss`
  form: `packages/spice/src/importer.ts:1039-1040, 1118-1145, 1235-1272`), so
  routing joins all of them by one trunk (R43). In a drawing each ground
  marker sits on its own piece of the Net and the pieces join by name; the
  planner seats each marker at its pin (R6a hosts with T127's extra hosts,
  `pin-contacts.ts` `assignRailHosts`; stubs R12) and reaches the human's
  rail wire.
- Human drawings (564 with a ground Net): 1174 ground markers for 1250
  grounded devices; 94% of marker pieces hold exactly one device pin; "one
  marker per grounded device" equals the human marker count in 82% of
  drawings and is within one in 90%. Supplies: 89% of supply Nets are one
  connected piece; 177 of 213 with a marker have exactly one.
- The data model: ground is a `ground` instance on pin `0` plus a `name-claim`
  owned by that `power-marker` (scope `global`, name `0`, `powerDomain:
"ground"`; `docs/specs/schematic-model.md:73-77`). A drawn supply is a
  `vdd-port` that is the interface instance of a Cell terminal
  (`schematic-model.md:56-66`); Cell terminals are never dropped.
- The planner already adds marker instances in R155
  (`packages/auto-layout/src/local-rail-markers.ts`,
  `local-rail-candidate.ts:205-240` for the edit shapes that split a rail
  piece off and give it a marker of the same name; `rail-marker-identity.ts`).
  It runs after placement and needs an existing marker or power claim, so it
  never fires on netlist input.
- `set_instance_symbol` exists (`packages/edit-engine/src/transaction.ts:398`);
  R2 forbids the planner from deleting instances.
- Instance-count thresholds (`auto-layout.ts:157, 179, 219, 395-489, 1021`;
  `geometry.ts:48-50`) count every instance, markers included: added markers
  can move a document across 24 or 40.
- Product rule this task makes an exception to, for netlist mode only: power
  domain comes from authored evidence, not from spelling
  (`docs/specs/connectivity-and-routing.md:205-213`). The planner's own R4
  name patterns (`net-roles.ts:8-10`) already treat such Nets as rails.

## Scope

Owned paths:

- `packages/auto-layout/src/types.ts` (`AutoLayoutOptions.presentation`),
  `auto-layout.ts` (the call in `planAutoLayout` only),
  `netlist-presentation.ts` (new)
- `packages/auto-layout/src/net-roles.ts`: only to export what the new module
  needs
- `packages/auto-layout/test/netlist-presentation.test.ts` (new, synthetic
  fixtures)
- `scripts/auto-layout-eval.mjs`: a `--presentation netlist` passthrough
- `docs/specs/auto-layout.md` (a new rule for the pre-pass; R4/R6a/R43
  cross-references), `docs/testing/readability.md` (the command)

Out of scope: the importer and exporter; hidden supply and control pins
(T130); labels for named Nets (T131); pin contacts; display names; any change
of behaviour when the option is absent; R155's own conditions.

## Steps

1. Investigate and report before writing the pre-pass (probe scripts under
   `tmp/`, on 10 converted cases of each form):
   - Which edits turn the single ground Base Net of an imported document into
     per-device pieces each ending in a `ground` marker, such that the
     Logical Net, `equivalentTerminals`, the electrical graph and the
     re-exported netlist text are all unchanged? Start from R155's edit
     shapes. Do this for a ground Net with a node-0 claim (`global` form) and
     for a ground Net that is only a Cell terminal named `VSS`/`GND` (`vss`
     form): there the `port` stays as the terminal's interface instance, and
     the markers must not rename the Net (what name and scope must their
     claim carry; does the exporter accept it — see `GROUND_NAME_MISMATCH` in
     `packages/netlist`). If no marker representation keeps the `vss` form's
     export text unchanged, say so and implement the node-0 case only.
   - Does `set_instance_symbol` from `port` to `vdd-port` on a supply
     terminal's interface instance keep `netlist.terminals`, MOS bulk
     defaults (`packages/derived/src/mos-bulk.ts:235-258`) and the export text
     unchanged?
   - How many converted cases cross the 24- or 40-instance thresholds when
     markers are added.
2. `netlist-presentation.ts`: from the document alone (no geometry) build the
   presentation edits.
   - Ground Nets: the Nets with a ground claim; when the document has no
     ground claim at all, the Nets R4 classifies as ground by name.
   - For each such Net without a ground marker: one `ground` marker per
     device that has a grounded visible pin R6a can host (a MOS source/drain,
     a two-pin part's pin, or a T127 extra host), on its own piece of the
     Net, named as step 1 found. Pins R6a cannot host (MOS gates, pins leaving
     away from the rail) stay together on the remaining piece, joined as
     today.
   - Supply: a Cell terminal whose interface instance is a `port` and whose
     Net R4 classifies as supply gets the `vdd-port` symbol. One symbol per
     terminal; no copies.
   - Idempotent: a rail that already has a power symbol is left alone.
   - Gate: replay the edits; unless `equivalentTerminals` holds, the
     electrical graph compares equal and the re-export text is unchanged (use
     what the package can check itself; the rest is checked by the evaluation
     in step 5), drop the presentation edits for that document and add a
     warning diagnostic. Skip, with a warning, documents over the R3 limit.
3. `planAutoLayout`: when `options.presentation === "netlist"`, replay the
   presentation edits, plan the replayed document with the existing pipeline
   unchanged, and return presentation edits followed by the plan's edits (one
   transaction; check the edit limit). Otherwise the new code is not entered.
4. Tests (synthetic): node-0 ground with three grounded devices gets three
   markers and the result is equivalent; a `VSS`-named terminal without node 0
   gets ground symbols and keeps its port; with node 0 present a Net named
   `VSS` gets none; a supply terminal becomes a `vdd-port`; a rail that
   already has a marker is untouched; a MOS gate on ground stays on the
   remaining piece; the gate drops the edits when equivalence would fail;
   without the option the plan equals today's.
5. Corpus: drawing mode against the base report; both netlist forms with
   `--presentation netlist` against the base netlist reports, compared with
   `scripts/netlist-input-compare.mjs`.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run packages/auto-layout scripts/netlist-input.test.mjs scripts/netlist-input-compare.test.mjs   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6 --baseline tmp/inputs/base-drawing-report.json   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form vss --jobs 6
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 6
node scripts/auto-layout-eval.mjs tmp/netlist-input/vss --reference tmp/inputs/le10-input --presentation netlist --out tmp/auto-layout-eval/netlist-vss --jobs 6
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --presentation netlist --out tmp/auto-layout-eval/netlist-global --jobs 6
```

- Drawing mode: every case equal to the base report (plan hash and every
  stored result field); the same 16 refused.
- Netlist mode, each form, against its base report: no case `threw`; every
  completed case equivalent against its input; no introduced dangling wire,
  unconnected pin or touching pin; cases with floating pins not higher;
  the number of documents where the gate dropped the presentation edits,
  with reasons.
- Rail wire, crossings involving a rail and bends on rail Nets fall; total
  crossings and total bends are not higher. Report the paired table (human,
  drawing input, base netlist, this task) for both forms, the count of ground
  and supply symbols drawn against the human's, the cases that got worse on
  bends or crossings with the reason for the largest five, and planning time.
- Render ORIGINAL | base netlist result | this task for the first 12
  non-sealed changed cases by sha256 of id in each form and look at them.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`, and runs a blind
  review of changed cases; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Never render, study or
name the ids under `sealed` in `tmp/inputs/sample.json`. The machine is
shared: at most 6 worker processes; iterate on a 40-case sub-corpus and run
each full run once.
