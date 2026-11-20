# T014 — Auto Layout in the editor: one command, planned off the main thread, one undo step

- Branch: `task/T014-editor-auto-layout`
- Base: `main` at `c116f55`
- Status: approved

## Goal

The automatic layout planner (`packages/auto-layout`) has no product consumer:
only `scripts/auto-layout-eval.mjs` and `scripts/auto-layout-review.mjs` call
it. After this task a person with a Document open in the editor chooses
**Circuit → Layout → Auto Layout**. The planner runs in a Web Worker while the
editor stays responsive. The status bar shows progress and a Cancel button.
The finished plan is committed as **one** transaction through the editor's
normal write path, so a single Undo restores the drawing. A refusal or warning
from the planner (`AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED`,
`AUTO_LAYOUT_CONNECTION_REFUSED`, `AUTO_LAYOUT_NET_UNROUTED`,
`AUTO_LAYOUT_RULE_UNSATISFIED`, …) is shown in words, and the drawing is left
unchanged on a refusal. This is the first end-to-end use of the planner: the
owner sees in the product what the evaluation scripts measure.

## Decisions

The owner confirmed every default below on 2026-11-20. Each item gives the
decision first; the alternative is recorded only as what was not chosen.

1. **Menu and label.** Default: a new **Layout** section in the **Circuit** menu
   with one item, `Auto Layout`, in English like every existing menu item (no
   i18n exists). Command id `layout.auto`, plus `layout.auto-cancel`.
   Alternative: put it in **Edit**, or label it `Auto Layout Current Cell`.
2. **Shortcut.** Default: none in v1; the menu is the only entry. Alternative:
   bind a key now, which needs a free-key audit of `use-editor-shortcuts.ts`.
3. **Scope.** Default: the whole active Document (the Cell open on the
   canvas) and nothing else. Selection, locks and other Cells are ignored.
   Alternative: only the selection, which needs `fixedInstanceIds` and belongs
   to the later locks task.
4. **Search budget.** Default: the planner's own bounded deterministic search
   (`defaultLayoutSearch`, the budget the corpus timings were measured with:
   median 2 s, p90 8.5 s, max 37 s), with no deadline. The status shows elapsed
   seconds and annealer progress. Alternative: add a deadline (for example
   30 s) that truncates the search. The result stays valid but is no longer
   reproducible.
5. **If the Document changes while planning.** Default: discard the result.
   That covers an edit, an Agent commit, Undo, a switch to another Cell or a
   Project replacement. The status bar says the drawing changed and nothing was
   applied. Alternative: plan again automatically from the new revision.
6. **How a refusal looks.** Default: the status line gives a plain headline
   ("Auto Layout left the drawing unchanged: …"), and a **Details** button on
   the status chip opens a small dialog listing every diagnostic (severity,
   code, message). Warnings on an applied layout use the same chip. Alternative:
   the status line only, with no dialog.
7. **Selection and view afterwards.** Default: clear the selection and fit the
   view to the new drawing (`fitView({ announce: false })`). Alternative: keep
   the view and prune only the selected ids that disappeared.
8. **Editing while planning.** Default: non-modal. The editor stays editable,
   any commit makes the result stale (item 5), and starting a second run while
   one is planning is disabled. Alternative: a modal overlay that blocks the
   canvas until the plan finishes or is cancelled.

## Context

Verified at `main` `c116f55`.

### The planner API

- `planAutoLayout(document, resolver, options)` is at
  `packages/auto-layout/src/auto-layout.ts:309-323`. It wraps every plan in
  `refuseUnconnected` (`:255-307`), the R14a gate. On refusal it returns
  `edits: []` with one `AUTO_LAYOUT_CONNECTION_REFUSED` error and keeps the
  warnings.
- The entry exports are at `packages/auto-layout/src/index.ts:1-15`:
  `planAutoLayout`, `defaultLayoutSearch`, the LLM helpers, and the types
  `AutoLayoutOptions`, `AutoLayoutDiagnostic`, `AutoLayoutResult`,
  `RecognizedGroup`, `LayoutPartition` and `BlockRole`.
- `AutoLayoutOptions` is at `packages/auto-layout/src/types.ts:38-58`. It has
  `quality`, `partition`, `fixedInstanceIds`, `presentation` and
  `search: { seed, evaluations, deadline?, signal?, onProgress? }`.
- A diagnostic is `{ severity: "error" | "warning", code, rule, message }`
  (`types.ts:59-64`). The result is `{ edits, groups, diagnostics }`
  (`types.ts:81-85`). All three are plain JSON data, so they survive
  `postMessage` and structured clone.
- The per-result timing record is a `WeakMap` (`timing.ts:24-25`). It does not
  cross the worker boundary, and the editor does not need it.
- R17 (`docs/specs/auto-layout.md:431-435`): only an `error` means "no edits".
  Warnings come with a delivered plan.
- The planner is browser-safe.
  - `packages/auto-layout/src` and its runtime dependencies (`@icm/derived`,
    `devices`, `edit-engine`, `model`, `symbols`) import no `node:` module, no
    `fs`, no `process`, and no `window`/`document` global (grep, excluding
    tests).
  - The only timing call is `performance.now()` (`timing.ts:67,93`), which
    exists in workers.
  - `llm-layout.ts` makes no `fetch` call: the partitioner is injected.
  - `package.json` is ESM (`"type": "module"`). Its `exports` resolve
    `development` → `./src/index.ts` and `default` → `./dist/index.js`, the
    same pattern as `@icm/symbols`.
- **Determinism.** `docs/specs/auto-layout.md:146-150`: identical inputs give
  byte-identical edits. With `search`, the same seed and budget give the same
  edits. Only a deadline or cancellation that truncates the run may change the
  result. The eval script records a `planHash` per case
  (`scripts/auto-layout-eval.mjs:708`).
- **Default budget.** `defaultLayoutSearch(document)` (`auto-layout.ts:172-184`)
  returns `{ seed: 1, evaluations: 2 }` above 40 instances, and otherwise
  `max(2, planningBudget(n, 24))`.
  - Passing that object explicitly is equivalent to omitting `search`:
    `options.search ?? defaultLayoutSearch(...)` at `:901` and `:1497`.
  - That is how the eval script measures "bounded" mode with an `onProgress`
    (`scripts/auto-layout-eval.mjs:673-700`).
  - Quick mode is `search: { seed, evaluations: 0 }` (`:638-641`).
- **Progress is coarse.** `onProgress` is called only by the annealer
  (`packages/auto-layout/src/search.ts:76-84`), with
  `{ evaluations, best, current }`. `best` and `current` are internal scores
  with no meaning to a user. Quick planning, relocation, ports, rails and
  finishing report nothing, and for documents above 40 instances the annealer
  budget is 2. So the UI shows elapsed time, plus "evaluation n of N" only while
  the annealer runs.
- **Stop points.** `signal.aborted` / `deadline` are checked only between
  phases and inside some searches (`auto-layout.ts:413-417, 593-595, 640-642,
689-691, 838-840, 1000-1002`, `local-rail-markers.ts:73`). Within a phase the
  planner is synchronous.
- **Size cap.** Above 120 instances the planner refuses with
  `AUTO_LAYOUT_TOO_LARGE` (`auto-layout.ts:2271-2277`).
- **Diagnostic codes in `src` (non-test):** `CONNECTION_REFUSED`,
  `COUPLING_DOT_CONFLICT`, `DRAFTING_INTERFACE_UNSUPPORTED`
  (`drafting-interface.ts:126-133`, whose message is already user-readable),
  `DRAFTING_OVERLAP`, `NET_UNROUTED`, `PARTITION*`, `RULE_UNSATISFIED`,
  `TOO_LARGE`, `NETLIST_*`, `LLM_*`. Most messages start with a rule id
  ("R10: …").

### Traps

1. **`AbortSignal` cannot cross into the worker, and an in-worker one would
   never fire.** An `AbortSignal` cannot be cloned or transferred. Creating an
   `AbortController` inside the worker does not help: `planAutoLayout` is
   synchronous, so the worker never runs its `onmessage` for a "cancel" message
   until planning has finished. A `SharedArrayBuffer` flag needs cross-origin
   isolation (COOP/COEP), and `apps/editor/vite.config.ts` sets no such
   headers. **Cancel is `worker.terminate()`**: immediate, and nothing can have
   been applied, because the main thread applies only after it receives a
   result. Use one worker per run; a cancelled worker is never reused.
2. **The resolver is a class instance and cannot be posted.** The worker must
   rebuild it from the Project:
   - The editor builds it as `createProjectSymbolResolver(project,
this.availableCatalog)` (`apps/editor/src/document/document-controller.ts:189-191`).
     `availableCatalog` is `builtInSymbols` plus component definitions offered
     for insertion but not placed yet (`:150-151, :165-187`).
   - Placed definitions are in `project.componentDefinitions`. The controller
     merges them on commit (`:526-540`).
   - The eval script uses `createProjectSymbolResolver(project, builtInSymbols)`
     (`scripts/auto-layout-eval.mjs:471`).
   - The worker therefore receives the whole `CircuitProject` (hierarchical
     Cell symbols are resolved from its other Documents) and builds the
     resolver the eval script uses. A step below proves that this resolves
     every instance on the examples.
3. **A stale result must not land.** Two cases:
   - **Document edits.** `executeTransaction` rejects with `STALE_REVISION`
     when `expectedRevision !== document.revision`
     (`packages/edit-engine/src/transaction.ts:134-139`). Committing with the
     revision captured at the start therefore rejects any plan whose Document
     changed.
   - **Not covered by that check.** The controller does not check
     `expectedStructureRevision` for human Document transactions. It is checked
     only for agent history (`document-controller.ts:470-471, 628-632`). A
     Project replacement or tab switch changes `projectSessionId`, and a Cell
     switch changes the active Document id.
   - So the session must compare `projectSessionId`, `project.structureRevision`,
     the active Document id **and** `document.revision` before it commits.
4. **The editor does not expose the revision-fenced write.**
   - `useDocumentController` returns
     `dispatchTransaction(request: EditorTransactionRequest)`
     (`document-controller.ts:813-821`). It synchronizes and stages recovery,
     but `App.tsx` does not destructure it (`App.tsx:680-693`).
   - `createEditorTransactionCommands().transact`
     (`apps/editor/src/app/editor-transaction-commands.ts:143-192`) always
     stamps the _current_ revision through `controller.transact`
     (`document-controller.ts:402-427`). Using it would silently apply a stale
     plan.
   - The status line (`applyResult`, `:128-141`) and the rule that an unrelated
     commit cancels a transient tool (`:177-191`, documented at `:56-60`) live
     in `transact`. The new write path must reuse them, not bypass them.
5. **Undo / one step.** One `dispatchTransaction` makes one history entry
   (`record`, `document-controller.ts:279-298`). Undo restores the content
   with a **new** revision (`:645-660`), so "restores exactly" means equal
   Document JSON ignoring `revision`. Use `sameDocumentJson(a, b, true)`, which
   already ignores it (`:507`). A plan whose edits produce identical JSON comes
   back `applied: false` with no history entry (`:507-523`). That case must
   read "Already laid out; nothing changed", not "Committed".
6. **Actor.** `EditActorSchema.kind` is `"human" | "agent"`
   (`packages/edit-engine/src/edit-schema.ts:40-43`). This is a user command,
   so the actor is `{ kind: "human", id: "human-local" }`, as in
   `controller.transact` (`:422`). `MAX_SCHEMATIC_EDITS_PER_TRANSACTION` is
   1024 (`edit-schema.ts:532`). The planner enforces it itself (R16,
   `docs/specs/auto-layout.md:429-430`).
7. **Editor command router.**
   - Requests form a closed union (`apps/editor/src/commands/editor-command.ts:9-38`).
   - Availability comes from an `EditorCommandContext` of booleans (`:51-70`).
   - Effects go through an `EditorCommandOperations` interface (`:72-111`).
   - A disabled command run from a menu reports its `reason` through
     `operations.report` (`:286-302`).
   - The context is built in `useEditorCommandRouter`
     (`apps/editor/src/app/use-editor-command-router.ts:181-207`). It has no
     read-only or component-editor flag.
   - Keyboard routing returns early while the component editor
     (`use-editor-shortcuts.ts:323`) or an interface confirmation (`:338`)
     is open.
   - Router tests use a full context fixture
     (`apps/editor/src/commands/editor-command.test.ts:10-30`). Every new
     context field must be added there.
8. **Menus.** The Circuit menu is `<details data-testid="circuit-menu">` in
   `apps/editor/src/app/editor-app-chrome.tsx:264-325`. It has sections
   **Hierarchy** and **Netlist**, each a `command-section` with a
   `command-section-title`. Props come from `EditorMenuBar`
   (`apps/editor/src/app/editor-menus.tsx:69`, wiring at `:420-590`), which
   App renders at `App.tsx:4740`.
9. **Feedback surfaces.** The status line is a `useState` string
   (`App.tsx:567`) rendered by `EditorStatusbar`
   (`apps/editor/src/features/editor-shell/editor-statusbar.tsx:148-152`,
   `aria-live="polite"`). The status bar already has a chip with an action
   button: `agentExpiring` / "Keep connected" (`:154-170`). That is the
   pattern for the "Auto Layout… Cancel" chip. No progress bar exists anywhere
   in `apps/editor/src`.
10. **Workers in the editor.**
    - The editor currently has no Worker of its own. The RNL runtime creates
      its own worker inside its package.
    - Precedent: T006 removed `features/simulation/artifact-codec.worker.ts`
      (see `git show b2ddf6d`). It used
      `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`
      and kept a pure `-core.ts` beside the worker.
    - Config is ready for module workers:
      - `vite.config.ts:62` and `vite.desktop.config.ts` both set
        `worker: { format: "es" }`.
      - Knip already treats `src/**/*.worker.ts!` as an editor entry
        (`knip.config.js:61`).
      - The service worker already caches `destination: "worker"` assets
        (`apps/editor/public/sw.js:62-74`), so no cache list changes.
    - The editor-bundle budget (`scripts/editor-bundle-budget.mjs`,
      `fixtures/editor-bundle-budget/report.json`, editor gzip ceiling
      1047 KiB vs 951.8 KiB measured) counts only first-paint assets. The
      planner and symbol catalogue must stay out of the main bundle: import
      them only from the worker file. In the main thread import only _types_
      from `@icm/auto-layout`.
11. **Tests cannot run a real Worker.** Vitest runs in Node/jsdom with no
    `Worker`. React `.tsx` tests get an isolated registry
    (`vitest.config.ts:19-30`). The worker file must stay a thin shell over a
    pure function that tests call directly. The Worker constructor is
    injected, so hook and session tests use a fake. CODING_STANDARDS.md
    item 3: the planner and Edit Engine in those tests are the real ones; only
    the thread boundary is faked. The real Worker path is proved in a
    Playwright spec (`apps/editor/e2e/`, `pnpm test:e2e:local`). CI runs only
    `pnpm test:local` (`.github/workflows/ci.yml:46-55`).
12. **Dependency and lockfile.** `@icm/auto-layout` is not in
    `apps/editor/package.json`. Adding `"@icm/auto-layout": "workspace:*"`
    changes `pnpm-lock.yaml` (an importer entry only, no network). CI installs
    with `--frozen-lockfile` (`ci.yml:46`). AGENTS.md:31-32 forbids lockfile
    changes unless the plan says so. **This plan says so**, for that one
    workspace link.
13. **Corpus facts for UX.** On main 612 of 628 corpus Documents complete and
    16 are refused (`tasks/T142-amplifier-polarity/plan.md:176`), with
    `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED` (rule R161: frames whose drawn
    interfaces the planner cannot keep). Planning time per Document, bounded
    mode, measured on the 628-case corpus at `c116f55` (8 processes on a
    laptop): median 2 s, p90 8.5 s, max 37 s. Most runs finish in
    seconds, and some long enough that Cancel matters.
14. **Examples for manual checks.** `http://127.0.0.1:5173/editor?example=<id>`
    opens a bundled example (`apps/editor/src/app/use-project-entry.ts:90-107`).
    The ids are `common-source-amplifier`, `two-stage-op-amp`,
    `current-mirror-loaded-differential-pair`,
    `fully-differential-two-stage-op-amp` and `five-transistor-ota-sky130`
    (`apps/editor/src/examples/library-examples.ts:33-75`). None contains a
    drafting rectangle, so none is refused. The refused case needs a built
    fixture: the `frameDocument()` pattern in
    `packages/auto-layout/test/drafting-interface.test.ts:47-75`.
15. **Docs that name T014.**
    - `docs/specs/auto-layout.md:10` says "Locks and the UI entry are **T014,
      not yet specified**".
    - `:146` says "Obstacle-aware placement belongs to T014". This task does
      not do that, so the sentence must point at a later task.
    - `docs/specs/README.md:17` lists auto-layout as "(proposed)".
    - `knip.config.js:94-98` holds the `includeEntryExports: false` override
      "remove then".
    - No spec or MCP guidance enumerates editor menu commands. The only user
      doc naming menu items is `docs/user/schematic-hierarchy.md:10`, and
      nothing generated lists commands, so no generator needs to run.
      `docs/specs/editor-interaction.md` (owner `apps/editor`) is the right
      home for the UI contract.

## Scope

Owned paths (may be created, edited or deleted):

- `apps/editor/src/features/auto-layout/` (new):
  - `auto-layout-protocol.ts`: message types.
  - `auto-layout-core.ts`: the pure worker function.
  - `auto-layout.worker.ts`: the thin shell.
  - `auto-layout-session.ts`: run lifecycle, staleness and apply decision.
  - `use-auto-layout.ts`: the React hook.
  - `auto-layout-report.tsx`: the details dialog.
  - Tests beside each file.
- `apps/editor/src/commands/editor-command.ts` and `editor-command.test.ts`
- `apps/editor/src/app/use-editor-command-router.ts`
- `apps/editor/src/app/editor-transaction-commands.ts` and its test (one new
  revision-fenced write function)
- `apps/editor/src/app/editor-menus.tsx`, `editor-app-chrome.tsx`
- `apps/editor/src/features/editor-shell/editor-statusbar.tsx` and its test
  (the chip)
- `apps/editor/src/app/App.tsx` (wiring only, kept to roughly 40 lines)
- `apps/editor/src/styles.css` or the status-bar CSS it already uses (chip
  styling only)
- `apps/editor/e2e/auto-layout.spec.ts` (new)
- `apps/editor/package.json` (one dependency) and `pnpm-lock.yaml` (its
  workspace link only)
- `knip.config.js` (lines 94-98)
- `packages/auto-layout/src/index.ts`, only if `pnpm deadcode` requires it
  after the knip override is removed (step 10)
- `docs/specs/auto-layout.md` (header and line 146), `docs/specs/README.md:17`,
  `docs/specs/editor-interaction.md` (new section)

Out of scope (do not change):

- Everything else under `packages/auto-layout/` (no planner behaviour, options,
  diagnostics or messages).
- Lock fields or a "keep these fixed" UI (`fixedInstanceIds`), automatic layout
  after netlist import, `presentation: "netlist"`, a before/after preview
  dialog, and "quick first, refine in background". These are later tasks.
- `packages/edit-engine`, `apps/editor/src/document/document-controller.ts`
  (use its existing `dispatchTransaction`), and the Agent API / MCP surface
  (no Agent operation for auto layout).
- `scripts/auto-layout-*.mjs`, the corpus, and anything under `tmp/` or Gallery
  drawings.

## Steps

1. **Investigate: planner cost and resolver parity on the shipped examples.**
   Write a throwaway Node script (do not commit it; put it under `tmp/`). For
   the top Document of each example in `apps/editor/src/examples/*.icproj.json`:
   1. Build `createProjectSymbolResolver(project, builtInSymbols)` and confirm
      that every `instance.symbolId` resolves.
   2. Run `planAutoLayout` in quick mode (`{ seed: 1, evaluations: 0 }`) and in
      default mode.
   3. Apply each plan with `executeTransaction` as
      `scripts/auto-layout-eval.mjs:622-636` does.

   Report, per example: instance count, ms for each mode, edit count,
   diagnostics, and whether the transaction applied. Name the slowest example
   (the manual Cancel check) and one example whose layout visibly changes (the
   manual apply check). If any symbol fails to resolve with `builtInSymbols`,
   stop and report: decision 3 and the worker protocol would have to change.

2. **Protocol and pure core (tests first).** In `auto-layout-protocol.ts`
   define:
   - `AutoLayoutWorkerRequest = { type: "plan"; runId: number; project:
CircuitProject; documentId: string; search: { seed: number; evaluations:
number } }`
   - `AutoLayoutWorkerMessage =`
     - `{ type: "progress"; runId; evaluations; budget }`
     - `| { type: "result"; runId; result: AutoLayoutResult; milliseconds }`
     - `| { type: "failed"; runId; message }`

   Import `@icm/auto-layout` _types only_ here.

   In `auto-layout-core.ts` add
   `runAutoLayout(request, post: (m) => void): void`. It builds the resolver as
   in step 1, finds the Document (missing → `failed`), and calls
   `planAutoLayout(document, resolver, { search: { ...request.search,
onProgress: (p) => post({ type: "progress", runId, evaluations:
p.evaluations, budget: request.search.evaluations }) } })`. It posts
   `result`, and turns a thrown error into `failed`.

   Tests in `auto-layout-core.test.ts`, each with an explicit `60_000`
   timeout. Use quick mode except where a test needs search, and then the
   smallest example:
   - The result equals a direct `planAutoLayout` call byte for byte
     (`JSON.stringify`) on `two-stage-op-amp`.
   - `structuredClone(result)` deep-equals the result.
   - Progress messages carry the budget and never exceed it.
   - A missing `documentId` posts `failed`.
   - A drafting-interface fixture (the `frameDocument` pattern) posts a result
     whose only error is `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED` with
     `edits: []`.

3. **Worker shell.** `auto-layout.worker.ts` contains only
   `onmessage = (e) => runAutoLayout(e.data, (m) => postMessage(m))`, with the
   global typed the way the T006 artifact-codec worker typed it (no DOM-lib
   change). It is the only file that imports `@icm/auto-layout` and
   `@icm/symbols` values for this feature.

4. **Revision-fenced write (tests first).** In `editor-transaction-commands.ts`:
   - Add a dependency `dispatchTransaction(request: EditorTransactionRequest)`.
   - Add a function `transactAtRevision(expectedRevision: number,
edits: SchematicEdit[], transactionId: string): EditTransactionResult`.
     It builds the envelope for the current `document.id` with
     `expectedStructureRevision: project.structureRevision` and the
     `human-local` actor. It shares `applyResult` and the
     interaction-cancelling tail of `transact` (`:143-192`). Factor that tail
     out; do not copy it.

   Tests in `editor-transaction-commands.test.ts`:
   - A matching revision commits once.
   - A stale revision returns `STALE_REVISION` and the status says nothing was
     applied.
   - A commit during a non-idle interaction cancels it with the existing
     message.

   In `App.tsx`, destructure `dispatchTransaction` from
   `useDocumentController` (`:680-693`) and pass it.

5. **Session (tests first).** `auto-layout-session.ts` is a framework-free
   state machine: `idle → planning → idle`, with an injected
   `createWorker: () => WorkerLike`. On `start(snapshot)` it records
   `{ runId, projectSessionId, structureRevision, documentId, revision }`,
   creates a worker, and posts the request with
   `search: defaultLayoutSearch(document)`. The `defaultLayoutSearch` value
   import is the one exception to type-only: it is small. If it pulls the
   planner into the main bundle (check in step 12), compute the budget inside
   the worker and send `search: undefined` instead.

   On `result` it terminates the worker, then decides:
   - **Stale.** Any of the four keys differs from the live snapshot, which it
     reads through an injected getter: discard, with "The drawing changed while
     Auto Layout was planning; nothing was applied."
   - **Error diagnostic.** Leave the drawing unchanged and report.
   - **Empty edits, no error.** "Already laid out; nothing changed".
   - **Otherwise.** Call `transactAtRevision`. When the result is
     `applied: false`, use the already-laid-out message too.

   It also handles:
   - `cancel()`: `terminate()`, back to `idle`, "Auto Layout cancelled; the
     drawing is unchanged."
   - The worker's `error` event (for example a chunk 404 after a deploy):
     "Auto Layout could not start: …".
   - A late message from a terminated `runId` is ignored.

   Headline wording per known code:
   - `DRAFTING_INTERFACE_UNSUPPORTED`: use the planner's own message.
   - `CONNECTION_REFUSED`: "could not connect every pin".
   - `TOO_LARGE`: "more than 120 parts".
   - Any other error: its message.
   - On an applied plan, warnings are counted ("applied with N warnings —
     Details").

   Tests in `auto-layout-session.test.ts` with a fake worker driving the
   **real** controller (`EditorDocumentController` + the real
   `runAutoLayout` called synchronously from the fake). Cover:
   - Apply.
   - One Undo restores `sameDocumentJson(…, true)`.
   - Cancel leaves the revision and JSON unchanged.
   - An edit committed between start and result discards the plan.
   - A Cell switch and a project session change discard it too.
   - A refused fixture leaves the drawing unchanged and reports the code.
   - A second `start` while planning is refused.

6. **Commands.** In `editor-command.ts`:
   - Add `{ id: "layout.auto" }` and `{ id: "layout.auto-cancel" }` to the
     union.
   - Add context fields `autoLayoutRunning: boolean` and
     `hasLayoutTarget: boolean` (Document has ≥1 instance and no component
     editor or interface confirmation is open).
   - Add operations `startAutoLayout()` and `cancelAutoLayout()`.

   Availability of `layout.auto`, checked in this order:
   - Disabled "Auto Layout is already running" while running.
   - "Finish or cancel the active tool first" unless
     `interactionMode === "idle"` and there is no canvas drag.
   - "Nothing to lay out" without a target.

   `layout.auto-cancel` is enabled only while running.

   Extend the `fixture()` in `editor-command.test.ts` and add state/execute
   tests. Wire the context and operations in `use-editor-command-router.ts`,
   with the values coming from `use-auto-layout.ts`.

7. **Hook.** `use-auto-layout.ts` owns one session per editor. Its default
   worker factory is
   `new Worker(new URL("./auto-layout.worker.ts", import.meta.url), { type: "module" })`.
   It exposes `{ running, progress: { evaluations, budget, startedAt } | null,
report: AutoLayoutDiagnostic[] | null, start, cancel, clearReport }`. It
   terminates on unmount and on a `projectSessionId` change, and calls
   `setStatus`. After an applied plan it calls `clearEditorSelection()` and
   `fitView({ announce: false })` (decision 7).

8. **Menu.** In `editor-app-chrome.tsx`, add a third Circuit-menu section
   **Layout**, after Netlist. It has a `command-section-title` and one
   `<button data-testid="auto-layout-command">Auto Layout</button>`, disabled
   when `layout.auto` is disabled, with `title` set to the reason. Pass
   `autoLayout: { enabled, reason, execute }` from `editor-menus.tsx`.

9. **Status chip and report dialog.** In `editor-statusbar.tsx`, add an
   optional `autoLayout` prop, rendered as a chip in the `agentExpiring`
   style:
   - **While running.** "Auto Layout… 12 s" (plus " · evaluation 3/24" when
     progress has a budget) and a Cancel button
     (`data-testid="auto-layout-cancel"`).
   - **When a report exists.** "Auto Layout: refused" or "…: N warnings", with
     a Details button (`data-testid="auto-layout-details"`). It opens
     `auto-layout-report.tsx`, a small dialog listing severity, code and
     message, which reuses an existing dialog shell from `editor-dialogs.tsx`.

   Update `editor-statusbar.test.tsx` for both states. Elapsed seconds tick
   from a 1 s interval in the hook, not per render.

10. **Knip.** Remove the `packages/auto-layout` override at
    `knip.config.js:94-98` as its comment asks. Run `pnpm deadcode`.
    - An index export that is now unused and that no script imports: drop it
      from `index.ts` only.
    - An index export used only by `scripts/` through `dist/index.js` (the LLM
      helpers, via `scripts/auto-layout-eval.mjs:73`): tag it `@public` with
      that reason, per the knip header (`knip.config.js:11-14`).

    Report each export and what was done with it.

11. **Docs.**
    - `docs/specs/editor-interaction.md`: add an "Automatic layout" section,
      at most about 15 lines. Cover the entry, scope, worker, progress and
      Cancel, staleness discard, one transaction and one Undo, refusal
      display, and selection and view.
    - `docs/specs/auto-layout.md:10`: replace the sentence with "The editor
      entry is specified in [editor-interaction.md](editor-interaction.md#automatic-layout)
      (T014); locks are a later task."
    - `docs/specs/auto-layout.md:146`: change "belongs to T014" to "belongs to
      the locks task".
    - Leave the spec's `Status: proposed` and `docs/specs/README.md:17`
      unchanged unless the owner decides otherwise (say so in the report).

12. **Bundle check.** Run `pnpm test:editor-build` and
    `node scripts/editor-bundle-budget.mjs --check`. Confirm that a separate
    `auto-layout.worker-*.js` asset exists in `apps/editor/dist/assets/` and
    that no first-paint chunk contains planner code (grep the eager chunks for
    a planner-only string such as `AUTO_LAYOUT_CONNECTION_REFUSED`).

13. **Browser spec.** Add `apps/editor/e2e/auto-layout.spec.ts`:
    1. Open the step-1 example by `?example=`.
    2. Export the project, run Circuit → Auto Layout, and wait for the
       status.
    3. Assert that the Document changed. Use `exportedProject`
       (`apps/editor/e2e/editor-fixtures.ts:572`) and compare Documents
       without `revision`.
    4. Undo once and assert that it equals the export from before the run.
    5. Open the refused fixture with `openProjectFile` (`:555`) and assert the
       status and the Details dialog name
       `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED`. Assert the Document is
       unchanged.

    Cancel is proved in step 5. Add it here too only if the step-1 slowest
    example plans long enough (≥3 s) to cancel without a race; otherwise say
    so in the report.

## Acceptance

Run from the repository root; all must pass.

```bash
pnpm install --offline   # expected: only the @icm/editor importer gains @icm/auto-layout in pnpm-lock.yaml
pnpm exec vitest run apps/editor/src/features/auto-layout apps/editor/src/commands apps/editor/src/app/editor-transaction-commands.test.ts apps/editor/src/features/editor-shell/editor-statusbar.test.tsx   # expected: all pass, new tests included
pnpm typecheck        # expected: exit 0
pnpm lint             # expected: exit 0
pnpm format:check     # expected: exit 0
pnpm docs:check       # expected: exit 0 (new anchor resolves)
pnpm deadcode         # expected: exit 0 with the auto-layout override removed
pnpm test:local       # expected: all pass
pnpm build            # expected: exit 0
pnpm test:editor-build && node scripts/editor-bundle-budget.mjs --check   # expected: "Within budget."; desktop build passes
pnpm test:e2e:local apps/editor/e2e/auto-layout.spec.ts                   # expected: all pass
git diff --stat main -- packages/auto-layout   # expected: at most packages/auto-layout/src/index.ts
```

Behavioral checks: start the `editor` config from `.claude/launch.json`, which
serves port 5173.

- Open `http://127.0.0.1:5173/editor?example=<the step-1 example that
changes>`. Choose Circuit → Layout → Auto Layout.
  - While it plans, the status chip shows "Auto Layout…" with elapsed seconds,
    and the canvas still pans.
  - When it finishes, the drawing changes, the view fits it, and the status
    reads as committed.
- Press Undo (toolbar or Ctrl/Cmd+Z) **once**. The drawing is exactly the
  original: File → Export Project File before the run and after Undo, and the
  Documents differ only in `revision`. Redo brings the layout back.
- Open the refused fixture (the step-13 project file). Run Auto Layout. The
  drawing does not change, the status headline gives the reason, and Details
  lists `AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED` with the frame ids.
- Open the slowest example from step 1, run Auto Layout, and click Cancel
  within a second. The status reads "cancelled", the revision in the telemetry
  is unchanged, and Undo has nothing new to undo.
- Run Auto Layout, then move a part before it finishes. The result is
  discarded with the "drawing changed" message, and the moved part stays where
  it was put.
- While a run is planning the menu item is disabled with its reason in the
  tooltip. With the component editor open, or on an empty Cell, it is disabled
  too.

## Notes for the implementer

- Implementation is by a Claude subagent, and review is by an independent Opus
  subagent before any PR. Codex is not used for this task.
- The planner in the main thread is forbidden, including as a fallback when
  `Worker` is undefined. Report "Auto Layout needs Web Workers" instead.
- Do not pass `signal` or `deadline` to the planner in v1 (decision 4). Cancel
  is `terminate()`.
- Every new test that calls the planner uses quick mode
  (`{ seed: 1, evaluations: 0 }`) unless it tests search progress, and passes
  an explicit `60_000` timeout. CI is about 4× slower than a laptop
  (`tasks/T144-test-timeouts/plan.md`). Do not touch `vitest.config.ts`.
- Keep `App.tsx` changes to wiring. Put logic in
  `apps/editor/src/features/auto-layout/`.
- The planner's messages carry rule ids ("R10: …"). Show them unchanged in the
  Details dialog. Only the one-line status headline is rephrased.
- Never commit anything from `tmp/`, corpus drawings or Gallery drawings. The
  refused fixture is built in TypeScript from the `frameDocument` pattern, not
  copied from the corpus.
- No step spends LLM API tokens. Do not call `planAutoLayoutWithLlm` or any
  partition provider.
- Commits end with a `Test-Impact: tests-updated` trailer
  (`docs/testing/README.md`).
- **Size and possible split.** Expected size is about 600–800 lines of product
  code and about 500 of tests, which is one reviewable diff. If review finds it
  too large, split it:
  - **T014a.** Steps 1–7 and 10–12: worker, session, command, write path and
    status-line feedback, ending at a working command with status-line
    messages only.
  - **T014b.** Steps 8, 9 and 13: menu section, status chip, Details dialog
    and browser spec.

  T014a alone has no menu entry: the command would be reachable only from
  tests. That is why the default is one task.
