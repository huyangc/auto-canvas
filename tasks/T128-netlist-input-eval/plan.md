# T128 — Netlist-input evaluation in the repository's tooling

- Branch: `task/T128-netlist-input-eval`
- Base: `main` at `fb61255`
- Status: approved (owner decision 2026-11-17: automatic layout must also work
  from the netlist alone; the drawing-input path stays as it is. This task
  adds measurement only.)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

Anyone can measure the planner on netlist-only input with documented commands,
reproducibly, next to the existing drawing-input evaluation: every corpus
drawing is exported with the product exporter, re-imported with the product
importer and the editor's post-import step, planned with `planAutoLayout`, and
compared against the human drawing and against the drawing-input result.
Equivalence and visible integrity are checked against the netlist-input
document. No planner behaviour changes in this task; it is the yardstick for
the netlist-mode tasks that follow (rail symbols, hidden supply pins, names).

## Context

- Baseline experiment (not in the repository), staged at
  `tmp/inputs/pt-netlist/`: `results.txt`, `to-netlist-input.mjs`,
  `run-planner.mjs`, `compare.mjs`, `common.mjs`, `bundle-display.mjs`. Copy
  its logic, not its hard-coded paths. Its numbers (VSS form, planner at
  `c26e267` + T127): 515 converted / 104 export-blocked / 9 import-failed of
  628; electrical-graph verdict equal 447, different 42, uncheckable 26;
  re-export identical 295, same cards 207, differs 11, blocked 2; planner 515
  completed, 515 equivalent, 96 cases with floating pins.
- Product path:
  - Export: `createDesignNetlistExport` (`packages/netlist/src/export.ts:212`).
    The default `groundPin: "pin"` (:232) prints the top Cell as a `.subckt`
    with a ground pin `VSS` (`extract-cell.ts:176-200`,
    `extract-ground-pin.ts:11`); `groundPin: "global"` keeps node `0`
    (`extract.ts:195-245`).
  - Import: `importSpiceSources` (`packages/spice/src/importer.ts:1811-1856`).
    Node `0` becomes a `global-declaration` claim with `powerDomain:
"ground"` (:1235-1258); other names become `net-name-hint`s (:1259-1272);
    one `port` per subcircuit terminal (:1118-1145); shelf placement
    (:769-829, :1165); no Routes (:1322-1323). A hidden supply passed at
    ground stays unbound (:159-171).
  - Editor step: `apps/editor/src/features/editor-shell/editor-file-commands.ts:336-373`
    calls `prepareImportSources`
    (`apps/editor/src/features/netlist-export/convert-import-sources.ts:37-52`)
    and `withImportedInstanceDisplays`
    (`apps/editor/src/features/instance-display/imported-instance-displays.ts:7-20`).
    They live in the app, not in a package: bundle them the way
    `scripts/lib/headless-bundle.mjs:25-50` bundles the headless workspace,
    keeping `@icm/*` external so the built `packages/*/dist` is the code the
    evaluation imports.
  - So the two forms differ in what the planner can know: in the VSS form
    ground has no electrical evidence (only R4's name patterns make it a rail,
    `packages/auto-layout/src/net-roles.ts:8-10, 131-140`); in the global form
    it has a ground claim.
- Evaluation: `scripts/auto-layout-eval.mjs`.
  - Every flag must be in the allowed list (:97-127) or the script throws.
  - `netBreakdown` (:225-292) has `wireLengthByNetKind` and
    `crossingsByKindPair`. Do not add keys inside an existing stored result
    key: `baselineEqual` (near :627-640) compares every stored `result` key of
    the baseline. A new top-level result key is safe.
  - Human metrics, symmetry components/stages and the integrity baseline are
    all taken from the input document today (near :421-423, :520-535,
    :600-604); the partition oracle near :446-470; `railMarkers` near
    :683-712; `.meta.json` files are skipped (near :776); exit criteria near
    :1222-1249.
- Device ids differ between a drawing and its netlist-input document; file ids
  are the same, so pair cases by file id only.
- Corpus: `tmp/inputs/le10-input` (628 cases, untracked). Drawing-mode
  baseline report of `main` at `fb61255`: `tmp/inputs/main-fb61255-report.json`.
  Never render, study or name the ids under `sealed` in
  `tmp/inputs/sample.json`; aggregates over them are fine.

## Scope

Owned paths:

- `scripts/netlist-input.mjs` (new): conversion
- `scripts/lib/import-display-bundle.mjs` (new): builds the editor's import
  step into `tmp/netlist-input/.bundle/`
- `scripts/netlist-input-compare.mjs` (new): paired comparison
- `scripts/netlist-input.test.mjs`, `scripts/netlist-input-compare.test.mjs`
  (new)
- `scripts/auto-layout-eval.mjs`: a `--reference <folder>` flag, an
  `--out <dir>` flag and one new result key
- `docs/testing/readability.md`: a "Netlist input" section

Out of scope: everything under `packages/` and `apps/` (no planner, importer,
exporter or editor change, not even to export a function); scoring weights;
the drawing-mode default output folder and exit criteria; any acceptability
score derived from bends or crossings (acceptance is judged by blind review,
not by a proxy).

## Steps

1. `scripts/lib/import-display-bundle.mjs`: `bundleImportDisplay()` builds
   `withImportedInstanceDisplays` and `prepareImportSources` into one ESM file
   under `tmp/netlist-input/.bundle/` (`@icm/*` external, resolved to
   `packages/<name>/dist/index.js`) and returns its path; rebuild when a source
   file is newer than the bundle.
2. `scripts/netlist-input.mjs <corpus> --form vss|global [--out <dir>]
[--jobs n]`, default output `tmp/netlist-input/<form>`. For each `<id>.json`
   (not `.meta.json`), top Document only: export with
   `createDesignNetlistExport(project, { format: "spice", groundPin: form ===
"vss" ? "pin" : "global" })`; import as the editor does; apply
   `withImportedInstanceDisplays`; write `<id>.json` (the netlist-input
   project) and `<id>.sp`; always write `<id>.meta.json` with the stage
   (converted, export-blocked, import-failed, threw), error codes and first
   message, re-export verdict (identical, same-cards, differs, blocked),
   electrical-graph verdict (source against import), pins netted in the import
   but not in the source (by device name and pin), new and lost Cell terminal
   names, and presentation counts for source and import (ground and supply
   markers, ports, Net labels, power labels, label-joined Nets, pin contacts,
   rails, hidden pins made explicit, whether ground has a ground claim). Print
   a coverage summary. Output is byte-identical across runs and job counts
   (sorted order, no timestamps).
3. `scripts/auto-layout-eval.mjs`:
   - `--reference <folder>`: for each input `<id>.json`, `<folder>/<id>.json`
     is the human reference. `human` metrics, and the symmetry components and
     stages they need, come from the reference Document. Equivalence,
     `integrity` and the quick run stay against the input Document; the
     integrity baseline is `visibleIntegrity(input)`, never the reference.
     The partition oracle is unavailable (the existing unavailable path), so
     no block or arrangement metrics. `railMarkers` stays on the input and
     adds the reference's counts per rail role. Store
     `measurement.reference = { folder, id }` and the conversion meta
     (`<input>/<id>.meta.json`) as `measurement.conversion`.
   - `--out <dir>` overrides the output folder.
   - New result key `netKindDetail`: bends per Net kind (rail, port, signal;
     the kind rule of `netBreakdown`), crossings involving a rail Net, and
     presentation counts of the result (ground and supply symbols, ports, Net
     labels, power labels). Computed in every run, drawing mode included.
   - Exit criteria unchanged in both modes.
4. `scripts/netlist-input-compare.mjs <netlist-report> <drawing-report>`:
   writes `compare.json` beside the netlist report and prints, each split dev
   and val: coverage by stage and code; planner status, equivalence, floating
   and missing pins, warning codes; the paired table human / drawing input /
   netlist input for crossings, bends, wire, area, aspect and long-narrow
   (aspect ≥ 2, and ≥ 2 with ≥ 1.5 × the human's), with better/equal/worse
   counts; wire, bends and crossings by Net kind and crossings involving a
   rail; symmetry and signal-direction totals; the breakdown by conversion
   meta (more than one ground marker, supply marker, label-joined Nets, hidden
   pins made explicit, contacts, none of these). Label overlap, clearance and
   ownership, drafting, `railMarkers`, `sourceDefects` and refusal status are
   listed as not comparable, with the reason.
5. Tests with synthetic fixtures built in the test (as
   `scripts/visible-integrity.test.mjs` does). A drawn NMOS + resistor +
   ground marker + `vdd-port` Cell terminal: the VSS form gives a `VSS` `port`
   and no ground claim; the global form gives a ground claim and no `VSS`
   port; meta verdicts equal/identical; two runs give identical bytes; a
   drawing the exporter blocks gives a meta with `export-blocked`. Compare
   script: pairing by id, totals, aspect and long-narrow, dev/val split on two
   small fake reports.
6. Corpus runs (once each, after iterating on a 30-case sub-corpus copied to a
   scratch folder under `tmp/`): conversion of both forms; evaluation of both
   forms with `--reference tmp/inputs/le10-input`; comparison against the
   drawing-mode report.
7. Doc: `docs/testing/readability.md`, "Netlist input": the two forms and why
   both are reported (VSS is what the product's own design export gives back;
   node 0 is what a deck states), the commands, the metric set, the
   not-comparable list.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check   # all 0
pnpm vitest run scripts/netlist-input.test.mjs scripts/netlist-input-compare.test.mjs scripts/visible-integrity.test.mjs   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6 --baseline tmp/inputs/main-fb61255-report.json   # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form vss --jobs 6      # exits 0
node scripts/netlist-input.mjs tmp/inputs/le10-input --form global --jobs 6   # exits 0
node scripts/auto-layout-eval.mjs tmp/netlist-input/vss --reference tmp/inputs/le10-input --out tmp/auto-layout-eval/netlist-vss --jobs 6
node scripts/auto-layout-eval.mjs tmp/netlist-input/global --reference tmp/inputs/le10-input --out tmp/auto-layout-eval/netlist-global --jobs 6
node scripts/netlist-input-compare.mjs tmp/auto-layout-eval/netlist-vss/report.json tmp/inputs/main-fb61255-report.json
node scripts/netlist-input-compare.mjs tmp/auto-layout-eval/netlist-global/report.json tmp/inputs/main-fb61255-report.json
```

- Drawing mode: every case equal to the baseline (plan hash and every stored
  result field), the same 16 refused, exit 0.
- VSS-form conversion reproduces the conversion numbers in Context exactly; a
  second run is byte-identical (compare a checksum list).
- Netlist evaluations: no case `threw`; every completed case equivalent
  against its input. Record each evaluation's exit code; list every failing
  case with its failing criterion, classified as "hidden supply or control pin
  made explicit" or other. Any other failure (equivalence, unsafe routing,
  introduced dangling wire or touching pin) stops the task and is reported.
- VSS-form paired totals (crossings, bends, wire, rail wire, crossings
  involving a rail, floating pins) are within 3% of `results.txt` section 4,
  or the difference is explained by the commits between that code and the
  base.
- Report both forms side by side: coverage, floating pins, hidden-pin
  warnings, rail wire, crossings involving a rail, bends on rail Nets, how
  many cases have an evidence-backed ground claim and how many have a
  supply-named Cell terminal.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. No LLM or API calls. Do not modify product code.
Keep the drawing-mode run identical and check it before the long netlist runs.
The machine is shared: at most 6 worker processes.
