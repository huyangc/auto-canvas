# T147 — Lay out an imported netlist: SPICE import runs Auto Layout on every imported Cell, as one Undo step

- Branch: `task/T147-layout-after-netlist-import`
- Base: `main` at `1ce1404`
- Status: approved

## Goal

Today, **File → Import → SPICE / SCS…** replaces the tab with a Project in
which every imported Cell holds its devices on a square shelf in source
order. Cell Pins wait on the sides. There are no wires, junctions or rail
symbols, only routing guides taken from the frozen import reference.

After this task the same import starts Auto Layout by itself:

- **Every imported Cell is planned.** T014's worker plans the Cells one after
  another, top Cell first, with `presentation: "netlist"` (R165). Ground Nets
  get per-device ground symbols, and a lone `VDD` Cell Pin becomes a supply
  symbol.
- **Every Cell that delivers a plan is committed in one Undo step.** One Undo
  returns every Cell to its shelf exactly as imported.
- **Refusals keep the shelf.** A Cell the planner refuses
  (`AUTO_LAYOUT_CONNECTION_REFUSED`, `AUTO_LAYOUT_TOO_LARGE`, …) keeps its
  shelf. The user reads the true reason per Cell.
- **Multi-Cell netlists come with a notice.** When the netlist has several
  subcircuits, the user is told plainly that each is drawn as its own Cell and
  that such drawings can be rougher.

For the top Cell, the editor runs the same import step and the same planner
call that `scripts/netlist-input.mjs --form global` and
`scripts/auto-layout-eval.mjs --presentation netlist` measure. On the corpus,
499 of 515 converted cases were delivered with 0 connection defects, and 16
were refused by R14a. This is the owner's end-to-end flow: netlist → readable
schematic.

## Decisions

The owner answered (a), (c), (d), (e) and (g) on 2026-11-20. Items (b), (f)
and (h) are **the coordinator's defaults**: they were put to the owner in
words the same day and not objected to, but not explicitly confirmed. Each item gives the decision first; an alternative is
recorded only as what was not chosen.

1. **(a) Trigger — confirmed.** A SPICE import starts Auto Layout by itself,
   with T014's status chip and Cancel. No prompt, checkbox or menu step is
   added. Import is a bare file input, so there is no import dialog anyway
   (`file-command-menu.tsx:235-263`).
2. **(b) When netlist presentation is used — coordinator's default.**
   - It is used when the Document is still netlist-only: it has an
     `importReference` and no routes.
   - The rule applies to the import run and to a manual Circuit → Layout →
     Auto Layout run alike. There is no second menu item.
   - Not chosen: a separate "Auto Layout (netlist)" item.
3. **(c) Multi-Cell netlists — confirmed (changed from the earlier draft).**
   - Every imported Cell with at least one instance is laid out, not only the
     top Cell.
   - The user is told plainly, at import, that the netlist has several
     subcircuits, that each is drawn as its own Cell, and that drawings of
     multi-subcircuit netlists can be rougher. Lower quality there is
     accepted.
   - Integrity is not relaxed: the R14a refusal and every connection rule
     apply per Cell.
4. **(d) Refusal or too large — confirmed.**
   - A refused or too-large Cell stays exactly as imported: devices on the
     shelf, no wires.
   - The status and Details give the true reason per Cell, by name.
   - The other Cells are still laid out.
5. **(e) Undo granularity — confirmed (changed).**
   - The whole post-import layout, every Cell that was laid out, is **one**
     Undo step. One Undo returns all of them to their shelves.
   - Redo re-applies all of them.
   - The import itself stays a replacement with no Undo, as today, so a
     second Undo is disabled.
6. **(f) A later manual Auto Layout on a Cell — coordinator's default.**
   - It follows (b). After the layout has drawn routes, the Cell is no longer
     netlist-only, and the plain planner runs on the open Cell only, exactly
     as T014 does.
   - Not chosen: a persisted "imported" flag.
7. **(g) R165 supply symbol — confirmed.** Accept R165 as it is for v1, so a
   lone `VDD` port becomes `vdd-port`. Later rounds tune it from what is seen.
8. **(h) Which import entries — coordinator's default.**
   - Included: SPICE / SCS… and Cadence SPICE (`!` globals)…, which share
     `importSpiceFiles`. Cadence's `gnd!` is not node `0`, so it gets no
     ground symbols, and that path is unmeasured.
   - Excluded: RNL import and Agent import.
9. **Edited Cell while planning — plan's recommendation.**
   - A Cell whose revision changed between import and result is **skipped and
     named** ("edited since import; not laid out"). The other Cells are still
     applied, in the one step.
   - A Project session change or a `structureRevision` change discards the
     whole run.
   - Opening another Cell while planning is allowed: it changes no Document.
   - Why: plans are per Document. The per-Document revision fence guarantees
     that no edited Document is touched. Throwing away every other Cell's
     layout because of one edit would punish the user for nothing.
   - Not chosen: all or nothing.
10. **A commit refused by the write path — plan's recommendation.**
    - If any Cell's fenced transaction is refused inside the step, the whole
      step rolls back. `commitAsOneStep` returns false, every Cell keeps its
      shelf, and the status names the Cell and the code.
    - Why: per-Document revisions are re-checked synchronously right before
      the step, so a refusal there is an unexpected engine or validation
      failure, not a user edit. A partial commit would leave a step that no
      longer matches its report. The planner's own refusals (item 4) never
      reach the write path.
    - Not chosen: keep the Cells that committed.
11. **Manual command unchanged.** Circuit → Layout → Auto Layout keeps T014's
    scope (the open Cell), fence (including the open Cell), statuses and
    Undo.

## Context

Verified in the `t014-editor-auto-layout` checkout, whose tree equals `main`
at `1ce1404` (`git diff --stat 1ce1404 HEAD` is empty).

### The editor's import today

- **Entries.** File → Import has `SPICE / SCS…` (`data-testid="spice-files"`),
  `Cadence SPICE (\`!\` globals)…` (`cadence-spice-files`) and `RNL…`
(`rnl-files`), all bare file inputs
(`apps/editor/src/features/editor-shell/file-command-menu.tsx:235-279`).
  - They are wired at `apps/editor/src/app/editor-menus.tsx:411-413`.
  - They are implemented in `features/editor-shell/editor-file-commands.ts`:
    `importSpiceFiles` at `:336-378` and `importRnlFiles` at `:302-334`.
  - The canvas drop handler places tray items, not files (`App.tsx:2778-2790`).
  - The Agent's own import (`apps/editor/src/agent/browser-agent-file-host.ts:405-449`)
    goes through an approval candidate and is not touched.
- **The import step.** Three calls (`editor-file-commands.ts:345-372`):
  `prepareImportSources`, then `importSpiceSources(…, { namingProfile,
originalSources, builtInBodies })`, then `withImportedInstanceDisplays`.
- **Replacement.** `installImport` (`:271-292`) calls
  `guardDirtyReplacement(label, perform)`.
  - `perform` runs at once when there is no unsafe work. Otherwise it runs
    from the dirty-replacement dialog, or never if the user cancels
    (`apps/editor/src/document/use-project-file-lifecycle.ts:637-662`).
  - `perform` calls `replaceActiveProject(…, { source: "spice-import" })`.
  - It opens the Import Review: `setImportReport`,
    `setImportReviewOpen(true)` and `setSelectionOpen(true)`. That panel is
    the `Import Review` section (`apps/editor/src/app/editor-properties-dock.tsx:234-238`),
    rendering `features/selection/selection-inspector-details.tsx`
    (report text at `:112-125`).
  - It sets the status "Imported N Documents and M structural instances"
    (`:288-290`).
- **The entry boundary transforms the Project before install.**
  `replaceActiveProject` (`use-project-file-lifecycle.ts:308-350`) runs
  `materializeRazaviProjectBulkConnections` (`:325`;
  `apps/editor/src/presentation/razavi-presentation.ts:89-130`, a
  `reconcile_mos_bulk` transaction per Document).
- **What the controller does on replace.**
  `EditorDocumentController.replaceProject`
  (`apps/editor/src/document/document-controller.ts:250-265`):
  - re-parses the Project;
  - bumps the session;
  - opens `topDocumentId` (`:259`);
  - **clears undo and redo** (`:261-262`).
- **The imported Project** (`packages/spice/src/importer.ts`):
  - **Which Cells become Documents.** One Document per kept Cell. Built-in
    bodies and library Cells are not Documents (`:1695-1712`), so every
    Document is a user subcircuit.
  - **Top Cell and name.** The top is the first top cell that is not a body
    or library Cell (`:1749-1756`, `:1796`). The Project is named
    "`<top> (SPICE Import)`" (`:1765`).
  - **Cell Pins** are `port` instances (`:1126-1157`).
  - **Shelf placement.** Devices fill a square block of up to 8 columns, pitch
    180×140 (`:1165-1180`, `:709-767`).
  - **No drawing.** `routes: []` and `junctions: []` (`:1323-1324`).
  - **Import markers.** `sourceBinding`, `sourceStatus: "in-sync"` and an
    `importReference` holding the frozen source Nets (`:1186-1220`).
  - **Evidence.** A node `0` Net gets a `global-declaration` name claim with
    `powerDomain: "ground"` (`:1228-1320`).
  - No ground or supply symbol exists anywhere.
- **What the canvas shows.** Unwired parts, plus routing guides from
  `assessImportReference` (`packages/derived/src/import-reference.ts:49-130`;
  `:94`: "must not make a newly imported, unrouted sheet look complete").
- **`sourceStatus` is not an "untouched" marker.** It flips on any geometry
  or connectivity commit (`packages/edit-engine/src/transaction.ts:1245-1249`),
  and possibly in the entry transform. Decision 2 keys on `importReference`
  plus no routes.

### The measured path

- `scripts/netlist-input.mjs:194-300`:
  - It exports each corpus drawing with `createDesignNetlistExport`
    (`groundPin: "global"`).
  - It imports with exactly the editor's three calls, then `parseProject`
    (`:222-246`). The editor functions come from a Vite bundle
    (`scripts/lib/import-display-bundle.mjs:20-23`).
  - It plans the **top Document only** (`:58-59`). Child Cells of
    multi-subcircuit netlists are therefore unmeasured. The owner accepts
    lower quality there.
- **It skips the editor's entry boundary**: no Razavi bulk transform and no
  controller re-parse (trap 1).
- `scripts/auto-layout-eval.mjs` passes `presentation` to `planAutoLayout`
  (`:638-641`, `:685-693`). Its budget is `defaultLayoutSearch(document, {})`
  (`:681`), which equals `runAutoLayout`'s `defaultLayoutSearch(document)`
  (`apps/editor/src/features/auto-layout/auto-layout-core.ts:31`).
- The R165 re-export and equivalence checks (`:846-890`) are measurements, not
  delivery gates. The `--reference` folder feeds only human-comparison metrics
  (`:513-519`).

### The planner's netlist presentation

- `planAutoLayout` (`packages/auto-layout/src/auto-layout.ts:309-323`) wraps
  `planNetlistPresentation` (`:326-358`) in the R14a gate.
- `netlistPresentation` (`packages/auto-layout/src/netlist-presentation.ts:117-298`)
  makes these edits:
  - **Ground symbols.** For each node-0 Net (`:62-75`) without a `ground`
    instance, per hostable device: `add_instance` of a `ground` with
    `placement: null`, `connect_endpoints`, and `upsert_connectivity_evidence`
    with a `power-marker`-owned claim (`:184-213`).
  - **Supply symbol.** A lone `VDD` port on a supply Net gets
    `set_instance_symbol` → `vdd-port` (`:218-253`).
  - **Gate.** The edits are replayed with `dryRun` and checked by
    `presentationChange` (`:258-290`).
- **Fallbacks** are warnings, and the plan is still delivered:
  - `_SKIPPED` above 120 instances (`:128-133`, `:254-261`);
  - `_DROPPED` on a gate failure (`:276-284`), or when the presented plan is
    refused, empty or over 1024 edits (`auto-layout.ts:333-356`);
  - `_SUPPLY_AMBIGUOUS` (`:236-243`).
- **On an edited Document** R165 ignores geometry, and it skips rails that
  already have their symbol (`:167`, `:226-232`).
- **Write path.** The result is plain `SchematicEdit[]`, and the controller
  rejects only `*_cell_terminal` edits (`document-controller.ts:453-467`).
- **Size.** Above 120 instances the planner returns `AUTO_LAYOUT_TOO_LARGE`
  (`auto-layout.ts:2270-2277`). The spec is `docs/specs/auto-layout.md:987-1033`.

### The editor's write path and history (the one-step design)

- **`commitAsOneStep` already exists.**
  `EditorDocumentController.commitAsOneStep(commit: () => boolean): boolean`
  (`document-controller.ts:305-340`) runs `commit`.
  - Every transaction inside it becomes one undo entry: `record`
    (`:279-298`) folds later commits into the step's first entry (`:285-289`).
  - On `false`, or on a throw, it restores the step's entry by an internal
    undo and puts back the earlier redo stack (`:316-336`). Nested calls just
    run `commit` (`:306`).
  - It is tested at `document-controller.test.ts:604-638`, on one Document.
  - Its only caller today is `apps/editor/src/agent/browser-agent-host.ts:141-149`.
    That caller re-synchronizes after a rollback: "The commits it undid were
    shown; show the Project they left."
- **History entries are whole-Project snapshots**
  (`ProjectHistoryEntry { project, documentId, structural }`, `:130-134`).
  - `restoreHistory` (`:596-735`) installs `entry.project`. Every Document
    that differs from the live one gets a new revision, and unchanged
    Documents keep their live object (`:648-664`).
  - It does not change the open Cell unless that Cell vanished (`:711-716`).
  - So one Undo of the step returns **every** laid-out Cell to its shelf at
    once, and the Cell the user is viewing stays open.
- **What `entry.documentId` is.** It is the Document of the step's **first**
  commit (`:289`). It decides two things:
  - which Document GUI Undo names in its request (`transact`, `:404-416`);
  - the Agent's chronological-history check (`:617-628`).

  Committing the top Cell first makes it the step's Document.

- **`useDocumentController` does not expose `commitAsOneStep`.** Its returned
  API (`:772-850`) has `dispatchTransaction` (`:813-821`), which synchronizes
  and calls `onCommitted` after each applied commit. The hook needs a
  `commitAsOneStep` beside it: `document-controller.ts` becomes an owned path
  for that one addition, unlike T014.
- **`dispatchTransaction` commits to any `documentId`** (`applyTransaction`,
  `:440-452`). `transactAtRevision` already takes `{ documentId,
expectedRevision, edits, transactionId, staleStatus }`
  (`apps/editor/src/app/editor-transaction-commands.ts:34-41`, `:233-255`).
- **The status and tool-cancelling tail.** `commitDocument` (`:166-218`) wraps
  one commit: `applyResult` sets the status, and a successful commit during a
  non-idle tool cancels it. A group must pass through it **once**: wrap the
  whole step as one `run`, not each Cell.

### T014's seams

- `AutoLayoutWorkerRequest` is `{ type, runId, project, documentId, search? }`
  (`features/auto-layout/auto-layout-protocol.ts:18-28`). There is one
  Document and no options. `runAutoLayout` calls
  `planAutoLayout(document, resolver, { search })` (`auto-layout-core.ts:33-44`).
- `createAutoLayoutSession` (`auto-layout-session.ts:84-264`) has these parts:
  - The fence `{ projectSessionId, structureRevision, documentId, revision }`
    (`:23-28`), checked against `live()` in `apply` (`:116-171`).
  - Fixed status strings (`:59-64`, `:133-170`).
  - A report of `AutoLayoutDiagnostic[]` (`:40`).
- `useAutoLayout` (`use-auto-layout.ts:53-142`):
  - `live()` reads the controller's **active** Document (`:70-78`).
  - `start()` reads the **last render's** Project (`:129-133`).
  - The `projectSessionId` effect's cleanup **disposes** a run (`:104-119`).
- The Details dialog lists a flat diagnostic array
  (`features/auto-layout/auto-layout-report.tsx:5-40`).
- The chip is in `features/editor-shell/editor-statusbar.tsx`.
- App wiring:
  - the hook at `App.tsx:4179-4188`;
  - the router at `:4189-4196`;
  - the file commands at `:4251-4281`;
  - the `layout.auto` availability at
    `apps/editor/src/commands/editor-command.ts:292-303`.
- **T014 review P3.** `FencedDocumentTransaction` lives in
  `app/editor-transaction-commands.ts:34-41` and is imported by
  `features/auto-layout/auto-layout-session.ts:8` and `use-auto-layout.ts:14`.
  That is feature → app, the wrong direction. Move it to the feature's
  protocol.

### Traps

1. **The measured Document may not be the installed Document.** The editor
   installs `replaceProject(materializeRazavi…(withImportedInstanceDisplays(imported)))`,
   while the eval plans `parseProject(withImportedInstanceDisplays(imported))`.
   Step 1 measures whether this matters before anything is built.
2. **Starting inside `installImport` loses the run.** It would read the old
   Project (`use-auto-layout.ts:129-133`) and be disposed by the re-render's
   cleanup (`:104-119`). Record the request from the **controller**'s new
   session, and start it in an effect after the render.
3. **The dirty guard may defer or cancel the install.** Record the request
   inside `perform` (`editor-file-commands.ts:280-291`), never before
   `guardDirtyReplacement`.
4. **Status overwrite breaks specs.** These assert the import headline with
   `toContainText` (`e2e/editor-fixtures.ts:120-125`):
   - `apps/editor/e2e/netlist-conversion.spec.ts:24`
   - `apps/editor/e2e/netlist-workflows.spec.ts:172`

   So every status of an import run keeps the headline as a prefix. In jsdom
   (no `Worker`, `use-auto-layout.ts:28-33`) an import run writes nothing.

5. **An extra Undo step that lands at an unpredictable time breaks import
   specs.** `instance-table.spec.ts:7-50` imports and then does Undo/Redo, and
   `netlist-workflows.spec.ts` and `netlist-conversion.spec.ts` act right
   after import. They must wait for the run's final status.
6. **The fence is per Document for an import run (a design item now, not a
   limitation).** T014's fence compares the open Cell (`use-auto-layout.ts:75`).
   - An import run's fence is `{ projectSessionId, structureRevision }` plus
     `documentId → revision` for every planned Cell, read from
     `controller.project.documents`.
   - The manual command keeps T014's fence (decision 11).
7. **Plans are made against the posted Project; commits change it.** Each
   Cell is planned in the worker against the Project as imported. If
   committing a child Cell's plan changed what a parent sees through the
   resolver, the parent's plan would rest on a stale child symbol. The resolver
   context is `documentResolverContextChanged`, `document-controller.ts:83-102`,
   and includes `projectCellSymbolTerminals`, which reads interface-label
   annotations (`packages/symbols/src/hierarchical-block.ts:91-121`). Step 1
   checks that a laid-out child leaves that context unchanged.
8. **One step, one tail.**
   - Each hook-level `dispatchTransaction` inside the step synchronizes and
     stages recovery. A rollback must synchronize once more, as
     `browser-agent-host.ts:146-148` does.
   - `commitDocument`'s status and tool cancelling run once for the step
     (Context, "The status and tool-cancelling tail").
9. **No planner value import on the main thread** (T014 report, deviation 1).
   The netlist-only predicate and the 120 limit stay out of the App chunk;
   the worker's `AUTO_LAYOUT_TOO_LARGE` is the size check.
10. **Gates that fail on `main` already.**
    - `pnpm deadcode` exits 1 on `main` (T014 report, "Knip").
    - `node scripts/editor-bundle-budget.mjs --check` fails on `main` (it reads
      a preload generator deleted in `d088df1`).

    For both, acceptance means **no new findings** compared with `main`'s
    output.

11. **The corpus is staged, not committed.** The coordinator copied the 628
    drawing Projects into this worktree's `tmp/inputs/le10-input` (ignored by
    git) before step 1. Do not read other worktrees for it.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/features/auto-layout/` (tests beside each file):
  - `auto-layout-protocol.ts`: a list of Documents, `presentation`,
    per-Cell progress and results, and `FencedDocumentTransaction` moved here.
  - `auto-layout-core.ts`: plan a list of Cells.
  - `auto-layout-session.ts`: run kinds, the per-Document fence, the one-step
    apply, prefixed statuses and a per-Cell report.
  - `use-auto-layout.ts`: the import request and the predicate.
  - `netlist-layout.ts` (new): `netlistOnly` and the multi-Cell notice text.
  - `auto-layout-report.tsx`: grouped by Cell.
  - `auto-layout-fixture.test-support.ts`: a multi-Cell netlist fixture.
- `apps/editor/src/document/document-controller.ts` and
  `document-controller.test.ts`: **only** to expose `commitAsOneStep` from
  `useDocumentController`, with the rollback synchronize, plus a
  multi-Document step test. The controller class's behavior is unchanged.
- `apps/editor/src/app/editor-transaction-commands.ts` and its test: import
  the moved type, and add `transactStepAtRevisions`.
- `apps/editor/src/features/editor-shell/editor-file-commands.ts` and its
  test: `onImported`, and the multi-Cell fields on `SpiceImportReport`.
- `apps/editor/src/features/selection/selection-inspector-details.tsx` and
  its test: the multi-Cell notice in Import Review.
- `apps/editor/src/features/editor-shell/editor-statusbar.tsx` and its test:
  "Cell k of n" in the chip.
- `apps/editor/src/app/App.tsx`: wiring only, at most about 20 lines.
- Browser specs:
  - `apps/editor/e2e/netlist-auto-layout.spec.ts` (new);
  - the existing import specs, only to wait for the run's end:
    `instance-table.spec.ts`, `netlist-workflows.spec.ts`,
    `netlist-conversion.spec.ts`, and `rnl-interchange.spec.ts` if affected.
- Docs:
  - `docs/specs/editor-interaction.md`: "Automatic layout" (`:433-455`) and
    "Drawn and unplaced Instances" (`:72-79`).
  - `docs/specs/auto-layout.md`: one sentence in R165 (`:987-1033`).
  - `docs/user/getting-started.md:15-19`, which is stale ("Placement Tray").

Out of scope (do not change):

- `packages/auto-layout/**`. The three known netlist-path gaps are later
  tasks:
  1. Standard cells import as blank boxes (11 cases).
  2. R165 recognizes ground only as node `0`, not `VSS`/`GND`/`gnds!`
     (5 cases).
  3. R165 makes `VDD` a `vdd-port` where people keep a port (174 cases;
     decision 7).
- `packages/spice/**` and `packages/edit-engine/**`.
- Everything in `apps/editor/src/document/**` beyond the one exposure above.
  That includes the entry transform and the shelf.
- RNL import, Agent import and the Agent/MCP surface.
- `scripts/**`, unless step 1 stops with a parity finding and the coordinator
  extends the scope. The corpus, `tmp/` and Gallery drawings are never
  committed.
- The manual command's behavior and wording (decision 11).

## Steps

1. **Investigate before building.** Stage the corpus (trap 11). Use throwaway
   scripts under `tmp/t147/`, not committed, and bundle the editor TypeScript
   with Vite as `scripts/lib/import-display-bundle.mjs` does.
   1. **Parity, trap 1.** For the 628 Projects in `tmp/inputs/le10-input`:
      1. Run `convertProject` (`scripts/netlist-input.mjs`, `--form global`).
      2. For each converted case, also build the editor's installed Project:
         `withImportedInstanceDisplays`, then
         `materializeRazaviProjectBulkConnections`, then
         `parseProjectSnapshot(withProjectComponentDefinitions(parseProjectSnapshot(p)))`.
      3. Compare the top Documents as JSON without `revision`.

      Report:
      - stage counts (expect 515 converted);
      - how many Documents differ, and in which fields;
      - `sourceStatus` and `importReference` after the transform;
      - whether `netlistOnly` (step 2) is true for all 515;
      - whether it is false for all 628 drawings and for each of the 10
        bundled examples (`apps/editor/src/examples/*.icproj.json`).

   2. **Multi-Cell facts, trap 7.** Import netlist B (step 3) and a
      three-Cell variant through the editor path. Plan each Cell in quick mode
      with `presentation: "netlist"`, and commit the plans child-first, then
      parent-first, through one `EditorDocumentController`.

      Report:
      - whether any child commit makes `documentResolverContextChanged` true
        for that child;
      - whether every commit applies in both orders;
      - whether the final Documents are identical between the orders.

   3. **Stop and report if:**
      - any converted top Document differs and a quick plan of the editor
        version has a different outcome or `planHash` from the measured one;
      - the predicate misclassifies any case;
      - a child commit changes the resolver context, or a later commit is
        refused.

      The fix then belongs to the coordinator. Options: make the measurement
      apply the entry step, plan the Cells in the worker against an evolving
      copy, or change the commit order.
2. **Predicate (tests first).** In `netlist-layout.ts`:
   - `netlistOnly(document)` returns
     `document.importReference !== undefined && document.routes.length === 0`.
     It imports model types only.
   - `multiCellNotice(cellCount)` returns the exact notice string (step 8).

   Test `netlistOnly` on a real import, on the same Document after one
   committed wire, and on each bundled example.

3. **Protocol and core (tests first).**
   - Change the request to `{ type: "plan"; runId; project; documentIds:
string[]; presentation?: "netlist"; search? }`.
   - Messages:
     - `progress { runId, cell, cells, evaluations, budget }`;
     - `result { runId, results: { documentId, result, milliseconds }[] }`;
     - `failed`.
   - `runAutoLayout` plans the ids in order, each with its own
     `defaultLayoutSearch(document)` and `presentation` when given. A missing
     id posts `failed`. A refused Cell yields its diagnostics, and the loop
     continues.
   - Move `FencedDocumentTransaction` into `auto-layout-protocol.ts`.

   Fixtures:

   ```spice
   * netlist A: one Cell, node 0 and a VDD pin
   .subckt cs in out vdd
   M1 out in 0 0 nmos w=1u l=1u
   R1 vdd out 10k
   .ends cs
   .model nmos nmos
   ```

   ```spice
   * netlist B: two Cells, each with node 0
   .subckt stage in out vdd
   M1 out in 0 0 nmos w=1u l=1u
   R1 vdd out 10k
   .ends stage
   .subckt top in out vdd
   X1 in mid vdd stage
   X2 mid out vdd stage
   C1 out 0 1p
   .ends top
   .model nmos nmos
   ```

   Adjust either fixture until it imports with 0 errors, and record the final
   text in the report.

   Tests (quick mode, explicit `60_000` timeout):
   - On netlist A, a one-id request equals a direct `planAutoLayout(…,
{ presentation: "netlist", search })` byte for byte.
   - On netlist B, two ids give two results in order, top first.
   - A 121-resistor chain beside a small Cell yields `AUTO_LAYOUT_TOO_LARGE`
     for one Cell and a plan for the other.
   - A request without `presentation` matches T014's single-Document result.

4. **Write path (tests first).**
   - **Expose the step.** In `useDocumentController`'s returned API
     (`document-controller.ts:772-850`), add `commitAsOneStep(commit)`.
     - It calls `controller.commitAsOneStep(commit)`.
     - When the result is false and the Project changed, it calls
       `synchronize()` and `onCommitted(controller.project)` once, as
       `browser-agent-host.ts:141-149` does.
   - **Controller test.** In `document-controller.test.ts`, add a
     multi-Document step on a two-Cell Project:
     - commits to both Cells give one Undo entry;
     - one GUI Undo restores both Documents (JSON without `revision`);
     - Redo re-applies both;
     - the open Cell is unchanged by the Undo;
     - a step returning false after the first Cell leaves no entry.
   - **Group commit.** In `editor-transaction-commands.ts`, add
     `transactStepAtRevisions(requests: FencedDocumentTransaction[])`, which
     returns `{ kept, results }`.
     - Inside one `commitDocument` run, it calls `commitAsOneStep`, which
       dispatches each request as `transactAtRevision` builds it.
     - It stops at the first refused result and returns false.
     - The `run` returns the last applied result, or the refusal, so
       `applyResult` and the tool-cancelling tail run once.
     - Pass the hook's `commitAsOneStep` as a new dependency from `App.tsx`.

     Tests:
     - Two Documents commit as one entry, with one status write.
     - A forced refusal of the second (wrong `expectedRevision`) rolls back
       both.
     - A commit during a non-idle tool cancels it once.
5. **Session (tests first).** Add a run kind:
   - The manual run is T014's, unchanged in fence, statuses and report text.
   - An import run takes `{ documentIds, presentation, statusPrefix,
cellNames }`. Its fence is `{ projectSessionId, structureRevision,
revisions: Map<documentId, revision> }`, captured from the controller
     at install.
   - On the result:
     1. A session or `structureRevision` change discards everything with the
        prefixed stale message.
     2. Cells are sorted into outcomes: `edited` (revision changed; decision
        9), `refused` (an error diagnostic), `unchanged` (no edits), and
        `planned`.
     3. Right before committing, the revisions of the `planned` Cells are
        re-read synchronously, and the step is committed in order, top first.
     4. A write-path refusal rolls back the whole step (decision 10).
   - The report becomes `{ documentId, cellName, outcome, diagnostics }[]`.
   - Statuses are the exact strings of step 8. Without a `Worker`, an import
     run writes nothing.

   Tests in `auto-layout-session.test.ts`, with the fake worker driving the
   **real** controller and the real `runAutoLayout`:
   1. Three Cells all applied: one Undo restores all three shelves (JSON
      without `revision`), `canUndo` is then false, and Redo re-applies all.
   2. One Cell refused (`AUTO_LAYOUT_TOO_LARGE`): the other two are applied in
      one step, and the report and status name the refused Cell.
   3. One Cell edited between start and result: it is untouched and reported
      as `edited`, and the other Cells are applied in one step.
   4. Cancel: nothing is applied, there is no history entry, and the
      revisions are unchanged.
   5. Netlist A, single Cell: applied with the prefixed single-Cell status,
      and one Undo returns to the shelf.
   6. Opening another Cell during planning still applies.
   7. A `structureRevision` change discards everything.
   8. A refused write rolls back every Cell.

6. **Hook (tests first).** In `use-auto-layout.ts`:
   - The manual `start()` passes `presentation: "netlist"` when
     `netlistOnly(document)` holds, per decisions 2 and 6.
   - Add `requestAfterImport(statusPrefix)`. It records the controller's
     `projectSessionId`, `structureRevision` and every Document id with at
     least one instance, top first and then in Project order, with its
     revision and name (trap 2).
   - An effect keyed on `binding.projectSessionId` consumes the request when
     the rendered session matches. It starts the import run with
     `presentation` for the Cells where `netlistOnly` holds and plain for the
     others; at import, all are netlist-only. Otherwise it drops the request.

   Tests:
   - A request before the re-render starts exactly one run after the
     session-change cleanup, with the listed `documentIds`.
   - A stale request is dropped.
   - The manual `start()` posts `presentation` only on a netlist-only Cell.

7. **Import wiring and notice (tests first).**
   - `createEditorFileCommands` gains `onImported?: (statusPrefix: string) =>
void`. `installImport(label, project, report, layout)` calls it inside
     `perform`, after the status, when `layout` is true (trap 3).
     `importSpiceFiles` passes `true` for both profiles, and RNL passes
     `false`.
   - `SpiceImportReport` gains `cellCount`. When it is above 1, Import Review
     shows the notice paragraph (`data-testid="import-multi-cell-notice"`),
     using `multiCellNotice`.
   - Wire `onImported: autoLayout.requestAfterImport` in `App.tsx`.

   Tests:
   - `onImported` is called once after `replaceActiveProject` with the
     headline.
   - It is not called on a failed import, on an RNL import, or when the guard
     never performs.
   - The notice renders for 2 Cells and not for 1.

8. **Exact user-visible text.**
   - **Notation.** `H` is the import headline, for example `Imported 3
Documents and 14 structural instances`. `n` is the number of Cells
     planned, `k` the number applied, and `<cell>` a Cell name.
   - **Single Cell (n = 1).** Every status is `H · ` followed by T014's
     message verbatim, for example `H · Auto Layout applied (revision 2)`.
   - **Import Review notice (n > 1):**
     "This netlist has n subcircuits, so each is drawn as its own Cell.
     Auto Layout lays out every Cell; drawings of multi-subcircuit netlists
     can be rougher than single-circuit ones, so check each Cell."
   - **Planning:** `H · Auto Layout is planning n Cells…`
   - **Chip:** `Auto Layout… 12 s · Cell 2 of 3 · evaluation 3/24`, with
     Cancel. The evaluation part appears only while the annealer reports.
   - **Done, all applied:** `H · Auto Layout applied to n of n Cells — Details`
   - **Done, some not applied:** `H · Auto Layout applied to k of n Cells;
<cell>: <reason>[; …] — Details`, where `<reason>` is one of:
     - T014's refusal reason (`could not connect every pin`, `more than 120
parts`, or the planner's message);
     - `edited since import, not laid out`;
     - `already laid out`.

     List at most two Cells, then `and m more`.

   - **Done, none applied:** `H · Auto Layout left every Cell as imported;
<same list> — Details`
   - **Cancel:** `H · Auto Layout cancelled; every Cell stays as imported.`
   - **Discarded run:** `H · The Project changed while Auto Layout was
planning; nothing was applied.`
   - **Rollback:** `H · Auto Layout could not commit <cell> (<code>); nothing
was applied — Details`
   - **Details dialog.**
     - It opens with the notice when n > 1.
     - Then one section per Cell, with heading `<cell> — applied` /
       `applied with N warnings` / `left as imported: <reason>` /
       `edited since import; not laid out` / `already laid out`, followed by
       that Cell's diagnostics (severity, code, the planner's message).
     - A manual run shows one section without a heading, as in T014.
9. **Browser spec.** Add `apps/editor/e2e/netlist-auto-layout.spec.ts`.
   - **Netlist A:**
     1. Import it; the status matches `/Imported 1 Document.*Auto Layout
applied/`.
     2. The top Cell has routes and at least one `ground`.
     3. Undo: no routes and no `ground`, and `draw-tool-undo` is disabled.
     4. Redo restores the layout.
   - **Netlist B:**
     1. Import it; the notice is visible.
     2. The status contains `applied to 2 of 2 Cells`.
     3. Both Documents in `exportedProject` have routes.
     4. One Undo leaves both without routes, and Undo is then disabled.
     5. Redo restores both.
   - **A 121-resistor chain beside a small Cell:** the status names the chain
     Cell with `more than 120 parts`, the small Cell is laid out, and Details
     lists `AUTO_LAYOUT_TOO_LARGE` under the chain Cell.
10. **Existing import specs.** In each spec that imports SPICE and then acts,
    wait for the run's final status before acting. Change no assertion's
    meaning, and list each edit in the report.
11. **Docs.**
    - `editor-interaction.md`, "Automatic layout": add a bullet of at most
      eight lines covering:
      - the import run on every Cell, top first;
      - the netlist-only rule;
      - the per-Document fence (Cell switches allowed, edited Cells skipped);
      - one Undo for all Cells;
      - refusals per Cell;
      - the multi-Cell notice;
      - prefixed statuses.

      At `:74`, add that a SPICE import is then laid out.

    - `auto-layout.md`, R165: one sentence naming the editor's netlist-only
      use.
    - `getting-started.md:15-19`: describe the new behavior and the
      multi-subcircuit notice.
12. **Investigate: timing.** In the dev server, import three converted corpus
    netlists from step 1 (`tmp/netlist-input/global/<id>.sp`): the median-size
    one, the largest delivered one and one R14a refusal. Also import netlist
    B. Report each chip's elapsed time and outcome. Commit none of them.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm exec vitest run apps/editor/src/features/auto-layout apps/editor/src/document/document-controller.test.ts apps/editor/src/features/editor-shell apps/editor/src/features/selection apps/editor/src/app/editor-transaction-commands.test.ts apps/editor/src/commands   # expected: all pass, new tests included
pnpm typecheck        # expected: exit 0
pnpm lint             # expected: exit 0
pnpm format:check     # expected: exit 0
pnpm docs:check       # expected: exit 0
pnpm test:local       # expected: all pass
pnpm build            # expected: exit 0
pnpm deadcode > tmp/t147/deadcode-branch.txt 2>&1; diff tmp/t147/deadcode-main.txt tmp/t147/deadcode-branch.txt   # expected: no added line (main exits 1 already; deadcode-main.txt comes from a clean main checkout, not git stash)
pnpm test:editor-build   # expected: exit 0; AUTO_LAYOUT_CONNECTION_REFUSED appears only in the auto-layout.worker-*.js asset (editor-bundle-budget.mjs is broken on main; not a gate)
ICM_E2E_PORT=4195 AUTO_CANVAS_E2E_API_PORT=4335 npx playwright test apps/editor/e2e/netlist-auto-layout.spec.ts apps/editor/e2e/auto-layout.spec.ts apps/editor/e2e/instance-table.spec.ts apps/editor/e2e/netlist-workflows.spec.ts apps/editor/e2e/netlist-conversion.spec.ts apps/editor/e2e/rnl-interchange.spec.ts   # expected: all pass
git diff --stat main -- packages scripts pnpm-lock.yaml   # expected: empty
git diff main -- apps/editor/src/document/document-controller.ts   # expected: only the hook's commitAsOneStep exposure
```

Behavioral checks: start the `editor` config from `.claude/launch.json`, which
serves port 5173. Use File → Import → SPICE / SCS… for each import.

- **Netlist A.**
  - The shelf appears, then the chip reads `Auto Layout… n s` with Cancel.
  - The status ends `… · Auto Layout applied (revision …)`.
  - The drawing is wired with ground symbols, `vdd` is a supply symbol, and
    the view fits.
  - Undo once: the exact shelf is back, and Undo is disabled.
  - Redo: the layout is back.
- **Netlist B.**
  - Import Review shows the multi-subcircuit notice.
  - The chip counts `Cell 1 of 2`, then `Cell 2 of 2`.
  - The status reads `… applied to 2 of 2 Cells — Details`.
  - The top Cell and `stage` are both wired.
  - With `stage` open, press Undo once: `stage` is back on its shelf, and so
    is the top Cell when opened. Undo is then disabled.
  - Redo restores both.
- **Open another Cell while netlist B plans.** The run still applies both
  Cells.
- **Edit a Cell while netlist B plans.** Drag a part in the open top Cell
  while the chip runs. The status names it as edited since import, `stage` is
  laid out, and the dragged part stays.
  - One Undo returns only `stage` to its shelf.
  - A second Undo reverts the drag.
- **The 121-resistor chain beside a small Cell.** The chain Cell stays on its
  shelf with `more than 120 parts`, the small Cell is laid out, and Details
  groups the diagnostics by Cell.
- **An R14a refusal from step 12.** The shelf stays and the status says
  `could not connect every pin`.
- **Cancel a long run (step 12).** The status reads `… · Auto Layout
cancelled; every Cell stays as imported.`, and Undo is disabled.
- **Unsaved work, then import.** The replace dialog appears.
  - Cancel: no import and no run.
  - Continue: the import is laid out.
- **Manual command on an example.** Open `?example=two-stage-op-amp` and run
  Circuit → Layout → Auto Layout. T014's behavior and wording are unchanged.

## Notes for the implementer

- Implementation is by a Claude subagent. Review is by an independent Opus
  subagent before any PR. Codex is not used.
- Reuse T014's worker, session and fenced write; add no second pipeline. Never
  plan on the main thread, including when `Worker` is missing.
- Never apply to a Document edited since import. The per-Document revision
  check right before the step, plus each transaction's own `expectedRevision`,
  enforces it. Do not weaken either.
- Keep the import step to the three calls the evaluation bundles
  (`editor-file-commands.ts:345-372`), with unchanged options.
- Commit the top Cell first inside the step, so `entry.documentId` is the top
  Cell (`document-controller.ts:289`).
- Planner tests use quick mode with an explicit `60_000` timeout. Do not touch
  `vitest.config.ts`.
- Time: n Cells cost n plans. On the corpus a single plan took a median of
  2 s, a p90 of 8.5 s and a maximum of 37 s. The chip shows the Cell count,
  and Cancel terminates the worker with nothing applied.
- No step spends LLM API tokens.
- Commits end with `Test-Impact: tests-updated`.
- **Size.** About 500–650 lines of product code, about 650 of tests (unit plus
  browser), 20–60 lines of edits to existing specs, and about 30 lines of
  docs. That is close to T014's diff, which was reviewed as one.
  - **Recommended:** one task, because the owner asked for the multi-Cell
    behavior and one Undo step.
  - **If review finds it too large, cut it in two:**
    - **T147a**, the single-Cell import flow: the top Cell only, with steps
      1, 2, 3 for one id, 6, 7 without the notice, and 9–11 for netlist A.
    - **T147b**, multi-Cell planning, the per-Document fence,
      `commitAsOneStep`, the notice and the grouped Details: steps 3–5, 7–9
      for netlist B.
  - **If step 1 stops on a parity finding,** first make the measurement match
    the product as its own task.
