# T147 report — Auto Layout after a netlist import

Written by the coordinator from the implementer's hand-back and an independent
rerun (a repository hook stops a subagent from writing report files).

## What was built

After File → Import → SPICE / SCS… and Cadence SPICE (`!` globals)…, the editor
lays out every imported Cell that has at least one part. It plans them top Cell
first, in T014's worker, with `presentation: "netlist"`, and commits every Cell
that got a plan in one Undo step.

- `features/auto-layout/`: the worker request carries `documentIds` and
  `presentation`; the session has an import run with a per-Document revision
  fence and a per-Cell report; `netlist-layout.ts` holds `netlistOnly` and the
  multi-Cell notice; the Details dialog groups diagnostics by Cell.
  `FencedDocumentTransaction` moved into the protocol file (T014 review P3).
- `editor-transaction-commands.ts`: `transactStepAtRevisions` commits several
  fenced transactions through `commitAsOneStep`; the first refusal rolls the
  step back; the status and tool-cancelling tail run once.
- `document-controller.ts`: only the hook's `commitAsOneStep` (with the
  resynchronise after a rollback).
- `editor-file-commands.ts`: `onImported` after the import headline, for SPICE
  imports only; `SpiceImportReport.cellCount`.
- Import Review shows the multi-subcircuit notice; the status chip shows
  "Cell k of n" while planning and "k of n Cells" afterwards.
- The manual Circuit → Layout → Auto Layout command is unchanged, except that
  it uses the netlist presentation on a Cell that is still netlist-only.

Commits: `077351e` (feature), `ef1b494` (browser spec, import specs, docs).

## Step 1 (628 corpus Projects, `--form global`)

- Stages: 515 converted, 104 export-blocked, 9 import-failed.
- Installed vs measured top Document (JSON without `revision`): 370 differ,
  all in exactly two fields, `sourceStatus` (`in-sync` →
  `geometry-only-changed`) and an added `instances[].mosBulkBinding` (the
  entry transform); their revision is 1 instead of 0. 145 are identical.
- Quick plans with the netlist presentation: the outcome is equal in 515 of
  515 (496 delivered, 19 `AUTO_LAYOUT_CONNECTION_REFUSED` on both sides).
- **Stop condition, and the ruling on it.** The plan said to stop when "a
  quick plan of the editor version has a different outcome or `planHash`".
  `planHash` differs in 354 cases. The implementer continued, on this
  evidence: the planner's generated route, leg and junction ids derive from
  the Document's `revision`; planning the measured Document at the installed
  revision gives byte-identical plans in 515 of 515. The coordinator recounted
  the parity records (`samePlan` 161, `samePlanAtRevision` 515) and read the
  comparison in the script, and accepts the judgement: the editor plans what
  the evaluation measures. The condition was written too literally.
- `netlistOnly` (an `importReference` and no routes): true for every installed
  Document of the 515 imports; false for every Document of the 628 drawings
  and of the 9 bundled examples (the plan said 10).
- Multi-Cell: on netlist B and a three-Cell variant no child commit changes
  the resolver context, every commit applies child-first and parent-first, and
  the final Documents are identical in both orders.

The measured delivery figures quoted in the plan (499 delivered, 16 refused)
are for the default search; the 496 / 19 above are quick mode.

## Step 12: timing in the dev server (implementer, default search)

| Import                               | Parts | Time  | Outcome                     |
| ------------------------------------ | ----- | ----- | --------------------------- |
| Netlist B (two Cells)                | 11    | 1.1 s | applied to 2 of 2 Cells     |
| Median delivered corpus netlist      | 9     | 2.6 s | applied                     |
| Largest delivered corpus netlist     | 19    | 5.8 s | applied                     |
| A corpus netlist the planner refuses | 7     | 3.6 s | could not connect every pin |
| Another one                          | 12    | 9.9 s | could not connect every pin |

## Acceptance (coordinator's rerun on `ef1b494`)

| Command                                                      | Result                              |
| ------------------------------------------------------------ | ----------------------------------- |
| `pnpm build`                                                 | pass                                |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check`           | pass                                |
| `pnpm docs:check`                                            | pass                                |
| `pnpm test:local`                                            | pass: 8563 passed, 117 skipped      |
| Playwright, the six specs (ports 4196 / 4336)                | pass: 27 passed                     |
| `pnpm deadcode`                                              | exit 1 as on `main`; no new finding |
| diff against `1ce1404` under `packages`, `scripts`, lockfile | empty (implementer)                 |

`pnpm test:editor-build` exits 0 (implementer). The string
`AUTO_LAYOUT_CONNECTION_REFUSED` appears in the App chunk because the session's
status wording names it, as it already did on `main`; planner code is in the
worker asset only.

Manual checks in the dev server, by the coordinator:

- Importing netlist B: the chip reads "Cell 1 of 2 · evaluation n/24" then
  "Cell 2 of 2"; the status ends "Imported 2 Documents and 11 structural
  instances · Auto Layout applied to 2 of 2 Cells — Details"; Import Review
  shows the multi-subcircuit notice; the top Cell is wired with a supply and a
  ground symbol.
- One Undo removes every wire and disables Undo; Redo restores the layout.
- Importing a 121-resistor Cell beside a small one: "applied to 1 of 2 Cells;
  chain: more than 120 parts"; Details lists `AUTO_LAYOUT_TOO_LARGE` under
  `chain` and "top — applied".

## Deviations from the plan

1. **Stop condition**: see step 1.
2. **One presentation per run.** The netlist presentation is used when every
   listed Cell is netlist-only; the plan asked for a per-Cell choice. At
   import every Cell is netlist-only, so the result is the same.
3. The report is `{ run, cells }`, so the dialog and chip can tell a manual
   run from an import run.
4. The chip after a multi-Cell import reads "Auto Layout: k of n Cells" (the
   plan did not specify it).
5. A one-Cell import uses T014's wording after the headline, as step 8 says,
   so its Cancel status ends "the drawing is unchanged." The plan's Acceptance
   quoted the multi-Cell wording there.
6. Statuses the plan did not list: a worker failure ("… Auto Layout failed:
   …; every Cell stays as imported"), a worker load failure, and "; and m
   more" at the end of a long list.
7. After a rollback every planned Cell is reported as not applied: "could not
   commit (code)" for the failing one, "nothing was applied" for the others.
8. A commit the controller finds to change nothing is reported as "already
   laid out".
9. The notice sits outside the import report section, because that section
   is hidden by CSS on `main`.
10. A new `netlist-import.test-support.ts` keeps the browser specs from
    loading the controller.
11. `commitAsOneStep`, `liveProject` and `transactStepAtRevisions` are
    optional dependencies; only tests omit them.
12. T014's tests changed mechanically (`documentIds`, `results`, the report
    shape and props).
13. Size: about +835 / −149 lines of product code against the plan's 500–650
    estimate, and about +1490 lines of tests.

Existing import specs (`instance-table`, `netlist-conversion`,
`netlist-workflows`) wait for the run's final status before acting; no
assertion changed. `rnl-interchange` is unaffected.

## Not covered

- Layout of a Cadence netlist: only "the import calls `onImported`" is tested.
  Its `gnd!` is not node 0, so no ground symbols are drawn there.
- Layout quality of child Cells on the corpus: the evaluation plans top Cells
  only.
- In the browser: skipping an edited Cell, and a rollback. Both are covered by
  session tests with the real controller and planner. Cancel was checked by
  hand by the implementer.

## Review round 2

An independent Opus review of `a0b1fc5` approved with two P2s and several P3s
(posted on PR 101); the codex hook had no findings. Fixed in `e8432ce`:

1. **P2 — runs fence on the controller object, not only the session id.**
   The session id is `<project id>:<counter>`, and importing the same file in
   two tabs gives both the same id, so a result planned for one tab could be
   committed into the other. Both run kinds (the manual run inherited this
   from T014) now discard when the live controller is a different object, and
   the hook ends a run when the controller changes. Test: two controllers with
   equal session id, structure revision and revisions.
2. **P2 — a rollback names the Cell that failed.** `transactStepAtRevisions`
   returns `failed: { index, result }`, also when a commit throws.
3. Selection reset, fit and tool cancelling happen only when the open Cell was
   laid out.
4. With several Cells, a planner throw on one becomes that Cell's error
   (`AUTO_LAYOUT_PLANNER_FAILED`); the others keep their plans.
5. An import run left by a tab switch is stopped, and when that tab returns
   its status reads "… Auto Layout stopped because the tab was left; every
   Cell stays as imported — Details". The trace is in memory only. Runs are
   not kept alive across a tab switch: the write path is bound to the tab on
   screen.
6. The docs now say the netlist presentation is chosen per run.
7. A Cell with no result is a failure ("no plan was returned").
8. **The reviewer's unconfirmed concern was real.** A Document-level edit
   (`set_cell_symbol_presentation`, terminal labels) changes a Cell's symbol
   terminals without a structure revision, so a parent's plan could be made
   against a stale child symbol. A Cell that directly places an edited Cell is
   now skipped: "depends on <cell>, edited since import". Only direct parents
   are skipped.

Coordinator's rerun on `e8432ce`: build, typecheck, lint, format:check and
docs:check pass; `pnpm test:local` 8573 passed, 117 skipped; the six browser
specs 27 passed; `pnpm deadcode` as on `main`, no new finding. In the dev
server: a two-subcircuit import (applied to 2 of 2, one Undo clears every
wire), a one-Cell import (applied, one Undo back to the shelf), and the manual
command on that shelf (laid out with ground and supply symbols).
